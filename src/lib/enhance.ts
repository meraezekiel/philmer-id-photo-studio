/**
 * Light and colour correction, pure — Photo Print's Enhance panel and the ID
 * flow's Light & colour section.
 *
 * DSLR photos are already sharp and large; what goes wrong is exposure,
 * colour cast from studio lights and flat contrast. So this is correction,
 * not AI: lookup tables, a saturation blend and an unsharp mask.
 */

import { boxBlur, clamp, createBitmap, type Bitmap } from './pixels'

export interface ToneOptions {
  /** -50..+50. Lifts or lowers every channel. */
  brightness?: number
  /** -50..+50. Stretches channels away from mid-grey, or flattens them. */
  contrast?: number
  /** -50..+50. Positive shifts toward red/yellow, negative toward blue. */
  warmth?: number
}

export interface EnhanceSettings extends ToneOptions {
  /** -50..+50. -50 is greyscale, +50 doubles the distance from grey. */
  saturation?: number
  /** 0..+50. Unsharp mask strength. */
  sharpness?: number
}

export const NEUTRAL_ENHANCE: Required<EnhanceSettings> = {
  brightness: 0,
  contrast: 0,
  warmth: 0,
  saturation: 0,
  sharpness: 0,
}

/**
 * One lookup table per channel. Walk-in photos are often dark or yellow from
 * the shop's own lights; this corrects the subject without an outside editor.
 */
export function toneTables(options: ToneOptions): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] | null {
  const brightness = clamp(options.brightness ?? 0, -50, 50)
  const contrast = clamp(options.contrast ?? 0, -50, 50)
  const warmth = clamp(options.warmth ?? 0, -50, 50)
  if (brightness === 0 && contrast === 0 && warmth === 0) return null

  const gain = 1 + contrast / 100
  const lift = brightness * 1.5
  const shift = warmth * 0.6
  const table = (offset: number) => {
    const t = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) t[v] = (v - 128) * gain + 128 + lift + offset
    return t
  }
  return [table(shift), table(0), table(-shift)]
}

/**
 * Unsharp-mask radius for an image of this size, so a 24 MP original and its
 * 1400 px preview look equally sharpened.
 */
export function sharpenRadius(width: number, height: number): number {
  return Math.max(1, Math.round(Math.max(width, height) / 1400))
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** Tables, then saturation, then sharpening. Alpha is carried through. */
export function applyEnhance(image: Bitmap, settings: EnhanceSettings, options: { radius?: number } = {}): Bitmap {
  const tables = toneTables(settings)
  const saturation = clamp(settings.saturation ?? 0, -50, 50)
  const sharpness = clamp(settings.sharpness ?? 0, 0, 50)
  if (!tables && saturation === 0 && sharpness === 0) return image

  const { width, height } = image
  const n = width * height
  const src = image.data
  const out = createBitmap(width, height)
  const s = 1 + saturation / 50

  for (let i = 0; i < n; i++) {
    let r = src[i * 4]
    let g = src[i * 4 + 1]
    let b = src[i * 4 + 2]
    if (tables) {
      r = tables[0][r]
      g = tables[1][g]
      b = tables[2][b]
    }
    if (saturation !== 0) {
      const l = luma(r, g, b)
      r = l + (r - l) * s
      g = l + (g - l) * s
      b = l + (b - l) * s
    }
    out.data[i * 4] = r
    out.data[i * 4 + 1] = g
    out.data[i * 4 + 2] = b
    out.data[i * 4 + 3] = src[i * 4 + 3]
  }

  if (sharpness > 0) {
    // Sharpen luminance only, so edges gain contrast without colour fringes.
    const lum = new Float32Array(n)
    for (let i = 0; i < n; i++) lum[i] = luma(out.data[i * 4], out.data[i * 4 + 1], out.data[i * 4 + 2])
    const blurred = boxBlur(lum, width, height, options.radius ?? sharpenRadius(width, height))
    const amount = (sharpness / 50) * 1.5
    for (let i = 0; i < n; i++) {
      const d = (lum[i] - blurred[i]) * amount
      if (d === 0) continue
      out.data[i * 4] += d
      out.data[i * 4 + 1] += d
      out.data[i * 4 + 2] += d
    }
  }
  return out
}

/**
 * `applyEnhance` over horizontal strips, for full-resolution saves: the
 * sharpening planes for a 48 MP photo cannot all be held at once. Only the
 * sharpening blur looks at neighbours, so each strip carries a few blur
 * radii of extra rows and keeps its middle; the result equals one pass.
 */
export function applyEnhanceInStrips(image: Bitmap, settings: EnhanceSettings, stripRows = 512): Bitmap {
  const { width, height } = image
  const radius = sharpenRadius(width, height)
  const overlap = 4 * radius + 2
  if (height <= stripRows + overlap * 2) return applyEnhance(image, settings, { radius })

  const out = createBitmap(width, height)
  for (let top = 0; top < height; top += stripRows) {
    const rows = Math.min(stripRows, height - top)
    const y0 = Math.max(0, top - overlap)
    const y1 = Math.min(height, top + rows + overlap)
    const part = applyEnhance(
      { width, height: y1 - y0, data: image.data.subarray(y0 * width * 4, y1 * width * 4) },
      settings,
      { radius },
    )
    const from = (top - y0) * width * 4
    out.data.set(part.data.subarray(from, from + rows * width * 4), top * width * 4)
  }
  return out
}

/** Clamp an auto value to the slider's safe range, as a whole number. */
const auto = (v: number) => Math.round(clamp(v, -35, 35))

/**
 * Analyse the photo and propose brightness, contrast and warmth. It only
 * proposes: the caller puts these on the sliders, where the operator sees
 * and can undo them.
 *
 * Exposure and contrast are measured on the subject when a mask is given (a
 * white backdrop must not make the face look bright enough). Warmth is always
 * measured on the whole photo: skin is not grey, so a grey-world estimate over
 * a face alone would always cool it.
 */
export function autoEnhance(image: Bitmap, mask?: Bitmap): Required<ToneOptions> {
  const { width, height, data } = image
  // Work on at most ~512 px along the long edge.
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 512))
  const maskStride = mask ? mask.data.length / (mask.width * mask.height) : 0

  const histogram = new Uint32Array(256)
  let counted = 0
  let sumR = 0
  let sumB = 0
  let mid = 0

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      const l = Math.round(luma(r, g, b))
      if (l >= 40 && l <= 215) {
        sumR += r
        sumB += b
        mid++
      }
      if (mask && mask.data[i * maskStride] < 128) continue
      histogram[l]++
      counted++
    }
  }

  if (counted === 0) return { brightness: 0, contrast: 0, warmth: 0 }

  const percentile = (p: number) => {
    const target = p * counted
    let seen = 0
    for (let v = 0; v < 256; v++) {
      seen += histogram[v]
      if (seen >= target) return v
    }
    return 255
  }
  const low = percentile(0.005)
  const high = percentile(0.995)
  const median = percentile(0.5)

  const brightness = (128 - median) / 1.5
  const spread = high - low
  const contrast = spread >= 8 ? (235 / spread - 1) * 100 : 0
  // Warmth moves R up and B down by 0.6 each per step: 1.2 per step on R - B.
  const warmth = mid > 0 ? (sumB / mid - sumR / mid) / 1.2 : 0

  return { brightness: auto(brightness), contrast: auto(contrast), warmth: auto(warmth) }
}
