/**
 * The finished page sizes the shop sells. Each book has one size; pages are
 * printed several to a sheet and trimmed (see bookSheets.ts).
 */

import type { EditPaperChoice } from './editPaper'
import type { SizeMm } from './bookTypes'

export type BookSizeId = '5x6' | '5x7' | '8x8' | '8x10' | 'a4'
export type BookOrientation = 'portrait' | 'landscape'

export interface BookSize {
  id: BookSizeId
  label: string
  sublabel: string
  /** Portrait: width is the short side. */
  widthMm: number
  heightMm: number
}

export const BOOK_SIZES: Record<BookSizeId, BookSize> = {
  '5x6': { id: '5x6', label: '5x6', sublabel: '127 x 152.4 mm - 5 x 6 in', widthMm: 127, heightMm: 152.4 },
  '5x7': { id: '5x7', label: '5x7', sublabel: '127 x 177.8 mm - 5 x 7 in', widthMm: 127, heightMm: 177.8 },
  '8x8': { id: '8x8', label: '8x8', sublabel: '203.2 x 203.2 mm - 8 x 8 in', widthMm: 203.2, heightMm: 203.2 },
  '8x10': { id: '8x10', label: '8x10', sublabel: '203.2 x 254 mm - 8 x 10 in', widthMm: 203.2, heightMm: 254 },
  a4: { id: 'a4', label: 'A4', sublabel: '210 x 297 mm', widthMm: 210, heightMm: 297 },
}

export const BOOK_SIZE_ORDER: BookSizeId[] = ['5x6', '5x7', '8x8', '8x10', 'a4']

/** The papers a book prints on. */
export const BOOK_PAPER_CHOICES: EditPaperChoice[] = ['a4', '8r', 'custom']

export function isSquare(id: BookSizeId): boolean {
  return BOOK_SIZES[id].widthMm === BOOK_SIZES[id].heightMm
}

export function pageSizeMm(id: BookSizeId, orientation: BookOrientation): SizeMm {
  const { widthMm, heightMm } = BOOK_SIZES[id]
  return orientation === 'landscape' ? { widthMm: heightMm, heightMm: widthMm } : { widthMm, heightMm }
}
