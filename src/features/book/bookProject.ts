/**
 * Saving and reopening books. Photos are referenced by path; a book opened
 * after its folder moved offers to find the photos by name.
 */

import { useEffect } from 'react'
import { ask, open as openDialog, save } from '@tauri-apps/plugin-dialog'

import { BOOK_FILE_EXTENSION, fileNameOf, parseBook, relinkPhotos, serializeBook } from '../../lib/bookFile'
import type { Book } from '../../lib/bookTypes'
import {
  asAppError,
  bookAddPhotos,
  bookAutosaveClear,
  bookAutosaveWrite,
  bookClear,
  bookFindInFolder,
  bookReadProject,
  bookWriteProject,
} from '../../lib/tauri'
import { useBook } from '../../store/book'
import { clearThumbCache } from './bookPaint'

export const AUTOSAVE_MS = 30_000

export function suggestedFileName(book: Book): string {
  const base = (book.cover?.title ?? '').replace(/[\\/:*?"<>|]+/g, '').trim()
  return `${base || 'photo-book'}.${BOOK_FILE_EXTENSION}`
}

export async function saveBook(saveAs = false): Promise<boolean> {
  const s = useBook.getState()
  let path = s.filePath
  if (!path || saveAs) {
    const chosen = await save({ defaultPath: suggestedFileName(s.book), filters: [{ name: 'Photo book', extensions: [BOOK_FILE_EXTENSION] }] })
    if (!chosen) return false
    path = chosen.toLowerCase().endsWith(`.${BOOK_FILE_EXTENSION}`) ? chosen : `${chosen}.${BOOK_FILE_EXTENSION}`
  }
  const book = useBook.getState().book
  await bookWriteProject(path, serializeBook(book))
  // Only mark clean if nothing changed while writing.
  if (useBook.getState().book === book) useBook.getState().markSaved(path)
  void bookAutosaveClear().catch(() => {})
  return true
}

/** Load thumbnails for these photos; returns the ids that could not be read. */
async function loadThumbnails(book: Book, ids?: Set<string>): Promise<string[]> {
  const photos = book.photos.filter((p) => !ids || ids.has(p.id))
  if (photos.length === 0) return []
  const infos = await bookAddPhotos(photos.map((p) => ({ id: p.id, path: p.path })))
  return infos.filter((i) => i.error).map((i) => i.id)
}

async function relink(book: Book, missing: string[]): Promise<{ book: Book; missing: string[]; changed: boolean }> {
  const folder = await openDialog({ directory: true, title: 'Find the folder with the photos' })
  if (typeof folder !== 'string') return { book, missing, changed: false }
  const names = book.photos.filter((p) => missing.includes(p.id)).map((p) => fileNameOf(p.path))
  const found = await bookFindInFolder(folder, names)
  const result = relinkPhotos(book, found, missing)
  if (result.relinked.length === 0) return { book, missing, changed: false }
  const failed = await loadThumbnails(result.book, new Set(result.relinked))
  return { book: result.book, missing: [...result.stillMissing, ...failed], changed: true }
}

/** Open a book's text; resolves to an error message, or null when opened. */
export async function openBookText(text: string, path: string | null, dirty: boolean): Promise<string | null> {
  if (useBook.getState().status === 'loading') return 'Photos are still loading.'
  const parsed = parseBook(text)
  if (!parsed.ok) return parsed.message
  let book = parsed.book
  useBook.getState().startLoading()
  try {
    await bookClear()
    clearThumbCache()
    let missing = await loadThumbnails(book)
    let changed = false
    if (missing.length > 0) {
      const locate = await ask(`${missing.length} of ${book.photos.length} photos are not where this book was saved. Find the photo folder?`, {
        title: 'Photos moved',
        kind: 'warning',
        okLabel: 'Find folder',
        cancelLabel: 'Open without them',
      })
      if (locate) ({ book, missing, changed } = await relink(book, missing))
    }
    useBook.getState().opened(book, path, missing, dirty || changed)
    return null
  } catch (error) {
    useBook.getState().loadFailed(asAppError(error).message)
    return asAppError(error).message
  }
}

export async function openBookDialog(): Promise<string | null> {
  const path = await openDialog({ multiple: false, filters: [{ name: 'Photo book', extensions: [BOOK_FILE_EXTENSION] }] })
  if (typeof path !== 'string') return null
  try {
    return await openBookText(await bookReadProject(path), path, false)
  } catch (error) {
    return asAppError(error).message
  }
}

/** Relink the photos still missing in the open book. */
export async function locateMissing(): Promise<string | null> {
  const { book, missing } = useBook.getState()
  if (missing.length === 0) return null
  try {
    const result = await relink(book, missing)
    if (result.changed) {
      useBook.getState().update(() => result.book)
      useBook.getState().setMissing(result.missing)
    }
    return result.changed ? null : 'None of the missing photos were found in that folder.'
  } catch (error) {
    return asAppError(error).message
  }
}

/** Every 30 s, keep a copy of an unsaved book where a crash cannot lose it. */
export function useBookAutosave(): void {
  useEffect(() => {
    let last: Book | null = null
    const timer = window.setInterval(() => {
      const { dirty, book } = useBook.getState()
      if (!dirty || book === last || book.photos.length === 0) return
      last = book
      void bookAutosaveWrite(serializeBook(book)).catch(() => {})
    }, AUTOSAVE_MS)
    return () => window.clearInterval(timer)
  }, [])
}
