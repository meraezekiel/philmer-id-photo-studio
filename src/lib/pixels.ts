/**
 * Pixel primitives shared by the compositor and the enhancer.
 *
 * Plain `{ width, height, data }` buffers, so everything stays testable in
 * Node with no canvas. A DOM `ImageData` satisfies `Bitmap` structurally.
 */

/** Structurally compatible with the DOM's `ImageData`. */
export interface Bitmap {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export function createBitmap(width: number, height: number): Bitmap & { data: Uint8ClampedArray } {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/**
 * Separable box blur over a single float plane. Two O(n) passes with a running
 * sum, so cost does not grow with the radius — which matters because the
 * fallback radius is 16 px and this runs on multi-megapixel crops.
 */
export function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius < 1) return Float32Array.from(src)
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const window = radius * 2 + 1

  for (let y = 0; y < height; y++) {
    const row = y * width
    // Seed the running sum with the left edge clamped.
    let sum = src[row] * (radius + 1)
    for (let x = 1; x <= radius; x++) sum += src[row + Math.min(x, width - 1)]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / window
      sum -= src[row + Math.max(x - radius, 0)]
      sum += src[row + Math.min(x + radius + 1, width - 1)]
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = tmp[x] * (radius + 1)
    for (let y = 1; y <= radius; y++) sum += tmp[Math.min(y, height - 1) * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / window
      sum -= tmp[Math.max(y - radius, 0) * width + x]
      sum += tmp[Math.min(y + radius + 1, height - 1) * width + x]
    }
  }
  return out
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
