import { describe, expect, it } from 'vitest'

import { NEUTRAL_ENHANCE } from './enhance'
import { CENTRED, cropRect } from './bookCrop'
import {
  addPage,
  addPhotos,
  clearFrame,
  deletePage,
  duplicatePage,
  firstPageIndex,
  movePage,
  placePhoto,
  removePhoto,
  setCover,
  setCrop,
  setEnhanceAll,
  setPageLayout,
  setPhotoEnhance,
  sortPhotos,
  swapFrames,
  unusedPhotos,
} from './bookModel'
import { DEFAULT_COVER, newBook, type Book, type BookPhoto } from './bookTypes'

const photo = (n: number, patch: Partial<BookPhoto> = {}): BookPhoto => ({
  id: `p${n}`,
  path: `C:\\wedding\\IMG_${n}.jpg`,
  name: `IMG_${n}.jpg`,
  width: 3000,
  height: 2000,
  takenAt: null,
  face: null,
  enhance: NEUTRAL_ENHANCE,
  ...patch,
})

function book(): Book {
  return {
    ...newBook(),
    photos: [1, 2, 3, 4, 5, 6].map((n) => photo(n)),
    pages: [
      { id: 'A', layoutId: '2-side', frames: [{ photoId: 'p1', crop: CENTRED }, { photoId: 'p2', crop: CENTRED }] },
      { id: 'B', layoutId: '1-full', frames: [{ photoId: 'p3', crop: CENTRED }] },
    ],
  }
}

const ids = (b: Book, page: number) => b.pages[page].frames.map((f) => f.photoId)

describe('layouts on a page', () => {
  it('keeps the photos in order when the layout gains frames', () => {
    const b = setPageLayout(book(), 0, '3-row')
    expect(ids(b, 0)).toEqual(['p1', 'p2', null])
  })

  it('sends extra photos back to the tray when the layout loses frames', () => {
    const b = setPageLayout(book(), 0, '1-full')
    expect(ids(b, 0)).toEqual(['p1'])
    expect(unusedPhotos(b).map((p) => p.id)).toEqual(['p2', 'p4', 'p5', 'p6'])
  })

  it('ignores unknown layouts, the cover layout and bad pages', () => {
    const b = book()
    expect(setPageLayout(b, 0, 'nope')).toBe(b)
    expect(setPageLayout(b, 0, 'cover')).toBe(b)
    expect(setPageLayout(b, 9, '1-full')).toBe(b)
    expect(setPageLayout(b, -1, '1-full')).toBe(b)
  })
})

describe('moving photos', () => {
  it('swaps two frames, even across pages', () => {
    const b = swapFrames(book(), { page: 0, frame: 0 }, { page: 1, frame: 0 })
    expect(ids(b, 0)).toEqual(['p3', 'p2'])
    expect(ids(b, 1)).toEqual(['p1'])
  })

  it('does nothing for the same frame or a bad reference', () => {
    const b = book()
    expect(swapFrames(b, { page: 0, frame: 0 }, { page: 0, frame: 0 })).toBe(b)
    expect(swapFrames(b, { page: 0, frame: 5 }, { page: 0, frame: 0 })).toBe(b)
  })

  it('places a tray photo, sending the old one back', () => {
    const b = placePhoto(book(), { page: 0, frame: 0 }, 'p4')
    expect(ids(b, 0)).toEqual(['p4', 'p2'])
    expect(unusedPhotos(b).map((p) => p.id)).toContain('p1')
  })

  it('swaps when the placed photo is already on a page', () => {
    const b = placePhoto(book(), { page: 0, frame: 0 }, 'p3')
    expect(ids(b, 0)).toEqual(['p3', 'p2'])
    expect(ids(b, 1)).toEqual(['p1'])
  })

  it('ignores an unknown photo', () => {
    const b = book()
    expect(placePhoto(b, { page: 0, frame: 0 }, 'zz')).toBe(b)
  })

  it('clears a frame', () => {
    const b = clearFrame(book(), { page: 1, frame: 0 })
    expect(ids(b, 1)).toEqual([null])
    const again = clearFrame(b, { page: 1, frame: 0 })
    expect(again).toBe(b)
  })

  it('keeps a typed crop inside the photo', () => {
    const b = setCrop(book(), { page: 1, frame: 0 }, { cx: 9, cy: -9, zoom: 3 })
    const crop = b.pages[1].frames[0].crop
    const r = cropRect(1.5, 115 / 140.4, crop)
    expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-12)
    expect(r.y).toBeGreaterThanOrEqual(0)
  })

  it('does not crop an empty frame', () => {
    const b = clearFrame(book(), { page: 1, frame: 0 })
    expect(setCrop(b, { page: 1, frame: 0 }, { cx: 0.2, cy: 0.2, zoom: 2 })).toBe(b)
  })
})

describe('pages', () => {
  it('adds an empty page after the given one', () => {
    const { book: b, index } = addPage(book(), 0)
    expect(index).toBe(1)
    expect(b.pages).toHaveLength(3)
    expect(ids(b, 1)).toEqual([null])
  })

  it('never adds a page in front of the cover', () => {
    const covered = setCover(book(), DEFAULT_COVER)
    const { book: b, index } = addPage(covered, -1)
    expect(index).toBe(1)
    expect(b.pages[0].layoutId).toBe('cover')
  })

  it('refuses to add a cover-layout page', () => {
    const b = book()
    expect(addPage(b, 0, 'cover').book).toBe(b)
  })

  it('duplicates a page with a new id', () => {
    const b = duplicatePage(book(), 0)
    expect(b.pages).toHaveLength(3)
    expect(b.pages[1].id).not.toBe('A')
    expect(ids(b, 1)).toEqual(['p1', 'p2'])
  })

  it('deletes pages, down to none', () => {
    let b = deletePage(book(), 0)
    expect(b.pages.map((p) => p.id)).toEqual(['B'])
    b = deletePage(b, 0)
    expect(b.pages).toEqual([])
    expect(deletePage(b, 0)).toBe(b)
  })

  it('moves a page and clamps the destination', () => {
    const b = movePage(book(), 0, 99)
    expect(b.pages.map((p) => p.id)).toEqual(['B', 'A'])
    expect(movePage(b, 1, 1)).toBe(b)
  })

  it('keeps the cover first', () => {
    const covered = setCover(book(), DEFAULT_COVER)
    expect(firstPageIndex(covered)).toBe(1)
    expect(movePage(covered, 0, 2)).toBe(covered)
    const moved = movePage(covered, 2, 0)
    expect(moved.pages[0].layoutId).toBe('cover')
    expect(moved.pages[1].id).toBe('B')
    expect(deletePage(covered, 0)).toBe(covered)
    expect(duplicatePage(covered, 0)).toBe(covered)
  })
})

describe('cover', () => {
  it('adds a cover page with the first unused photo', () => {
    const b = setCover(book(), DEFAULT_COVER)
    expect(b.pages[0].layoutId).toBe('cover')
    expect(ids(b, 0)).toEqual(['p4'])
  })

  it('only records the setting before pages are built', () => {
    const empty = { ...book(), pages: [] }
    const b = setCover(empty, DEFAULT_COVER)
    expect(b.cover).toEqual(DEFAULT_COVER)
    expect(b.pages).toEqual([])
  })

  it('changes cover text without touching pages', () => {
    const covered = setCover(book(), DEFAULT_COVER)
    const b = setCover(covered, { ...DEFAULT_COVER, title: 'Juan & Maria' })
    expect(b.pages).toBe(covered.pages)
    expect(b.cover?.title).toBe('Juan & Maria')
  })

  it('removes the cover page and returns its photo to the tray', () => {
    const covered = setCover(book(), DEFAULT_COVER)
    const b = setCover(covered, null)
    expect(b.pages.map((p) => p.id)).toEqual(['A', 'B'])
    expect(unusedPhotos(b).map((p) => p.id)).toContain('p4')
    const none = book()
    expect(setCover(none, null)).toBe(none)
  })
})

describe('photos', () => {
  it('addPhotos dedupes by path, ignoring case', () => {
    const result = addPhotos(book(), [
      photo(1, { id: 'x1', path: 'c:\\WEDDING\\img_1.JPG' }),
      photo(7),
      photo(7, { id: 'x7' }),
    ])
    expect(result.added).toBe(1)
    expect(result.duplicates).toBe(2)
    expect(result.book.photos.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])
  })

  it('sorts by date taken, then undated photos by name with numbers in order', () => {
    const sorted = sortPhotos([
      photo(10, { takenAt: null, name: 'IMG_10.jpg' }),
      photo(2, { takenAt: null, name: 'IMG_2.jpg' }),
      photo(3, { takenAt: '2026-10-12T15:00:00' }),
      photo(4, { takenAt: '2026-10-12T09:00:00' }),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['p4', 'p3', 'p2', 'p10'])
  })

  it('removes a photo from the book and from its frame', () => {
    const b = removePhoto(book(), 'p1')
    expect(b.photos.some((p) => p.id === 'p1')).toBe(false)
    expect(ids(b, 0)).toEqual([null, 'p2'])
    expect(removePhoto(b, 'p1')).toBe(b)
  })

  it('sets enhance for one photo or all of them', () => {
    const one = setPhotoEnhance(book(), 'p2', { brightness: 10 })
    expect(one.photos[1].enhance.brightness).toBe(10)
    expect(one.photos[0].enhance.brightness).toBe(0)
    const all = setEnhanceAll(book(), { p1: { ...NEUTRAL_ENHANCE, warmth: -5 } })
    expect(all.photos[0].enhance.warmth).toBe(-5)
    expect(all.photos[1].enhance).toEqual(NEUTRAL_ENHANCE)
    expect(setPhotoEnhance(book(), 'zz', { brightness: 1 }).photos).toEqual(book().photos)
  })

  it('returns the same book when an enhance change is a no-op', () => {
    const b = book()
    expect(setPhotoEnhance(b, 'zz', { brightness: 1 })).toBe(b)
    expect(setPhotoEnhance(b, 'p2', { brightness: 0 })).toBe(b)
    expect(setEnhanceAll(b, {})).toBe(b)
    expect(setEnhanceAll(b, { zz: { ...NEUTRAL_ENHANCE, warmth: 5 } })).toBe(b)
    expect(setEnhanceAll(b, { p1: { ...NEUTRAL_ENHANCE } })).toBe(b)
  })
})
