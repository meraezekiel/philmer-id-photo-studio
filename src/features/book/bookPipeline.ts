/**
 * Getting photos into the book: expand dropped folders, make thumbnails in
 * Rust, and report what could not be used.
 */

import { pageMmOf } from '../../lib/bookModel'
import { planSheets, type SheetPlan } from '../../lib/bookSheets'
import { isEdgeToEdge, type Book, type BookPhoto, type SizeMm } from '../../lib/bookTypes'
import { editPaper } from '../../lib/editPaper'
import { NEUTRAL_ENHANCE } from '../../lib/enhance'
import { asAppError, bookAddPhotos, bookExpandPaths, type BookPhotoInfo } from '../../lib/tauri'
import { useBook } from '../../store/book'

export function newPhotoId(): string {
  return `ph-${crypto.randomUUID()}`
}

export function toBookPhoto(info: BookPhotoInfo): BookPhoto {
  return {
    id: info.id,
    path: info.path,
    name: info.name,
    width: info.width,
    height: info.height,
    takenAt: info.takenAt,
    face: info.face,
    enhance: NEUTRAL_ENHANCE,
  }
}

export function paperMmOf(book: Book): SizeMm {
  const p = editPaper(book.paper, book.customPaper)
  return { widthMm: p.widthMm, heightMm: p.heightMm }
}

export function bookPlan(book: Book): SheetPlan {
  return planSheets(pageMmOf(book), paperMmOf(book), isEdgeToEdge(book.style))
}

export async function loadBookPhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const store = useBook.getState()
  store.startLoading()
  try {
    const { files, skipped } = await bookExpandPaths(paths)
    const known = new Set(useBook.getState().book.photos.map((p) => p.path.toLowerCase()))
    const fresh = files.filter((f) => !known.has(f.toLowerCase()))
    const infos = fresh.length ? await bookAddPhotos(fresh.map((path) => ({ id: newPhotoId(), path }))) : []
    const errors = [
      ...skipped.map((name) => `${name}: not a photo the app can open (use JPG, PNG, WebP or BMP)`),
      ...infos.filter((i) => i.error).map((i) => `${i.name}: ${i.error}`),
    ]
    useBook.getState().photosAdded(infos.filter((i) => !i.error).map(toBookPhoto), errors, files.length - fresh.length)
  } catch (error) {
    useBook.getState().loadFailed(asAppError(error).message)
  }
}
