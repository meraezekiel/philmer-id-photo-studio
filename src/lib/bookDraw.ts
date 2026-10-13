/**
 * What a page looks like, in millimetres: where each photo goes and which
 * part of it shows, plus the cover text. Pure, so the screen preview and the
 * 300 DPI print are drawn from the same numbers.
 */

import { cropRect, effectiveDpi, LOW_DPI } from './bookCrop'
import { fitRect, layoutById, resolveFrames } from './bookLayouts'
import { pageMmOf, photoAspect } from './bookModel'
import type { Book, BookCover, BookFont, BookPage, NormRect, RectMm, SizeMm } from './bookTypes'

export interface DrawFrame {
  index: number
  photoId: string | null
  /** Where the photo is drawn; extends into the bleed at the trim edge. */
  rect: RectMm
  /** The part of the photo drawn into `rect`, or null for an empty frame. */
  source: NormRect | null
  missing: boolean
  lowRes: boolean
  dpi: number | null
}

export interface PageDraw {
  page: SizeMm
  bleedMm: number
  color: string
  frames: DrawFrame[]
}

const EPS = 1e-6

export function pageDraw(book: Book, page: BookPage, options: { bleedMm?: number; missing?: ReadonlySet<string> } = {}): PageDraw {
  const size = pageMmOf(book)
  const bleed = Math.max(0, options.bleedMm ?? 0)
  const layout = layoutById(page.layoutId)
  const base: PageDraw = { page: size, bleedMm: bleed, color: book.style.color, frames: [] }
  if (!layout) return base
  const rects = resolveFrames(layout, size, book.style)
  base.frames = layout.frames.map((lf, index): DrawFrame => {
    const frame = page.frames[index]
    const photo = frame?.photoId ? book.photos.find((p) => p.id === frame.photoId) : undefined
    const box = rects[index]
    if (!photo || box.w <= EPS || box.h <= EPS) {
      return { index, photoId: photo?.id ?? null, rect: box, source: null, missing: false, lowRes: false, dpi: null }
    }
    const aspect = photoAspect(photo)
    let rect: RectMm
    let source: NormRect
    if (lf.fit === 'photo') {
      rect = fitRect(box, aspect)
      source = { x: 0, y: 0, w: 1, h: 1 }
    } else {
      // Crop for the trim, then grow both rectangles together into the bleed
      // so nothing inside the trim moves.
      const crop = cropRect(aspect, box.w / box.h, frame.crop)
      const sx = crop.w / box.w
      const sy = crop.h / box.h
      const want = (touching: boolean) => (touching ? bleed : 0)
      const wl = want(box.x <= EPS)
      const wt = want(box.y <= EPS)
      const wr = want(box.x + box.w >= size.widthMm - EPS)
      const wb = want(box.y + box.h >= size.heightMm - EPS)
      const l = Math.min(wl, crop.x / sx)
      const t = Math.min(wt, crop.y / sy)
      const r = Math.min(wr, (1 - crop.x - crop.w) / sx)
      const b = Math.min(wb, (1 - crop.y - crop.h) / sy)
      if (wl === 0 && wt === 0 && wr === 0 && wb === 0) {
        rect = box
        source = crop
      } else if (l < wl - EPS || t < wt - EPS || r < wr - EPS || b < wb - EPS) {
        // The photo runs out before the bleed does (a zoom-1 crop uses the
        // whole photo on one axis). Crop for the bled rectangle instead, so
        // the bleed is always photo, never a band of page colour that shows
        // on a miscut. The trim then shows the middle of a ~3% larger crop.
        rect = { x: box.x - wl, y: box.y - wt, w: box.w + wl + wr, h: box.h + wt + wb }
        source = cropRect(aspect, rect.w / rect.h, frame.crop)
      } else {
        rect = { x: box.x - l, y: box.y - t, w: box.w + l + r, h: box.h + t + b }
        source = { x: crop.x - l * sx, y: crop.y - t * sy, w: crop.w + (l + r) * sx, h: crop.h + (t + b) * sy }
      }
    }
    const dpi = effectiveDpi(photo, source, rect)
    return { index, photoId: photo.id, rect, source, missing: options.missing?.has(photo.id) ?? false, lowRes: dpi < LOW_DPI, dpi }
  })
  return base
}

// --- cover text ------------------------------------------------------------

export const FONT_FAMILIES: Record<BookFont, string> = {
  archivo: 'Archivo',
  playfair: '"Playfair Display"',
  greatvibes: '"Great Vibes"',
}
export const FONT_WEIGHTS: Record<BookFont, number> = { archivo: 800, playfair: 700, greatvibes: 400 }
export const FONT_LABELS: Record<BookFont, string> = { archivo: 'Modern', playfair: 'Classic', greatvibes: 'Script' }

export function fontCss(font: BookFont, sizePx: number): string {
  return `${FONT_WEIGHTS[font]} ${sizePx}px ${FONT_FAMILIES[font]}`
}

export interface TextLine {
  text: string
  font: BookFont
  sizeMm: number
  /** Centre of the line. */
  x: number
  baseline: number
  color: string
}

/** Width in millimetres of `text` set at `sizeMm`. */
export type Measure = (text: string, font: BookFont, sizeMm: number) => number

/** For tests and as a fallback: an average glyph is 0.55 of the size wide. */
export const approximateMeasure: Measure = (text, _font, sizeMm) => text.length * sizeMm * 0.55

const MIN_TITLE_MM = 4
const MIN_SUBTITLE_MM = 2.5

export function coverText(cover: BookCover, page: SizeMm, measure: Measure): TextLine[] {
  const title = cover.title.trim()
  const subtitle = cover.subtitle.trim()
  if (!title && !subtitle) return []
  const maxW = page.widthMm * 0.84
  const fit = (text: string, start: number, min: number) => {
    let size = start
    while (size > min && measure(text, cover.font, size) > maxW) size *= 0.95
    return Math.max(size, min)
  }
  const titleSize = title ? fit(title, page.widthMm * 0.12, MIN_TITLE_MM) : 0
  const subStart = titleSize ? Math.min(page.widthMm * 0.045, titleSize * 0.45) : page.widthMm * 0.045
  const subSize = subtitle ? fit(subtitle, Math.max(subStart, MIN_SUBTITLE_MM), MIN_SUBTITLE_MM) : 0
  const gap = titleSize && subSize ? subSize * 0.8 : 0
  const block = titleSize + gap + subSize
  const top =
    cover.position === 'top' ? page.heightMm * 0.08 : cover.position === 'middle' ? (page.heightMm - block) / 2 : page.heightMm * 0.92 - block
  const lines: TextLine[] = []
  const x = page.widthMm / 2
  if (title) lines.push({ text: title, font: cover.font, sizeMm: titleSize, x, baseline: top + titleSize * 0.8, color: cover.textColor })
  if (subtitle) lines.push({ text: subtitle, font: cover.font, sizeMm: subSize, x, baseline: top + titleSize + gap + subSize * 0.8, color: cover.textColor })
  return lines
}

export function pageText(book: Book, pageIndex: number, measure: Measure): TextLine[] {
  const page = book.pages[pageIndex]
  if (!page || page.layoutId !== 'cover' || !book.cover) return []
  return coverText(book.cover, pageMmOf(book), measure)
}
