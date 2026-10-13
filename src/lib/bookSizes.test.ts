import { describe, expect, it } from 'vitest'

import { BOOK_SIZE_ORDER, BOOK_SIZES, isSquare, pageSizeMm } from './bookSizes'
import { clampStyle, isEdgeToEdge, newBook, EDGE_TO_EDGE, WHITE_BORDER } from './bookTypes'

describe('book sizes', () => {
  it('stores every size portrait, short side first', () => {
    for (const id of BOOK_SIZE_ORDER) {
      expect(BOOK_SIZES[id].widthMm).toBeLessThanOrEqual(BOOK_SIZES[id].heightMm)
    }
  })

  it('gives the exact trim sizes the shop sells', () => {
    expect(pageSizeMm('5x6', 'portrait')).toEqual({ widthMm: 127, heightMm: 152.4 })
    expect(pageSizeMm('5x7', 'portrait')).toEqual({ widthMm: 127, heightMm: 177.8 })
    expect(pageSizeMm('8x10', 'portrait')).toEqual({ widthMm: 203.2, heightMm: 254 })
    expect(pageSizeMm('a4', 'portrait')).toEqual({ widthMm: 210, heightMm: 297 })
  })

  it('swaps the sides for landscape', () => {
    expect(pageSizeMm('5x6', 'landscape')).toEqual({ widthMm: 152.4, heightMm: 127 })
  })

  it('ignores orientation for the square book', () => {
    expect(isSquare('8x8')).toBe(true)
    expect(pageSizeMm('8x8', 'landscape')).toEqual({ widthMm: 203.2, heightMm: 203.2 })
  })
})

describe('book style', () => {
  it('treats a zero margin as edge to edge', () => {
    expect(isEdgeToEdge(EDGE_TO_EDGE)).toBe(true)
    expect(isEdgeToEdge(WHITE_BORDER)).toBe(false)
  })

  it('clamps typed values into range and repairs a bad colour', () => {
    expect(clampStyle({ marginMm: -4, gapMm: 99, color: 'red' })).toEqual({ marginMm: 0, gapMm: 10, color: '#FFFFFF' })
    expect(clampStyle({ marginMm: Number.NaN, gapMm: 2, color: '#f4efe6' })).toEqual({ marginMm: 0, gapMm: 2, color: '#f4efe6' })
  })

  it('starts a new book empty with the white-border style', () => {
    const book = newBook()
    expect(book.photos).toEqual([])
    expect(book.pages).toEqual([])
    expect(book.cover).toBeNull()
    expect(book.style).toEqual(WHITE_BORDER)
    expect(book.version).toBe(1)
  })
})
