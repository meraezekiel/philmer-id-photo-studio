import { describe, expect, it } from 'vitest'

import { BOOK_LAYOUTS, fitRect, layoutById, layoutsFor, rectAspect, resolveFrames } from './bookLayouts'

const PAGE = { widthMm: 127, heightMm: 152.4 }
const area = (f: { w: number; h: number }) => f.w * f.h
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

describe('layout data', () => {
  it('has unique ids and a frame per photo', () => {
    expect(new Set(BOOK_LAYOUTS.map((l) => l.id)).size).toBe(BOOK_LAYOUTS.length)
    for (const layout of BOOK_LAYOUTS) expect(layout.frames.length).toBe(layout.count)
  })

  it('keeps every frame inside the page', () => {
    for (const layout of BOOK_LAYOUTS) {
      for (const f of layout.frames) {
        expect(f.x).toBeGreaterThanOrEqual(0)
        expect(f.y).toBeGreaterThanOrEqual(0)
        expect(f.x + f.w).toBeLessThanOrEqual(1 + 1e-9)
        expect(f.y + f.h).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  it('tiles the page exactly when no frame is a fit frame', () => {
    for (const layout of BOOK_LAYOUTS.filter((l) => l.frames.every((f) => !f.fit))) {
      const total = layout.frames.reduce((sum, f) => sum + area(f), 0)
      expect(total, layout.id).toBeCloseTo(1, 9)
      for (let i = 0; i < layout.frames.length; i++) {
        for (let j = i + 1; j < layout.frames.length; j++) {
          expect(overlap(layout.frames[i], layout.frames[j]), `${layout.id} ${i}/${j}`).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('offers at least one layout for 1 to 6 photos, never the cover', () => {
    for (let n = 1; n <= 6; n++) {
      expect(layoutsFor(n).length, `${n} photos`).toBeGreaterThan(0)
      expect(layoutsFor(n).some((l) => l.cover)).toBe(false)
    }
    expect(layoutsFor(7)).toEqual([])
  })

  it('looks layouts up by id', () => {
    expect(layoutById('2-side')?.count).toBe(2)
    expect(layoutById('cover')?.cover).toBe(true)
    expect(layoutById('nope')).toBeUndefined()
  })
})

describe('resolveFrames', () => {
  const style = { marginMm: 6, gapMm: 3 }

  it('puts exactly the gap between neighbours and the margin at the edges', () => {
    const [a, b] = resolveFrames(layoutById('2-side')!, PAGE, style)
    expect(a.x).toBeCloseTo(6)
    expect(b.x - (a.x + a.w)).toBeCloseTo(3)
    expect(b.x + b.w).toBeCloseTo(127 - 6)
    expect(a.y).toBeCloseTo(6)
    expect(a.h).toBeCloseTo(152.4 - 12)
  })

  it('touches the trim edge when the margin is zero', () => {
    const [full] = resolveFrames(layoutById('1-full')!, PAGE, { marginMm: 0, gapMm: 1.5 })
    expect(full).toEqual({ x: 0, y: 0, w: 127, h: 152.4 })
  })

  it('resolveFrames never returns negative or out-of-page frames', () => {
    for (const layout of BOOK_LAYOUTS) {
      for (const s of [{ marginMm: 20, gapMm: 10 }, { marginMm: 80, gapMm: 10 }, { marginMm: 0, gapMm: 0 }]) {
        for (const r of resolveFrames(layout, PAGE, s)) {
          expect(r.w).toBeGreaterThanOrEqual(0)
          expect(r.h).toBeGreaterThanOrEqual(0)
          expect(r.x).toBeGreaterThanOrEqual(0)
          expect(r.y).toBeGreaterThanOrEqual(0)
          expect(r.x + r.w).toBeLessThanOrEqual(PAGE.widthMm + 1e-9)
          expect(r.y + r.h).toBeLessThanOrEqual(PAGE.heightMm + 1e-9)
        }
      }
    }
  })
})

describe('fitRect', () => {
  it('fits a wide photo into a tall box, centred', () => {
    const r = fitRect({ x: 10, y: 10, w: 100, h: 200 }, 2)
    expect(r).toEqual({ x: 10, y: 85, w: 100, h: 50 })
  })

  it('fits a tall photo into a wide box, centred', () => {
    const r = fitRect({ x: 0, y: 0, w: 200, h: 100 }, 0.5)
    expect(r).toEqual({ x: 75, y: 0, w: 50, h: 100 })
  })

  it('returns the box for a bad aspect or an empty box', () => {
    const box = { x: 1, y: 2, w: 3, h: 4 }
    expect(fitRect(box, 0)).toEqual(box)
    expect(fitRect(box, Number.NaN)).toEqual(box)
    expect(fitRect({ x: 0, y: 0, w: 0, h: 5 }, 1)).toEqual({ x: 0, y: 0, w: 0, h: 5 })
  })

  it('measures aspect safely', () => {
    expect(rectAspect({ x: 0, y: 0, w: 20, h: 10 })).toBe(2)
    expect(rectAspect({ x: 0, y: 0, w: 20, h: 0 })).toBe(1)
  })
})
