/**
 * Where a whole photo goes on a sheet of photo paper, and which part of a
 * background picture covers a box. Geometry only, in pixels.
 */

import { mmToPx } from './dpi'
import { PRINT_DPI } from './presets'

export type PaperFit = 'fit' | 'fill'
export type PaperOrientation = 'auto' | 'portrait' | 'landscape'

export interface PaperPlacement {
  /** The paper at `dpi`, already turned for the orientation. */
  paper: { width: number; height: number }
  /** The photo on it; in Fill mode it runs past the edges and is cropped. */
  rect: { x: number; y: number; width: number; height: number }
  landscape: boolean
}

/**
 * Fit shows the whole photo with a white border on the short side; Fill
 * covers the paper edge to edge and crops the overflow from the centre.
 * Auto orientation turns the paper to match the photo.
 */
export function placeOnPaper(
  photo: { width: number; height: number },
  paperMm: { widthMm: number; heightMm: number },
  fit: PaperFit,
  orientation: PaperOrientation,
  dpi: number = PRINT_DPI,
): PaperPlacement {
  const landscape = orientation === 'auto' ? photo.width > photo.height : orientation === 'landscape'
  const short = mmToPx(Math.min(paperMm.widthMm, paperMm.heightMm), dpi)
  const long = mmToPx(Math.max(paperMm.widthMm, paperMm.heightMm), dpi)
  const paper = landscape ? { width: long, height: short } : { width: short, height: long }

  const sx = paper.width / photo.width
  const sy = paper.height / photo.height
  const scale = fit === 'fit' ? Math.min(sx, sy) : Math.max(sx, sy)
  const width = Math.round(photo.width * scale)
  const height = Math.round(photo.height * scale)
  return {
    paper,
    rect: {
      x: Math.round((paper.width - width) / 2),
      y: Math.round((paper.height - height) / 2),
      width,
      height,
    },
    landscape,
  }
}

/** How a background picture sits behind the subject. */
export interface BackgroundView {
  /** 1..3: 1 is the smallest crop that still covers. */
  zoom: number
  /** -1..1: -1 shows the left (top) edge of the picture, 1 the right (bottom). */
  offsetX: number
  offsetY: number
}

export const DEFAULT_VIEW: BackgroundView = { zoom: 1, offsetX: 0, offsetY: 0 }

/** The part of `src` that covers a `dst`-shaped box, zoomed and moved. */
export function coverSourceRect(
  src: { width: number; height: number },
  dst: { width: number; height: number },
  view: BackgroundView,
): { x: number; y: number; width: number; height: number } {
  const dstAspect = dst.width / dst.height
  let width = src.width
  let height = src.height
  if (src.width / src.height > dstAspect) width = src.height * dstAspect
  else height = src.width / dstAspect
  const zoom = Math.min(3, Math.max(1, view.zoom))
  width /= zoom
  height /= zoom
  const ox = Math.min(1, Math.max(-1, view.offsetX))
  const oy = Math.min(1, Math.max(-1, view.offsetY))
  const cx = src.width / 2 + (ox * (src.width - width)) / 2
  const cy = src.height / 2 + (oy * (src.height - height)) / 2
  return { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width: Math.round(width), height: Math.round(height) }
}
