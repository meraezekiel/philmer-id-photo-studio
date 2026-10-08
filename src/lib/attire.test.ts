import { describe, expect, it } from 'vitest'

import {
  attireBottomFraction,
  attireMatrix,
  autoFit,
  clothesMask,
  DEFAULT_FIT,
  faceFrame,
  measureTemplate,
  NECK_BAND,
  COLLAR_DROP,
  neckBand,
  scaleCrop,
  shiftCrop,
  SHOULDER_PER_FACE,
} from './attire'
import { createBitmap, type Bitmap } from './composite'
import type { Face } from './tauri'

/** A template drawn from rows of '#' (opaque) and '.' (transparent). */
function templateFrom(rows: string[]): Bitmap {
  const width = rows[0].length
  const bmp = createBitmap(width, rows.length)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      bmp.data[(y * width + x) * 4 + 3] = row[x] === '#' ? 255 : 0
    }
  })
  return bmp
}

function face(box: [number, number, number, number]): Face {
  const [x, y, w, h] = box
  return {
    box,
    score: 0.9,
    landmarks: {
      rightEye: { x: x + w * 0.3, y: y + h * 0.4 },
      leftEye: { x: x + w * 0.7, y: y + h * 0.4 },
      nose: { x: x + w * 0.5, y: y + h * 0.6 },
      mouthRight: { x: x + w * 0.35, y: y + h * 0.8 },
      mouthLeft: { x: x + w * 0.65, y: y + h * 0.8 },
    },
  }
}

function apply(m: number[], x: number, y: number) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

describe('measureTemplate', () => {
  it('anchors at the top of the collar, on the centre line', () => {
    const t = templateFrom([
      '..##.....##..',
      '..###...###..',
      '.#####.#####.',
      '#############',
      '#############',
    ])
    const a = measureTemplate(t)
    expect(a.collar).toEqual({ x: 6, y: 0 })
    expect(a.shoulderWidth).toBe(11)
    expect(a.bottom).toBe(5)
    expect(a.width).toBe(13)
  })

  it('anchors a high collar at its top centre too', () => {
    const t = templateFrom(['...###...', '.#######.', '#########', '#########'])
    const lowered = templateFrom(['.........', ...['...###...', '.#######.', '#########']])
    expect(measureTemplate(t).collar).toEqual({ x: 4, y: 0 })
    expect(measureTemplate(lowered).collar).toEqual({ x: 4, y: 1 })
  })

  it('measures shoulders only in the top of the clothing', () => {
    // A flared bottom must not count as shoulders.
    const t = templateFrom([
      '...###...',
      '..#####..',
      '..#####..',
      '..#####..',
      '..#####..',
      '#########',
    ])
    expect(measureTemplate(t).shoulderWidth).toBe(5)
  })

  it('refuses a template with nothing opaque', () => {
    expect(() => measureTemplate(templateFrom(['....', '....']))).toThrow(/no clothing/i)
  })
})

describe('faceFrame', () => {
  const image = { width: 1000, height: 1000 }

  it('is null without a face', () => {
    expect(faceFrame(null, null, image)).toBeNull()
  })

  it('maps to fractions of the whole image when there is no crop', () => {
    const f = faceFrame(face([400, 200, 200, 250]), null, image)!
    expect(f.faceWidth).toBeCloseTo(0.2)
    expect(f.faceHeight).toBeCloseTo(0.25)
    expect(f.chinX).toBeCloseTo(0.5)
  })

  it('maps through the crop, including its rotation', () => {
    const fc = face([400, 200, 200, 250])
    const crop = { x: 300, y: 100, width: 400, height: 500, rotationDeg: 0 }
    const flat = faceFrame(fc, crop, image)!
    expect(flat.chinX).toBeCloseTo(0.5)
    expect(flat.faceWidth).toBeCloseTo(0.5)

    // A 180° turn about the crop centre mirrors the chin through it.
    const turned = faceFrame(fc, { ...crop, rotationDeg: 180 }, image)!
    expect(turned.chinX).toBeCloseTo(1 - flat.chinX)
    expect(turned.chinY).toBeCloseTo(1 - flat.chinY)
  })
})

describe('autoFit', () => {
  it('has a centred default when no face was found', () => {
    expect(autoFit(null)).toEqual(DEFAULT_FIT)
  })

  it('hangs the collar just below the chin and sizes shoulders from the face', () => {
    const fit = autoFit({ chinX: 0.5, chinY: 0.6, faceWidth: 0.3, faceHeight: 0.4 })
    expect(fit.x).toBeCloseTo(0.5)
    expect(fit.y).toBeCloseTo(0.6 + COLLAR_DROP * 0.4)
    expect(fit.scale).toBeCloseTo(SHOULDER_PER_FACE * 0.3)
    expect(fit.rotation).toBe(0)
  })
})

describe('neckBand', () => {
  it('keeps a neck-wide strip centred under the chin', () => {
    const band = neckBand({ chinX: 0.5, chinY: 0.6, faceWidth: 0.4, faceHeight: 0.5 })
    expect(band.left).toBeCloseTo(0.5 - NECK_BAND * 0.2)
    expect(band.right).toBeCloseTo(0.5 + NECK_BAND * 0.2)
  })
})

describe('attireMatrix', () => {
  const anchors = { collar: { x: 50, y: 20 }, shoulderWidth: 100, bottom: 120, width: 100, height: 120 }
  const fit = { x: 0.5, y: 0.7, scale: 0.8, rotation: 10 }

  it('puts the template collar on the fitted point at any resolution', () => {
    for (const [w, h] of [
      [300, 400],
      [600, 800],
    ]) {
      const p = apply(attireMatrix(fit, anchors, w, h), 50, 20)
      expect(p.x).toBeCloseTo(0.5 * w)
      expect(p.y).toBeCloseTo(0.7 * h)
    }
  })

  it('scales the shoulders to the fitted share of the photo width', () => {
    const m = attireMatrix({ ...fit, rotation: 0 }, anchors, 600, 800)
    const left = apply(m, 0, 20)
    const right = apply(m, 100, 20)
    expect(right.x - left.x).toBeCloseTo(0.8 * 600)
  })

  it('reports where the template bottom lands', () => {
    const bottom = attireBottomFraction({ ...fit, rotation: 0 }, anchors, 600, 800)
    // 100 template px below the collar, at 4.8 photo px per template px.
    expect(bottom).toBeCloseTo((0.7 * 800 + 100 * 4.8) / 800)
  })
})


describe('clothesMask', () => {
  const W = 40
  const H = 40
  const SKIN = [200, 150, 120]
  const SHIRT = [40, 80, 160]
  const frame = { chinX: 0.5, chinY: 0.5, faceWidth: 0.4, faceHeight: 0.4 }

  /** Head, neck, a shirt, and a shirt collar that rises beside the jaw. */
  function person(face = SKIN) {
    const photo = createBitmap(W, H)
    const alpha = new Float32Array(W * H)
    const paint = (x0: number, x1: number, y0: number, y1: number, c: number[]) => {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x
          photo.data.set([c[0], c[1], c[2], 255], i * 4)
          alpha[i] = 1
        }
    }
    paint(2, 37, 26, 39, SHIRT)
    paint(28, 31, 16, 25, SHIRT)
    paint(12, 27, 4, 19, face)
    paint(16, 23, 20, 27, face)
    return { photo, alpha }
  }
  const at = (m: Uint8Array, x: number, y: number) => m[y * W + x]

  it('marks the shirt and a collar beside the jaw, and keeps the head and neck', () => {
    const { photo, alpha } = person()
    const m = clothesMask(photo, alpha, frame)!
    expect(at(m, 5, 30)).toBe(1)
    expect(at(m, 29, 18)).toBe(1)
    expect(at(m, 20, 24)).toBe(0)
    expect(at(m, 20, 10)).toBe(0)
    expect(at(m, 2, 2)).toBe(0)
  })

  it('also takes patches and logos the flood cannot reach', () => {
    const { photo, alpha } = person()
    // A white badge on the shirt: too sharp an edge for the flood to cross.
    for (let y = 28; y <= 38; y++)
      for (let x = 3; x <= 14; x++) photo.data.set([255, 255, 255, 255], (y * W + x) * 4)
    const m = clothesMask(photo, alpha, frame)!
    expect(at(m, 8, 33)).toBe(1)
    expect(at(m, 20, 24)).toBe(0)
  })

  it('takes skin-coloured patches that are not joined to the face', () => {
    const { photo, alpha } = person()
    for (let y = 30; y <= 37; y++)
      for (let x = 26; x <= 35; x++) photo.data.set([200, 150, 120, 255], (y * W + x) * 4)
    const m = clothesMask(photo, alpha, frame)!
    expect(at(m, 30, 34)).toBe(1)
    expect(at(m, 20, 24)).toBe(0)
  })

  it('does not mistake a light grey top for skin', () => {
    // Pale skin and a light grey top that touches the neck.
    const PALE = [225, 185, 160]
    const { photo, alpha } = person(PALE)
    for (let y = 26; y <= 39; y++)
      for (let x = 2; x <= 37; x++) {
        const i = y * W + x
        if (x >= 16 && x <= 23 && y <= 27) continue
        photo.data.set([200, 198, 196, 255], i * 4)
      }
    const m = clothesMask(photo, alpha, frame)!
    expect(at(m, 5, 30)).toBe(1)
    expect(at(m, 20, 24)).toBe(0)
  })

  it('gives up when the face shows no skin to compare against', () => {
    const { photo, alpha } = person(SHIRT)
    expect(clothesMask(photo, alpha, frame)).toBeNull()
  })
})

describe('shiftCrop', () => {
  const crop = { x: 100, y: 200, width: 400, height: 500, rotationDeg: 0 }

  it('moves the window the other way, so the person moves the way you drag', () => {
    const moved = shiftCrop(crop, 0.1, 0.2)
    expect(moved.x).toBeCloseTo(100 - 40)
    expect(moved.y).toBeCloseTo(200 - 100)
    expect([moved.width, moved.height, moved.rotationDeg]).toEqual([400, 500, 0])
  })

  it('follows the crop rotation', () => {
    const moved = shiftCrop({ ...crop, rotationDeg: 180 }, 0.1, 0.2)
    expect(moved.x).toBeCloseTo(100 + 40)
    expect(moved.y).toBeCloseTo(200 + 100)
  })

  it('moves the face the same amount in the finished photo', () => {
    const f = face([250, 300, 100, 120])
    const tilted = { ...crop, rotationDeg: 12 }
    const before = faceFrame(f, tilted, { width: 1000, height: 1000 })!
    const after = faceFrame(f, shiftCrop(tilted, 0.05, 0.1), { width: 1000, height: 1000 })!
    expect(after.chinX - before.chinX).toBeCloseTo(0.05)
    expect(after.chinY - before.chinY).toBeCloseTo(0.1)
  })
})

describe('scaleCrop', () => {
  const f = face([250, 300, 100, 120])
  const image = { width: 1000, height: 1000 }

  for (const rotationDeg of [0, 12]) {
    it(`grows the person around a fixed point (rotation ${rotationDeg}°)`, () => {
      const crop = { x: 100, y: 200, width: 400, height: 500, rotationDeg }
      const before = faceFrame(f, crop, image)!
      const after = faceFrame(f, scaleCrop(crop, 1.25, before.chinX, before.chinY), image)!
      expect(after.chinX).toBeCloseTo(before.chinX)
      expect(after.chinY).toBeCloseTo(before.chinY)
      expect(after.faceWidth).toBeCloseTo(before.faceWidth * 1.25)
    })
  }
})
