/**
 * Page layouts as data. Frames are fractions of the area inside the margins,
 * so one layout serves every book size, margin and gap; adding a layout is
 * one entry here.
 */

import type { BookStyle, RectMm, SizeMm } from './bookTypes'

export interface LayoutFrame {
  x: number
  y: number
  w: number
  h: number
  /** Shrink the frame to the photo's shape instead of cropping the photo. */
  fit?: 'photo'
}

export interface BookLayout {
  id: string
  label: string
  count: number
  frames: LayoutFrame[]
  cover?: true
}

const T = 1 / 3
const f = (x: number, y: number, w: number, h: number): LayoutFrame => ({ x, y, w, h })

export const BOOK_LAYOUTS: BookLayout[] = [
  { id: '1-full', label: 'Full page', count: 1, frames: [f(0, 0, 1, 1)] },
  { id: '1-framed', label: 'Whole photo', count: 1, frames: [{ x: 0.08, y: 0.08, w: 0.84, h: 0.84, fit: 'photo' }] },
  { id: '2-side', label: 'Side by side', count: 2, frames: [f(0, 0, 0.5, 1), f(0.5, 0, 0.5, 1)] },
  { id: '2-stack', label: 'Stacked', count: 2, frames: [f(0, 0, 1, 0.5), f(0, 0.5, 1, 0.5)] },
  { id: '2-big-left', label: 'Big + small', count: 2, frames: [f(0, 0, 0.62, 1), f(0.62, 0, 0.38, 1)] },
  { id: '2-big-top', label: 'Big + small, stacked', count: 2, frames: [f(0, 0, 1, 0.62), f(0, 0.62, 1, 0.38)] },
  { id: '3-big-left', label: 'Big left', count: 3, frames: [f(0, 0, 0.6, 1), f(0.6, 0, 0.4, 0.5), f(0.6, 0.5, 0.4, 0.5)] },
  { id: '3-big-right', label: 'Big right', count: 3, frames: [f(0.4, 0, 0.6, 1), f(0, 0, 0.4, 0.5), f(0, 0.5, 0.4, 0.5)] },
  { id: '3-big-top', label: 'Big top', count: 3, frames: [f(0, 0, 1, 0.6), f(0, 0.6, 0.5, 0.4), f(0.5, 0.6, 0.5, 0.4)] },
  { id: '3-row', label: 'Three across', count: 3, frames: [f(0, 0, T, 1), f(T, 0, T, 1), f(2 * T, 0, T, 1)] },
  { id: '3-stack', label: 'Three stacked', count: 3, frames: [f(0, 0, 1, T), f(0, T, 1, T), f(0, 2 * T, 1, T)] },
  { id: '4-grid', label: 'Grid of four', count: 4, frames: [f(0, 0, 0.5, 0.5), f(0.5, 0, 0.5, 0.5), f(0, 0.5, 0.5, 0.5), f(0.5, 0.5, 0.5, 0.5)] },
  { id: '4-big-top', label: 'Big top + three', count: 4, frames: [f(0, 0, 1, 0.6), f(0, 0.6, T, 0.4), f(T, 0.6, T, 0.4), f(2 * T, 0.6, T, 0.4)] },
  { id: '4-big-left', label: 'Big left + three', count: 4, frames: [f(0, 0, 0.6, 1), f(0.6, 0, 0.4, T), f(0.6, T, 0.4, T), f(0.6, 2 * T, 0.4, T)] },
  { id: '5-mosaic', label: 'Two over three', count: 5, frames: [f(0, 0, 0.5, 0.5), f(0.5, 0, 0.5, 0.5), f(0, 0.5, T, 0.5), f(T, 0.5, T, 0.5), f(2 * T, 0.5, T, 0.5)] },
  { id: '5-mosaic-side', label: 'Two beside three', count: 5, frames: [f(0, 0, 0.5, 0.5), f(0, 0.5, 0.5, 0.5), f(0.5, 0, 0.5, T), f(0.5, T, 0.5, T), f(0.5, 2 * T, 0.5, T)] },
  { id: '6-grid', label: 'Grid of six', count: 6, frames: [f(0, 0, 0.5, T), f(0.5, 0, 0.5, T), f(0, T, 0.5, T), f(0.5, T, 0.5, T), f(0, 2 * T, 0.5, T), f(0.5, 2 * T, 0.5, T)] },
  { id: '6-grid-wide', label: 'Six, three across', count: 6, frames: [f(0, 0, T, 0.5), f(T, 0, T, 0.5), f(2 * T, 0, T, 0.5), f(0, 0.5, T, 0.5), f(T, 0.5, T, 0.5), f(2 * T, 0.5, T, 0.5)] },
  { id: 'cover', label: 'Cover', count: 1, cover: true, frames: [f(0, 0, 1, 1)] },
]

const BY_ID = new Map(BOOK_LAYOUTS.map((l) => [l.id, l]))

export function layoutById(id: string): BookLayout | undefined {
  return BY_ID.get(id)
}

export function layoutsFor(count: number): BookLayout[] {
  return BOOK_LAYOUTS.filter((l) => l.count === count && !l.cover)
}

const EPS = 1e-6

/**
 * Frames in millimetres on the trim. Interior edges are pulled in by half the
 * gap each, so neighbours end up exactly `gapMm` apart.
 */
export function resolveFrames(
  layout: BookLayout,
  page: SizeMm,
  style: Pick<BookStyle, 'marginMm' | 'gapMm'>,
): RectMm[] {
  const margin = Math.min(Math.max(0, style.marginMm || 0), page.widthMm / 2, page.heightMm / 2)
  const gap = Math.max(0, style.gapMm || 0)
  const cw = Math.max(0, page.widthMm - 2 * margin)
  const ch = Math.max(0, page.heightMm - 2 * margin)
  return layout.frames.map((fr) => {
    let left = margin + fr.x * cw
    let right = margin + (fr.x + fr.w) * cw
    let top = margin + fr.y * ch
    let bottom = margin + (fr.y + fr.h) * ch
    if (fr.x > EPS) left += gap / 2
    if (fr.x + fr.w < 1 - EPS) right -= gap / 2
    if (fr.y > EPS) top += gap / 2
    if (fr.y + fr.h < 1 - EPS) bottom -= gap / 2
    const w = Math.max(0, right - left)
    const h = Math.max(0, bottom - top)
    // A gap wider than the frame collapses it in place, never past the page.
    return { x: Math.min(left, page.widthMm - w), y: Math.min(top, page.heightMm - h), w, h }
  })
}

export function rectAspect(r: RectMm): number {
  return r.h > 0 && r.w > 0 ? r.w / r.h : 1
}

/** The largest rectangle of `aspect` inside `box`, centred. */
export function fitRect(box: RectMm, aspect: number): RectMm {
  if (!(aspect > 0) || !Number.isFinite(aspect) || box.w <= 0 || box.h <= 0) return box
  if (box.w / box.h > aspect) {
    const w = box.h * aspect
    return { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h }
  }
  const h = box.w / aspect
  return { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h }
}
