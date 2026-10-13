/**
 * The Photo Book job. The book itself is plain data (`lib/bookTypes.ts`);
 * every edit goes through `update`, which keeps the undo history. Talking to
 * Rust is left to `features/book/*`, so this file runs in Node tests.
 */

import { create } from 'zustand'

import { autoFill } from '../lib/autoFill'
import { addPhotos, pageMmOf, photoAspect } from '../lib/bookModel'
import { newBook, type Book, type BookPhoto } from '../lib/bookTypes'

export type BookStep = 'import' | 'setup' | 'pages' | 'print'
export const BOOK_STEPS: BookStep[] = ['import', 'setup', 'pages', 'print']
export const BOOK_STEP_LABELS: Record<BookStep, string> = {
  import: 'Import',
  setup: 'Setup',
  pages: 'Pages',
  print: 'Print & Export',
}

export const UNDO_LIMIT = 50
/** Slider moves closer together than this are one undo step. */
export const COALESCE_MS = 800

export interface FrameSelection {
  page: number
  frame: number
}

export interface BookState {
  step: BookStep
  status: 'empty' | 'loading' | 'ready'
  /** Bumped by reset() and opened() so an in-flight photo load can tell it is stale. */
  generation: number
  progress: { done: number; total: number } | null
  /** Files that could not be used, shown until dismissed. */
  loadErrors: string[]
  /** A one-line message, e.g. duplicates skipped. */
  notice: string | null
  book: Book
  /** Photos whose file is not where the book says. */
  missing: string[]
  past: Book[]
  future: Book[]
  dirty: boolean
  filePath: string | null
  selectedPage: number
  selectedFrame: FrameSelection | null
  fillError: string | null

  coalesceKey: string | null
  coalesceAt: number
  gestureStart: Book | null
  gestureDirty: boolean

  setStep: (step: BookStep) => void
  startLoading: () => void
  setProgress: (progress: { done: number; total: number } | null) => void
  photosAdded: (photos: BookPhoto[], errors: string[], duplicates: number) => void
  loadFailed: (message: string) => void
  dismissLoadErrors: () => void
  update: (change: (book: Book) => Book) => void
  updateCoalesced: (key: string, change: (book: Book) => Book) => void
  beginGesture: () => void
  endGesture: () => void
  undo: () => void
  redo: () => void
  selectPage: (index: number) => void
  selectFrame: (selection: FrameSelection | null) => void
  buildPages: () => boolean
  opened: (book: Book, path: string | null, missing: string[], dirty: boolean) => void
  setMissing: (ids: string[]) => void
  markSaved: (path: string) => void
  /** Remember where the book was written without touching the unsaved flag. */
  setFilePath: (path: string) => void
  /** Point photos at new files everywhere (book and undo history); not an undo step. */
  relinkPaths: (paths: Record<string, string>, missing: string[]) => void
  reset: () => void
}

function clampSelection(book: Book, page: number, frame: FrameSelection | null) {
  const selectedPage = Math.max(0, Math.min(book.pages.length - 1, page))
  const valid = frame && frame.page === selectedPage && frame.frame < (book.pages[selectedPage]?.frames.length ?? 0)
  return { selectedPage, selectedFrame: valid ? frame : null }
}

export const useBook = create<BookState>((set, get) => ({
  step: 'import',
  status: 'empty',
  generation: 0,
  progress: null,
  loadErrors: [],
  notice: null,
  book: newBook(),
  missing: [],
  past: [],
  future: [],
  dirty: false,
  filePath: null,
  selectedPage: 0,
  selectedFrame: null,
  fillError: null,
  coalesceKey: null,
  coalesceAt: 0,
  gestureStart: null,
  gestureDirty: false,

  setStep: (step) => set({ step }),
  startLoading: () => set({ status: 'loading', progress: null, loadErrors: [], notice: null }),
  setProgress: (progress) => set({ progress }),

  photosAdded: (photos, errors, duplicates) => {
    const s = get()
    const result = addPhotos(s.book, photos)
    const skipped = duplicates + result.duplicates
    const notice = skipped > 0 ? `${skipped} photo${skipped === 1 ? ' was' : 's were'} already in the book.` : null
    if (result.book.photos.length === 0) {
      set({ status: 'empty', progress: null, loadErrors: [...errors, 'No photos could be read.'], notice })
      return
    }
    set({
      book: result.book,
      status: 'ready',
      progress: null,
      loadErrors: errors,
      notice,
      dirty: s.dirty || result.added > 0,
      step: s.step === 'import' ? 'setup' : s.step,
    })
  },

  loadFailed: (message) =>
    set((s) => ({ status: s.book.photos.length ? 'ready' : 'empty', progress: null, loadErrors: [message] })),
  dismissLoadErrors: () => set({ loadErrors: [], notice: null }),

  update: (change) => {
    const s = get()
    const next = change(s.book)
    if (next === s.book) return
    const history = s.gestureStart ? {} : { past: [...s.past, s.book].slice(-UNDO_LIMIT), future: [] }
    set({
      book: next,
      ...history,
      dirty: true,
      coalesceKey: null,
      ...clampSelection(next, s.selectedPage, s.selectedFrame),
    })
  },

  updateCoalesced: (key, change) => {
    const s = get()
    const now = Date.now()
    if (s.coalesceKey === key && now - s.coalesceAt < COALESCE_MS) {
      const next = change(s.book)
      if (next !== s.book) set({ book: next, dirty: true, coalesceAt: now })
      return
    }
    s.update(change)
    if (!get().gestureStart) set({ coalesceKey: key, coalesceAt: now })
  },

  beginGesture: () => set((s) => ({ gestureStart: s.book, gestureDirty: s.dirty, coalesceKey: null })),
  endGesture: () => {
    const { gestureStart: start, gestureDirty, book, past } = get()
    if (!start) return
    const changed = start !== book && JSON.stringify(start) !== JSON.stringify(book)
    set(
      changed
        ? { gestureStart: null, coalesceKey: null, past: [...past, start].slice(-UNDO_LIMIT), future: [] }
        : { gestureStart: null, coalesceKey: null, book: start, dirty: gestureDirty },
    )
  },

  undo: () => {
    const s = get()
    if (s.gestureStart) return
    const previous = s.past[s.past.length - 1]
    if (!previous) return
    set({
      book: previous,
      past: s.past.slice(0, -1),
      future: [s.book, ...s.future],
      dirty: true,
      coalesceKey: null,
      ...clampSelection(previous, s.selectedPage, s.selectedFrame),
    })
  },

  redo: () => {
    const s = get()
    if (s.gestureStart) return
    const next = s.future[0]
    if (!next) return
    set({
      book: next,
      past: [...s.past, s.book].slice(-UNDO_LIMIT),
      future: s.future.slice(1),
      dirty: true,
      coalesceKey: null,
      ...clampSelection(next, s.selectedPage, s.selectedFrame),
    })
  },

  selectPage: (index) => set((s) => clampSelection(s.book, index, null)),
  selectFrame: (selectedFrame) => set({ selectedFrame }),

  buildPages: () => {
    const { book } = get()
    const result = autoFill(
      book.photos.map((p) => ({ id: p.id, aspect: photoAspect(p), face: p.face })),
      { pageCount: book.pageCount, cover: book.cover !== null, page: pageMmOf(book), style: book.style },
    )
    if (!result.ok) {
      set({ fillError: result.message })
      return false
    }
    get().update((b) => ({ ...b, pages: result.pages }))
    set({ fillError: null, selectedPage: 0, selectedFrame: null, step: 'pages' })
    return true
  },

  opened: (book, filePath, missing, dirty) =>
    set((st) => ({
      generation: st.generation + 1,
      book,
      filePath,
      missing,
      dirty,
      past: [],
      future: [],
      status: 'ready',
      progress: null,
      loadErrors: [],
      notice: null,
      fillError: null,
      gestureStart: null,
      coalesceKey: null,
      selectedPage: 0,
      selectedFrame: null,
      step: book.pages.length ? 'pages' : 'setup',
    })),

  setMissing: (missing) => set({ missing }),
  markSaved: (filePath) => set({ filePath, dirty: false }),
  setFilePath: (filePath) => set({ filePath }),
  relinkPaths: (paths, missing) => {
    const apply = (b: Book): Book =>
      b.photos.some((p) => paths[p.id])
        ? { ...b, photos: b.photos.map((p) => (paths[p.id] ? { ...p, path: paths[p.id] } : p)) }
        : b
    set((s) => ({
      book: apply(s.book),
      past: s.past.map(apply),
      future: s.future.map(apply),
      gestureStart: s.gestureStart ? apply(s.gestureStart) : null,
      missing,
      dirty: true,
    }))
  },

  reset: () => {
    const { book } = get()
    const fresh = newBook()
    set({
      book: {
        ...fresh,
        size: book.size,
        orientation: book.orientation,
        paper: book.paper,
        customPaper: book.customPaper,
        style: book.style,
        pageCount: book.pageCount,
        cover: book.cover ? { ...book.cover, title: '', subtitle: '' } : null,
      },
      step: 'import',
      status: 'empty',
      generation: get().generation + 1,
      progress: null,
      loadErrors: [],
      notice: null,
      missing: [],
      past: [],
      future: [],
      dirty: false,
      filePath: null,
      selectedPage: 0,
      selectedFrame: null,
      fillError: null,
      coalesceKey: null,
      gestureStart: null,
    })
  },
}))
