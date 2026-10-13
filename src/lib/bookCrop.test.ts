import { describe, expect, it } from 'vitest'

import { CENTRED, MAX_ZOOM, cropRect, effectiveDpi, initialCrop, normaliseCrop, panCrop, zoomCrop } from './bookCrop'

const inside = (r: { x: number; y: number; w: number; h: number }) => {
  expect(r.x).toBeGreaterThanOrEqual(-1e-12)
  expect(r.y).toBeGreaterThanOrEqual(-1e-12)
  expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-12)
  expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-12)
}

describe('cropRect', () => {
  it('covers the frame: the visible part has the frame shape in pixels', () => {
    for (const [pa, fa] of [[1.5, 0.8], [0.667, 1.5], [1, 1], [2, 2.5]]) {
      const r = cropRect(pa, fa, CENTRED)
      expect((r.w / r.h) * pa).toBeCloseTo(fa, 9)
      expect(Math.max(r.w, r.h)).toBeCloseTo(1, 9)
      inside(r)
    }
  })

  it('shows the whole photo when the shapes match', () => {
    expect(cropRect(1.5, 1.5, CENTRED)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('zooms in around the centre', () => {
    const r = cropRect(1, 1, { cx: 0.5, cy: 0.5, zoom: 2 })
    expect(r).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })

  it('never leaves the photo, whatever the crop says', () => {
    for (const crop of [
      { cx: -3, cy: 9, zoom: 1 },
      { cx: 0.99, cy: 0.01, zoom: 4 },
      { cx: Number.NaN, cy: Number.POSITIVE_INFINITY, zoom: Number.NaN },
      { cx: 0.5, cy: 0.5, zoom: 0.2 },
      { cx: 0.5, cy: 0.5, zoom: 50 },
    ]) {
      inside(cropRect(1.5, 0.7, crop))
    }
  })

  it('treats a broken aspect as square', () => {
    inside(cropRect(0, Number.NaN, CENTRED))
    expect(cropRect(0, Number.NaN, CENTRED)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('clamps zoom to the range', () => {
    expect(cropRect(1, 1, { cx: 0.5, cy: 0.5, zoom: 0.1 }).w).toBe(1)
    expect(cropRect(1, 1, { cx: 0.5, cy: 0.5, zoom: 99 }).w).toBeCloseTo(1 / MAX_ZOOM)
  })
})

describe('moving the crop', () => {
  it('pans opposite to the drag and stops at the edge', () => {
    const start = normaliseCrop(1, 1, { cx: 0.5, cy: 0.5, zoom: 2 })
    const right = panCrop(start, 1, 1, 0.1, 0)
    expect(right.cx).toBeCloseTo(0.45)
    const far = panCrop(start, 1, 1, 10, -10)
    expect(far.cx).toBeCloseTo(0.25)
    expect(far.cy).toBeCloseTo(0.75)
  })

  it('cannot pan a crop that already shows the whole photo', () => {
    expect(panCrop(CENTRED, 1.5, 1.5, 0.3, 0.3)).toEqual({ cx: 0.5, cy: 0.5, zoom: 1 })
  })

  it('zooms within limits', () => {
    expect(zoomCrop(CENTRED, 1, 1, 2).zoom).toBe(2)
    expect(zoomCrop({ cx: 0.5, cy: 0.5, zoom: 4 }, 1, 1, 10).zoom).toBe(MAX_ZOOM)
    expect(zoomCrop(CENTRED, 1, 1, 0.1).zoom).toBe(1)
  })

  it('stores the centre of the clamped rectangle so the crop never drifts', () => {
    const c = normaliseCrop(1, 1, { cx: 0.01, cy: 0.99, zoom: 2 })
    expect(c).toEqual({ cx: 0.25, cy: 0.75, zoom: 2 })
  })
})

describe('initialCrop', () => {
  it('centres when there is no face', () => {
    expect(initialCrop(1.5, 0.8, null)).toEqual(normaliseCrop(1.5, 0.8, CENTRED))
  })

  it('keeps a face near the top of a tall photo in a wide frame', () => {
    const face = { x: 0.4, y: 0.05, w: 0.2, h: 0.15 }
    const crop = initialCrop(0.667, 1.5, face)
    const r = cropRect(0.667, 1.5, crop)
    expect(r.y).toBeLessThanOrEqual(face.y)
    expect(r.y + r.h).toBeGreaterThanOrEqual(face.y + face.h)
  })
})

describe('effectiveDpi', () => {
  it('is pixels shown over inches printed', () => {
    // 3000 px wide photo, whole width shown on a 254 mm (10 in) frame = 300 DPI.
    expect(effectiveDpi({ width: 3000, height: 2000 }, { x: 0, y: 0, w: 1, h: 1 }, { w: 254, h: 169.33 })).toBeCloseTo(300, 0)
  })

  it('is infinite for an empty frame', () => {
    expect(effectiveDpi({ width: 10, height: 10 }, { x: 0, y: 0, w: 1, h: 1 }, { w: 0, h: 5 })).toBe(Number.POSITIVE_INFINITY)
  })
})
