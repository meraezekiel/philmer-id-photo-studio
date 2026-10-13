import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NEUTRAL_ENHANCE } from '../lib/enhance'
import { deletePage } from '../lib/bookModel'
import { DEFAULT_COVER, newBook, type BookPhoto } from '../lib/bookTypes'
import { UNDO_LIMIT, useBook } from './book'

const photo = (n: number): BookPhoto => ({
  id: `p${n}`, path: `C:\\w\\IMG_${String(n).padStart(3, '0')}.jpg`, name: `IMG_${String(n).padStart(3, '0')}.jpg`,
  width: 3000, height: 2000, takenAt: null, face: null, enhance: NEUTRAL_ENHANCE,
})

const photos = (n: number) => Array.from({ length: n }, (_, i) => photo(i + 1))
const s = () => useBook.getState()

beforeEach(() => {
  useBook.setState({ ...useBook.getInitialState() })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loading photos', () => {
  it('moves to Setup once photos are in', () => {
    s().startLoading()
    s().photosAdded(photos(3), [], 0)
    expect(s().status).toBe('ready')
    expect(s().step).toBe('setup')
    expect(s().book.photos).toHaveLength(3)
    expect(s().dirty).toBe(true)
  })

  it('stays on Import and explains when nothing could be read', () => {
    s().startLoading()
    s().photosAdded([], ['a.heic — HEIC is not supported'], 0)
    expect(s().status).toBe('empty')
    expect(s().step).toBe('import')
    expect(s().loadErrors).toEqual(['a.heic — HEIC is not supported', 'No photos could be read.'])
  })

  it('says how many duplicates were skipped', () => {
    s().photosAdded(photos(2), [], 0)
    s().photosAdded([photo(1), photo(5)], [], 3)
    expect(s().book.photos).toHaveLength(3)
    expect(s().notice).toBe('4 photos were already in the book.')
  })

  it('keeps the current step when photos are added later', () => {
    s().photosAdded(photos(2), [], 0)
    s().setStep('pages')
    s().photosAdded([photo(9)], [], 0)
    expect(s().step).toBe('pages')
  })
})

describe('history', () => {
  beforeEach(() => {
    s().photosAdded(photos(6), [], 0)
    s().buildPages()
  })

  it('undoes and redoes an edit', () => {
    const before = s().book
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: 9 } }))
    expect(s().book.style.gapMm).toBe(9)
    s().undo()
    expect(s().book).toBe(before)
    s().redo()
    expect(s().book.style.gapMm).toBe(9)
  })

  it('does not record a change that changes nothing', () => {
    const depth = s().past.length
    s().update((b) => b)
    expect(s().past).toHaveLength(depth)
  })

  it('forgets the redo branch after a new edit', () => {
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: 1 } }))
    s().undo()
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: 2 } }))
    expect(s().future).toEqual([])
  })

  it('keeps at most UNDO_LIMIT steps', () => {
    for (let i = 0; i < UNDO_LIMIT + 20; i++) s().update((b) => ({ ...b, style: { ...b.style, gapMm: (i % 10) + 0.5 } }))
    expect(s().past).toHaveLength(UNDO_LIMIT)
  })

  it('ignores undo and redo with nothing to do', () => {
    useBook.setState({ past: [], future: [] })
    const book = s().book
    s().undo()
    s().redo()
    expect(s().book).toBe(book)
  })

  it('merges quick slider moves into one step', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const depth = s().past.length
    s().updateCoalesced('gap', (b) => ({ ...b, style: { ...b.style, gapMm: 1 } }))
    vi.setSystemTime(1300)
    s().updateCoalesced('gap', (b) => ({ ...b, style: { ...b.style, gapMm: 2 } }))
    vi.setSystemTime(1600)
    s().updateCoalesced('gap', (b) => ({ ...b, style: { ...b.style, gapMm: 3 } }))
    expect(s().past).toHaveLength(depth + 1)
    vi.setSystemTime(5000)
    s().updateCoalesced('gap', (b) => ({ ...b, style: { ...b.style, gapMm: 4 } }))
    expect(s().past).toHaveLength(depth + 2)
    s().undo()
    expect(s().book.style.gapMm).toBe(3)
  })

  it('records a drag as one step, and nothing if it ends where it began', () => {
    const depth = s().past.length
    const start = s().book
    const wasDirty = s().dirty
    s().beginGesture()
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: 5 } }))
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: 6 } }))
    s().endGesture()
    expect(s().past).toHaveLength(depth + 1)
    s().undo()
    expect(s().book).toBe(start)

    s().beginGesture()
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: 7 } }))
    s().update(() => start)
    s().endGesture()
    expect(s().past).toHaveLength(depth)
    expect(s().dirty).toBe(wasDirty)
  })

  it('leaves a clean book clean after a gesture that changes nothing', () => {
    s().markSaved('D:\a.photobook')
    s().beginGesture()
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: 8 } }))
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: b.style.gapMm } }))
    s().endGesture()
    expect(s().dirty).toBe(true)
    s().markSaved('D:\a.photobook')
    s().beginGesture()
    s().endGesture()
    expect(s().dirty).toBe(false)
  })

  it('ignores undo and redo while a gesture is open', () => {
    const start = s().book
    const depth = s().past.length
    s().beginGesture()
    s().update((b) => ({ ...b, style: { ...b.style, gapMm: 5 } }))
    s().undo()
    s().redo()
    s().endGesture()
    expect(s().past).toHaveLength(depth + 1)
    expect(s().book.style.gapMm).toBe(5)
    s().undo()
    expect(s().book).toBe(start)
    s().redo()
    expect(s().book.style.gapMm).toBe(5)
  })

  it('keeps a coalesced edit inside a gesture as part of its one step', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const depth = s().past.length
    s().beginGesture()
    s().updateCoalesced('gap', (b) => ({ ...b, style: { ...b.style, gapMm: 1 } }))
    s().endGesture()
    expect(s().past).toHaveLength(depth + 1)
  })

  it('gives a coalesced edit right after a gesture its own step', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    s().beginGesture()
    s().updateCoalesced('gap', (b) => ({ ...b, style: { ...b.style, gapMm: 1 } }))
    s().endGesture()
    const depth = s().past.length
    vi.setSystemTime(1100)
    s().updateCoalesced('gap', (b) => ({ ...b, style: { ...b.style, gapMm: 2 } }))
    expect(s().past).toHaveLength(depth + 1)
    s().undo()
    expect(s().book.style.gapMm).toBe(1)
  })

  it('copes with a book that has no pages', () => {
    s().selectPage(1)
    s().update((b) => ({ ...b, pages: [] }))
    expect(s().selectedPage).toBe(0)
    expect(s().selectedFrame).toBeNull()
    s().undo()
    s().undo()
    expect(s().selectedFrame).toBeNull()
  })
})

describe('building pages', () => {
  it('builds pages and opens the first', () => {
    s().photosAdded(photos(10), [], 0)
    expect(s().buildPages()).toBe(true)
    expect(s().step).toBe('pages')
    expect(s().book.pages.length).toBe(4)
    expect(s().selectedPage).toBe(0)
  })

  it('shows why it cannot build', () => {
    s().photosAdded(photos(3), [], 0)
    s().update((b) => ({ ...b, pageCount: 20 }))
    expect(s().buildPages()).toBe(false)
    expect(s().fillError).toContain('cannot fill 20 pages')
    expect(s().step).toBe('setup')
  })

  it('makes a cover page when the cover is on', () => {
    s().photosAdded(photos(5), [], 0)
    s().update((b) => ({ ...b, cover: DEFAULT_COVER }))
    s().buildPages()
    expect(s().book.pages[0].layoutId).toBe('cover')
  })
})

describe('selection', () => {
  it('stays on a real page after the selected page is deleted', () => {
    s().photosAdded(photos(10), [], 0)
    s().buildPages()
    const last = s().book.pages.length - 1
    s().selectPage(last)
    s().selectFrame({ page: last, frame: 0 })
    s().update((b) => deletePage(b, last))
    expect(s().selectedPage).toBe(last - 1)
    expect(s().selectedFrame).toBeNull()
  })

  it('clamps a requested page', () => {
    s().photosAdded(photos(10), [], 0)
    s().buildPages()
    s().selectPage(99)
    expect(s().selectedPage).toBe(s().book.pages.length - 1)
    s().selectPage(-4)
    expect(s().selectedPage).toBe(0)
  })
})

describe('files', () => {
  it('marks a saved book clean and remembers the path', () => {
    s().photosAdded(photos(2), [], 0)
    s().markSaved('D:\\books\\a.photobook')
    expect(s().dirty).toBe(false)
    expect(s().filePath).toBe('D:\\books\\a.photobook')
  })

  it('opens a book on its pages, with missing photos noted', () => {
    const book = { ...newBook(), photos: photos(2), pages: [{ id: 'x', layoutId: '1-full', frames: [{ photoId: 'p1', crop: { cx: 0.5, cy: 0.5, zoom: 1 } }] }] }
    s().opened(book, 'D:\\a.photobook', ['p2'], false)
    expect(s().step).toBe('pages')
    expect(s().missing).toEqual(['p2'])
    expect(s().past).toEqual([])
    expect(s().dirty).toBe(false)
  })

  it('opens a book without pages on Setup', () => {
    s().opened({ ...newBook(), photos: photos(2) }, null, [], true)
    expect(s().step).toBe('setup')
    expect(s().dirty).toBe(true)
  })
})

describe('new customer', () => {
  it('keeps the shop settings and clears the job', () => {
    s().photosAdded(photos(4), [], 0)
    s().update((b) => ({ ...b, size: '8x10', paper: '8r', style: { marginMm: 0, gapMm: 2, color: '#000000' }, cover: { ...DEFAULT_COVER, title: 'Juan', font: 'greatvibes' } }))
    s().buildPages()
    s().reset()
    const b = s().book
    expect(b.photos).toEqual([])
    expect(b.pages).toEqual([])
    expect(b.size).toBe('8x10')
    expect(b.paper).toBe('8r')
    expect(b.style.color).toBe('#000000')
    expect(b.cover).toEqual({ ...DEFAULT_COVER, font: 'greatvibes' })
    expect(s().step).toBe('import')
    expect(s().past).toEqual([])
    expect(s().dirty).toBe(false)
    expect(s().filePath).toBeNull()
  })
})
