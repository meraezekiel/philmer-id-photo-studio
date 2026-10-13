/**
 * Which part of a photo a frame shows. A crop is a centre and a zoom; zoom 1
 * is the smallest crop that still covers the frame. Everything is in
 * fractions of the photo, so it survives the book changing size.
 */

import type { Crop, NormRect } from './bookTypes'
import { clamp } from './pixels'

export const CENTRED: Crop = { cx: 0.5, cy: 0.5, zoom: 1 }
export const MAX_ZOOM = 5
/** Below this at print size a photo looks soft; the editor warns. */
export const LOW_DPI = 200

const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)
const safeAspect = (a: number) => (Number.isFinite(a) && a > 0 ? a : 1)

export function cropRect(photoAspect: number, frameAspect: number, crop: Crop): NormRect {
  const pa = safeAspect(photoAspect)
  const fa = safeAspect(frameAspect)
  let w = 1
  let h = 1
  if (fa > pa) h = pa / fa
  else w = fa / pa
  const zoom = clamp(finite(crop.zoom, 1), 1, MAX_ZOOM)
  w /= zoom
  h /= zoom
  const x = clamp(finite(crop.cx, 0.5) - w / 2, 0, 1 - w)
  const y = clamp(finite(crop.cy, 0.5) - h / 2, 0, 1 - h)
  return { x, y, w, h }
}

export function normaliseCrop(photoAspect: number, frameAspect: number, crop: Crop): Crop {
  const r = cropRect(photoAspect, frameAspect, crop)
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, zoom: clamp(finite(crop.zoom, 1), 1, MAX_ZOOM) }
}

/** Drag by a fraction of the frame; the photo follows the pointer. */
export function panCrop(crop: Crop, photoAspect: number, frameAspect: number, dxFraction: number, dyFraction: number): Crop {
  const r = cropRect(photoAspect, frameAspect, crop)
  return normaliseCrop(photoAspect, frameAspect, {
    ...crop,
    cx: r.x + r.w / 2 - finite(dxFraction, 0) * r.w,
    cy: r.y + r.h / 2 - finite(dyFraction, 0) * r.h,
  })
}

export function zoomCrop(crop: Crop, photoAspect: number, frameAspect: number, factor: number): Crop {
  return normaliseCrop(photoAspect, frameAspect, { ...crop, zoom: finite(crop.zoom, 1) * finite(factor, 1) })
}

/** Centred, or centred on the face with a little headroom. */
export function initialCrop(photoAspect: number, frameAspect: number, face: NormRect | null): Crop {
  if (!face) return normaliseCrop(photoAspect, frameAspect, CENTRED)
  const base = cropRect(photoAspect, frameAspect, CENTRED)
  return normaliseCrop(photoAspect, frameAspect, {
    cx: face.x + face.w / 2,
    // Push the centre below the face so the face sits in the upper part.
    cy: face.y + face.h / 2 + base.h * 0.1,
    zoom: 1,
  })
}

export function effectiveDpi(photo: { width: number; height: number }, source: NormRect, frameMm: { w: number; h: number }): number {
  if (frameMm.w <= 0 || frameMm.h <= 0) return Number.POSITIVE_INFINITY
  const x = (source.w * photo.width) / (frameMm.w / 25.4)
  const y = (source.h * photo.height) / (frameMm.h / 25.4)
  return Math.min(x, y)
}
