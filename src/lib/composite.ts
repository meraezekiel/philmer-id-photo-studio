/**
 * Mask shaping and compositing — BUILD_PLAN §5 "Compositing".
 *
 * Everything here works on plain `{ width, height, data }` buffers rather than
 * a real `ImageData`, so the whole pipeline is testable in Node with no canvas.
 * A browser `ImageData` satisfies `Bitmap` structurally, so callers can pass
 * one straight in.
 *
 * The halo problem this module exists to solve: a semi-transparent edge pixel
 * in the source photo is already a blend of the subject and the *old*
 * background. Compositing it straight onto white leaves a grey fringe, and onto
 * blue a grey-blue one. So the true foreground colour has to be recovered
 * before the new background goes behind it.
 */

import { boxBlur, clamp, createBitmap, parseHex, type Bitmap, type Rgb } from './pixels'
import { applyEnhance, sharpenRadius, toneTables, type EnhanceSettings, type ToneOptions } from './enhance'

export { boxBlur, createBitmap, parseHex, toneTables }
export type { Bitmap, Rgb, ToneOptions }

/** Alpha below this is background; above it is subject. Between is the fringe. */
const ALPHA_FLOOR = 0.02
const ALPHA_CEIL = 0.98

/**
 * Foreground-estimation radii, in output pixels. The small radius keeps
 * detail; the large one is the fallback where there is too little opaque
 * neighbourhood for the small one to mean anything (BUILD_PLAN §5.3).
 */
const RADIUS_SMALL = 4
const RADIUS_LARGE = 16

/** Minimum blurred-alpha support for the small radius to be trusted. */
const SUPPORT_EPSILON = 0.05


// --- mask shaping -------------------------------------------------------

/** Separable min (erode) or max (dilate) over a float plane. */
function morph(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  mode: 'min' | 'max',
): Float32Array {
  if (radius < 1) return Float32Array.from(src)
  const pick = mode === 'min' ? Math.min : Math.max
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let acc = src[row + x]
      for (let d = -radius; d <= radius; d++) {
        const xx = Math.min(Math.max(x + d, 0), width - 1)
        acc = pick(acc, src[row + xx])
      }
      tmp[row + x] = acc
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let acc = tmp[y * width + x]
      for (let d = -radius; d <= radius; d++) {
        const yy = Math.min(Math.max(y + d, 0), height - 1)
        acc = pick(acc, tmp[yy * width + x])
      }
      out[y * width + x] = acc
    }
  }
  return out
}

export interface MaskOptions {
  /**
   * -2..+2 px. Negative tightens the cutout (erode), positive expands it
   * (dilate). Either way the result is feathered so the edge stays soft.
   */
  edgeSoftness?: number
  /**
   * -1..+1. Positive keeps more of the faint hair the model was unsure about,
   * negative discards it. Applied as a gamma on alpha.
   */
  hairDetail?: number
}

/** Extract alpha 0..1 from a grayscale or RGBA mask bitmap. */
export function maskToAlpha(mask: Bitmap): Float32Array {
  const n = mask.width * mask.height
  const alpha = new Float32Array(n)
  const stride = mask.data.length / n
  for (let i = 0; i < n; i++) {
    // A PNG-decoded grayscale mask arrives as RGBA with the value in R.
    alpha[i] = mask.data[i * stride] / 255
  }
  return alpha
}

export function shapeMask(
  alpha: Float32Array,
  width: number,
  height: number,
  options: MaskOptions = {},
): Float32Array {
  const softness = clamp(options.edgeSoftness ?? 0, -2, 2)
  const hairDetail = clamp(options.hairDetail ?? 0, -1, 1)

  let out = alpha
  if (hairDetail !== 0) {
    // gamma < 1 lifts faint alpha, so more wispy hair survives.
    const gamma = Math.pow(2, -hairDetail)
    out = Float32Array.from(out, (a) => Math.pow(a, gamma))
  }

  const radius = Math.round(Math.abs(softness))
  if (radius >= 1) {
    out = morph(out, width, height, radius, softness < 0 ? 'min' : 'max')
  }
  if (softness !== 0) {
    // Feather so an eroded or dilated edge does not read as a cut-out.
    out = boxBlur(out, width, height, Math.max(1, radius))
  }
  return out
}

// --- foreground estimation ---------------------------------------------

/**
 * Recover the un-contaminated foreground colour of every fringe pixel.
 *
 * BUILD_PLAN §5.3 gives this as `F = blur(I*a) / blur(a)`. That estimate is
 * biased, and the bias points exactly the wrong way. Expanding it for a fringe
 * where `I = F*a + B*(1-a)`:
 *
 *     blur(I*a)/blur(a) = F * Σa²/Σa  +  B * Σa(1-a)/Σa
 *
 * The second term is leftover *old background* — the very thing being removed.
 * It shrinks only when the neighbourhood is mostly opaque, so it is worst
 * precisely at a soft edge, which is where hair lives.
 *
 * Instead, estimate the old background `B` from nearby pixels that are known
 * to be pure background, and then solve the compositing equation directly:
 *
 *     F = (I - B*(1-a)) / a
 *
 * `B` is the easy quantity to estimate — backdrops are large and smooth, and
 * only genuinely-background pixels vote. Where a pixel has no background
 * neighbour at either radius (a gap deep inside hair), this falls back to the
 * plan's original formula, which is reasonable there because such a
 * neighbourhood *is* mostly opaque.
 */
export function estimateForeground(
  image: Bitmap,
  alpha: Float32Array,
): { r: Float32Array; g: Float32Array; b: Float32Array } {
  const { width, height } = image
  const n = width * height
  const src = image.data

  // Only pure-background pixels vote for B; only pure-subject pixels vote in
  // the fallback. A partly transparent pixel knows neither colour.
  const bgVote = new Float32Array(n)
  const fgWeight = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    bgVote[i] = alpha[i] <= ALPHA_FLOOR ? 1 : 0
    fgWeight[i] = alpha[i]
  }

  const bgSupport = {
    small: boxBlur(bgVote, width, height, RADIUS_SMALL),
    large: boxBlur(bgVote, width, height, RADIUS_LARGE),
  }

  // The fallback only fires for fringe pixels with no background in sight at
  // either radius. That is rare, and each blur is a full pass over the image —
  // at 12 MP the difference is several seconds on an export, so only pay for
  // it if some pixel actually needs it.
  let needsFallback = false
  for (let i = 0; i < n && !needsFallback; i++) {
    const a = alpha[i]
    if (a > ALPHA_FLOOR && a < ALPHA_CEIL) {
      needsFallback = bgSupport.small[i] <= SUPPORT_EPSILON && bgSupport.large[i] <= SUPPORT_EPSILON
    }
  }

  const fgSupport = needsFallback
    ? {
        small: boxBlur(fgWeight, width, height, RADIUS_SMALL),
        large: boxBlur(fgWeight, width, height, RADIUS_LARGE),
      }
    : null

  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]

  for (let c = 0; c < 3; c++) {
    const observedTimesBgVote = new Float32Array(n)
    for (let i = 0; i < n; i++) observedTimesBgVote[i] = src[i * 4 + c] * bgVote[i]
    const bgBlur = {
      small: boxBlur(observedTimesBgVote, width, height, RADIUS_SMALL),
      large: boxBlur(observedTimesBgVote, width, height, RADIUS_LARGE),
    }

    let fgBlur: { small: Float32Array; large: Float32Array } | null = null
    if (fgSupport) {
      const observedTimesAlpha = new Float32Array(n)
      for (let i = 0; i < n; i++) observedTimesAlpha[i] = src[i * 4 + c] * alpha[i]
      fgBlur = {
        small: boxBlur(observedTimesAlpha, width, height, RADIUS_SMALL),
        large: boxBlur(observedTimesAlpha, width, height, RADIUS_LARGE),
      }
    }

    for (let i = 0; i < n; i++) {
      const a = alpha[i]
      const observed = src[i * 4 + c]

      // Opaque: the pixel already is the foreground. Transparent: the value is
      // never used, but keep it finite.
      if (a >= ALPHA_CEIL || a <= ALPHA_FLOOR) {
        out[c][i] = observed
        continue
      }

      // Prefer the tight radius, which keeps local background variation.
      const oldBackground =
        bgSupport.small[i] > SUPPORT_EPSILON
          ? bgBlur.small[i] / bgSupport.small[i]
          : bgSupport.large[i] > SUPPORT_EPSILON
            ? bgBlur.large[i] / bgSupport.large[i]
            : null

      if (oldBackground !== null) {
        out[c][i] = clamp((observed - oldBackground * (1 - a)) / a, 0, 255)
        continue
      }

      // No background in sight: fall back to the alpha-weighted average.
      out[c][i] =
        fgSupport && fgBlur
          ? fgSupport.small[i] > SUPPORT_EPSILON
            ? clamp(fgBlur.small[i] / fgSupport.small[i], 0, 255)
            : fgSupport.large[i] > SUPPORT_EPSILON
              ? clamp(fgBlur.large[i] / fgSupport.large[i], 0, 255)
              : observed
          : observed
    }
  }
  return { r: out[0], g: out[1], b: out[2] }
}

// --- light and colour ---------------------------------------------------

// --- compositing --------------------------------------------------------

/**
 * A `#RRGGBB` colour, the literal `'transparent'`, or a bitmap the same size
 * as the image (Photo Print's own background picture, already placed).
 */
export type CompositeBackground = string | Bitmap

export interface CompositeOptions extends MaskOptions, EnhanceSettings {
  /** Cropped source pixels, RGBA. */
  image: Bitmap
  /** Alpha mask, the same size as `image`. */
  mask: Bitmap
  background: CompositeBackground
  /**
   * Skip foreground estimation. Only for measuring what the estimation is
   * worth — the halo it removes is the reason this module exists.
   */
  skipDecontamination?: boolean
  /** Unsharp radius; defaults to `sharpenRadius` of this image. Strips pass the whole photo's. */
  sharpenRadius?: number
}

/**
 * The subject on the chosen background, with the old background's colour
 * removed from the fringe. Enhance applies to the subject before it meets the
 * background, so a white backdrop stays exactly white however far the
 * sliders go. Transparent output keeps the shaped mask as alpha.
 */
export function composite(options: CompositeOptions): Bitmap & { data: Uint8ClampedArray } {
  const { image, mask, background } = options
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(
      `mask is ${mask.width}x${mask.height} but the image is ${image.width}x${image.height}`,
    )
  }
  const { width, height } = image
  const transparent = background === 'transparent'
  const bgImage = typeof background === 'string' ? null : background
  if (bgImage && (bgImage.width !== width || bgImage.height !== height)) {
    throw new Error(`background is ${bgImage.width}x${bgImage.height} but the image is ${width}x${height}`)
  }
  const bg = typeof background === 'string' && !transparent ? parseHex(background) : { r: 0, g: 0, b: 0 }

  const alpha = shapeMask(maskToAlpha(mask), width, height, options)
  const n = width * height

  // The foreground colour of every pixel, as float planes.
  let fr: ArrayLike<number>
  let fg: ArrayLike<number>
  let fb: ArrayLike<number>
  if (options.skipDecontamination) {
    const r = new Float32Array(n)
    const g = new Float32Array(n)
    const b = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      r[i] = image.data[i * 4]
      g[i] = image.data[i * 4 + 1]
      b[i] = image.data[i * 4 + 2]
    }
    fr = r
    fg = g
    fb = b
  } else {
    const f = estimateForeground(image, alpha)
    fr = f.r
    fg = f.g
    fb = f.b
  }

  // Saturation and sharpening need whole-image passes; tone alone stays a
  // per-pixel table so the ID flow's output is unchanged.
  let tables = toneTables(options)
  if ((options.saturation ?? 0) !== 0 || (options.sharpness ?? 0) > 0) {
    const fgBitmap = createBitmap(width, height)
    for (let i = 0; i < n; i++) {
      fgBitmap.data[i * 4] = fr[i]
      fgBitmap.data[i * 4 + 1] = fg[i]
      fgBitmap.data[i * 4 + 2] = fb[i]
      fgBitmap.data[i * 4 + 3] = 255
    }
    const enhanced = applyEnhance(fgBitmap, options, {
      radius: options.sharpenRadius ?? sharpenRadius(width, height),
    })
    const r = new Float32Array(n)
    const g = new Float32Array(n)
    const b = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      r[i] = enhanced.data[i * 4]
      g[i] = enhanced.data[i * 4 + 1]
      b[i] = enhanced.data[i * 4 + 2]
    }
    fr = r
    fg = g
    fb = b
    tables = null
  }
  const [tr, tg, tb] = tables ?? [null, null, null]

  const out = createBitmap(width, height)
  for (let i = 0; i < n; i++) {
    const a = alpha[i]
    const r = tr ? tr[Math.round(fr[i])] : fr[i]
    const g = tg ? tg[Math.round(fg[i])] : fg[i]
    const b = tb ? tb[Math.round(fb[i])] : fb[i]
    if (transparent) {
      out.data[i * 4] = r
      out.data[i * 4 + 1] = g
      out.data[i * 4 + 2] = b
      out.data[i * 4 + 3] = Math.round(a * 255)
      continue
    }
    const br = bgImage ? bgImage.data[i * 4] : bg.r
    const bgg = bgImage ? bgImage.data[i * 4 + 1] : bg.g
    const bb = bgImage ? bgImage.data[i * 4 + 2] : bg.b
    out.data[i * 4] = r * a + br * (1 - a)
    out.data[i * 4 + 1] = g * a + bgg * (1 - a)
    out.data[i * 4 + 2] = b * a + bb * (1 - a)
    out.data[i * 4 + 3] = 255
  }
  return out
}

/**
 * Cut a rectangle out of `source`, clamped to its bounds and padded with
 * `pad` where the rectangle runs off the edge.
 *
 * Padding rather than refusing is deliberate (BUILD_PLAN §5): a correctly
 * aligned crop often extends past the top of the photo, and since the
 * background is being replaced anyway, the padding is invisible.
 */
export function crop(
  source: Bitmap,
  rect: { x: number; y: number; width: number; height: number },
  pad: Rgb | 'transparent' = 'transparent',
): Bitmap & { data: Uint8ClampedArray } {
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const out = createBitmap(width, height)
  const x0 = Math.round(rect.x)
  const y0 = Math.round(rect.y)

  const padR = pad === 'transparent' ? 0 : pad.r
  const padG = pad === 'transparent' ? 0 : pad.g
  const padB = pad === 'transparent' ? 0 : pad.b
  const padA = pad === 'transparent' ? 0 : 255

  for (let y = 0; y < height; y++) {
    const sy = y0 + y
    for (let x = 0; x < width; x++) {
      const sx = x0 + x
      const di = (y * width + x) * 4
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) {
        out.data[di] = padR
        out.data[di + 1] = padG
        out.data[di + 2] = padB
        out.data[di + 3] = padA
        continue
      }
      const si = (sy * source.width + sx) * 4
      out.data[di] = source.data[si]
      out.data[di + 1] = source.data[si + 1]
      out.data[di + 2] = source.data[si + 2]
      out.data[di + 3] = source.data[si + 3]
    }
  }
  return out
}


/**
 * Top-most foreground row of the mask within a horizontal span — the real
 * crown, *including hair* (BUILD_PLAN §5).
 *
 * A face box stops at the hairline, so aligning to it puts tall or voluminous
 * hair outside the crop. The mask already knows where the subject ends, so the
 * span is limited to the face's own columns to avoid catching a raised hand or
 * a shoulder.
 */
export function findCrownY(
  mask: Bitmap,
  xStart: number,
  xEnd: number,
  threshold = 128,
): number | null {
  const left = Math.max(0, Math.floor(Math.min(xStart, xEnd)))
  const right = Math.min(mask.width - 1, Math.ceil(Math.max(xStart, xEnd)))
  if (right < left) return null
  const stride = mask.data.length / (mask.width * mask.height)

  for (let y = 0; y < mask.height; y++) {
    const row = y * mask.width
    for (let x = left; x <= right; x++) {
      if (mask.data[(row + x) * stride] >= threshold) return y
    }
  }
  return null
}

/**
 * `composite` over horizontal strips, for full-resolution saves: foreground
 * estimation allocates several float planes per pixel, which a 24 MP photo
 * cannot afford in one go. Every step is local, so each strip is computed
 * with `overlap` extra rows above and below and only its middle is kept; the
 * result matches a single pass.
 */
export function compositeInStrips(options: CompositeOptions, stripRows = 512): Bitmap & { data: Uint8ClampedArray } {
  const { image, mask, background } = options
  const { width, height } = image
  // Mask shaping (≤4) + foreground estimation (16, twice in the fallback) + sharpening.
  const radius = options.sharpenRadius ?? sharpenRadius(width, height)
  const overlap = 40 + radius
  if (height <= stripRows + overlap * 2) return composite(options)

  const slice = (b: Bitmap, y0: number, y1: number): Bitmap => ({
    width,
    height: y1 - y0,
    data: b.data.subarray(y0 * width * 4, y1 * width * 4),
  })
  const out = createBitmap(width, height)
  for (let top = 0; top < height; top += stripRows) {
    const rows = Math.min(stripRows, height - top)
    const y0 = Math.max(0, top - overlap)
    const y1 = Math.min(height, top + rows + overlap)
    const part = composite({
      ...options,
      image: slice(image, y0, y1),
      mask: slice(mask, y0, y1),
      background: typeof background === 'string' ? background : slice(background, y0, y1),
      sharpenRadius: radius,
    })
    const from = (top - y0) * width * 4
    out.data.set(part.data.subarray(from, from + rows * width * 4), top * width * 4)
  }
  return out
}
