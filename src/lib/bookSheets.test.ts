import { describe, expect, it } from 'vitest'

import { BLEED_MM, cutLines, pagesOnSheet, planSheets, sheetCount, type SheetPlan } from './bookSheets'

const A4 = { widthMm: 210, heightMm: 297 }
const R8 = { widthMm: 203.2, heightMm: 254 }
const P5x6 = { widthMm: 127, heightMm: 152.4 }
const P5x7 = { widthMm: 127, heightMm: 177.8 }

function ok(plan: SheetPlan) {
  if (!plan.ok) throw new Error(plan.message)
  return plan
}

function expectSane(plan: SheetPlan) {
  const p = ok(plan)
  for (const [i, slot] of p.slots.entries()) {
    const b = p.bleedMm
    expect(slot.trim.x - b).toBeGreaterThanOrEqual(-1e-9)
    expect(slot.trim.y - b).toBeGreaterThanOrEqual(-1e-9)
    expect(slot.trim.x + slot.trim.w + b).toBeLessThanOrEqual(p.paper.widthMm + 1e-9)
    expect(slot.trim.y + slot.trim.h + b).toBeLessThanOrEqual(p.paper.heightMm + 1e-9)
    for (const other of p.slots.slice(i + 1)) {
      const sep =
        other.trim.x - b >= slot.trim.x + slot.trim.w + b - 1e-9 ||
        slot.trim.x - b >= other.trim.x + other.trim.w + b - 1e-9 ||
        other.trim.y - b >= slot.trim.y + slot.trim.h + b - 1e-9 ||
        slot.trim.y - b >= other.trim.y + other.trim.h + b - 1e-9
      expect(sep, 'bleeds must not overlap').toBe(true)
    }
  }
  return p
}

describe('planSheets', () => {
  it('fits two 5x6 pages on A4 by turning them', () => {
    const p = expectSane(planSheets(P5x6, A4, false))
    expect(p.perSheet).toBe(2)
    expect(p.slots.every((s) => s.rotated)).toBe(true)
    expect(p.slots[0].trim.w).toBeCloseTo(152.4)
  })

  it('still fits two 5x6 pages with bleed', () => {
    const p = expectSane(planSheets(P5x6, A4, true))
    expect(p.perSheet).toBe(2)
    expect(p.bleedMm).toBe(BLEED_MM)
  })

  it('fits two 5x7 pages on A4', () => {
    expect(expectSane(planSheets(P5x7, A4, true)).perSheet).toBe(2)
  })

  it('keeps the page upright when it fits that way', () => {
    const landscape5x6 = { widthMm: 152.4, heightMm: 127 }
    const p = expectSane(planSheets(landscape5x6, A4, false))
    expect(p.perSheet).toBe(2)
    expect(p.slots.every((s) => !s.rotated)).toBe(true)
  })

  it('shrinks the bleed to the room left for an 8x8 on A4', () => {
    const p = expectSane(planSheets({ widthMm: 203.2, heightMm: 203.2 }, A4, true))
    expect(p.perSheet).toBe(1)
    expect(p.bleedMm).toBeCloseTo(0.4)
    expect(p.borderless).toBe(false)
  })

  it('prints 8x10 on A4 with a trim', () => {
    const p = expectSane(planSheets({ widthMm: 203.2, heightMm: 254 }, A4, false))
    expect(p.perSheet).toBe(1)
    expect(p.borderless).toBe(false)
  })

  it('prints 8x10 on 8R and A4 on A4 borderless, without marks', () => {
    for (const [page, paper] of [[{ widthMm: 203.2, heightMm: 254 }, R8], [A4, A4]] as const) {
      const p = expectSane(planSheets(page, paper, true))
      expect(p.borderless).toBe(true)
      expect(p.bleedMm).toBe(0)
      expect(cutLines(p, 1)).toEqual([])
      expect(p.slots[0].labelAt).toBeNull()
    }
  })

  it('marks the cuts on the axis a borderless page does not fill (8x8 on 8R)', () => {
    const p = expectSane(planSheets({ widthMm: 203.2, heightMm: 203.2 }, R8, true))
    expect(p.borderless).toBe(true)
    const { trim } = p.slots[0]
    expect(trim.y).toBeCloseTo(25.4)
    const lines = cutLines(p, 1)
    expect(lines).toHaveLength(4)
    for (const l of lines) {
      // In the top and bottom margins, never over the page.
      expect(l.x1).toBe(l.x2)
      for (const y of [l.y1, l.y2]) {
        expect(y < trim.y || y > trim.y + trim.h).toBe(true)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(p.paper.heightMm)
      }
    }
  })

  it('refuses a page larger than the paper', () => {
    expect(planSheets(A4, R8, false)).toEqual({ ok: false, message: 'The page is larger than the paper. Choose a bigger paper or a smaller book size.' })
  })

  it('packs four 5x6 pages on an A3 custom paper', () => {
    expect(expectSane(planSheets(P5x6, { widthMm: 297, heightMm: 420 }, false)).perSheet).toBe(4)
  })

  it('treats a landscape paper the same as portrait', () => {
    const a = ok(planSheets(P5x6, A4, false))
    const b = ok(planSheets(P5x6, { widthMm: 297, heightMm: 210 }, false))
    expect(b.paper).toEqual(A4)
    expect(b.slots).toEqual(a.slots)
  })
})

describe('cut marks', () => {
  it('sit outside every trim and on the paper', () => {
    for (const edge of [false, true]) {
      const p = ok(planSheets(P5x6, A4, edge))
      const lines = cutLines(p, 2)
      expect(lines.length).toBe(16)
      for (const l of lines) {
        for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2], [(l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2]]) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(p.paper.widthMm)
          expect(y).toBeLessThanOrEqual(p.paper.heightMm)
          for (const s of p.slots) {
            const insideTrim = x > s.trim.x + 1e-9 && x < s.trim.x + s.trim.w - 1e-9 && y > s.trim.y + 1e-9 && y < s.trim.y + s.trim.h - 1e-9
            expect(insideTrim).toBe(false)
          }
        }
      }
    }
  })

  it('marks only the slots that hold a page', () => {
    const p = ok(planSheets(P5x6, A4, false))
    expect(cutLines(p, 1)).toHaveLength(8)
    expect(cutLines(p, 0)).toEqual([])
  })

  it('places page labels on the paper, below their page', () => {
    const p = ok(planSheets(P5x6, A4, false))
    for (const s of p.slots) {
      expect(s.labelAt).not.toBeNull()
      expect(s.labelAt!.y).toBeGreaterThan(s.trim.y + s.trim.h)
      expect(s.labelAt!.y).toBeLessThanOrEqual(p.paper.heightMm)
    }
  })
})

describe('sheets for a book', () => {
  it('counts sheets and fills them in order', () => {
    expect(sheetCount(21, 2)).toBe(11)
    expect(sheetCount(0, 2)).toBe(0)
    expect(sheetCount(5, 0)).toBe(0)
    expect(pagesOnSheet(0, 2, 21)).toEqual([0, 1])
    expect(pagesOnSheet(10, 2, 21)).toEqual([20])
    expect(pagesOnSheet(11, 2, 21)).toEqual([])
  })
})
