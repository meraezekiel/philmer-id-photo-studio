/**
 * The first draft of a book: photos in order, grouped into pages, each page
 * given the layout that crops its photos least. The operator adjusts from
 * here; nothing in this file runs again unless they ask for a rebuild.
 */

import { initialCrop } from './bookCrop'
import { layoutsFor, rectAspect, resolveFrames, type BookLayout } from './bookLayouts'
import { PAGE_COUNT_OPTIONS, type BookPage, type BookStyle, type NormRect, type SizeMm } from './bookTypes'

export interface FillPhoto {
  id: string
  aspect: number
  face: NormRect | null
}

export interface FillOptions {
  pageCount: 'auto' | number
  cover: boolean
  page: SizeMm
  style: Pick<BookStyle, 'marginMm' | 'gapMm'>
  newId?: () => string
}

export type FillResult = { ok: true; pages: BookPage[] } | { ok: false; message: string }

export const MAX_PER_PAGE = 6
export const AUTO_PHOTOS_PER_PAGE = 2.5
export const ASPECT_LIMIT = 1.6
export const FEATURE_EVERY = 5
/** A whole-photo frame never crops, but a full-bleed page is preferred when it fits. */
const FIT_SCORE = 0.15

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function autoPageCount(n: number): number {
  return Math.min(n, Math.max(1, Math.round(n / AUTO_PHOTOS_PER_PAGE)))
}

/** Photos per page. Every FEATURE_EVERY-th page stays a single photo for as long as possible. */
export function distribute(n: number, pages: number): number[] {
  const counts = new Array<number>(pages).fill(1)
  let remaining = n - pages
  const all = counts.map((_, i) => i)
  const groups = [all.filter((i) => i % FEATURE_EVERY !== 0), all.filter((i) => i % FEATURE_EVERY === 0)]
  for (const group of groups) {
    while (remaining > 0 && group.some((i) => counts[i] < MAX_PER_PAGE)) {
      for (const i of group) {
        if (remaining === 0) break
        if (counts[i] < MAX_PER_PAGE) {
          counts[i]++
          remaining--
        }
      }
    }
  }
  return counts
}

interface Evaluation {
  layout: BookLayout
  score: number
  worst: number
  /** order[frame] = index into the page's photos. */
  order: number[]
}

function evaluate(layout: BookLayout, group: FillPhoto[], options: FillOptions): Evaluation {
  const rects = resolveFrames(layout, options.page, options.style)
  const aspect = (p: FillPhoto) => (p.aspect > 0 && Number.isFinite(p.aspect) ? p.aspect : 1)
  // Pairing the sorted shapes is the cheapest assignment in one dimension.
  const frames = rects.map((_, i) => i).sort((a, b) => rectAspect(rects[a]) - rectAspect(rects[b]))
  const photos = group.map((_, i) => i).sort((a, b) => aspect(group[a]) - aspect(group[b]))
  const order = new Array<number>(rects.length)
  let score = 0
  let worst = 0
  frames.forEach((frame, k) => {
    const photo = photos[k]
    order[frame] = photo
    if (layout.frames[frame].fit === 'photo') {
      score += FIT_SCORE
      return
    }
    const d = Math.abs(Math.log(rectAspect(rects[frame]) / aspect(group[photo])))
    score += d
    worst = Math.max(worst, d)
  })
  return { layout, score, worst, order }
}

function choose(group: FillPhoto[], previous: BookPage[], options: FillOptions): Evaluation {
  const evaluations = layoutsFor(group.length).map((l) => evaluate(l, group, options))
  const recent = previous.slice(-2).map((p) => p.layoutId)
  const repeating = recent.length === 2 && recent[0] === recent[1] ? recent[0] : null
  const limit = Math.log(ASPECT_LIMIT) + 1e-9
  const passing = evaluations.filter((e) => e.worst <= limit)
  const fresh = (list: Evaluation[]) => list.filter((e) => e.layout.id !== repeating)
  // The aspect limit outranks the rhythm rule; the rhythm rule outranks score.
  const pool = [fresh(passing), passing, fresh(evaluations), evaluations].find((list) => list.length > 0)!
  return pool.reduce((best, e) => (e.score < best.score - 1e-12 ? e : best))
}

let fallbackCounter = 0
const defaultId = () => `pg-${Date.now().toString(36)}-${(fallbackCounter++).toString(36)}`

export function autoFill(photos: FillPhoto[], options: FillOptions): FillResult {
  const newId = options.newId ?? defaultId
  if (photos.length === 0) return { ok: false, message: 'Add at least one photo first.' }

  const pages: BookPage[] = []
  let rest = photos
  if (options.cover) {
    const first = photos[0]
    const coverAspect = options.page.widthMm / options.page.heightMm
    pages.push({ id: newId(), layoutId: 'cover', frames: [{ photoId: first.id, crop: initialCrop(first.aspect, coverAspect, first.face) }] })
    rest = photos.slice(1)
  }

  const n = rest.length
  if (n === 0) return { ok: true, pages }
  const target = options.pageCount === 'auto' ? autoPageCount(n) : Math.floor(options.pageCount)
  if (!(target >= 1)) return { ok: false, message: 'Choose at least one page.' }
  if (n < target) {
    return { ok: false, message: `${plural(n, 'photo')} cannot fill ${target} pages. Add ${plural(target - n, 'more photo')} or choose fewer pages.` }
  }
  if (n > target * MAX_PER_PAGE) {
    const fits = PAGE_COUNT_OPTIONS.find((c) => c >= Math.ceil(n / MAX_PER_PAGE))
    const extra = n - target * MAX_PER_PAGE
    return {
      ok: false,
      message: `${n} photos do not fit on ${target} pages (6 per page at most). Remove ${plural(extra, 'photo')}${fits ? ` or choose ${fits} pages` : ''}.`,
    }
  }

  let at = 0
  for (const count of distribute(n, target)) {
    const group = rest.slice(at, at + count)
    at += count
    const choice = choose(group, pages, options)
    const rects = resolveFrames(choice.layout, options.page, options.style)
    pages.push({
      id: newId(),
      layoutId: choice.layout.id,
      frames: choice.order.map((p, frame) => {
        const photo = group[p]
        const frameAspect = choice.layout.frames[frame].fit === 'photo' ? photo.aspect : rectAspect(rects[frame])
        return { photoId: photo.id, crop: initialCrop(photo.aspect, frameAspect, photo.face) }
      }),
    })
  }
  return { ok: true, pages }
}
