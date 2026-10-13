import { describe, expect, it } from 'vitest'

import { NEUTRAL_ENHANCE } from './enhance'
import { CENTRED } from './bookCrop'
import { fileNameOf, parseBook, relinkPhotos, serializeBook } from './bookFile'
import { DEFAULT_COVER, newBook, type Book } from './bookTypes'

function sample(): Book {
  return {
    ...newBook(),
    size: '8x10',
    orientation: 'landscape',
    cover: { ...DEFAULT_COVER, title: 'Juan & María' },
    photos: [
      { id: 'p1', path: 'D:\\Kasal ni Juan & María\\IMG 001.JPG', name: 'IMG 001.JPG', width: 4000, height: 6000, takenAt: '2026-10-12T14:03:22', face: { x: 0.4, y: 0.1, w: 0.2, h: 0.1 }, enhance: { ...NEUTRAL_ENHANCE, brightness: 8 } },
      { id: 'p2', path: 'D:\\Kasal ni Juan & María\\IMG 002.JPG', name: 'IMG 002.JPG', width: 6000, height: 4000, takenAt: null, face: null, enhance: NEUTRAL_ENHANCE },
    ],
    pages: [
      { id: 'c', layoutId: 'cover', frames: [{ photoId: 'p1', crop: { cx: 0.5, cy: 0.4, zoom: 1.2 } }] },
      { id: 'a', layoutId: '1-full', frames: [{ photoId: 'p2', crop: CENTRED }] },
    ],
  }
}

const parsed = (text: string) => {
  const result = parseBook(text)
  if (!result.ok) throw new Error(result.message)
  return result.book
}

describe('saving and opening', () => {
  it('round-trips a book exactly', () => {
    expect(parsed(serializeBook(sample()))).toEqual(sample())
  })

  it('rejects text that is not a photo book', () => {
    for (const text of ['', 'hello', '[]', '{"version":1}', 'null', JSON.stringify({ app: 'other', version: 1 })]) {
      expect(parseBook(text)).toEqual({ ok: false, message: 'This file is not a photo book.' })
    }
  })

  it('refuses a book from a newer version of the app', () => {
    const text = JSON.stringify({ ...JSON.parse(serializeBook(sample())), version: 2 })
    expect(parseBook(text)).toEqual({ ok: false, message: 'This book was saved by a newer version of the app. Update the app to open it.' })
  })

  it('refuses a damaged book', () => {
    const text = JSON.stringify({ ...JSON.parse(serializeBook(sample())), pages: 'oops' })
    expect(parseBook(text)).toEqual({ ok: false, message: 'This photo book is damaged and cannot be opened.' })
  })

  it('repairs what it can: dangling photos, unknown layouts, bad numbers, bad settings', () => {
    const raw = JSON.parse(serializeBook(sample()))
    raw.size = '9x9'
    raw.paper = 'poster'
    raw.style = { marginMm: 500, gapMm: -1, color: 'pink' }
    raw.pageCount = -3
    raw.pages[1] = { id: 'a', layoutId: 'retired-layout', frames: [{ photoId: 'p2', crop: { cx: 'x', cy: null, zoom: 900 } }, { photoId: 'gone', crop: CENTRED }] }
    raw.photos.push({ id: 'bad', path: 42 })
    const book = parsed(JSON.stringify(raw))
    expect(book.size).toBe('5x6')
    expect(book.paper).toBe('a4')
    expect(book.style).toEqual({ marginMm: 20, gapMm: 0, color: '#FFFFFF' })
    expect(book.pageCount).toBe('auto')
    expect(book.photos.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(book.pages[1].layoutId).toBe('2-side')
    expect(book.pages[1].frames.map((f) => f.photoId)).toEqual(['p2', null])
    expect(book.pages[1].frames[0].crop).toEqual({ cx: 0.5, cy: 0.5, zoom: 5 })
  })

  it('keeps the cover page and the cover setting consistent', () => {
    const raw = JSON.parse(serializeBook(sample()))
    raw.cover = null
    expect(parsed(JSON.stringify(raw)).pages.map((p) => p.layoutId)).toEqual(['1-full'])
    const raw2 = JSON.parse(serializeBook(sample()))
    raw2.pages = raw2.pages.slice(1)
    const fixed = parsed(JSON.stringify(raw2))
    expect(fixed.pages[0].layoutId).toBe('cover')
    expect(fixed.pages[0].frames[0].photoId).toBeNull()
  })
})

describe('relinking moved photos', () => {
  it('relinkPhotos matches names ignoring case', () => {
    const found = { 'img 001.jpg': 'E:\\Moved\\Kasal\\IMG 001.jpg' }
    const result = relinkPhotos(sample(), found, ['p1', 'p2'])
    expect(result.relinked).toEqual(['p1'])
    expect(result.stillMissing).toEqual(['p2'])
    expect(result.book.photos[0].path).toBe('E:\\Moved\\Kasal\\IMG 001.jpg')
    expect(result.book.photos[1].path).toBe(sample().photos[1].path)
  })

  it('takes the file name from either slash', () => {
    expect(fileNameOf('C:\\a\\b.jpg')).toBe('b.jpg')
    expect(fileNameOf('/a/b c.jpg')).toBe('b c.jpg')
    expect(fileNameOf('plain.jpg')).toBe('plain.jpg')
  })
})
