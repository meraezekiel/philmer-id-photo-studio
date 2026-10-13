import { describe, expect, it } from 'vitest'

import type { Book } from '../../lib/bookTypes'
import { suggestedFileName } from './bookProject'

const withTitle = (title: string | null) => ({ cover: title === null ? null : { title } }) as unknown as Book

describe('suggestedFileName', () => {
  it('falls back without a cover title', () => {
    expect(suggestedFileName(withTitle(null))).toBe('photo-book.photobook')
    expect(suggestedFileName(withTitle('  '))).toBe('photo-book.photobook')
  })
  it('strips characters a file name cannot hold', () => {
    expect(suggestedFileName(withTitle('Our: trip/2026?'))).toBe('Our trip2026.photobook')
  })
})
