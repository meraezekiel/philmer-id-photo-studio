/**
 * Pixels for the book: thumbnails for the screen, frame-sized crops from Rust
 * for print. Both go through `paintPage`, so the screen shows what prints.
 */

import { pageDraw, pageText, fontCss, type DrawFrame, type Measure, type PageDraw, type TextLine } from '../../lib/bookDraw'
import { cutLines, LABEL_SIZE_MM, pagesOnSheet, type SheetPlan } from '../../lib/bookSheets'
import type { Book, BookFont } from '../../lib/bookTypes'
import { applyEnhance, applyEnhanceInStrips, NEUTRAL_ENHANCE, type EnhanceSettings } from '../../lib/enhance'
import { CUT_MARK_WIDTH_MM } from '../../lib/layout'
import { bookRenderPhoto, bookThumb } from '../../lib/tauri'

// --- thumbnails -------------------------------------------------------------

const thumbs = new Map<string, Promise<HTMLImageElement>>()

export function thumbImage(id: string): Promise<HTMLImageElement> {
  let pending = thumbs.get(id)
  if (!pending) {
    pending = bookThumb(id).then(
      (bytes) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('the thumbnail could not be shown'))
          }
          img.src = url
        }),
    )
    // A failure is not cached: the photo may be relinked and loaded again.
    pending.catch(() => {
      if (thumbs.get(id) === pending) thumbs.delete(id)
    })
    thumbs.set(id, pending)
  }
  return pending
}

export function thumbSrc(id: string): Promise<string> {
  return thumbImage(id).then((img) => img.src)
}

export async function thumbPixels(id: string): Promise<ImageData> {
  const img = await thumbImage(id)
  const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight)
}

export function clearThumbCache(): void {
  for (const pending of thumbs.values()) pending.then((img) => URL.revokeObjectURL(img.src)).catch(() => {})
  thumbs.clear()
}

// --- photo sources ----------------------------------------------------------

/** The frame's photo at exactly `width` x `height` px, or null to leave it blank. */
export type PhotoSource = (frame: DrawFrame, width: number, height: number) => Promise<CanvasImageSource | null>

const isNeutral = (e: Required<EnhanceSettings>) =>
  (Object.keys(NEUTRAL_ENHANCE) as (keyof EnhanceSettings)[]).every((k) => e[k] === NEUTRAL_ENHANCE[k])

export function previewSource(book: Book): PhotoSource {
  return async (frame, width, height) => {
    if (!frame.photoId || !frame.source) return null
    const photo = book.photos.find((p) => p.id === frame.photoId)
    const img = await thumbImage(frame.photoId).catch(() => null)
    if (!img || !photo) return null
    const s = frame.source
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, s.x * img.naturalWidth, s.y * img.naturalHeight, s.w * img.naturalWidth, s.h * img.naturalHeight, 0, 0, width, height)
    if (!isNeutral(photo.enhance)) {
      const out = applyEnhance(ctx.getImageData(0, 0, width, height), photo.enhance)
      ctx.putImageData(new ImageData(out.data as Uint8ClampedArray, width, height), 0, 0)
    }
    return canvas
  }
}

export function printSource(book: Book): PhotoSource {
  return async (frame, width, height) => {
    if (!frame.photoId || !frame.source) return null
    const photo = book.photos.find((p) => p.id === frame.photoId)
    if (!photo) return null
    const bytes = await bookRenderPhoto({ path: photo.path, crop: frame.source, width, height })
    let image = { width, height, data: new Uint8ClampedArray(bytes) }
    if (!isNeutral(photo.enhance)) image = applyEnhanceInStrips(image, photo.enhance) as typeof image
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')!.putImageData(new ImageData(image.data as Uint8ClampedArray, width, height), 0, 0)
    return canvas
  }
}

// --- text -------------------------------------------------------------------

let measureContext: OffscreenCanvasRenderingContext2D | null = null

export const measureText: Measure = (text, font: BookFont, sizeMm) => {
  measureContext ??= new OffscreenCanvas(1, 1).getContext('2d')
  if (!measureContext) return text.length * sizeMm * 0.55
  const PX_PER_MM = 10
  measureContext.font = fontCss(font, sizeMm * PX_PER_MM)
  return measureContext.measureText(text).width / PX_PER_MM
}

export async function ensureFonts(): Promise<void> {
  const fonts: BookFont[] = ['archivo', 'playfair', 'greatvibes']
  await Promise.all(fonts.map((f) => document.fonts.load(fontCss(f, 48)).catch(() => [])))
}

// --- painting ---------------------------------------------------------------

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export interface PaintOptions {
  pxPerMm: number
  /** Where the trim's top-left corner lands, in canvas pixels. */
  originPx: { x: number; y: number }
  source: PhotoSource
  /** Draw placeholders for empty and missing frames. */
  preview: boolean
}

export async function paintPage(ctx: Context2D, draw: PageDraw, text: TextLine[], o: PaintOptions): Promise<void> {
  const px = (mm: number) => mm * o.pxPerMm
  const b = draw.bleedMm
  ctx.fillStyle = draw.color
  ctx.fillRect(o.originPx.x - px(b), o.originPx.y - px(b), px(draw.page.widthMm + 2 * b), px(draw.page.heightMm + 2 * b))
  for (const frame of draw.frames) {
    const x = Math.round(o.originPx.x + px(frame.rect.x))
    const y = Math.round(o.originPx.y + px(frame.rect.y))
    const w = Math.round(o.originPx.x + px(frame.rect.x + frame.rect.w)) - x
    const h = Math.round(o.originPx.y + px(frame.rect.y + frame.rect.h)) - y
    if (w < 1 || h < 1) continue
    if (frame.missing || !frame.photoId) {
      if (o.preview) {
        ctx.fillStyle = frame.missing ? '#F4C7C3' : 'rgba(0, 0, 0, 0.07)'
        ctx.fillRect(x, y, w, h)
      }
      continue
    }
    // Print and export must stop on a failed photo rather than ship a blank frame; only the screen preview tolerates it.
    const image = o.preview ? await o.source(frame, w, h).catch(() => null) : await o.source(frame, w, h)
    if (image) ctx.drawImage(image, x, y, w, h)
    else if (o.preview) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.07)'
      ctx.fillRect(x, y, w, h)
    }
  }
  for (const line of text) {
    ctx.save()
    const size = px(line.sizeMm)
    ctx.font = fontCss(line.font, size)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = line.color
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
    ctx.shadowBlur = size * 0.15
    ctx.fillText(line.text, o.originPx.x + px(line.x), o.originPx.y + px(line.baseline))
    ctx.restore()
  }
}

export interface RenderOptions {
  dpi: number
  source: PhotoSource
  preview: boolean
  missing?: ReadonlySet<string>
}

/** One page, trimmed (no bleed), at `dpi`. */
export async function renderPage(book: Book, index: number, o: RenderOptions): Promise<OffscreenCanvas> {
  const draw = pageDraw(book, book.pages[index], { missing: o.missing })
  const pxPerMm = o.dpi / 25.4
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(draw.page.widthMm * pxPerMm)), Math.max(1, Math.round(draw.page.heightMm * pxPerMm)))
  const ctx = canvas.getContext('2d')!
  await paintPage(ctx, draw, pageText(book, index, measureText), { pxPerMm, originPx: { x: 0, y: 0 }, source: o.source, preview: o.preview })
  return canvas
}

/** "Cover", then inside pages from 1. */
export function pageLabel(book: Book, index: number): string {
  if (book.pages[0]?.layoutId === 'cover') return index === 0 ? 'Cover' : String(index)
  return String(index + 1)
}

/** One print sheet with its pages, cut marks and page numbers. */
export async function renderSheet(book: Book, plan: SheetPlan, sheetIndex: number, o: RenderOptions): Promise<OffscreenCanvas> {
  if (!plan.ok) throw new Error(plan.message)
  const pxPerMm = o.dpi / 25.4
  const px = (mm: number) => mm * pxPerMm
  const canvas = new OffscreenCanvas(Math.round(px(plan.paper.widthMm)), Math.round(px(plan.paper.heightMm)))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const pages = pagesOnSheet(sheetIndex, plan.perSheet, book.pages.length)
  for (const [slotIndex, pageIndex] of pages.entries()) {
    const slot = plan.slots[slotIndex]
    const draw = pageDraw(book, book.pages[pageIndex], { bleedMm: plan.bleedMm, missing: o.missing })
    ctx.save()
    if (slot.rotated) {
      // Page (u, v) lands at (trim.x + trim.w - v, trim.y + u): a quarter turn clockwise.
      ctx.translate(px(slot.trim.x + slot.trim.w), px(slot.trim.y))
      ctx.rotate(Math.PI / 2)
    } else {
      ctx.translate(px(slot.trim.x), px(slot.trim.y))
    }
    await paintPage(ctx, draw, pageText(book, pageIndex, measureText), { pxPerMm, originPx: { x: 0, y: 0 }, source: o.source, preview: o.preview })
    ctx.restore()
    if (slot.labelAt) {
      ctx.fillStyle = '#9E9E9E'
      ctx.font = fontCss('archivo', px(LABEL_SIZE_MM))
      ctx.textAlign = 'center'
      ctx.fillText(pageLabel(book, pageIndex), px(slot.labelAt.x), px(slot.labelAt.y))
    }
  }

  ctx.strokeStyle = 'rgb(158, 158, 158)'
  ctx.lineWidth = Math.max(1, px(CUT_MARK_WIDTH_MM))
  ctx.beginPath()
  for (const l of cutLines(plan, pages.length)) {
    ctx.moveTo(px(l.x1), px(l.y1))
    ctx.lineTo(px(l.x2), px(l.y2))
  }
  ctx.stroke()
  return canvas
}

export async function canvasBytes(canvas: OffscreenCanvas, type: 'image/jpeg' | 'image/png', quality = 0.95): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type, quality })
  return new Uint8Array(await blob.arrayBuffer())
}
