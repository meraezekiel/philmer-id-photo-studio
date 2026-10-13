import { describe, expect, it } from 'vitest'

import { CENTRED } from '../../lib/bookCrop'
import { NEUTRAL_ENHANCE } from '../../lib/enhance'
import { newBook, type Book, type BookPage, type BookPhoto } from '../../lib/bookTypes'
import { bookIssues, pageFileName } from './useBookOutput'

const photo = (id: string, width = 3000, height = 2000): BookPhoto => ({
  id, path: `C:\${id}.jpg`, name: `${id}.jpg`, width, height, takenAt: null, face: null, enhance: NEUTRAL_ENHANCE,
})

const inside = (n: number): BookPage[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, layoutId: '1-full', frames: [{ photoId: 'a', crop: CENTRED }] }))
const cover: BookPage = { id: 'c', layoutId: 'cover', frames: [{ photoId: 'a', crop: CENTRED }] }

describe('pageFileName', () => {
  it('names the cover and numbers inside pages', () => {
    const book: Book = { ...newBook(), photos: [photo('a')], pages: [cover, ...inside(12)] }
    expect(pageFileName(book, 0)).toBe('cover.jpg')
    expect(pageFileName(book, 1)).toBe('page-01.jpg')
    expect(pageFileName(book, 12)).toBe('page-12.jpg')
  })
  it('pads to the width of the page count', () => {
    const book: Book = { ...newBook(), photos: [photo('a')], pages: inside(120) }
    expect(pageFileName(book, 0)).toBe('page-001.jpg')
    expect(pageFileName(book, 119)).toBe('page-120.jpg')
  })
})

describe('bookIssues', () => {
  it('counts empty, missing and low-resolution frames', () => {
    const book: Book = {
      ...newBook(),
      photos: [photo('a'), photo('tiny', 300, 200)],
      pages: [
        { id: '1', layoutId: '2-side', frames: [{ photoId: 'a', crop: CENTRED }, { photoId: null, crop: CENTRED }] },
        { id: '2', layoutId: '1-full', frames: [{ photoId: 'tiny', crop: CENTRED }] },
        { id: '3', layoutId: '1-full', frames: [{ photoId: 'a', crop: CENTRED }] },
      ],
    }
    expect(bookIssues(book, new Set())).toEqual({ empty: 1, lowRes: 1, missing: 0 })
    expect(bookIssues(book, new Set(['a']))).toEqual({ empty: 1, lowRes: 1, missing: 2 })
  })
})
