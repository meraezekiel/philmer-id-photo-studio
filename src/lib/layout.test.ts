import { describe, expect, it } from 'vitest'

import {
  capacity,
  cutMarks,
  fillSheet,
  packPackage,
  packageItemsToRequests,
  photoSizeMm,
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

  it('centres the grid on the paper', () => {
    const layout = fillSheet('a4', photoSizeMm('2x2'))
    const left = Math.min(...layout.placements.map((p) => p.xMm))
    const right = Math.max(...layout.placements.map((p) => p.xMm + p.widthMm))
    expect(left).toBeCloseTo(PAPERS.a4.widthMm - right, 6)
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

  it('each head ratio sits inside its own range', () => {
    for (const preset of Object.values(PHOTO_PRESETS)) {
      const [lo, hi] = preset.headRatioRange
      expect(preset.headRatio).toBeGreaterThanOrEqual(lo)
      expect(preset.headRatio).toBeLessThanOrEqual(hi)
    }
  })

  it('passport head band is the 32-36 mm ICAO rule', () => {
    const p = PHOTO_PRESETS.passport
    expect(p.headRatioRange[0] * p.heightMm).toBeCloseTo(32, 6)
    expect(p.headRatioRange[1] * p.heightMm).toBeCloseTo(36, 6)
    expect(p.topGapRatio * p.heightMm).toBeCloseTo(4, 6)
  })
})
