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

export { boxBlur, createBitmap, parseHex }
export type { Bitmap, Rgb }

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

export interface ToneOptions {
  /** -50..+50. Lifts or lowers every channel. */
  brightness?: number
  /** -50..+50. Stretches channels away from mid-grey, or flattens them. */
  contrast?: number
  /** -50..+50. Positive shifts toward red/yellow, negative toward blue. */
  warmth?: number
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

// --- compositing --------------------------------------------------------

export interface CompositeOptions extends MaskOptions, ToneOptions {
  /** Cropped source pixels, RGBA. */
  image: Bitmap
  /** Alpha mask, the same size as `image`. */
  mask: Bitmap
  /** New background, as `#RRGGBB`. */
  background: string
  /**
   * Skip foreground estimation. Only for measuring what the estimation is
   * worth — the halo it removes is the reason this module exists.
   */
  skipDecontamination?: boolean
}

/**
 * Produce the final opaque image: subject on the chosen background, with the
 * old background's colour removed from the fringe.
 */
export function composite(options: CompositeOptions): Bitmap & { data: Uint8ClampedArray } {
  const { image, mask, background } = options
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(
      `mask is ${mask.width}x${mask.height} but the image is ${image.width}x${image.height}`,
    )
  }

  const { width, height } = image
  const bg = parseHex(background)
  const alpha = shapeMask(maskToAlpha(mask), width, height, options)

  const out = createBitmap(width, height)
  const n = width * height
  // Tone applies to the subject before it meets the background, so a white
  // backdrop stays exactly white however far the sliders go.
  const tone = toneTables(options)
  const [tr, tg, tb] = tone ?? [null, null, null]

  if (options.skipDecontamination) {
    for (let i = 0; i < n; i++) {
      const a = alpha[i]
      const r = image.data[i * 4]
      const g = image.data[i * 4 + 1]
      const b = image.data[i * 4 + 2]
      out.data[i * 4] = (tr ? tr[r] : r) * a + bg.r * (1 - a)
      out.data[i * 4 + 1] = (tg ? tg[g] : g) * a + bg.g * (1 - a)
      out.data[i * 4 + 2] = (tb ? tb[b] : b) * a + bg.b * (1 - a)
      out.data[i * 4 + 3] = 255
    }
    return out
  }

  const f = estimateForeground(image, alpha)
  for (let i = 0; i < n; i++) {
    const a = alpha[i]
    const r = f.r[i]
    const g = f.g[i]
    const b = f.b[i]
    out.data[i * 4] = (tr ? tr[Math.round(r)] : r) * a + bg.r * (1 - a)
    out.data[i * 4 + 1] = (tg ? tg[Math.round(g)] : g) * a + bg.g * (1 - a)
    out.data[i * 4 + 2] = (tb ? tb[Math.round(b)] : b) * a + bg.b * (1 - a)
    // ID photos print on paper; there is no transparency in the output.
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
