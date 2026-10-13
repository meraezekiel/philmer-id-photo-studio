/**
 * Every change the operator makes to a book, as a pure function. Each returns
 * the same object when it would change nothing, so the store can tell a real
 * edit (which goes on the undo stack) from a no-op.
 */

import { CENTRED, initialCrop, normaliseCrop } from './bookCrop'
import { layoutById, rectAspect, resolveFrames } from './bookLayouts'
import { pageSizeMm } from './bookSizes'
import type { Book, BookCover, BookPage, BookPhoto, Crop, SizeMm } from './bookTypes'
import type { EnhanceSettings } from './enhance'

export interface FrameRef {
  page: number
  frame: number
}

export function newPageId(): string {
  return `pg-${crypto.randomUUID()}`
}

export function pageMmOf(book: Book): SizeMm {
  return pageSizeMm(book.size, book.orientation)
}

export function photoAspect(photo: BookPhoto): number {
  return photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1
}

const photoById = (book: Book, id: string | null) => (id ? book.photos.find((p) => p.id === id) : undefined)

function validRef(book: Book, ref: FrameRef): boolean {
  const page = book.pages[ref.page]
  return Boolean(page) && ref.frame >= 0 && ref.frame < page.frames.length
}

/** The shape the photo in this frame is cropped to; null for a bad reference. */
export function frameAspect(book: Book, ref: FrameRef, photo?: BookPhoto): number | null {
  const page = book.pages[ref.page]
  const layout = page && layoutById(page.layoutId)
  if (!layout || !layout.frames[ref.frame]) return null
  if (layout.frames[ref.frame].fit === 'photo') return photo ? photoAspect(photo) : 1
  return rectAspect(resolveFrames(layout, pageMmOf(book), book.style)[ref.frame])
}

export function freshCrop(book: Book, ref: FrameRef, photoId: string | null): Crop {
  const photo = photoById(book, photoId)
  const aspect = frameAspect(book, ref, photo)
  if (!photo || aspect === null) return CENTRED
  return initialCrop(photoAspect(photo), aspect, photo.face)
}

function replacePage(book: Book, index: number, page: BookPage): Book {
  const pages = book.pages.slice()
  pages[index] = page
  return { ...book, pages }
}

function withFrame(book: Book, ref: FrameRef, photoId: string | null): Book {
  const page = book.pages[ref.page]
  const frames = page.frames.slice()
  frames[ref.frame] = { photoId, crop: freshCrop(book, ref, photoId) }
  return replacePage(book, ref.page, { ...page, frames })
}

export function usedPhotoIds(book: Book): Set<string> {
  const used = new Set<string>()
  for (const page of book.pages) for (const frame of page.frames) if (frame.photoId) used.add(frame.photoId)
  return used
}

export function unusedPhotos(book: Book): BookPhoto[] {
  const used = usedPhotoIds(book)
  return book.photos.filter((p) => !used.has(p.id))
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Dated photos by time taken, then undated ones by file name. */
export function sortPhotos(photos: BookPhoto[]): BookPhoto[] {
  return photos.slice().sort((a, b) => {
    if (a.takenAt && b.takenAt && a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? -1 : 1
    if (a.takenAt && !b.takenAt) return -1
    if (!a.takenAt && b.takenAt) return 1
    return byName.compare(a.name, b.name)
  })
}

export function addPhotos(book: Book, photos: BookPhoto[]): { book: Book; added: number; duplicates: number } {
  const seen = new Set(book.photos.map((p) => p.path.toLowerCase()))
  const fresh: BookPhoto[] = []
  for (const p of photos) {
    const key = p.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    fresh.push(p)
  }
  const duplicates = photos.length - fresh.length
  if (fresh.length === 0) return { book, added: 0, duplicates }
  return { book: { ...book, photos: sortPhotos([...book.photos, ...fresh]) }, added: fresh.length, duplicates }
}

export function removePhoto(book: Book, id: string): Book {
  if (!book.photos.some((p) => p.id === id)) return book
  return {
    ...book,
    photos: book.photos.filter((p) => p.id !== id),
    pages: book.pages.map((page) =>
      page.frames.some((f) => f.photoId === id)
        ? { ...page, frames: page.frames.map((f) => (f.photoId === id ? { photoId: null, crop: CENTRED } : f)) }
        : page,
    ),
  }
}

export function setPageLayout(book: Book, pageIndex: number, layoutId: string): Book {
  const page = book.pages[pageIndex]
  const layout = layoutById(layoutId)
  if (!page || !layout || layout.cover || page.layoutId === 'cover' || page.layoutId === layoutId) return book
  const photos = page.frames.map((f) => f.photoId).filter((id): id is string => id !== null)
  let next = replacePage(book, pageIndex, {
    ...page,
    layoutId,
    frames: layout.frames.map(() => ({ photoId: null, crop: CENTRED })),
  })
  layout.frames.forEach((_, frame) => {
    const id = photos[frame] ?? null
    if (id) next = withFrame(next, { page: pageIndex, frame }, id)
  })
  return next
}

export function swapFrames(book: Book, a: FrameRef, b: FrameRef): Book {
  if (!validRef(book, a) || !validRef(book, b)) return book
  if (a.page === b.page && a.frame === b.frame) return book
  const first = book.pages[a.page].frames[a.frame].photoId
  const second = book.pages[b.page].frames[b.frame].photoId
  if (first === second) return book
  return withFrame(withFrame(book, a, second), b, first)
}

export function placePhoto(book: Book, target: FrameRef, photoId: string): Book {
  if (!validRef(book, target) || !photoById(book, photoId)) return book
  for (let page = 0; page < book.pages.length; page++) {
    const frame = book.pages[page].frames.findIndex((f) => f.photoId === photoId)
    if (frame >= 0) return swapFrames(book, { page, frame }, target)
  }
  return withFrame(book, target, photoId)
}

export function clearFrame(book: Book, ref: FrameRef): Book {
  if (!validRef(book, ref) || book.pages[ref.page].frames[ref.frame].photoId === null) return book
  return withFrame(book, ref, null)
}

export function setCrop(book: Book, ref: FrameRef, crop: Crop): Book {
  if (!validRef(book, ref)) return book
  const frame = book.pages[ref.page].frames[ref.frame]
  const photo = photoById(book, frame.photoId)
  const aspect = frameAspect(book, ref, photo)
  if (!photo || aspect === null) return book
  const next = normaliseCrop(photoAspect(photo), aspect, crop)
  if (next.cx === frame.crop.cx && next.cy === frame.crop.cy && next.zoom === frame.crop.zoom) return book
  const page = book.pages[ref.page]
  const frames = page.frames.slice()
  frames[ref.frame] = { ...frame, crop: next }
  return replacePage(book, ref.page, { ...page, frames })
}

/** The first index a non-cover page may occupy. */
export function firstPageIndex(book: Book): number {
  return book.pages[0]?.layoutId === 'cover' ? 1 : 0
}

export function addPage(book: Book, afterIndex: number, layoutId = '1-full'): { book: Book; index: number } {
  const layout = layoutById(layoutId)
  if (!layout || layout.cover) return { book, index: afterIndex }
  const index = Math.min(book.pages.length, Math.max(firstPageIndex(book), afterIndex + 1))
  const page: BookPage = { id: newPageId(), layoutId, frames: layout.frames.map(() => ({ photoId: null, crop: CENTRED })) }
  const pages = book.pages.slice()
  pages.splice(index, 0, page)
  return { book: { ...book, pages }, index }
}

export function duplicatePage(book: Book, index: number): Book {
  const page = book.pages[index]
  if (!page || page.layoutId === 'cover') return book
  const pages = book.pages.slice()
  pages.splice(index + 1, 0, { ...page, id: newPageId(), frames: page.frames.map((f) => ({ ...f })) })
  return { ...book, pages }
}

export function deletePage(book: Book, index: number): Book {
  const page = book.pages[index]
  if (!page || page.layoutId === 'cover') return book
  return { ...book, pages: book.pages.filter((_, i) => i !== index) }
}

export function movePage(book: Book, from: number, to: number): Book {
  const first = firstPageIndex(book)
  if (from < first || from >= book.pages.length) return book
  const target = Math.min(book.pages.length - 1, Math.max(first, to))
  if (target === from) return book
  const pages = book.pages.slice()
  const [page] = pages.splice(from, 1)
  pages.splice(target, 0, page)
  return { ...book, pages }
}

export function setCover(book: Book, cover: BookCover | null): Book {
  if (cover === null) {
    if (!book.cover) return book
    return { ...book, cover: null, pages: book.pages[0]?.layoutId === 'cover' ? book.pages.slice(1) : book.pages }
  }
  if (book.cover || book.pages.length === 0) return { ...book, cover }
  const first = unusedPhotos(book)[0] ?? null
  const withPage: Book = {
    ...book,
    cover,
    pages: [{ id: newPageId(), layoutId: 'cover', frames: [{ photoId: null, crop: CENTRED }] }, ...book.pages],
  }
  return first ? withFrame(withPage, { page: 0, frame: 0 }, first.id) : withPage
}

export function setPhotoEnhance(book: Book, photoId: string, patch: EnhanceSettings): Book {
  if (!book.photos.some((p) => p.id === photoId)) return book
  return { ...book, photos: book.photos.map((p) => (p.id === photoId ? { ...p, enhance: { ...p.enhance, ...patch } } : p)) }
}

export function setEnhanceAll(book: Book, byId: Record<string, Required<EnhanceSettings>>): Book {
  return { ...book, photos: book.photos.map((p) => (byId[p.id] ? { ...p, enhance: byId[p.id] } : p)) }
}
