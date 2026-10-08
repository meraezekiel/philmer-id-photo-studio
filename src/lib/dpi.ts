/**
 * Physical-size maths and the DPI metadata writers (BUILD_PLAN §8).
 *
 * A 2x2 must come out of the printer measuring 50.8 mm. Pixel count alone does
 * not achieve that — the file has to *say* it is 300 DPI, or the print dialog
 * and most viewers assume 72 and shrink it. Canvas `toBlob` writes no useful
 * density, so we patch the encoded bytes here.
 */

import { MM_PER_INCH, PRINT_DPI } from './presets'

export function mmToPx(mm: number, dpi: number = PRINT_DPI): number {
  return Math.round((mm / MM_PER_INCH) * dpi)
}

export function pxToMm(px: number, dpi: number = PRINT_DPI): number {
  return (px / dpi) * MM_PER_INCH
}

export function inchesToMm(inches: number): number {
  return inches * MM_PER_INCH
}

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH
}

/** PDF works in points; 72 pt to the inch. */
export function mmToPoints(mm: number): number {
  return (mm / MM_PER_INCH) * 72
}

/** PNG stores pixels per *metre*, so 300 DPI is 11811 (BUILD_PLAN §8). */
export function dpiToPixelsPerMetre(dpi: number = PRINT_DPI): number {
  return Math.round(dpi / 0.0254)
}

/** Output pixel size for a photo preset at print resolution. */
export function outputSizePx(
  widthMm: number,
  heightMm: number,
  dpi: number = PRINT_DPI,
): { width: number; height: number } {
  return { width: mmToPx(widthMm, dpi), height: mmToPx(heightMm, dpi) }
}

// --- JPEG ---------------------------------------------------------------

const SOI = 0xd8
const APP0 = 0xe0

/**
 * Set the JFIF density to `dpi` x `dpi` with units = 1 (dots per inch).
 *
 * If the file already has a JFIF APP0 we patch it in place; otherwise we insert
 * a minimal one straight after the SOI marker, which is where the spec requires
 * it to live.
 */
export function setJpegDpi(bytes: Uint8Array, dpi: number = PRINT_DPI): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) {
    throw new Error('not a JPEG: missing SOI marker')
  }

  // Segment after SOI.
  if (bytes[2] === 0xff && bytes[3] === APP0) {
    const length = (bytes[4] << 8) | bytes[5]
    const isJfif =
      bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46
    if (isJfif && length >= 16) {
      const out = new Uint8Array(bytes)
      out[13] = 1 // units: dots per inch
      out[14] = (dpi >> 8) & 0xff
      out[15] = dpi & 0xff
      out[16] = (dpi >> 8) & 0xff
      out[17] = dpi & 0xff
      return out
    }
  }

  // 16-byte JFIF APP0: length, "JFIF\0", version 1.02, units, densities, no thumbnail.
  const app0 = new Uint8Array([
    0xff,
    APP0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x02,
    0x01,
    (dpi >> 8) & 0xff,
    dpi & 0xff,
    (dpi >> 8) & 0xff,
    dpi & 0xff,
    0x00,
    0x00,
  ])

  const out = new Uint8Array(bytes.length + app0.length)
  out.set(bytes.subarray(0, 2), 0)
  out.set(app0, 2)
  out.set(bytes.subarray(2), 2 + app0.length)
  return out
}

export function readJpegDpi(bytes: Uint8Array): { x: number; y: number; units: number } | null {
  if (bytes[2] !== 0xff || bytes[3] !== APP0) return null
  const isJfif = bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46
  if (!isJfif) return null
  return {
    units: bytes[13],
    x: (bytes[14] << 8) | bytes[15],
    y: (bytes[16] << 8) | bytes[17],
  }
}

// --- PNG ----------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  )
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

/**
 * Write a `pHYs` chunk (pixels per metre, unit = 1 for metres).
 *
 * The chunk must appear before the first `IDAT`; an existing one is replaced so
 * repeated exports do not accumulate chunks.
 */
export function setPngDpi(bytes: Uint8Array, dpi: number = PRINT_DPI): Uint8Array {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG: bad signature')
  }

  const ppm = dpiToPixelsPerMetre(dpi)
  const data = new Uint8Array(9)
  writeUint32(data, 0, ppm)
  writeUint32(data, 4, ppm)
  data[8] = 1 // unit specifier: metres

  const typeAndData = new Uint8Array(4 + data.length)
  typeAndData.set([0x70, 0x48, 0x59, 0x73], 0) // "pHYs"
  typeAndData.set(data, 4)

  const chunk = new Uint8Array(12 + data.length)
  writeUint32(chunk, 0, data.length)
  chunk.set(typeAndData, 4)
  writeUint32(chunk, 8 + data.length, crc32(typeAndData))

  // Walk chunks: drop any existing pHYs, and insert before the first IDAT.
  const head: Uint8Array[] = [bytes.subarray(0, 8)]
  const tail: Uint8Array[] = []
  let offset = 8
  let inserted = false

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset)
    const type = chunkType(bytes, offset + 4)
    const end = offset + 12 + length
    const slice = bytes.subarray(offset, end)

    if (type === 'pHYs') {
      offset = end
      continue
    }
    if (!inserted && type === 'IDAT') {
      head.push(chunk)
      inserted = true
    }
    ;(inserted ? tail : head).push(slice)
    offset = end
  }

  // A PNG with no IDAT is malformed, but never drop the chunk on the floor.
  if (!inserted) head.push(chunk)

  const parts = [...head, ...tail]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function readPngDpi(bytes: Uint8Array): { x: number; y: number; unit: number } | null {
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset)
    if (chunkType(bytes, offset + 4) === 'pHYs') {
      return {
        x: readUint32(bytes, offset + 8),
        y: readUint32(bytes, offset + 12),
        unit: bytes[offset + 16],
      }
    }
    offset += 12 + length
  }
  return null
}

/** `IDPhoto_2x2_20260924-1432.jpg` (BUILD_PLAN §8). */
export function defaultFileName(sizeLabel: string, ext: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`
  const safe = sizeLabel.replace(/[^A-Za-z0-9]+/g, '')
  return `IDPhoto_${safe}_${stamp}.${ext}`
}

/** `IMG_0042-edited.jpg` — Photo Print keeps the customer's own file name. */
export function editedFileName(sourceName: string | null, ext: string): string {
  const base = (sourceName ?? '').replace(/[<>:"/\\|?*]/g, '_').trim() || 'photo'
  return `${base}-edited.${ext}`
}
