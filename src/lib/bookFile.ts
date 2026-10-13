/**
 * The `.photobook` file: the book as JSON, photos referenced by path. Opening
 * is lenient with settings (a bad value falls back to the default) and strict
 * about structure (no photo or page lists means it is not a book).
 */

import { CENTRED, MAX_ZOOM } from './bookCrop'
import { layoutById, layoutsFor } from './bookLayouts'
import { BOOK_SIZES, type BookOrientation, type BookSizeId } from './bookSizes'
import {
  BOOK_VERSION,
  clampStyle,
  newBook,
  WHITE_BORDER,
  type Book,
  type BookCover,
  type BookFont,
  type BookFrame,
  type BookPage,
  type BookPhoto,
  type Crop,
  type NormRect,
} from './bookTypes'
import { CUSTOM_PAPER_MAX_MM, CUSTOM_PAPER_MIN_MM, EDIT_PAPER_CHOICES, type EditPaperChoice } from './editPaper'
import { NEUTRAL_ENHANCE, type EnhanceSettings } from './enhance'

export const BOOK_FILE_EXTENSION = 'photobook'
const MARKER = 'philmer-photo-book'

const NOT_A_BOOK = 'This file is not a photo book.'
const NEWER = 'This book was saved by a newer version of the app. Update the app to open it.'
const DAMAGED = 'This photo book is damaged and cannot be opened.'

export type ParseResult = { ok: true; book: Book } | { ok: false; message: string }

type Raw = Record<string, unknown>
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const HEX = /^#[0-9a-f]{6}$/i

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function serializeBook(book: Book): string {
  return JSON.stringify({ app: MARKER, ...book }, null, 2)
}

function parseRect(v: unknown): NormRect | null {
  if (!isObject(v)) return null
  const r = { x: num(v.x, -1), y: num(v.y, -1), w: num(v.w, -1), h: num(v.h, -1) }
  return r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9 ? r : null
}

function parseEnhance(v: unknown): Required<EnhanceSettings> {
  const raw = isObject(v) ? v : {}
  const out = { ...NEUTRAL_ENHANCE }
  for (const key of Object.keys(out) as (keyof EnhanceSettings)[]) {
    const limit = key === 'sharpness' ? [0, 50] : [-50, 50]
    out[key] = Math.min(limit[1], Math.max(limit[0], num(raw[key], 0)))
  }
  return out
}

function parsePhoto(v: unknown): BookPhoto | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.path !== 'string') return null
  const width = num(v.width, 0)
  const height = num(v.height, 0)
  if (width <= 0 || height <= 0) return null
  return {
    id: v.id,
    path: v.path,
    name: str(v.name, fileNameOf(v.path)),
    width,
    height,
    takenAt: typeof v.takenAt === 'string' ? v.takenAt : null,
    face: parseRect(v.face),
    enhance: parseEnhance(v.enhance),
  }
}

function parseCrop(v: unknown): Crop {
  if (!isObject(v)) return CENTRED
  return {
    cx: Math.min(1, Math.max(0, num(v.cx, 0.5))),
    cy: Math.min(1, Math.max(0, num(v.cy, 0.5))),
    zoom: Math.min(MAX_ZOOM, Math.max(1, num(v.zoom, 1))),
  }
}

function parsePage(v: unknown, photoIds: Set<string>, index: number): BookPage | null {
  if (!isObject(v) || !Array.isArray(v.frames)) return null
  const rawFrames = v.frames
  let layout = layoutById(str(v.layoutId, ''))
  if (!layout) layout = layoutsFor(Math.min(6, Math.max(1, rawFrames.length)))[0] ?? layoutById('1-full')!
  const frames: BookFrame[] = layout.frames.map((_, i) => {
    const raw = rawFrames[i]
    if (!isObject(raw)) return { photoId: null, crop: CENTRED }
    const id = typeof raw.photoId === 'string' && photoIds.has(raw.photoId) ? raw.photoId : null
    return { photoId: id, crop: id ? parseCrop(raw.crop) : CENTRED }
  })
  return { id: str(v.id, `pg-restored-${index}`), layoutId: layout.id, frames }
}

function parseCover(v: unknown): BookCover | null {
  if (!isObject(v)) return null
  const fonts: BookFont[] = ['archivo', 'playfair', 'greatvibes']
  const positions = ['top', 'middle', 'bottom'] as const
  return {
    title: str(v.title, ''),
    subtitle: str(v.subtitle, ''),
    font: fonts.includes(v.font as BookFont) ? (v.font as BookFont) : 'playfair',
    textColor: typeof v.textColor === 'string' && HEX.test(v.textColor) ? v.textColor : '#FFFFFF',
    position: positions.includes(v.position as never) ? (v.position as BookCover['position']) : 'bottom',
  }
}

export function parseBook(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: NOT_A_BOOK }
  }
  if (!isObject(raw) || raw.app !== MARKER) return { ok: false, message: NOT_A_BOOK }
  if (typeof raw.version === 'number' && raw.version > BOOK_VERSION) return { ok: false, message: NEWER }
  if (raw.version !== BOOK_VERSION) return { ok: false, message: NOT_A_BOOK }
  if (!Array.isArray(raw.photos) || !Array.isArray(raw.pages)) return { ok: false, message: DAMAGED }

  const defaults = newBook()
  const photos = raw.photos.map(parsePhoto).filter((p): p is BookPhoto => p !== null)
  const ids = new Set(photos.map((p) => p.id))
  const cover = parseCover(raw.cover)
  let pages = raw.pages.map((p, i) => parsePage(p, ids, i)).filter((p): p is BookPage => p !== null)
  // Only page 0 may be the cover, and only while the cover is on.
  pages = pages.filter((p, i) => p.layoutId !== 'cover' || (i === 0 && cover))
  if (cover && pages[0]?.layoutId !== 'cover') {
    pages = [{ id: 'pg-restored-cover', layoutId: 'cover', frames: [{ photoId: null, crop: CENTRED }] }, ...pages]
  }

  const custom = isObject(raw.customPaper) ? raw.customPaper : {}
  const side = (v: unknown, fallback: number) => {
    const n = num(v, fallback)
    return n >= CUSTOM_PAPER_MIN_MM && n <= CUSTOM_PAPER_MAX_MM ? n : fallback
  }
  const style = isObject(raw.style)
    ? clampStyle({ marginMm: num(raw.style.marginMm, WHITE_BORDER.marginMm), gapMm: num(raw.style.gapMm, WHITE_BORDER.gapMm), color: str(raw.style.color, '#FFFFFF') })
    : WHITE_BORDER
  const pageCount = raw.pageCount === 'auto' ? 'auto' : Number.isInteger(raw.pageCount) && (raw.pageCount as number) >= 1 && (raw.pageCount as number) <= 500 ? (raw.pageCount as number) : 'auto'

  return {
    ok: true,
    book: {
      version: BOOK_VERSION,
      size: typeof raw.size === 'string' && Object.hasOwn(BOOK_SIZES, raw.size) ? (raw.size as BookSizeId) : defaults.size,
      orientation: raw.orientation === 'landscape' ? 'landscape' : ('portrait' as BookOrientation),
      paper: EDIT_PAPER_CHOICES.includes(raw.paper as EditPaperChoice) ? (raw.paper as EditPaperChoice) : defaults.paper,
      customPaper: { widthMm: side(custom.widthMm, defaults.customPaper.widthMm), heightMm: side(custom.heightMm, defaults.customPaper.heightMm) },
      style,
      pageCount,
      cover,
      photos,
      pages,
    },
  }
}

/** How many path segments match, counted from the file name back. */
function trailingMatch(a: string, b: string): number {
  const sa = a.toLowerCase().split(/[\\/]/)
  const sb = b.toLowerCase().split(/[\\/]/)
  let n = 0
  while (n < sa.length && n < sb.length && sa[sa.length - 1 - n] === sb[sb.length - 1 - n]) n++
  return n
}

/**
 * Point missing photos at files of the same name found in another folder.
 *
 * `found` lists every file with each (lower-cased) name. Two cameras both
 * shoot IMG_0001.JPG, so a photo takes the candidate whose folders best match
 * where it used to be. A tie, or a file another photo also wants or already
 * uses, leaves the photo missing: a wrong photo in a book is worse than a gap.
 */
export function relinkPhotos(
  book: Book,
  found: Record<string, string[]>,
  missingIds: string[],
): { book: Book; relinked: string[]; stillMissing: string[] } {
  const missing = new Set(missingIds)
  const taken = new Set(book.photos.filter((p) => !missing.has(p.id)).map((p) => p.path.toLowerCase()))
  const best = new Map<string, string>()
  const claims = new Map<string, number>()
  for (const p of book.photos) {
    if (!missing.has(p.id)) continue
    const name = fileNameOf(p.path).toLowerCase()
    const candidates = (Object.hasOwn(found, name) && Array.isArray(found[name]) ? found[name] : []).filter((c) => !taken.has(c.toLowerCase()))
    let top = 0
    let pick: string | null = null
    for (const c of candidates) {
      const score = trailingMatch(p.path, c)
      if (score > top) {
        top = score
        pick = c
      } else if (score === top) {
        pick = null
      }
    }
    if (!pick) continue
    best.set(p.id, pick)
    claims.set(pick.toLowerCase(), (claims.get(pick.toLowerCase()) ?? 0) + 1)
  }
  const relinked: string[] = []
  const photos = book.photos.map((p) => {
    const path = best.get(p.id)
    if (!path || claims.get(path.toLowerCase())! > 1) return p
    relinked.push(p.id)
    return { ...p, path }
  })
  return {
    book: relinked.length ? { ...book, photos } : book,
    relinked,
    stillMissing: missingIds.filter((id) => !relinked.includes(id)),
  }
}

/** What a relinked photo's new file says about itself. */
export interface PhotoFile {
  path: string
  width: number
  height: number
  takenAt: string | null
  face: NormRect | null
}

/** Update photos (by id) from their new files; edits such as enhance are kept. */
export function applyPhotoFiles(book: Book, files: Record<string, PhotoFile>): Book {
  const has = (id: string) => Object.hasOwn(files, id)
  if (!book.photos.some((p) => has(p.id))) return book
  return {
    ...book,
    photos: book.photos.map((p) => {
      if (!has(p.id)) return p
      const { path, width, height, takenAt, face } = files[p.id]
      return { ...p, path, width, height, takenAt, face }
    }),
  }
}

const AUTOSAVE_MARKER = 'philmer-photo-book-autosave'

/** The autosave keeps the book's file too, so Save after a restore goes back to it. */
export function autosaveText(book: Book, path: string | null): string {
  return JSON.stringify({ app: AUTOSAVE_MARKER, path, book: serializeBook(book) })
}

/** The book text and file of an autosave; an older autosave is the plain book. */
export function readAutosave(text: string): { text: string; path: string | null } {
  try {
    const raw: unknown = JSON.parse(text)
    if (isObject(raw) && raw.app === AUTOSAVE_MARKER && typeof raw.book === 'string') {
      return { text: raw.book, path: typeof raw.path === 'string' && raw.path ? raw.path : null }
    }
  } catch {
    // Not JSON: hand it on as it is and let opening say what is wrong.
  }
  return { text, path: null }
}
