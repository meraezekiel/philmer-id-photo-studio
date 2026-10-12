import { describe, expect, it } from 'vitest'

import { editPaper, formatLength, parseLength, sizeSublabel } from './editPaper'
import { PAPERS } from './presets'

describe('Photo Print paper sizes', () => {
  it('uses the preset for a named paper', () => {
    const p = editPaper('5r', { widthMm: 50, heightMm: 50 })
    expect(p).toMatchObject({ label: '5R', widthMm: 127, heightMm: 177.8, sublabel: PAPERS['5r'].sublabel })
    expect(p.longLabel).toBe('5R')
  })

  it('uses the operator size for Custom, and names it in both units', () => {
    const p = editPaper('custom', { widthMm: 127, heightMm: 177.8 })
    expect(p.label).toBe('Custom')
    expect(p.widthMm).toBe(127)
    expect(p.heightMm).toBe(177.8)
    expect(p.sublabel).toBe('127 x 177.8 mm - 5 x 7 in')
    expect(p.longLabel).toBe('custom paper, 127 x 177.8 mm - 5 x 7 in')
  })

  it('writes lengths without trailing zeros', () => {
    expect(sizeSublabel(210, 297)).toBe('210 x 297 mm - 8.27 x 11.69 in')
    expect(formatLength(101.6, 'in')).toBe('4')
    expect(formatLength(101.6, 'mm')).toBe('101.6')
    expect(formatLength(88.9, 'in')).toBe('3.5')
  })

  it('reads a typed length in either unit as millimetres', () => {
    expect(parseLength('5', 'in')).toBeCloseTo(127, 6)
    expect(parseLength(' 152.4 ', 'mm')).toBe(152.4)
    expect(parseLength('4,5', 'in')).toBeCloseTo(114.3, 6)
  })

  it('refuses a length that is empty, not a number, or no printer can take', () => {
    expect(parseLength('', 'mm')).toBeNull()
    expect(parseLength('abc', 'mm')).toBeNull()
    expect(parseLength('0', 'in')).toBeNull()
    expect(parseLength('10', 'mm')).toBeNull()
    expect(parseLength('600', 'mm')).toBeNull()
    expect(parseLength('25', 'mm')).toBe(25)
    expect(parseLength('500', 'mm')).toBe(500)
  })
})
