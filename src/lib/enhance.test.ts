import { describe, expect, it } from 'vitest'

import { applyEnhance, applyEnhanceInStrips, autoEnhance, NEUTRAL_ENHANCE, sharpenRadius } from './enhance'
import { createBitmap, type Bitmap } from './pixels'

function solid(width: number, height: number, r: number, g: number, b: number): Bitmap & { data: Uint8ClampedArray } {
  const bmp = createBitmap(width, height)
  for (let i = 0; i < width * height; i++) bmp.data.set([r, g, b, 255], i * 4)
  return bmp
}

/** Left half `low`, right half `high`, grey. */
function stepEdge(width: number, height: number, low: number, high: number) {
  const bmp = createBitmap(width, height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = x < width / 2 ? low : high
      bmp.data.set([v, v, v, 255], (y * width + x) * 4)
    }
  return bmp
}

describe('applyEnhance', () => {
  it('leaves the photo untouched at neutral settings', () => {
    const img = stepEdge(20, 4, 60, 180)
    expect(Array.from(applyEnhance(img, NEUTRAL_ENHANCE).data)).toEqual(Array.from(img.data))
  })

  it('takes a colour to its own luminance at saturation -50', () => {
    const out = applyEnhance(solid(2, 2, 200, 100, 50), { saturation: -50 })
    const l = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50)
    expect(Math.abs(out.data[0] - l)).toBeLessThanOrEqual(1)
    expect(Math.abs(out.data[1] - l)).toBeLessThanOrEqual(1)
    expect(Math.abs(out.data[2] - l)).toBeLessThanOrEqual(1)
  })

  it('raises contrast across an edge when sharpening', () => {
    const img = stepEdge(20, 6, 60, 180)
    const out = applyEnhance(img, { sharpness: 50 }, { radius: 2 })
    const at = (x: number) => out.data[(3 * 20 + x) * 4]
    expect(at(9)).toBeLessThan(60) // dark side of the edge gets darker
    expect(at(10)).toBeGreaterThan(180) // bright side gets brighter
    expect(at(0)).toBe(60) // flat areas are left alone
  })

  it('keeps alpha', () => {
    const img = solid(2, 1, 100, 100, 100)
    img.data[3] = 40
    expect(applyEnhance(img, { brightness: 20, saturation: 10 }).data[3]).toBe(40)
  })
})

describe('autoEnhance', () => {
  it('brightens a dark photo', () => {
    expect(autoEnhance(solid(40, 40, 50, 50, 50)).brightness).toBeGreaterThan(0)
  })

  it('warms a blue cast', () => {
    expect(autoEnhance(solid(40, 40, 90, 120, 170)).warmth).toBeGreaterThan(0)
  })

  it('never goes past ±35', () => {
    for (const img of [solid(40, 40, 5, 5, 5), solid(40, 40, 250, 250, 250), solid(40, 40, 30, 60, 250)]) {
      const s = autoEnhance(img)
      for (const v of [s.brightness, s.contrast, s.warmth]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(35)
      }
    }
  })

  it('returns finite numbers for a completely flat photo', () => {
    const s = autoEnhance(solid(30, 30, 128, 128, 128))
    expect(Number.isFinite(s.brightness)).toBe(true)
    expect(Number.isFinite(s.contrast)).toBe(true)
    expect(Number.isFinite(s.warmth)).toBe(true)
    expect(s.contrast).toBe(0)
  })

  it('measures exposure on the subject when given a mask', () => {
    // Bright backdrop, dark subject in the left quarter (so the whole
    // photo's median is the backdrop's).
    const img = createBitmap(40, 40)
    const mask = createBitmap(40, 40)
    for (let i = 0; i < 1600; i++) {
      const subject = i % 40 < 10
      const v = subject ? 50 : 240
      img.data.set([v, v, v, 255], i * 4)
      const m = subject ? 255 : 0
      mask.data.set([m, m, m, 255], i * 4)
    }
    expect(autoEnhance(img, mask).brightness).toBeGreaterThan(autoEnhance(img).brightness)
  })
})

describe('applyEnhanceInStrips', () => {
  it('matches a single pass, sharpening included', () => {
    const width = 40
    const height = 300
    const image = createBitmap(width, height)
    let seed = 11
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < width * height; i++) image.data.set([rand() * 255, rand() * 255, rand() * 255, 255], i * 4)
    const settings = { brightness: 10, contrast: -5, warmth: 8, saturation: 20, sharpness: 30 }
    const whole = applyEnhance(image, settings, { radius: sharpenRadius(width, height) })
    const strips = applyEnhanceInStrips(image, settings, 64)
    let worst = 0
    for (let i = 0; i < whole.data.length; i++) worst = Math.max(worst, Math.abs(whole.data[i] - strips.data[i]))
    expect(worst).toBe(0)
  })
})
