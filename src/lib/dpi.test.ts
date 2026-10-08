import { describe, expect, it } from 'vitest'

import {
  defaultFileName,
  dpiToPixelsPerMetre,
  editedFileName,
  mmToPoints,
  mmToPx,
  outputSizePx,
  pxToMm,
  readJpegDpi,
  readPngDpi,
  setJpegDpi,
  setPngDpi,
} from './dpi'
import { PHOTO_PRESETS } from './presets'

describe('physical size maths', () => {
  it('produces the output pixel sizes in the BUILD_PLAN §6 table', () => {
    expect(outputSizePx(PHOTO_PRESETS['1x1'].widthMm, PHOTO_PRESETS['1x1'].heightMm)).toEqual({
      width: 300,
      height: 300,
    })
    expect(outputSizePx(PHOTO_PRESETS['2x2'].widthMm, PHOTO_PRESETS['2x2'].heightMm)).toEqual({
      width: 600,
      height: 600,
    })
    expect(
      outputSizePx(PHOTO_PRESETS.passport.widthMm, PHOTO_PRESETS.passport.heightMm),
    ).toEqual({ width: 413, height: 531 })
  })

  it('round-trips mm and px', () => {
    expect(pxToMm(mmToPx(50.8))).toBeCloseTo(50.8, 3)
  })

  it('converts mm to PDF points', () => {
    expect(mmToPoints(25.4)).toBeCloseTo(72, 9)
    expect(mmToPoints(50.8)).toBeCloseTo(144, 9)
  })

  it('uses 11811 pixels per metre for 300 DPI, as the plan specifies', () => {
    expect(dpiToPixelsPerMetre(300)).toBe(11811)
  })
})

/** A JPEG needs only SOI + APP0 + EOI for these byte-level tests. */
function jpegWithJfif(density: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x02, // version
    0x00, // units: none
    (density >> 8) & 0xff, density & 0xff,
    (density >> 8) & 0xff, density & 0xff,
    0x00, 0x00, // no thumbnail
    0xff, 0xd9, // EOI
  ])
}

describe('setJpegDpi', () => {
  it('patches an existing JFIF header to 300 DPI', () => {
    const out = setJpegDpi(jpegWithJfif(1), 300)
    expect(readJpegDpi(out)).toEqual({ units: 1, x: 300, y: 300 })
    expect(out.length).toBe(jpegWithJfif(1).length)
  })

  it('inserts a JFIF header when the encoder omitted one', () => {
    // SOI, then a DQT segment, then EOI — no APP0 at all.
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9])
    const out = setJpegDpi(bare, 300)
    expect(readJpegDpi(out)).toEqual({ units: 1, x: 300, y: 300 })
    expect(out.length).toBe(bare.length + 18)
    // The original segments survive, just pushed along.
    expect(Array.from(out.subarray(out.length - 8))).toEqual([
      0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9,
    ])
  })

  it('rejects something that is not a JPEG', () => {
    expect(() => setJpegDpi(new Uint8Array([1, 2, 3, 4]))).toThrow(/SOI/)
  })
})

/** Minimal PNG: signature + IHDR + IDAT + IEND, with valid lengths. */
function makePng(withExistingPhys = false): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const len = [
      (data.length >>> 24) & 0xff,
      (data.length >>> 16) & 0xff,
      (data.length >>> 8) & 0xff,
      data.length & 0xff,
    ]
    const typeBytes = [...type].map((c) => c.charCodeAt(0))
    // CRC is not validated by the writer, so zeros are fine for these fixtures.
    return [...len, ...typeBytes, ...data, 0, 0, 0, 0]
  }
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...(withExistingPhys ? chunk('pHYs', [0, 0, 0x0b, 0x12, 0, 0, 0x0b, 0x12, 1]) : []),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ])
}

describe('setPngDpi', () => {
  it('writes pHYs with 11811 px/m and unit = metres', () => {
    const out = setPngDpi(makePng(), 300)
    expect(readPngDpi(out)).toEqual({ x: 11811, y: 11811, unit: 1 })
  })

  it('places pHYs before the first IDAT, as the spec requires', () => {
    const out = setPngDpi(makePng(), 300)
    const text = Array.from(out)
      .map((b) => String.fromCharCode(b))
      .join('')
    expect(text.indexOf('pHYs')).toBeGreaterThan(-1)
    expect(text.indexOf('pHYs')).toBeLessThan(text.indexOf('IDAT'))
  })

  it('replaces an existing pHYs rather than adding a second', () => {
    const out = setPngDpi(makePng(true), 300)
    const occurrences = Array.from(out)
      .map((b) => String.fromCharCode(b))
      .join('')
      .split('pHYs').length - 1
    expect(occurrences).toBe(1)
    expect(readPngDpi(out)).toEqual({ x: 11811, y: 11811, unit: 1 })
  })

  it('keeps IHDR first and IEND last', () => {
    const out = setPngDpi(makePng(), 300)
    const text = Array.from(out)
      .map((b) => String.fromCharCode(b))
      .join('')
    expect(text.indexOf('IHDR')).toBeLessThan(text.indexOf('pHYs'))
    expect(text.indexOf('IEND')).toBeGreaterThan(text.indexOf('IDAT'))
  })

  it('rejects something that is not a PNG', () => {
    expect(() => setPngDpi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/signature/)
  })
})

describe('defaultFileName', () => {
  it('matches the IDPhoto_{size}_{yyyyMMdd-HHmm}.{ext} pattern', () => {
    const name = defaultFileName('2x2', 'jpg', new Date(2026, 8, 24, 14, 32))
    expect(name).toBe('IDPhoto_2x2_20260924-1432.jpg')
  })

  it('strips characters that are not safe in a file name', () => {
    expect(defaultFileName('35 x 45 mm', 'pdf', new Date(2026, 0, 2, 3, 4))).toBe(
      'IDPhoto_35x45mm_20260102-0304.pdf',
    )
    expect(defaultFileName('Custom / 2:1', 'png', new Date(2026, 0, 2, 3, 4))).toBe(
      'IDPhoto_Custom21_20260102-0304.png',
    )
  })
})

describe('editedFileName', () => {
  it('adds -edited to the original name', () => {
    expect(editedFileName('IMG_0042', 'jpg')).toBe('IMG_0042-edited.jpg')
  })
  it('falls back to photo for a pasted image', () => {
    expect(editedFileName(null, 'png')).toBe('photo-edited.png')
  })
  it('drops characters Windows will not take', () => {
    expect(editedFileName('a:b*c?', 'png')).toBe('a_b_c_-edited.png')
  })
})
