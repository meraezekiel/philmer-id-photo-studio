import { describe, expect, it } from 'vitest'

import {
  autoCrop,
  estimateChinY,
  eyeMidpoint,
  geometry,
  headAt,
  headRatioRange,
  headStatus,
  largestFace,
  measureHead,
  mouthMidpoint,
  nominalHeadRatio,
  rollDegrees,
  zoomCrop,
  EYE_RATIO,
  MAX_ROLL_DEGREES,
} from './autoCrop'
import { PHOTO_PRESETS } from './presets'
import type { Face } from './tauri'

/**
 * A face with the eyes level, built so the geometry is easy to reason about:
 * eyes at y=100, mouth at y=160, which puts the estimated chin at
 * 160 + 0.85*60 = 211.
 */
function face(overrides: Partial<Face['landmarks']> = {}, box?: Face['box']): Face {
  return {
    box: box ?? [60, 40, 120, 200],
    score: 0.95,
    landmarks: {
      rightEye: { x: 90, y: 100 },
      leftEye: { x: 130, y: 100 },
      nose: { x: 110, y: 135 },
      mouthRight: { x: 95, y: 160 },
      mouthLeft: { x: 125, y: 160 },
      ...overrides,
    },
  }
}

describe('landmark arithmetic', () => {
  it('finds the eye and mouth midpoints', () => {
    expect(eyeMidpoint(face())).toEqual({ x: 110, y: 100 })
    expect(mouthMidpoint(face())).toEqual({ x: 110, y: 160 })
  })

  it('estimates the chin below the mouth by CHIN_FACTOR of the eye-mouth span', () => {
    // 160 + 0.85 * (160 - 100)
    expect(estimateChinY(face())).toBeCloseTo(211, 6)
  })
})

describe('roll', () => {
  it('is zero when the eyes are level', () => {
    expect(rollDegrees(face())).toBeCloseTo(0, 6)
  })

  it('returns the rotation that levels a tilted eye line', () => {
    // Left eye 40 lower over a 40 px span: the face is tilted +45 degrees, so
    // levelling it needs -45, clamped to the limit.
    const tilted = face({ leftEye: { x: 130, y: 140 } })
    expect(rollDegrees(tilted)).toBe(-MAX_ROLL_DEGREES)
  })

  it('clamps to +/-15 degrees in both directions', () => {
    const up = face({ leftEye: { x: 130, y: 20 } })
    expect(rollDegrees(up)).toBe(MAX_ROLL_DEGREES)
  })

  it('passes through a small tilt unclamped', () => {
    // ~5.7 degrees over a 40 px span.
    const slight = face({ leftEye: { x: 130, y: 104 } })
    const roll = rollDegrees(slight)
    expect(roll).toBeLessThan(0)
    expect(roll).toBeGreaterThan(-MAX_ROLL_DEGREES)
  })
})

describe('geometry', () => {
  it('places the eye line between crown and chin at EYE_RATIO', () => {
    const g = geometry(PHOTO_PRESETS['2x2'])
    expect(g.eye).toBeCloseTo(g.crown + EYE_RATIO * (g.chinMid - g.crown), 9)
    expect(g.eye).toBeGreaterThan(g.crown)
    expect(g.eye).toBeLessThan(g.chinMid)
  })

  it('keeps the passport band on the ICAO rule', () => {
    const p = PHOTO_PRESETS.passport
    const [lo, hi] = headRatioRange(p)
    // 32-36 mm of head in a 45 mm photo, 4 mm above the crown.
    expect(lo * p.heightMm).toBeCloseTo(32, 6)
    expect(hi * p.heightMm).toBeCloseTo(36, 6)
    expect(p.crownRatio * p.heightMm).toBeCloseTo(4, 6)
    expect(nominalHeadRatio(p) * p.heightMm).toBeCloseTo(34, 6)
  })

  it('every preset has a chin band below its crown', () => {
    for (const preset of Object.values(PHOTO_PRESETS)) {
      expect(preset.chinMin).toBeGreaterThan(preset.crownRatio)
      expect(preset.chinMax).toBeGreaterThan(preset.chinMin)
      expect(preset.chinMax).toBeLessThanOrEqual(1)
    }
  })

  it('takes the aspect from the preset', () => {
    expect(geometry(PHOTO_PRESETS.passport).aspect).toBeCloseTo(35 / 45, 9)
    expect(geometry(PHOTO_PRESETS['2x2']).aspect).toBeCloseTo(1, 9)
  })
})

describe('headAt', () => {
  const g = geometry(PHOTO_PRESETS['2x2'])

  it('is the nominal head at zoom 1', () => {
    const h = headAt(g, 1)
    expect(h.crown).toBeCloseTo(g.crown, 9)
    expect(h.chin).toBeCloseTo(g.chinMid, 9)
  })

  it('grows the head about the eye line, so the eyes stay put', () => {
    const small = headAt(g, 0.8)
    const large = headAt(g, 1.2)
    expect(large.chin - large.crown).toBeGreaterThan(small.chin - small.crown)
    // The eye line is the fixed point of the zoom.
    for (const h of [small, large]) {
      const eye = h.crown + EYE_RATIO * (h.chin - h.crown)
      expect(eye).toBeCloseTo(g.eye, 6)
    }
  })
})

describe('headStatus', () => {
  const g = geometry(PHOTO_PRESETS['2x2'])

  it('is OK at the nominal zoom', () => {
    expect(headStatus(g, 1)).toBe('ok')
  })

  it('reports too small when the chin lands above the band', () => {
    expect(headStatus(g, 0.5)).toBe('small')
  })

  it('reports too large when the chin passes the band', () => {
    expect(headStatus(g, 1.5)).toBe('large')
  })

  it('reports too large when the crown is pushed off the top edge', () => {
    // A zoom big enough to drive the crown negative.
    expect(headStatus(g, 5)).toBe('large')
  })

  it('falls back to manual when no face was found', () => {
    expect(headStatus(g, 1, { faceFound: false })).toBe('manual')
  })

  it('is OK across the whole band for every preset', () => {
    for (const preset of Object.values(PHOTO_PRESETS)) {
      const pg = geometry(preset)
      expect(headStatus(pg, 1)).toBe('ok')
    }
  })
})

describe('autoCrop', () => {
  const g = geometry(PHOTO_PRESETS['2x2'])
  const input = { face: face(), imageWidth: 1000, imageHeight: 1400 }

  it('puts the crown on the preset crown line and the chin in the band', () => {
    const crownY = 40
    const crop = autoCrop({ ...input, crownY }, g)
    const chinY = estimateChinY(face())

    const measured = measureHead(crop, crownY, chinY)
    expect(measured.crown).toBeCloseTo(g.crown, 6)
    expect(measured.chin).toBeGreaterThanOrEqual(g.chinMin)
    expect(measured.chin).toBeLessThanOrEqual(g.chinMax)
  })

  it('centres the crop horizontally on the eye midpoint', () => {
    const crop = autoCrop({ ...input, crownY: 40 }, g)
    expect(crop.x + crop.width / 2).toBeCloseTo(eyeMidpoint(face()).x, 6)
  })

  it('locks the crop to the preset aspect', () => {
    for (const preset of Object.values(PHOTO_PRESETS)) {
      const pg = geometry(preset)
      const crop = autoCrop({ ...input, crownY: 40 }, pg)
      expect(crop.width / crop.height).toBeCloseTo(pg.aspect, 6)
    }
  })

  it('carries the levelling rotation', () => {
    const tilted = { ...input, face: face({ leftEye: { x: 130, y: 104 } }), crownY: 40 }
    expect(autoCrop(tilted, g).rotationDeg).toBeCloseTo(rollDegrees(tilted.face), 9)
  })

  it('is allowed to run past the top edge rather than clamping', () => {
    // A head right at the top of the frame needs headroom that is not there.
    const high = {
      face: face({
        rightEye: { x: 90, y: 12 },
        leftEye: { x: 130, y: 12 },
        mouthRight: { x: 95, y: 30 },
        mouthLeft: { x: 125, y: 30 },
      }),
      crownY: 0,
      imageWidth: 1000,
      imageHeight: 1400,
    }
    const crop = autoCrop(high, g)
    expect(crop.y).toBeLessThan(0)
  })

  it('uses a hair-aware crown when given one', () => {
    const withHair = autoCrop({ ...input, crownY: 20 }, g)
    const withoutHair = autoCrop(input, g)
    // A higher crown means a taller head, so a taller crop.
    expect(withHair.height).toBeGreaterThan(0)
    expect(withoutHair.height).toBeGreaterThan(0)
    expect(withHair.y).toBeLessThan(withoutHair.y + withHair.height)
  })

  it('a bigger head produces a bigger crop, keeping the head fraction fixed', () => {
    const near = autoCrop({ ...input, crownY: 40 }, g)
    const far = autoCrop({ ...input, crownY: 70 }, g)
    expect(near.height).toBeGreaterThan(far.height)
  })
})

describe('largestFace', () => {
  it('returns null when there are none', () => {
    expect(largestFace([])).toBeNull()
  })

  it('picks the biggest by area, which is the subject at the counter', () => {
    const small = { ...face(), box: [0, 0, 50, 50] as Face['box'] }
    const big = { ...face(), box: [0, 0, 200, 200] as Face['box'] }
    expect(largestFace([small, big, small])).toBe(big)
  })
})

describe('zoomCrop', () => {
  it('keeps the centre and scales the rectangle', () => {
    const crop = { x: 100, y: 200, width: 400, height: 500, rotationDeg: 0 }
    const zoomed = zoomCrop(crop, 2)
    expect(zoomed.width).toBe(200)
    expect(zoomed.height).toBe(250)
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(crop.x + crop.width / 2, 9)
    expect(zoomed.y + zoomed.height / 2).toBeCloseTo(crop.y + crop.height / 2, 9)
  })

  it('preserves the aspect ratio', () => {
    const crop = { x: 0, y: 0, width: 350, height: 450, rotationDeg: 0 }
    const zoomed = zoomCrop(crop, 1.37)
    expect(zoomed.width / zoomed.height).toBeCloseTo(350 / 450, 9)
  })
})
