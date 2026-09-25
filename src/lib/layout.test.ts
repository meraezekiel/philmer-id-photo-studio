import { describe, expect, it } from 'vitest'

import {
  capacity,
  cutMarks,
  fillSheet,
  packPackage,
  packageItemsToRequests,
  reduceRequest,
  photoSizeMm,
  fillSheetAuto,
  packPackageAuto,
  requestedCount,
} from './layout'
import {
  DEFAULT_GAP_MM,
  PACKAGE_PRESETS,
  PAPERS,
  PHOTO_PRESETS,
  type PaperId,
  type PhotoPresetId,
} from './presets'

/**
 * BUILD_PLAN §7's fixture table, verbatim. These are the numbers the shop
 * counts by hand, so they are the contract for this module.
 *
 * Gap 2 mm; margins 3 mm on 4R and 5 mm elsewhere.
 */
const EXPECTED: Record<PaperId, { '1x1': number; '2x2': number; passport: number }> = {
  '4r': { '1x1': 15, '2x2': 2, passport: 8 },
  a4: { '1x1': 70, '2x2': 15, passport: 30 },
  short: { '1x1': 63, '2x2': 15, passport: 28 },
  long: { '1x1': 77, '2x2': 18, passport: 32 },
}

const SIZES: Exclude<PhotoPresetId, 'custom'>[] = ['1x1', '2x2', 'passport']

describe('fillSheet matches the BUILD_PLAN §7 table', () => {
  for (const paper of Object.keys(EXPECTED) as PaperId[]) {
    for (const size of SIZES) {
      it(`${PAPERS[paper].label} fits ${EXPECTED[paper][size]} x ${size}`, () => {
        expect(capacity(paper, photoSizeMm(size))).toBe(EXPECTED[paper][size])
      })
    }
  }
})

describe('fillSheet geometry', () => {
  it('uses the paper default margin and the 2 mm gap unless told otherwise', () => {
    const layout = fillSheet('4r', photoSizeMm('1x1'))
    expect(layout.marginMm).toBe(3)
    expect(layout.gapMm).toBe(DEFAULT_GAP_MM)
    expect(layout.cols * layout.rows).toBe(15)
  })

  it('turns Passport sideways on 4R, which is what makes 8 instead of 6', () => {
    const upright = fillSheet('4r', photoSizeMm('passport'), { orientation: 'portrait' })
    const auto = fillSheet('4r', photoSizeMm('passport'))
    expect(upright.capacity).toBe(6)
    expect(auto.capacity).toBe(8)
    expect(auto.rotated).toBe(true)
    // A rotated cell really is 45 x 35, not 35 x 45.
    expect(auto.placements[0].widthMm).toBeCloseTo(45, 6)
    expect(auto.placements[0].heightMm).toBeCloseTo(35, 6)
  })

  it('never rotates a square photo away from its better orientation', () => {
    const layout = fillSheet('a4', photoSizeMm('2x2'))
    expect(layout.rotated).toBe(false)
  })

  it('keeps every photo inside the margins', () => {
    for (const paper of Object.keys(EXPECTED) as PaperId[]) {
      for (const size of SIZES) {
        const layout = fillSheet(paper, photoSizeMm(size))
        const { widthMm, heightMm } = PAPERS[paper]
        for (const p of layout.placements) {
          expect(p.xMm).toBeGreaterThanOrEqual(layout.marginMm - 1e-6)
          expect(p.yMm).toBeGreaterThanOrEqual(layout.marginMm - 1e-6)
          expect(p.xMm + p.widthMm).toBeLessThanOrEqual(widthMm - layout.marginMm + 1e-6)
          expect(p.yMm + p.heightMm).toBeLessThanOrEqual(heightMm - layout.marginMm + 1e-6)
        }
      }
    }
  })

  it('leaves at least the gap between neighbours', () => {
    const layout = fillSheet('a4', photoSizeMm('1x1'))
    for (let i = 0; i < layout.placements.length; i++) {
      for (let j = i + 1; j < layout.placements.length; j++) {
        const a = layout.placements[i]
        const b = layout.placements[j]
        const gapX = Math.max(a.xMm - (b.xMm + b.widthMm), b.xMm - (a.xMm + a.widthMm))
        const gapY = Math.max(a.yMm - (b.yMm + b.heightMm), b.yMm - (a.yMm + a.heightMm))
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(layout.gapMm - 1e-6)
      }
    }
  })

  it('anchors the grid at the top-left margin, not centred', () => {
    // A cutting job wants the photos at the top: you cut downwards and the
    // leftover paper stays in one usable piece.
    const layout = fillSheet('a4', photoSizeMm('2x2'))
    const left = Math.min(...layout.placements.map((p) => p.xMm))
    const top = Math.min(...layout.placements.map((p) => p.yMm))
    expect(left).toBeCloseTo(layout.marginMm, 6)
    expect(top).toBeCloseTo(layout.marginMm, 6)
  })

  it('shifts the whole block by the drag offset', () => {
    const base = fillSheet('a4', photoSizeMm('2x2'))
    const moved = fillSheet('a4', photoSizeMm('2x2'), { offsetXMm: 7, offsetYMm: 11 })
    expect(moved.placements).toHaveLength(base.placements.length)
    moved.placements.forEach((p, i) => {
      expect(p.xMm).toBeCloseTo(base.placements[i].xMm + 7, 6)
      expect(p.yMm).toBeCloseTo(base.placements[i].yMm + 11, 6)
    })
  })

  it('honours an exact quantity and never exceeds capacity', () => {
    expect(fillSheet('a4', photoSizeMm('1x1'), { quantity: 12 }).placements).toHaveLength(12)
    expect(fillSheet('4r', photoSizeMm('2x2'), { quantity: 99 }).placements).toHaveLength(2)
    expect(fillSheet('a4', photoSizeMm('1x1'), { quantity: 0 }).placements).toHaveLength(0)
  })

  it('reports zero rather than throwing when the photo is bigger than the paper', () => {
    const layout = fillSheet('4r', { widthMm: 300, heightMm: 300 })
    expect(layout.capacity).toBe(0)
    expect(layout.placements).toEqual([])
  })

  it('larger margins reduce the count', () => {
    expect(capacity('a4', photoSizeMm('1x1'), { marginMm: 20 })).toBeLessThan(
      capacity('a4', photoSizeMm('1x1')),
    )
  })

  it('accepts a custom size and rejects one with no dimensions', () => {
    expect(photoSizeMm('custom', { widthMm: 30, heightMm: 40 })).toEqual({
      widthMm: 30,
      heightMm: 40,
    })
    expect(() => photoSizeMm('custom')).toThrow()
  })
})

describe('packPackage', () => {
  it('places every photo of the shipped 4R combo', () => {
    const preset = PACKAGE_PRESETS.find((p) => p.id === '4r-combo')!
    const result = packPackage(preset.paper, packageItemsToRequests(preset.items))
    expect(result.fits).toBe(true)
    expect(result.unplaced).toEqual([])
    expect(result.placements).toHaveLength(6) // 2 x 2x2 + 4 x 1x1
  })

  it('places every photo of the shipped A4 combo', () => {
    const preset = PACKAGE_PRESETS.find((p) => p.id === 'a4-combo')!
    const result = packPackage(preset.paper, packageItemsToRequests(preset.items))
    expect(result.fits).toBe(true)
    expect(result.placements).toHaveLength(16) // 4 + 8 + 4
  })

  it('every shipped package preset fits on its own paper with default margins', () => {
    for (const preset of PACKAGE_PRESETS) {
      const result = packPackage(preset.paper, packageItemsToRequests(preset.items))
      expect(result.fits, `${preset.label} should fit on ${preset.paper}`).toBe(true)
    }
  })

  it('reports what did not fit instead of silently dropping it', () => {
    const result = packPackage('4r', [{ presetId: '2x2', qty: 12 }])
    expect(result.fits).toBe(false)
    const short = result.unplaced.find((u) => u.presetId === '2x2')!
    expect(short.qty + result.placements.length).toBe(12)
  })

  it('the same package that overflows 4R fits on A4', () => {
    const items = [
      { presetId: '2x2' as const, qty: 4 },
      { presetId: '1x1' as const, qty: 8 },
    ]
    expect(packPackage('4r', items).fits).toBe(false)
    expect(packPackage('a4', items).fits).toBe(true)
  })

  it('keeps packed photos inside the margins and non-overlapping', () => {
    const preset = PACKAGE_PRESETS.find((p) => p.id === 'a4-combo')!
    const result = packPackage(preset.paper, packageItemsToRequests(preset.items))
    const paper = PAPERS[preset.paper]
    for (const p of result.placements) {
      expect(p.xMm).toBeGreaterThanOrEqual(result.marginMm - 1e-6)
      expect(p.yMm).toBeGreaterThanOrEqual(result.marginMm - 1e-6)
      expect(p.xMm + p.widthMm).toBeLessThanOrEqual(paper.widthMm - result.marginMm + 1e-6)
      expect(p.yMm + p.heightMm).toBeLessThanOrEqual(paper.heightMm - result.marginMm + 1e-6)
    }
    for (let i = 0; i < result.placements.length; i++) {
      for (let j = i + 1; j < result.placements.length; j++) {
        const a = result.placements[i]
        const b = result.placements[j]
        const overlaps =
          a.xMm < b.xMm + b.widthMm - 1e-6 &&
          b.xMm < a.xMm + a.widthMm - 1e-6 &&
          a.yMm < b.yMm + b.heightMm - 1e-6 &&
          b.yMm < a.yMm + a.heightMm - 1e-6
        expect(overlaps, `placement ${i} overlaps ${j}`).toBe(false)
      }
    }
  })

  it('tracks which package row each photo came from', () => {
    const result = packPackage('a4', [
      { presetId: '2x2', qty: 2 },
      { presetId: '1x1', qty: 3 },
    ])
    expect(result.placements.filter((p) => p.itemIndex === 0)).toHaveLength(2)
    expect(result.placements.filter((p) => p.itemIndex === 1)).toHaveLength(3)
  })

  it('packs a package from the top-left margin', () => {
    const result = packPackage('a4', [
      { presetId: '2x2', qty: 2 },
      { presetId: '1x1', qty: 4 },
    ])
    const left = Math.min(...result.placements.map((p) => p.xMm))
    const top = Math.min(...result.placements.map((p) => p.yMm))
    expect(left).toBeCloseTo(result.marginMm, 6)
    expect(top).toBeCloseTo(result.marginMm, 6)
  })

  it('shifts a packed block by the drag offset', () => {
    const items = [{ presetId: '1x1' as const, qty: 3 }]
    const base = packPackage('a4', items)
    const moved = packPackage('a4', items, { offsetXMm: -4, offsetYMm: 6 })
    moved.placements.forEach((p, i) => {
      expect(p.xMm).toBeCloseTo(base.placements[i].xMm - 4, 6)
      expect(p.yMm).toBeCloseTo(base.placements[i].yMm + 6, 6)
    })
  })

  it('an empty package is trivially satisfied', () => {
    const result = packPackage('4r', [])
    expect(result.fits).toBe(true)
    expect(result.placements).toEqual([])
  })
})

describe('cutMarks', () => {
  it('draws marks without duplicating shared edges', () => {
    const layout = fillSheet('4r', photoSizeMm('2x2'))
    const marks = cutMarks(layout)
    expect(marks.length).toBeGreaterThan(0)
    const keys = new Set(marks.map((m) => `${m.x1Mm},${m.y1Mm},${m.x2Mm},${m.y2Mm}`))
    expect(keys.size).toBe(marks.length)
  })

  it('never crosses the inside of a photo', () => {
    const layout = fillSheet('a4', photoSizeMm('1x1'))
    for (const m of cutMarks(layout)) {
      for (const p of layout.placements) {
        const insideX = m.x1Mm > p.xMm + 1e-6 && m.x2Mm < p.xMm + p.widthMm - 1e-6
        const insideY = m.y1Mm > p.yMm + 1e-6 && m.y2Mm < p.yMm + p.heightMm - 1e-6
        expect(insideX && insideY).toBe(false)
      }
    }
  })
})

describe('presets stay consistent with the plan', () => {
  it('passport locks to white and forbids a name tag', () => {
    expect(PHOTO_PRESETS.passport.lockBackgroundToWhite).toBe(true)
    expect(PHOTO_PRESETS.passport.allowNameTag).toBe(false)
  })

  it('every preset has a positive physical size', () => {
    for (const preset of Object.values(PHOTO_PRESETS)) {
      expect(preset.widthMm).toBeGreaterThan(0)
      expect(preset.heightMm).toBeGreaterThan(0)
    }
  })
})

describe('paper orientation', () => {
  it('a uniform grid fits the same count either way round', () => {
    // cols * rows is symmetric when the paper's sides swap.
    for (const paper of Object.keys(EXPECTED) as PaperId[]) {
      for (const size of SIZES) {
        const portrait = fillSheet(paper, photoSizeMm(size), { paperLandscape: false })
        const landscape = fillSheet(paper, photoSizeMm(size), { paperLandscape: true })
        expect(landscape.capacity).toBe(portrait.capacity)
      }
    }
  })

  it('reports the paper size actually used', () => {
    const landscape = fillSheet('4r', photoSizeMm('1x1'), { paperLandscape: true })
    expect(landscape.paperWidthMm).toBeCloseTo(PAPERS['4r'].heightMm, 6)
    expect(landscape.paperHeightMm).toBeCloseTo(PAPERS['4r'].widthMm, 6)
    expect(landscape.paperLandscape).toBe(true)
  })

  it('still matches the §7 table through the auto chooser', () => {
    for (const paper of Object.keys(EXPECTED) as PaperId[]) {
      for (const size of SIZES) {
        expect(fillSheetAuto(paper, photoSizeMm(size), 'auto').capacity).toBe(
          EXPECTED[paper][size],
        )
      }
    }
  })

  it('honours an explicit paper orientation', () => {
    expect(fillSheetAuto('a4', photoSizeMm('1x1'), 'landscape').paperLandscape).toBe(true)
    expect(fillSheetAuto('a4', photoSizeMm('1x1'), 'portrait').paperLandscape).toBe(false)
  })

  it('turns the paper sideways to rescue a package that would not fit', () => {
    // Shelf packing is not symmetric, so orientation can decide the outcome.
    const items = [
      { presetId: 'passport' as const, qty: 3 },
      { presetId: '2x2' as const, qty: 1 },
    ]
    const auto = packPackageAuto('4r', items, 'auto')
    // Whatever it picks, auto must never do worse than a fixed orientation.
    const portrait = packPackage('4r', items, { paperLandscape: false })
    const landscape = packPackage('4r', items, { paperLandscape: true })
    const best = Math.max(portrait.placements.length, landscape.placements.length)
    expect(auto.placements.length).toBe(best)
  })

  it('prefers an orientation that fits over one that does not', () => {
    const items = [{ presetId: '1x1' as const, qty: 4 }]
    const auto = packPackageAuto('4r', items, 'auto')
    expect(auto.fits).toBe(true)
  })

  it('counts what a package asked for', () => {
    expect(requestedCount([{ presetId: '1x1', qty: 4 }, { presetId: '2x2', qty: 2 }])).toBe(6)
    expect(requestedCount([])).toBe(0)
  })
})

describe('reduceRequest', () => {
  const rows = [
    { presetId: '2x2', qty: 2 },
    { presetId: '1x1', qty: 14 },
  ]

  it('takes the deleted photos off the row they came from', () => {
    expect(reduceRequest(rows, [1, 1, 1])).toEqual([
      { presetId: '2x2', qty: 2 },
      { presetId: '1x1', qty: 11 },
    ])
  })

  it('drops a row that reaches zero', () => {
    expect(reduceRequest(rows, [0, 0])).toEqual([{ presetId: '1x1', qty: 14 }])
  })

  it('handles several rows at once', () => {
    expect(reduceRequest(rows, [0, 1, 1])).toEqual([
      { presetId: '2x2', qty: 1 },
      { presetId: '1x1', qty: 12 },
    ])
  })

  it('never goes below zero, however many are deleted', () => {
    expect(reduceRequest(rows, [0, 0, 0, 0, 0])).toEqual([{ presetId: '1x1', qty: 14 }])
  })

  it('leaves the rows alone when nothing was deleted', () => {
    expect(reduceRequest(rows, [])).toEqual(rows)
  })

  /**
   * The point of the whole exercise: what the order says and what the sheet
   * shows must agree, so that raising the quantity adds one photo rather than
   * resurrecting every photo that was deleted.
   */
  it('leaves the order agreeing with the sheet', () => {
    const after = reduceRequest(rows, [1, 1, 1, 1, 1, 1])
    const items = after.map((r) => ({ presetId: r.presetId as PhotoPresetId, qty: r.qty }))
    const packed = packPackage('a4', items)
    expect(requestedCount(items)).toBe(packed.placements.length)
    expect(packed.placements.length).toBe(10)
  })
})
