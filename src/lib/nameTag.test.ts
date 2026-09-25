import { describe, expect, it } from 'vitest'

import { DEFAULT_NAME_TAG, nameTagFont, nameTagLayout, type NameTag } from './nameTag'

const tag = (over: Partial<NameTag> = {}): NameTag => ({
  ...DEFAULT_NAME_TAG,
  enabled: true,
  text: 'Mendoza, Mabel Andamo',
  ...over,
})

describe('nameTagLayout', () => {
  it('is nothing at all when switched off', () => {
    expect(nameTagLayout(413, 531, tag({ enabled: false }))).toBeNull()
  })

  it('is nothing at all with no name typed', () => {
    expect(nameTagLayout(413, 531, tag({ text: '   ' }))).toBeNull()
  })

  it('upper-cases the name the way the counter prints it', () => {
    expect(nameTagLayout(413, 531, tag())?.text).toBe('MENDOZA, MABEL ANDAMO')
  })

  it('leaves the case alone when asked to', () => {
    expect(nameTagLayout(413, 531, tag({ uppercase: false }))?.text).toBe('Mendoza, Mabel Andamo')
  })

  /** A 35 x 45 mm passport at 300 DPI is 413 x 531 px. */
  it('sits the band at the bottom, inside the photo', () => {
    const layout = nameTagLayout(413, 531, tag())
    expect(layout).not.toBeNull()
    expect(layout!.bandY + layout!.bandHeight).toBe(531)
    expect(layout!.bandHeight).toBeLessThan(531 * 0.2)
    expect(layout!.centreY).toBeCloseTo(layout!.bandY + layout!.bandHeight / 2, 6)
  })

  it('scales with the photo, so 1x1 and 2x2 print the same proportions', () => {
    const small = nameTagLayout(300, 300, tag())!
    const big = nameTagLayout(600, 600, tag())!
    expect(big.bandHeight / big.fontPx).toBeCloseTo(small.bandHeight / small.fontPx, 1)
    expect(big.fontPx).toBeCloseTo(small.fontPx * 2, 6)
  })

  it('shrinks the type to fit a long name rather than running off the photo', () => {
    // A measurer where every character is half the type size wide.
    const measure = (text: string, px: number) => text.length * px * 0.5
    const layout = nameTagLayout(413, 531, tag({ text: 'DE LOS SANTOS-BUENAVENTURA, MA. CRISTINA' }), measure)!
    expect(measure(layout.text, layout.fontPx)).toBeLessThanOrEqual(layout.maxTextWidth + 1e-9)
    expect(layout.fontPx).toBeLessThan(531 * DEFAULT_NAME_TAG.fontSizeRatio)
  })

  it('leaves a short name at the size that was asked for', () => {
    const measure = (text: string, px: number) => text.length * px * 0.5
    const layout = nameTagLayout(413, 531, tag({ text: 'CRUZ, JUAN' }), measure)!
    expect(layout.fontPx).toBeCloseTo(531 * DEFAULT_NAME_TAG.fontSizeRatio, 6)
  })

  it('keeps the band height when the type shrinks, so a row of prints stays even', () => {
    const measure = (text: string, px: number) => text.length * px * 0.5
    const short = nameTagLayout(413, 531, tag({ text: 'CRUZ, JUAN' }), measure)!
    const long = nameTagLayout(413, 531, tag({ text: 'DE LOS SANTOS-BUENAVENTURA, MA. CRISTINA' }), measure)!
    expect(long.bandHeight).toBe(short.bandHeight)
  })

  it('follows the font size setting', () => {
    const small = nameTagLayout(413, 531, tag({ fontSizeRatio: 0.04 }))!
    const large = nameTagLayout(413, 531, tag({ fontSizeRatio: 0.1 }))!
    expect(large.fontPx).toBeGreaterThan(small.fontPx)
    expect(large.bandHeight).toBeGreaterThan(small.bandHeight)
  })

  it('never lets the band swallow the whole photo', () => {
    const layout = nameTagLayout(413, 531, tag({ fontSizeRatio: 5 }))!
    expect(layout.bandHeight).toBeLessThanOrEqual(531)
    expect(layout.bandY).toBeGreaterThanOrEqual(0)
  })
})

describe('nameTagFont', () => {
  it('asks for the chosen family, with a fallback', () => {
    expect(nameTagFont(tag({ fontFamily: 'Archivo' }), 24)).toBe(
      '700 24px "Archivo", Arial, sans-serif',
    )
  })

  it('carries weight and slant', () => {
    expect(nameTagFont(tag({ bold: false, italic: true }), 24)).toBe(
      'italic 400 24px "Arial", Arial, sans-serif',
    )
  })
})
