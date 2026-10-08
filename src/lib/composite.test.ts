import { describe, expect, it } from 'vitest'

import {
  boxBlur,
  composite,
  createBitmap,
  crop,
  estimateForeground,
  maskToAlpha,
  parseHex,
  shapeMask,
  type Bitmap,
} from './composite'

/** A grayscale-style mask bitmap built from alpha values. */
function maskFrom(alpha: number[], width: number, height: number): Bitmap {
  const bmp = createBitmap(width, height)
  for (let i = 0; i < width * height; i++) {
    const v = Math.round(alpha[i] * 255)
    bmp.data[i * 4] = v
    bmp.data[i * 4 + 1] = v
    bmp.data[i * 4 + 2] = v
    bmp.data[i * 4 + 3] = 255
  }
  return bmp
}

/**
 * The situation this module exists for: a red subject shot against a green
 * background, with a soft edge between them. Each edge pixel in the photo is
 * genuinely `subject * a + green * (1 - a)` — the green is really in those
 * pixels, and it has to come back out.
 */
const SUBJECT = { r: 220, g: 40, b: 40 }
const OLD_BACKGROUND = { r: 30, g: 200, b: 60 }

function syntheticEdge(width = 64, height = 16) {
  const alpha: number[] = []
  const image = createBitmap(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Opaque subject, an 8 px ramp, then background.
      const a = x < 28 ? 1 : x > 36 ? 0 : 1 - (x - 28) / 8
      alpha.push(a)
      const i = (y * width + x) * 4
      image.data[i] = SUBJECT.r * a + OLD_BACKGROUND.r * (1 - a)
      image.data[i + 1] = SUBJECT.g * a + OLD_BACKGROUND.g * (1 - a)
      image.data[i + 2] = SUBJECT.b * a + OLD_BACKGROUND.b * (1 - a)
      image.data[i + 3] = 255
    }
  }
  return { image, mask: maskFrom(alpha, width, height), alpha, width, height }
}

/** Index of the pixel whose alpha is nearest 0.5, on the middle row. */
function midEdgeIndex(width: number, height: number) {
  return ((height >> 1) * width + 32) * 4
}

describe('decontamination removes the old background from the fringe', () => {
  it('leaves no green cast when compositing red-on-green onto white', () => {
    const { image, mask, width, height } = syntheticEdge()
    const i = midEdgeIndex(width, height)

    const naive = composite({
      image,
      mask,
      background: '#FFFFFF',
      skipDecontamination: true,
    })
    const fixed = composite({ image, mask, background: '#FFFFFF' })

    // On a neutral white background, a correctly recovered red subject blends
    // to a pink whose green and blue channels match. Any gap between them is
    // leftover green from the original backdrop — the halo.
    const naiveCast = naive.data[i + 1] - naive.data[i + 2]
    const fixedCast = fixed.data[i + 1] - fixed.data[i + 2]

    expect(naiveCast).toBeGreaterThan(25)
    expect(Math.abs(fixedCast)).toBeLessThan(2)
    expect(Math.abs(fixedCast)).toBeLessThan(naiveCast / 15)
  })

  it('also removes it against blue, where a grey fringe would show', () => {
    const { image, mask, width, height } = syntheticEdge()
    const i = midEdgeIndex(width, height)

    const fixed = composite({ image, mask, background: '#1E5BC6' })
    const bg = parseHex('#1E5BC6')
    const a = 0.5

    // Expected: subject and the chosen blue, mixed half and half.
    for (const [offset, subject, background] of [
      [0, SUBJECT.r, bg.r],
      [1, SUBJECT.g, bg.g],
      [2, SUBJECT.b, bg.b],
    ] as const) {
      const expected = subject * a + background * (1 - a)
      expect(Math.abs(fixed.data[i + offset] - expected)).toBeLessThan(2)
    }
  })

  it('recovers close to the true subject colour along the whole ramp', () => {
    const { image, alpha, width, height } = syntheticEdge()
    const f = estimateForeground(image, Float32Array.from(alpha))

    for (let x = 29; x <= 35; x++) {
      const i = (height >> 1) * width + x
      expect(Math.abs(f.r[i] - SUBJECT.r)).toBeLessThan(6)
      expect(Math.abs(f.g[i] - SUBJECT.g)).toBeLessThan(6)
      expect(Math.abs(f.b[i] - SUBJECT.b)).toBeLessThan(6)
    }
  })
})

describe('composite output invariants', () => {
  it('is fully opaque — the print has no transparency', () => {
    const { image, mask } = syntheticEdge()
    const out = composite({ image, mask, background: '#FFFFFF' })
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255)
  })

  it('keeps the source size exactly', () => {
    const { image, mask } = syntheticEdge(37, 19)
    const out = composite({ image, mask, background: '#FFFFFF' })
    expect([out.width, out.height]).toEqual([37, 19])
  })

  it('paints background pixels as the exact chosen colour', () => {
    const { image, mask, width, height } = syntheticEdge()
    const out = composite({ image, mask, background: '#C62828' })
    const bg = parseHex('#C62828')
    const i = ((height >> 1) * width + width - 1) * 4 // fully alpha 0
    expect([out.data[i], out.data[i + 1], out.data[i + 2]]).toEqual([bg.r, bg.g, bg.b])
  })

  it('leaves fully opaque pixels untouched', () => {
    const { image, mask, width, height } = syntheticEdge()
    const out = composite({ image, mask, background: '#FFFFFF' })
    const i = ((height >> 1) * width + 2) * 4 // deep inside the subject
    expect(out.data[i]).toBeCloseTo(SUBJECT.r, -1)
    expect(out.data[i + 1]).toBeCloseTo(SUBJECT.g, -1)
    expect(out.data[i + 2]).toBeCloseTo(SUBJECT.b, -1)
  })

  it('rejects a mask that does not match the image', () => {
    const { image } = syntheticEdge()
    const wrong = createBitmap(8, 8)
    expect(() => composite({ image, mask: wrong, background: '#FFFFFF' })).toThrow(/mask is 8x8/)
  })
})

describe('light and colour act on the subject only', () => {
  /** RGB of the pixel deep inside the subject, and of one in the background. */
  function probe(tone: { brightness?: number; contrast?: number; warmth?: number }) {
    const { image, mask, width, height } = syntheticEdge()
    const out = composite({ image, mask, background: '#FFFFFF', ...tone })
    const row = (height >> 1) * width
    const at = (x: number) => {
      const i = (row + x) * 4
      return [out.data[i], out.data[i + 1], out.data[i + 2]]
    }
    return { subject: at(2), background: at(width - 1) }
  }

  it('changes nothing at the neutral settings', () => {
    expect(probe({ brightness: 0, contrast: 0, warmth: 0 })).toEqual(probe({}))
  })

  it('brightness lightens or darkens every channel of the subject', () => {
    const base = probe({}).subject
    const up = probe({ brightness: 30 }).subject
    const down = probe({ brightness: -30 }).subject
    for (let c = 0; c < 3; c++) {
      expect(up[c]).toBeGreaterThan(base[c])
      expect(down[c]).toBeLessThan(base[c])
    }
  })

  it('contrast pushes channels away from mid-grey', () => {
    const base = probe({}).subject // 220, 40, 40
    const more = probe({ contrast: 30 }).subject
    expect(more[0]).toBeGreaterThan(base[0])
    expect(more[1]).toBeLessThan(base[1])
  })

  it('warmth moves the subject toward red, cooler toward blue', () => {
    const base = probe({}).subject
    const warm = probe({ warmth: 30 }).subject
    const cool = probe({ warmth: -30 }).subject
    expect(warm[0] - warm[2]).toBeGreaterThan(base[0] - base[2])
    expect(cool[0] - cool[2]).toBeLessThan(base[0] - base[2])
  })

  it('never touches the background colour — white stays pure white', () => {
    const { background } = probe({ brightness: -50, contrast: 50, warmth: 50 })
    expect(background).toEqual([255, 255, 255])
  })
})

describe('mask shaping', () => {
  const width = 32
  const height = 1
  const ramp = Float32Array.from({ length: width }, (_, x) => (x < 16 ? 1 : 0))

  it('hair detail above zero keeps more faint alpha, below zero less', () => {
    const faint = Float32Array.from([0.25, 0.25, 0.25, 0.25])
    const more = shapeMask(faint, 2, 2, { hairDetail: 1 })
    const less = shapeMask(faint, 2, 2, { hairDetail: -1 })
    expect(more[0]).toBeGreaterThan(faint[0])
    expect(less[0]).toBeLessThan(faint[0])
  })

  it('leaves the mask alone at the neutral settings', () => {
    const out = shapeMask(ramp, width, height, { edgeSoftness: 0, hairDetail: 0 })
    expect(Array.from(out)).toEqual(Array.from(ramp))
  })

  it('negative edge softness tightens the cutout, positive expands it', () => {
    const area = (a: Float32Array) => a.reduce((sum, v) => sum + v, 0)
    const tight = shapeMask(ramp, width, height, { edgeSoftness: -2 })
    const loose = shapeMask(ramp, width, height, { edgeSoftness: 2 })
    expect(area(tight)).toBeLessThan(area(ramp))
    expect(area(loose)).toBeGreaterThan(area(ramp))
  })

  it('clamps settings rather than trusting the caller', () => {
    const a = shapeMask(ramp, width, height, { edgeSoftness: 99, hairDetail: 99 })
    const b = shapeMask(ramp, width, height, { edgeSoftness: 2, hairDetail: 1 })
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('reads alpha from the red channel of a grayscale mask', () => {
    const mask = maskFrom([0, 0.5, 1, 0.25], 2, 2)
    const alpha = maskToAlpha(mask)
    expect(alpha[0]).toBeCloseTo(0, 2)
    expect(alpha[2]).toBeCloseTo(1, 2)
    expect(alpha[1]).toBeCloseTo(0.5, 1)
  })
})

describe('boxBlur', () => {
  it('leaves a constant plane unchanged, including at the edges', () => {
    const flat = new Float32Array(64).fill(0.7)
    const out = boxBlur(flat, 8, 8, 3)
    for (const v of out) expect(v).toBeCloseTo(0.7, 5)
  })

  it('conserves roughly the total signal', () => {
    const src = new Float32Array(64)
    src[27] = 1
    const out = boxBlur(src, 8, 8, 2)
    const total = out.reduce((s, v) => s + v, 0)
    expect(total).toBeGreaterThan(0.8)
    expect(total).toBeLessThan(1.2)
  })

  it('is a no-op below radius 1', () => {
    const src = Float32Array.from([1, 2, 3, 4])
    expect(Array.from(boxBlur(src, 2, 2, 0))).toEqual([1, 2, 3, 4])
  })
})

describe('crop', () => {
  function gradient(width: number, height: number) {
    const bmp = createBitmap(width, height)
    for (let i = 0; i < width * height; i++) {
      bmp.data[i * 4] = i
      bmp.data[i * 4 + 3] = 255
    }
    return bmp
  }

  it('takes the requested rectangle', () => {
    const out = crop(gradient(4, 4), { x: 1, y: 1, width: 2, height: 2 })
    expect([out.width, out.height]).toEqual([2, 2])
    expect(out.data[0]).toBe(5) // row 1, col 1
  })

  it('pads with the given colour where the rectangle leaves the image', () => {
    const out = crop(gradient(4, 4), { x: -2, y: 0, width: 4, height: 1 }, { r: 9, g: 8, b: 7 })
    expect([out.data[0], out.data[1], out.data[2], out.data[3]]).toEqual([9, 8, 7, 255])
    // The third column is the image's first pixel.
    expect(out.data[2 * 4]).toBe(0)
  })

  it('pads transparent by default, so padding is visible to later stages', () => {
    const out = crop(gradient(4, 4), { x: -1, y: -1, width: 2, height: 2 })
    expect(out.data[3]).toBe(0)
  })
})

describe('parseHex', () => {
  it('accepts both with and without the hash', () => {
    expect(parseHex('#1E5BC6')).toEqual({ r: 30, g: 91, b: 198 })
    expect(parseHex('1e5bc6')).toEqual({ r: 30, g: 91, b: 198 })
  })

  it('rejects anything else rather than guessing', () => {
    for (const bad of ['#fff', 'red', '', '#12345g']) {
      expect(() => parseHex(bad)).toThrow(/hex/)
    }
  })
})

describe('composite backgrounds', () => {
  function uniform(width: number, height: number, rgb: [number, number, number]) {
    const bmp = createBitmap(width, height)
    for (let i = 0; i < width * height; i++) bmp.data.set([...rgb, 255], i * 4)
    return bmp
  }

  it('writes the mask into alpha when transparent', () => {
    const image = uniform(4, 1, [200, 50, 50])
    const mask = maskFrom([1, 1, 0, 0], 4, 1)
    const out = composite({ image, mask, background: 'transparent' })
    expect(out.data[3]).toBe(255)
    expect(out.data[11]).toBe(0)
    expect(out.data[0]).toBe(200) // opaque pixel keeps its colour
  })

  it('blends onto a background image, pixel by pixel', () => {
    const image = uniform(2, 1, [255, 0, 0])
    const mask = maskFrom([0, 0], 2, 1)
    const bg = createBitmap(2, 1)
    bg.data.set([0, 0, 255, 255, 0, 255, 0, 255])
    const out = composite({ image, mask, background: bg })
    expect(Array.from(out.data.slice(0, 3))).toEqual([0, 0, 255])
    expect(Array.from(out.data.slice(4, 7))).toEqual([0, 255, 0])
  })

  it('rejects a background image of the wrong size', () => {
    const image = uniform(2, 2, [1, 2, 3])
    expect(() =>
      composite({ image, mask: maskFrom([1, 1, 1, 1], 2, 2), background: createBitmap(3, 3) }),
    ).toThrow(/background/)
  })

  it('applies saturation to the subject but not to a colour background', () => {
    const image = uniform(2, 1, [200, 100, 50])
    const mask = maskFrom([1, 0], 2, 1)
    const out = composite({ image, mask, background: '#3366CC', saturation: -50 })
    expect(Math.abs(out.data[0] - out.data[1])).toBeLessThanOrEqual(1) // subject went grey
    expect(Array.from(out.data.slice(4, 7))).toEqual([0x33, 0x66, 0xcc]) // backdrop untouched
  })
})
