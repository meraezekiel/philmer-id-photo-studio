# Photo Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third mode, *Photo Book*, that turns a batch of photos into
auto-filled, hand-adjustable book pages and prints them at true size, several
pages per sheet with cut marks, for manual cutting and binding.

**Architecture:** Pure TypeScript modules hold all geometry and book logic
(layouts, crops, auto-fill, page operations, sheet packing, save file) and are
unit-tested in Node. Rust keeps only file paths plus 1024 px JPEG thumbnails,
and on print returns each photo already cropped and resized to its frame. The
browser paints pages with the existing `enhance.ts`, and printing reuses the
existing GDI true-size path extended to several sheets per job.

**Tech Stack:** Tauri 2, Rust (`image`, `fast_image_resize`, `kamadak-exif`,
`rayon`), React 18, zustand 5, pdf-lib, Vitest 3, `@fontsource` fonts.

**Spec:** `docs/superpowers/specs/2026-10-13-photo-book-design.md`

## Global Constraints

- Operator-facing name **Photo Book**; code name `book` (`mode: 'id' | 'edit' | 'book'`, `src/features/book/`).
- Book sizes: `5x6` 127 x 152.4 mm, `5x7` 127 x 177.8 mm, `8x8` 203.2 x 203.2 mm, `8x10` 203.2 x 254 mm, `a4` 210 x 297 mm; portrait or landscape (8x8 square).
- Print papers: A4, 8R, Custom (reuse `editPaper.ts`).
- Single-sided printing only. Print resolution `PRINT_DPI` = 300.
- Thumbnails: 1024 px long edge, JPEG. Rust never keeps a full-size original for the book.
- Low-resolution warning below **200 DPI** at print size.
- Auto page count ≈ **2.5** photos per page; at most **6** photos per page; full-page photo every **5** pages; frame/photo aspect mismatch limit **1.6**.
- Edge-to-edge (margin 0) pages get **2 mm** bleed; cut marks the same faint grey as the ID sheet (0.62 grey, `CUT_MARK_WIDTH_MM`).
- Approval PDF: pages at **150 DPI** JPEG. Print PDF: sheets at 300 DPI. JPGs: one per page, 300 DPI stamped with `setJpegDpi`.
- Save file: `.photobook` JSON referencing photos by path; `version: 1`; autosave every **30 s** to the app data folder.
- Do not change the ID flow or Photo Print beyond the files listed in each task.
- No Python on this machine: use node or the editor for scripted edits.

## Spec amendments (decided while planning)

- A **5-photo** layout family is added (counts 1–6), so auto-fill can distribute any count without parity problems.
- Layout frames may be marked `fit: 'photo'`: the frame shrinks to the photo's shape and never crops ("Whole photo"). This guarantees a non-cropping choice for single photos of any shape.
- The cover is a page with `layoutId: 'cover'` that is always `pages[0]` while `book.cover` is set. The target page count counts **inside pages**; the cover is extra.
- Printing stages each rendered sheet as a temp JPEG and Rust prints them in **one** job by reading them one at a time (memory stays flat; no printer handle crosses IPC calls).
- Book project files are read and written by dedicated, **unlicensed** Rust commands (saving work is not "producing output"); exports and printing keep the licence gate.
- Fonts come from `@fontsource/playfair-display` and `@fontsource/great-vibes` (OFL, bundled by Vite, offline).

## Review Focus

1. **Phone photos with EXIF rotation** (portrait shots stored landscape + Orientation 6): thumbnail, reported width/height, crops and the printed crop must all be upright. Pinned by the Rust test `orientation_6_photo_is_upright_everywhere` (Task 9).
2. **The same photos dropped twice** (or the folder and its files): the book must not contain duplicates. Pinned by `addPhotos dedupes by path, ignoring case` (Task 5) and `expand_paths_dedupes_a_folder_and_its_file` (Task 9).
3. **Extreme margin/gap** (margin 20 mm and gap 10 mm on a 5x6 6-grid): no negative sizes, nothing outside the page, no crash in auto-fill or drawing. Pinned by `resolveFrames never returns negative or out-of-page frames` (Task 2) and `autoFill survives zero-size frames` (Task 4).
4. **Non-ASCII and spaced file names** ("Kasal ni Juan & María/IMG 001.JPG") when relinking a moved folder. Pinned by `find_in_folder_matches_unicode_names_ignoring_case` (Task 9) and `relinkPhotos matches names ignoring case` (Task 6).
5. **Changing book size after hand-editing crops**: every crop must stay inside the photo. Pinned by `crops stay inside the photo after the book size changes` (Task 8).

Known limitation, accepted: four landscape photos on a portrait page have no layout under the 1.6 limit; auto-fill then picks the least-cropping layout.

---

### Task 1: Book types and sizes

**Files:**
- Create: `src/lib/bookTypes.ts`
- Create: `src/lib/bookSizes.ts`
- Test: `src/lib/bookSizes.test.ts`

**Interfaces:**
- Produces: types `NormRect, RectMm, SizeMm, Crop, BookFrame, BookPage, BookPhoto, BookFont, CoverPosition, BookCover, BookStyle, PageCountTarget, Book`; constants `BOOK_VERSION, PAGE_COUNT_OPTIONS, STYLE_LIMITS, WHITE_BORDER, EDGE_TO_EDGE, DEFAULT_COVER`; `newBook(): Book`, `isEdgeToEdge(style): boolean`, `clampStyle(style): BookStyle`.
- Produces: `BookSizeId`, `BookOrientation`, `BOOK_SIZES`, `BOOK_SIZE_ORDER`, `BOOK_PAPER_CHOICES`, `isSquare(id)`, `pageSizeMm(id, orientation): SizeMm`.

- [ ] **Step 1: Write the failing test**

`src/lib/bookSizes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { BOOK_SIZE_ORDER, BOOK_SIZES, isSquare, pageSizeMm } from './bookSizes'
import { clampStyle, isEdgeToEdge, newBook, EDGE_TO_EDGE, WHITE_BORDER } from './bookTypes'

describe('book sizes', () => {
  it('stores every size portrait, short side first', () => {
    for (const id of BOOK_SIZE_ORDER) {
      expect(BOOK_SIZES[id].widthMm).toBeLessThanOrEqual(BOOK_SIZES[id].heightMm)
    }
  })

  it('gives the exact trim sizes the shop sells', () => {
    expect(pageSizeMm('5x6', 'portrait')).toEqual({ widthMm: 127, heightMm: 152.4 })
    expect(pageSizeMm('5x7', 'portrait')).toEqual({ widthMm: 127, heightMm: 177.8 })
    expect(pageSizeMm('8x10', 'portrait')).toEqual({ widthMm: 203.2, heightMm: 254 })
    expect(pageSizeMm('a4', 'portrait')).toEqual({ widthMm: 210, heightMm: 297 })
  })

  it('swaps the sides for landscape', () => {
    expect(pageSizeMm('5x6', 'landscape')).toEqual({ widthMm: 152.4, heightMm: 127 })
  })

  it('ignores orientation for the square book', () => {
    expect(isSquare('8x8')).toBe(true)
    expect(pageSizeMm('8x8', 'landscape')).toEqual({ widthMm: 203.2, heightMm: 203.2 })
  })
})

describe('book style', () => {
  it('treats a zero margin as edge to edge', () => {
    expect(isEdgeToEdge(EDGE_TO_EDGE)).toBe(true)
    expect(isEdgeToEdge(WHITE_BORDER)).toBe(false)
  })

  it('clamps typed values into range and repairs a bad colour', () => {
    expect(clampStyle({ marginMm: -4, gapMm: 99, color: 'red' })).toEqual({ marginMm: 0, gapMm: 10, color: '#FFFFFF' })
    expect(clampStyle({ marginMm: Number.NaN, gapMm: 2, color: '#f4efe6' })).toEqual({ marginMm: 0, gapMm: 2, color: '#f4efe6' })
  })

  it('starts a new book empty with the white-border style', () => {
    const book = newBook()
    expect(book.photos).toEqual([])
    expect(book.pages).toEqual([])
    expect(book.cover).toBeNull()
    expect(book.style).toEqual(WHITE_BORDER)
    expect(book.version).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookSizes.test.ts`
Expected: FAIL, cannot resolve `./bookSizes`.

- [ ] **Step 3: Write the implementation**

`src/lib/bookTypes.ts`:

```ts
/**
 * The photo book as plain data: exactly what a `.photobook` file holds.
 * Runtime state (thumbnails, load progress, undo) lives in the store.
 */

import type { EnhanceSettings } from './enhance'
import type { CustomPaper, EditPaperChoice } from './editPaper'
import type { BookOrientation, BookSizeId } from './bookSizes'
import { NEUTRAL_ENHANCE } from './enhance'

/** A rectangle in fractions (0..1) of a photo's width and height. */
export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

/** A rectangle in millimetres, origin at the page's top-left trim corner. */
export interface RectMm {
  x: number
  y: number
  w: number
  h: number
}

export interface SizeMm {
  widthMm: number
  heightMm: number
}

/** Which part of the photo a frame shows: centre (0..1) and zoom (1 = cover). */
export interface Crop {
  cx: number
  cy: number
  zoom: number
}

export interface BookFrame {
  photoId: string | null
  crop: Crop
}

export interface BookPage {
  id: string
  layoutId: string
  frames: BookFrame[]
}

export interface BookPhoto {
  id: string
  path: string
  /** File name, for the tray and for relinking a moved folder. */
  name: string
  /** Upright (EXIF-corrected) size of the original, in pixels. */
  width: number
  height: number
  /** ISO date from EXIF, or null. */
  takenAt: string | null
  /** Largest face, in fractions of the photo, or null. */
  face: NormRect | null
  enhance: Required<EnhanceSettings>
}

export type BookFont = 'archivo' | 'playfair' | 'greatvibes'
export type CoverPosition = 'top' | 'middle' | 'bottom'

export interface BookCover {
  title: string
  subtitle: string
  font: BookFont
  textColor: string
  position: CoverPosition
}

export interface BookStyle {
  marginMm: number
  gapMm: number
  color: string
}

/** Inside pages; the cover is extra. */
export type PageCountTarget = 'auto' | number

export interface Book {
  version: 1
  size: BookSizeId
  orientation: BookOrientation
  paper: EditPaperChoice
  customPaper: CustomPaper
  style: BookStyle
  pageCount: PageCountTarget
  cover: BookCover | null
  photos: BookPhoto[]
  pages: BookPage[]
}

export const BOOK_VERSION = 1
export const PAGE_COUNT_OPTIONS = [20, 30, 40, 50] as const
export const STYLE_LIMITS = { marginMm: [0, 20], gapMm: [0, 10] } as const

export const WHITE_BORDER: BookStyle = { marginMm: 6, gapMm: 3, color: '#FFFFFF' }
export const EDGE_TO_EDGE: BookStyle = { marginMm: 0, gapMm: 1.5, color: '#FFFFFF' }

export const DEFAULT_COVER: BookCover = {
  title: '',
  subtitle: '',
  font: 'playfair',
  textColor: '#FFFFFF',
  position: 'bottom',
}

export function isEdgeToEdge(style: BookStyle): boolean {
  return style.marginMm === 0
}

const HEX = /^#[0-9a-f]{6}$/i

function clampNumber(value: number, [min, max]: readonly [number, number]): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function clampStyle(style: BookStyle): BookStyle {
  return {
    marginMm: clampNumber(style.marginMm, STYLE_LIMITS.marginMm),
    gapMm: clampNumber(style.gapMm, STYLE_LIMITS.gapMm),
    color: HEX.test(style.color) ? style.color : '#FFFFFF',
  }
}

export function newBook(): Book {
  return {
    version: BOOK_VERSION,
    size: '5x6',
    orientation: 'portrait',
    paper: 'a4',
    customPaper: { widthMm: 210, heightMm: 297 },
    style: WHITE_BORDER,
    pageCount: 'auto',
    cover: null,
    photos: [],
    pages: [],
  }
}

export const NEUTRAL_PHOTO_ENHANCE: Required<EnhanceSettings> = NEUTRAL_ENHANCE
```

`src/lib/bookSizes.ts`:

```ts
/**
 * The finished page sizes the shop sells. Each book has one size; pages are
 * printed several to a sheet and trimmed (see bookSheets.ts).
 */

import type { EditPaperChoice } from './editPaper'
import type { SizeMm } from './bookTypes'

export type BookSizeId = '5x6' | '5x7' | '8x8' | '8x10' | 'a4'
export type BookOrientation = 'portrait' | 'landscape'

export interface BookSize {
  id: BookSizeId
  label: string
  sublabel: string
  /** Portrait: width is the short side. */
  widthMm: number
  heightMm: number
}

export const BOOK_SIZES: Record<BookSizeId, BookSize> = {
  '5x6': { id: '5x6', label: '5x6', sublabel: '127 x 152.4 mm - 5 x 6 in', widthMm: 127, heightMm: 152.4 },
  '5x7': { id: '5x7', label: '5x7', sublabel: '127 x 177.8 mm - 5 x 7 in', widthMm: 127, heightMm: 177.8 },
  '8x8': { id: '8x8', label: '8x8', sublabel: '203.2 x 203.2 mm - 8 x 8 in', widthMm: 203.2, heightMm: 203.2 },
  '8x10': { id: '8x10', label: '8x10', sublabel: '203.2 x 254 mm - 8 x 10 in', widthMm: 203.2, heightMm: 254 },
  a4: { id: 'a4', label: 'A4', sublabel: '210 x 297 mm', widthMm: 210, heightMm: 297 },
}

export const BOOK_SIZE_ORDER: BookSizeId[] = ['5x6', '5x7', '8x8', '8x10', 'a4']

/** The papers a book prints on. */
export const BOOK_PAPER_CHOICES: EditPaperChoice[] = ['a4', '8r', 'custom']

export function isSquare(id: BookSizeId): boolean {
  return BOOK_SIZES[id].widthMm === BOOK_SIZES[id].heightMm
}

export function pageSizeMm(id: BookSizeId, orientation: BookOrientation): SizeMm {
  const { widthMm, heightMm } = BOOK_SIZES[id]
  return orientation === 'landscape' ? { widthMm: heightMm, heightMm: widthMm } : { widthMm, heightMm }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookSizes.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookTypes.ts src/lib/bookSizes.ts src/lib/bookSizes.test.ts
git commit -m "Photo Book: book types and page sizes"
```

---

### Task 2: Layouts

**Files:**
- Create: `src/lib/bookLayouts.ts`
- Test: `src/lib/bookLayouts.test.ts`

**Interfaces:**
- Consumes: `RectMm, SizeMm, BookStyle` (Task 1).
- Produces: `LayoutFrame { x, y, w, h, fit?: 'photo' }`, `BookLayout { id, label, count, frames, cover?: true }`, `BOOK_LAYOUTS`, `layoutById(id): BookLayout | undefined`, `layoutsFor(count): BookLayout[]`, `resolveFrames(layout, page: SizeMm, style: Pick<BookStyle,'marginMm'|'gapMm'>): RectMm[]`, `fitRect(box: RectMm, aspect: number): RectMm`, `rectAspect(r: RectMm): number`.

- [ ] **Step 1: Write the failing test**

`src/lib/bookLayouts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { BOOK_LAYOUTS, fitRect, layoutById, layoutsFor, rectAspect, resolveFrames } from './bookLayouts'

const PAGE = { widthMm: 127, heightMm: 152.4 }
const area = (f: { w: number; h: number }) => f.w * f.h
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

describe('layout data', () => {
  it('has unique ids and a frame per photo', () => {
    expect(new Set(BOOK_LAYOUTS.map((l) => l.id)).size).toBe(BOOK_LAYOUTS.length)
    for (const layout of BOOK_LAYOUTS) expect(layout.frames.length).toBe(layout.count)
  })

  it('keeps every frame inside the page', () => {
    for (const layout of BOOK_LAYOUTS) {
      for (const f of layout.frames) {
        expect(f.x).toBeGreaterThanOrEqual(0)
        expect(f.y).toBeGreaterThanOrEqual(0)
        expect(f.x + f.w).toBeLessThanOrEqual(1 + 1e-9)
        expect(f.y + f.h).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  it('tiles the page exactly when no frame is a fit frame', () => {
    for (const layout of BOOK_LAYOUTS.filter((l) => l.frames.every((f) => !f.fit))) {
      const total = layout.frames.reduce((sum, f) => sum + area(f), 0)
      expect(total, layout.id).toBeCloseTo(1, 9)
      for (let i = 0; i < layout.frames.length; i++) {
        for (let j = i + 1; j < layout.frames.length; j++) {
          expect(overlap(layout.frames[i], layout.frames[j]), `${layout.id} ${i}/${j}`).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('offers at least one layout for 1 to 6 photos, never the cover', () => {
    for (let n = 1; n <= 6; n++) {
      expect(layoutsFor(n).length, `${n} photos`).toBeGreaterThan(0)
      expect(layoutsFor(n).some((l) => l.cover)).toBe(false)
    }
    expect(layoutsFor(7)).toEqual([])
  })

  it('looks layouts up by id', () => {
    expect(layoutById('2-side')?.count).toBe(2)
    expect(layoutById('cover')?.cover).toBe(true)
    expect(layoutById('nope')).toBeUndefined()
  })
})

describe('resolveFrames', () => {
  const style = { marginMm: 6, gapMm: 3 }

  it('puts exactly the gap between neighbours and the margin at the edges', () => {
    const [a, b] = resolveFrames(layoutById('2-side')!, PAGE, style)
    expect(a.x).toBeCloseTo(6)
    expect(b.x - (a.x + a.w)).toBeCloseTo(3)
    expect(b.x + b.w).toBeCloseTo(127 - 6)
    expect(a.y).toBeCloseTo(6)
    expect(a.h).toBeCloseTo(152.4 - 12)
  })

  it('touches the trim edge when the margin is zero', () => {
    const [full] = resolveFrames(layoutById('1-full')!, PAGE, { marginMm: 0, gapMm: 1.5 })
    expect(full).toEqual({ x: 0, y: 0, w: 127, h: 152.4 })
  })

  it('resolveFrames never returns negative or out-of-page frames', () => {
    for (const layout of BOOK_LAYOUTS) {
      for (const s of [{ marginMm: 20, gapMm: 10 }, { marginMm: 80, gapMm: 10 }, { marginMm: 0, gapMm: 0 }]) {
        for (const r of resolveFrames(layout, PAGE, s)) {
          expect(r.w).toBeGreaterThanOrEqual(0)
          expect(r.h).toBeGreaterThanOrEqual(0)
          expect(r.x).toBeGreaterThanOrEqual(0)
          expect(r.y).toBeGreaterThanOrEqual(0)
          expect(r.x + r.w).toBeLessThanOrEqual(PAGE.widthMm + 1e-9)
          expect(r.y + r.h).toBeLessThanOrEqual(PAGE.heightMm + 1e-9)
        }
      }
    }
  })
})

describe('fitRect', () => {
  it('fits a wide photo into a tall box, centred', () => {
    const r = fitRect({ x: 10, y: 10, w: 100, h: 200 }, 2)
    expect(r).toEqual({ x: 10, y: 85, w: 100, h: 50 })
  })

  it('fits a tall photo into a wide box, centred', () => {
    const r = fitRect({ x: 0, y: 0, w: 200, h: 100 }, 0.5)
    expect(r).toEqual({ x: 75, y: 0, w: 50, h: 100 })
  })

  it('returns the box for a bad aspect or an empty box', () => {
    const box = { x: 1, y: 2, w: 3, h: 4 }
    expect(fitRect(box, 0)).toEqual(box)
    expect(fitRect(box, Number.NaN)).toEqual(box)
    expect(fitRect({ x: 0, y: 0, w: 0, h: 5 }, 1)).toEqual({ x: 0, y: 0, w: 0, h: 5 })
  })

  it('measures aspect safely', () => {
    expect(rectAspect({ x: 0, y: 0, w: 20, h: 10 })).toBe(2)
    expect(rectAspect({ x: 0, y: 0, w: 20, h: 0 })).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookLayouts.test.ts`
Expected: FAIL, cannot resolve `./bookLayouts`.

- [ ] **Step 3: Write the implementation**

`src/lib/bookLayouts.ts`:

```ts
/**
 * Page layouts as data. Frames are fractions of the area inside the margins,
 * so one layout serves every book size, margin and gap; adding a layout is
 * one entry here.
 */

import type { BookStyle, RectMm, SizeMm } from './bookTypes'

export interface LayoutFrame {
  x: number
  y: number
  w: number
  h: number
  /** Shrink the frame to the photo's shape instead of cropping the photo. */
  fit?: 'photo'
}

export interface BookLayout {
  id: string
  label: string
  count: number
  frames: LayoutFrame[]
  cover?: true
}

const T = 1 / 3
const f = (x: number, y: number, w: number, h: number): LayoutFrame => ({ x, y, w, h })

export const BOOK_LAYOUTS: BookLayout[] = [
  { id: '1-full', label: 'Full page', count: 1, frames: [f(0, 0, 1, 1)] },
  { id: '1-framed', label: 'Whole photo', count: 1, frames: [{ x: 0.08, y: 0.08, w: 0.84, h: 0.84, fit: 'photo' }] },
  { id: '2-side', label: 'Side by side', count: 2, frames: [f(0, 0, 0.5, 1), f(0.5, 0, 0.5, 1)] },
  { id: '2-stack', label: 'Stacked', count: 2, frames: [f(0, 0, 1, 0.5), f(0, 0.5, 1, 0.5)] },
  { id: '2-big-left', label: 'Big + small', count: 2, frames: [f(0, 0, 0.62, 1), f(0.62, 0, 0.38, 1)] },
  { id: '2-big-top', label: 'Big + small, stacked', count: 2, frames: [f(0, 0, 1, 0.62), f(0, 0.62, 1, 0.38)] },
  { id: '3-big-left', label: 'Big left', count: 3, frames: [f(0, 0, 0.6, 1), f(0.6, 0, 0.4, 0.5), f(0.6, 0.5, 0.4, 0.5)] },
  { id: '3-big-right', label: 'Big right', count: 3, frames: [f(0.4, 0, 0.6, 1), f(0, 0, 0.4, 0.5), f(0, 0.5, 0.4, 0.5)] },
  { id: '3-big-top', label: 'Big top', count: 3, frames: [f(0, 0, 1, 0.6), f(0, 0.6, 0.5, 0.4), f(0.5, 0.6, 0.5, 0.4)] },
  { id: '3-row', label: 'Three across', count: 3, frames: [f(0, 0, T, 1), f(T, 0, T, 1), f(2 * T, 0, T, 1)] },
  { id: '3-stack', label: 'Three stacked', count: 3, frames: [f(0, 0, 1, T), f(0, T, 1, T), f(0, 2 * T, 1, T)] },
  { id: '4-grid', label: 'Grid of four', count: 4, frames: [f(0, 0, 0.5, 0.5), f(0.5, 0, 0.5, 0.5), f(0, 0.5, 0.5, 0.5), f(0.5, 0.5, 0.5, 0.5)] },
  { id: '4-big-top', label: 'Big top + three', count: 4, frames: [f(0, 0, 1, 0.6), f(0, 0.6, T, 0.4), f(T, 0.6, T, 0.4), f(2 * T, 0.6, T, 0.4)] },
  { id: '4-big-left', label: 'Big left + three', count: 4, frames: [f(0, 0, 0.6, 1), f(0.6, 0, 0.4, T), f(0.6, T, 0.4, T), f(0.6, 2 * T, 0.4, T)] },
  { id: '5-mosaic', label: 'Two over three', count: 5, frames: [f(0, 0, 0.5, 0.5), f(0.5, 0, 0.5, 0.5), f(0, 0.5, T, 0.5), f(T, 0.5, T, 0.5), f(2 * T, 0.5, T, 0.5)] },
  { id: '5-mosaic-side', label: 'Two beside three', count: 5, frames: [f(0, 0, 0.5, 0.5), f(0, 0.5, 0.5, 0.5), f(0.5, 0, 0.5, T), f(0.5, T, 0.5, T), f(0.5, 2 * T, 0.5, T)] },
  { id: '6-grid', label: 'Grid of six', count: 6, frames: [f(0, 0, 0.5, T), f(0.5, 0, 0.5, T), f(0, T, 0.5, T), f(0.5, T, 0.5, T), f(0, 2 * T, 0.5, T), f(0.5, 2 * T, 0.5, T)] },
  { id: '6-grid-wide', label: 'Six, three across', count: 6, frames: [f(0, 0, T, 0.5), f(T, 0, T, 0.5), f(2 * T, 0, T, 0.5), f(0, 0.5, T, 0.5), f(T, 0.5, T, 0.5), f(2 * T, 0.5, T, 0.5)] },
  { id: 'cover', label: 'Cover', count: 1, cover: true, frames: [f(0, 0, 1, 1)] },
]

const BY_ID = new Map(BOOK_LAYOUTS.map((l) => [l.id, l]))

export function layoutById(id: string): BookLayout | undefined {
  return BY_ID.get(id)
}

export function layoutsFor(count: number): BookLayout[] {
  return BOOK_LAYOUTS.filter((l) => l.count === count && !l.cover)
}

const EPS = 1e-6

/**
 * Frames in millimetres on the trim. Interior edges are pulled in by half the
 * gap each, so neighbours end up exactly `gapMm` apart.
 */
export function resolveFrames(
  layout: BookLayout,
  page: SizeMm,
  style: Pick<BookStyle, 'marginMm' | 'gapMm'>,
): RectMm[] {
  const margin = Math.min(Math.max(0, style.marginMm || 0), page.widthMm / 2, page.heightMm / 2)
  const gap = Math.max(0, style.gapMm || 0)
  const cw = Math.max(0, page.widthMm - 2 * margin)
  const ch = Math.max(0, page.heightMm - 2 * margin)
  return layout.frames.map((fr) => {
    let left = margin + fr.x * cw
    let right = margin + (fr.x + fr.w) * cw
    let top = margin + fr.y * ch
    let bottom = margin + (fr.y + fr.h) * ch
    if (fr.x > EPS) left += gap / 2
    if (fr.x + fr.w < 1 - EPS) right -= gap / 2
    if (fr.y > EPS) top += gap / 2
    if (fr.y + fr.h < 1 - EPS) bottom -= gap / 2
    const w = Math.max(0, right - left)
    const h = Math.max(0, bottom - top)
    // A gap wider than the frame collapses it in place, never past the page.
    return { x: Math.min(left, page.widthMm - w), y: Math.min(top, page.heightMm - h), w, h }
  })
}

export function rectAspect(r: { w: number; h: number }): number {
  return r.h > 0 && r.w > 0 ? r.w / r.h : 1
}

/** The largest rectangle of `aspect` inside `box`, centred. */
export function fitRect(box: RectMm, aspect: number): RectMm {
  if (!(aspect > 0) || !Number.isFinite(aspect) || box.w <= 0 || box.h <= 0) return box
  if (box.w / box.h > aspect) {
    const w = box.h * aspect
    return { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h }
  }
  const h = box.w / aspect
  return { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookLayouts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookLayouts.ts src/lib/bookLayouts.test.ts
git commit -m "Photo Book: page layouts and frame geometry"
```

---

### Task 3: Crop maths

**Files:**
- Create: `src/lib/bookCrop.ts`
- Test: `src/lib/bookCrop.test.ts`

**Interfaces:**
- Consumes: `Crop, NormRect` (Task 1), `clamp` from `src/lib/pixels.ts`.
- Produces: `CENTRED`, `MAX_ZOOM = 5`, `LOW_DPI = 200`, `cropRect(photoAspect, frameAspect, crop): NormRect`, `normaliseCrop(photoAspect, frameAspect, crop): Crop`, `panCrop(crop, photoAspect, frameAspect, dxFraction, dyFraction): Crop`, `zoomCrop(crop, photoAspect, frameAspect, factor): Crop`, `initialCrop(photoAspect, frameAspect, face: NormRect | null): Crop`, `effectiveDpi(photo: {width,height}, source: NormRect, frameMm: {w,h}): number`.

- [ ] **Step 1: Write the failing test**

`src/lib/bookCrop.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { CENTRED, MAX_ZOOM, cropRect, effectiveDpi, initialCrop, normaliseCrop, panCrop, zoomCrop } from './bookCrop'

const inside = (r: { x: number; y: number; w: number; h: number }) => {
  expect(r.x).toBeGreaterThanOrEqual(-1e-12)
  expect(r.y).toBeGreaterThanOrEqual(-1e-12)
  expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-12)
  expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-12)
}

describe('cropRect', () => {
  it('covers the frame: the visible part has the frame shape in pixels', () => {
    for (const [pa, fa] of [[1.5, 0.8], [0.667, 1.5], [1, 1], [2, 2.5]]) {
      const r = cropRect(pa, fa, CENTRED)
      expect((r.w / r.h) * pa).toBeCloseTo(fa, 9)
      expect(Math.max(r.w, r.h)).toBeCloseTo(1, 9)
      inside(r)
    }
  })

  it('shows the whole photo when the shapes match', () => {
    expect(cropRect(1.5, 1.5, CENTRED)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('zooms in around the centre', () => {
    const r = cropRect(1, 1, { cx: 0.5, cy: 0.5, zoom: 2 })
    expect(r).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })

  it('never leaves the photo, whatever the crop says', () => {
    for (const crop of [
      { cx: -3, cy: 9, zoom: 1 },
      { cx: 0.99, cy: 0.01, zoom: 4 },
      { cx: Number.NaN, cy: Number.POSITIVE_INFINITY, zoom: Number.NaN },
      { cx: 0.5, cy: 0.5, zoom: 0.2 },
      { cx: 0.5, cy: 0.5, zoom: 50 },
    ]) {
      inside(cropRect(1.5, 0.7, crop))
    }
  })

  it('treats a broken aspect as square', () => {
    inside(cropRect(0, Number.NaN, CENTRED))
    expect(cropRect(0, Number.NaN, CENTRED)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('clamps zoom to the range', () => {
    expect(cropRect(1, 1, { cx: 0.5, cy: 0.5, zoom: 0.1 }).w).toBe(1)
    expect(cropRect(1, 1, { cx: 0.5, cy: 0.5, zoom: 99 }).w).toBeCloseTo(1 / MAX_ZOOM)
  })
})

describe('moving the crop', () => {
  it('pans opposite to the drag and stops at the edge', () => {
    const start = normaliseCrop(1, 1, { cx: 0.5, cy: 0.5, zoom: 2 })
    const right = panCrop(start, 1, 1, 0.1, 0)
    expect(right.cx).toBeCloseTo(0.45)
    const far = panCrop(start, 1, 1, 10, -10)
    expect(far.cx).toBeCloseTo(0.25)
    expect(far.cy).toBeCloseTo(0.75)
  })

  it('cannot pan a crop that already shows the whole photo', () => {
    expect(panCrop(CENTRED, 1.5, 1.5, 0.3, 0.3)).toEqual({ cx: 0.5, cy: 0.5, zoom: 1 })
  })

  it('zooms within limits', () => {
    expect(zoomCrop(CENTRED, 1, 1, 2).zoom).toBe(2)
    expect(zoomCrop({ cx: 0.5, cy: 0.5, zoom: 4 }, 1, 1, 10).zoom).toBe(MAX_ZOOM)
    expect(zoomCrop(CENTRED, 1, 1, 0.1).zoom).toBe(1)
  })

  it('stores the centre of the clamped rectangle so the crop never drifts', () => {
    const c = normaliseCrop(1, 1, { cx: 0.01, cy: 0.99, zoom: 2 })
    expect(c).toEqual({ cx: 0.25, cy: 0.75, zoom: 2 })
  })
})

describe('initialCrop', () => {
  it('centres when there is no face', () => {
    expect(initialCrop(1.5, 0.8, null)).toEqual(normaliseCrop(1.5, 0.8, CENTRED))
  })

  it('keeps a face near the top of a tall photo in a wide frame', () => {
    const face = { x: 0.4, y: 0.05, w: 0.2, h: 0.15 }
    const crop = initialCrop(0.667, 1.5, face)
    const r = cropRect(0.667, 1.5, crop)
    expect(r.y).toBeLessThanOrEqual(face.y)
    expect(r.y + r.h).toBeGreaterThanOrEqual(face.y + face.h)
  })
})

describe('effectiveDpi', () => {
  it('is pixels shown over inches printed', () => {
    // 3000 px wide photo, whole width shown on a 254 mm (10 in) frame = 300 DPI.
    expect(effectiveDpi({ width: 3000, height: 2000 }, { x: 0, y: 0, w: 1, h: 1 }, { w: 254, h: 169.33 })).toBeCloseTo(300, 0)
  })

  it('is infinite for an empty frame', () => {
    expect(effectiveDpi({ width: 10, height: 10 }, { x: 0, y: 0, w: 1, h: 1 }, { w: 0, h: 5 })).toBe(Number.POSITIVE_INFINITY)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookCrop.test.ts`
Expected: FAIL, cannot resolve `./bookCrop`.

- [ ] **Step 3: Write the implementation**

`src/lib/bookCrop.ts`:

```ts
/**
 * Which part of a photo a frame shows. A crop is a centre and a zoom; zoom 1
 * is the smallest crop that still covers the frame. Everything is in
 * fractions of the photo, so it survives the book changing size.
 */

import type { Crop, NormRect } from './bookTypes'
import { clamp } from './pixels'

export const CENTRED: Crop = { cx: 0.5, cy: 0.5, zoom: 1 }
export const MAX_ZOOM = 5
/** Below this at print size a photo looks soft; the editor warns. */
export const LOW_DPI = 200

const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback)
const safeAspect = (a: number) => (Number.isFinite(a) && a > 0 ? a : 1)

export function cropRect(photoAspect: number, frameAspect: number, crop: Crop): NormRect {
  const pa = safeAspect(photoAspect)
  const fa = safeAspect(frameAspect)
  let w = 1
  let h = 1
  if (fa > pa) h = pa / fa
  else w = fa / pa
  const zoom = clamp(finite(crop.zoom, 1), 1, MAX_ZOOM)
  w /= zoom
  h /= zoom
  const x = clamp(finite(crop.cx, 0.5) - w / 2, 0, 1 - w)
  const y = clamp(finite(crop.cy, 0.5) - h / 2, 0, 1 - h)
  return { x, y, w, h }
}

export function normaliseCrop(photoAspect: number, frameAspect: number, crop: Crop): Crop {
  const r = cropRect(photoAspect, frameAspect, crop)
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, zoom: clamp(finite(crop.zoom, 1), 1, MAX_ZOOM) }
}

/** Drag by a fraction of the frame; the photo follows the pointer. */
export function panCrop(crop: Crop, photoAspect: number, frameAspect: number, dxFraction: number, dyFraction: number): Crop {
  const r = cropRect(photoAspect, frameAspect, crop)
  return normaliseCrop(photoAspect, frameAspect, {
    ...crop,
    cx: r.x + r.w / 2 - finite(dxFraction, 0) * r.w,
    cy: r.y + r.h / 2 - finite(dyFraction, 0) * r.h,
  })
}

export function zoomCrop(crop: Crop, photoAspect: number, frameAspect: number, factor: number): Crop {
  return normaliseCrop(photoAspect, frameAspect, { ...crop, zoom: finite(crop.zoom, 1) * finite(factor, 1) })
}

/** Centred, or centred on the face with a little headroom. */
export function initialCrop(photoAspect: number, frameAspect: number, face: NormRect | null): Crop {
  if (!face) return normaliseCrop(photoAspect, frameAspect, CENTRED)
  const base = cropRect(photoAspect, frameAspect, CENTRED)
  return normaliseCrop(photoAspect, frameAspect, {
    cx: face.x + face.w / 2,
    // Push the centre below the face so the face sits in the upper part.
    cy: face.y + face.h / 2 + base.h * 0.1,
    zoom: 1,
  })
}

export function effectiveDpi(photo: { width: number; height: number }, source: NormRect, frameMm: { w: number; h: number }): number {
  if (frameMm.w <= 0 || frameMm.h <= 0) return Number.POSITIVE_INFINITY
  const x = (source.w * photo.width) / (frameMm.w / 25.4)
  const y = (source.h * photo.height) / (frameMm.h / 25.4)
  return Math.min(x, y)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookCrop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookCrop.ts src/lib/bookCrop.test.ts
git commit -m "Photo Book: crop maths"
```

---

### Task 4: Auto-fill

**Files:**
- Create: `src/lib/autoFill.ts`
- Test: `src/lib/autoFill.test.ts`

**Interfaces:**
- Consumes: `initialCrop` (Task 3), `layoutsFor, resolveFrames, rectAspect, BookLayout` (Task 2), `BookPage, BookStyle, NormRect, SizeMm, PAGE_COUNT_OPTIONS` (Task 1).
- Produces: `FillPhoto { id, aspect, face }`, `FillOptions { pageCount, cover, page, style, newId? }`, `FillResult = { ok: true; pages: BookPage[] } | { ok: false; message: string }`, `autoFill(photos, options): FillResult`, `autoPageCount(n): number`, `distribute(n, pages): number[]`, constants `MAX_PER_PAGE = 6, AUTO_PHOTOS_PER_PAGE = 2.5, ASPECT_LIMIT = 1.6, FEATURE_EVERY = 5`.

- [ ] **Step 1: Write the failing test**

`src/lib/autoFill.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { ASPECT_LIMIT, autoFill, autoPageCount, distribute, type FillOptions, type FillPhoto } from './autoFill'
import { layoutById, rectAspect, resolveFrames } from './bookLayouts'
import type { BookPage } from './bookTypes'

const photos = (n: number, aspect = 1.5): FillPhoto[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, aspect, face: null }))

function options(patch: Partial<FillOptions> = {}): FillOptions {
  let id = 0
  return {
    pageCount: 'auto',
    cover: false,
    page: { widthMm: 127, heightMm: 152.4 },
    style: { marginMm: 6, gapMm: 3 },
    newId: () => `pg${id++}`,
    ...patch,
  }
}

function pagesOf(result: ReturnType<typeof autoFill>): BookPage[] {
  if (!result.ok) throw new Error(result.message)
  return result.pages
}

const index = (id: string | null) => Number(id!.slice(1))

describe('distribute', () => {
  it('spreads every photo over the pages, 1 to 6 each', () => {
    for (const [n, p] of [[10, 4], [37, 15], [40, 20], [120, 20], [6, 1], [5, 5]]) {
      const counts = distribute(n, p)
      expect(counts).toHaveLength(p)
      expect(counts.reduce((a, b) => a + b, 0)).toBe(n)
      for (const c of counts) {
        expect(c).toBeGreaterThanOrEqual(1)
        expect(c).toBeLessThanOrEqual(6)
      }
    }
  })

  it('keeps every fifth page a single photo while the rest have room', () => {
    const counts = distribute(40, 20)
    for (let i = 0; i < 20; i += 5) expect(counts[i]).toBe(1)
  })

  it('fills the feature pages too when there are very many photos', () => {
    expect(distribute(60, 10)).toEqual(new Array(10).fill(6))
  })
})

describe('autoFill', () => {
  it('picks about 2.5 photos a page when the count is automatic', () => {
    expect(autoPageCount(37)).toBe(15)
    expect(autoPageCount(1)).toBe(1)
    expect(autoPageCount(2)).toBe(1)
    expect(pagesOf(autoFill(photos(37), options()))).toHaveLength(15)
  })

  it('uses every photo exactly once, in consecutive groups', () => {
    const pages = pagesOf(autoFill(photos(37), options()))
    let next = 0
    for (const page of pages) {
      const ids = page.frames.map((f) => index(f.photoId)).sort((a, b) => a - b)
      expect(ids).toEqual(ids.map((_, k) => next + k))
      next += ids.length
    }
    expect(next).toBe(37)
  })

  it('makes exactly the requested number of pages, plus the cover', () => {
    expect(pagesOf(autoFill(photos(50), options({ pageCount: 20 })))).toHaveLength(20)
    const withCover = pagesOf(autoFill(photos(50), options({ pageCount: 20, cover: true })))
    expect(withCover).toHaveLength(21)
    expect(withCover[0].layoutId).toBe('cover')
    expect(withCover[0].frames.map((f) => f.photoId)).toEqual(['p0'])
    expect(withCover.slice(1).flatMap((p) => p.frames).some((f) => f.photoId === 'p0')).toBe(false)
  })

  it('makes only the cover when the cover is the only photo', () => {
    const pages = pagesOf(autoFill(photos(1), options({ cover: true })))
    expect(pages.map((p) => p.layoutId)).toEqual(['cover'])
  })

  it('puts one photo on every fifth page', () => {
    const pages = pagesOf(autoFill(photos(40), options({ pageCount: 20 })))
    for (let i = 0; i < 20; i += 5) expect(pages[i].frames).toHaveLength(1)
  })

  it('stacks two landscape photos on a portrait page instead of squeezing them side by side', () => {
    const pages = pagesOf(autoFill(photos(2, 1.5), options({ pageCount: 1, page: { widthMm: 203.2, heightMm: 254 } })))
    expect(pages[0].layoutId).toBe('2-stack')
  })

  it('keeps frames within the aspect limit when a layout allows it', () => {
    const page = { widthMm: 127, heightMm: 152.4 }
    const style = { marginMm: 6, gapMm: 3 }
    // Each case was checked by hand to have at least one layout within the limit.
    for (const [n, aspect] of [[1, 1.5], [2, 1.5], [3, 1.5], [6, 0.667], [1, 0.667]] as const) {
      const [only] = pagesOf(autoFill(photos(n, aspect), options({ pageCount: 1 })))
      const layout = layoutById(only.layoutId)!
      const rects = resolveFrames(layout, page, style)
      layout.frames.forEach((frame, i) => {
        if (frame.fit) return
        const ratio = Math.max(rectAspect(rects[i]) / aspect, aspect / rectAspect(rects[i]))
        expect(ratio, `${n} x ${aspect} on ${layout.id}`).toBeLessThanOrEqual(ASPECT_LIMIT + 1e-9)
      })
    }
  })

  it('still lays out four landscape photos on a portrait page', () => {
    const pages = pagesOf(autoFill(photos(4, 1.5), options({ pageCount: 1 })))
    expect(pages[0].frames).toHaveLength(4)
  })

  it('never uses the same layout three pages in a row when another fits', () => {
    // Landscape photos on a landscape 5x7: both single layouts pass.
    const pages = pagesOf(autoFill(photos(3, 1.5), options({ pageCount: 3, page: { widthMm: 177.8, heightMm: 127 } })))
    const ids = pages.map((p) => p.layoutId)
    expect(new Set(ids).size).toBeGreaterThan(1)
    for (let i = 2; i < ids.length; i++) expect(ids[i] === ids[i - 1] && ids[i] === ids[i - 2]).toBe(false)
  })

  it('is deterministic', () => {
    const a = pagesOf(autoFill(photos(23, 1.2), options()))
    const b = pagesOf(autoFill(photos(23, 1.2), options()))
    expect(a.map((p) => [p.layoutId, p.frames])).toEqual(b.map((p) => [p.layoutId, p.frames]))
  })

  it('autoFill survives zero-size frames', () => {
    const pages = pagesOf(autoFill(photos(12, 1.5), options({ pageCount: 2, style: { marginMm: 80, gapMm: 10 } })))
    expect(pages.flatMap((p) => p.frames)).toHaveLength(12)
    for (const frame of pages.flatMap((p) => p.frames)) {
      expect(Number.isFinite(frame.crop.cx) && Number.isFinite(frame.crop.cy)).toBe(true)
    }
  })

  it('refuses an empty book', () => {
    expect(autoFill([], options())).toEqual({ ok: false, message: 'Add at least one photo first.' })
  })

  it('says how many photos to add when there are fewer photos than pages', () => {
    const result = autoFill(photos(12), options({ pageCount: 20 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('12 photos cannot fill 20 pages. Add 8 more photos or choose fewer pages.')
  })

  it('says how many to remove, and which page count fits, when there are too many', () => {
    const result = autoFill(photos(200), options({ pageCount: 20 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('200 photos do not fit on 20 pages (6 per page at most). Remove 80 photos or choose 40 pages.')
  })

  it('does not suggest a page count when none of the offered ones fits', () => {
    const result = autoFill(photos(400), options({ pageCount: 50 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('400 photos do not fit on 50 pages (6 per page at most). Remove 100 photos.')
  })

  it('handles hundreds of photos', () => {
    const pages = pagesOf(autoFill(photos(300, 1.33), options()))
    expect(pages).toHaveLength(120)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/autoFill.test.ts`
Expected: FAIL, cannot resolve `./autoFill`.

- [ ] **Step 3: Write the implementation**

`src/lib/autoFill.ts`:

```ts
/**
 * The first draft of a book: photos in order, grouped into pages, each page
 * given the layout that crops its photos least. The operator adjusts from
 * here; nothing in this file runs again unless they ask for a rebuild.
 */

import { initialCrop } from './bookCrop'
import { layoutsFor, rectAspect, resolveFrames, type BookLayout } from './bookLayouts'
import { PAGE_COUNT_OPTIONS, type BookPage, type BookStyle, type NormRect, type SizeMm } from './bookTypes'

export interface FillPhoto {
  id: string
  aspect: number
  face: NormRect | null
}

export interface FillOptions {
  pageCount: 'auto' | number
  cover: boolean
  page: SizeMm
  style: Pick<BookStyle, 'marginMm' | 'gapMm'>
  newId?: () => string
}

export type FillResult = { ok: true; pages: BookPage[] } | { ok: false; message: string }

export const MAX_PER_PAGE = 6
export const AUTO_PHOTOS_PER_PAGE = 2.5
export const ASPECT_LIMIT = 1.6
export const FEATURE_EVERY = 5
/** A whole-photo frame never crops, but a full-bleed page is preferred when it fits. */
const FIT_SCORE = 0.15

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function autoPageCount(n: number): number {
  return Math.min(n, Math.max(1, Math.round(n / AUTO_PHOTOS_PER_PAGE)))
}

/** Photos per page. Every FEATURE_EVERY-th page stays a single photo for as long as possible. */
export function distribute(n: number, pages: number): number[] {
  const counts = new Array<number>(pages).fill(1)
  let remaining = n - pages
  const all = counts.map((_, i) => i)
  const groups = [all.filter((i) => i % FEATURE_EVERY !== 0), all.filter((i) => i % FEATURE_EVERY === 0)]
  for (const group of groups) {
    while (remaining > 0 && group.some((i) => counts[i] < MAX_PER_PAGE)) {
      for (const i of group) {
        if (remaining === 0) break
        if (counts[i] < MAX_PER_PAGE) {
          counts[i]++
          remaining--
        }
      }
    }
  }
  return counts
}

interface Evaluation {
  layout: BookLayout
  score: number
  worst: number
  /** order[frame] = index into the page's photos. */
  order: number[]
}

function evaluate(layout: BookLayout, group: FillPhoto[], options: FillOptions): Evaluation {
  const rects = resolveFrames(layout, options.page, options.style)
  const aspect = (p: FillPhoto) => (p.aspect > 0 && Number.isFinite(p.aspect) ? p.aspect : 1)
  // Pairing the sorted shapes is the cheapest assignment in one dimension.
  const frames = rects.map((_, i) => i).sort((a, b) => rectAspect(rects[a]) - rectAspect(rects[b]))
  const photos = group.map((_, i) => i).sort((a, b) => aspect(group[a]) - aspect(group[b]))
  const order = new Array<number>(rects.length)
  let score = 0
  let worst = 0
  frames.forEach((frame, k) => {
    const photo = photos[k]
    order[frame] = photo
    if (layout.frames[frame].fit === 'photo') {
      score += FIT_SCORE
      return
    }
    const d = Math.abs(Math.log(rectAspect(rects[frame]) / aspect(group[photo])))
    score += d
    worst = Math.max(worst, d)
  })
  return { layout, score, worst, order }
}

function choose(group: FillPhoto[], previous: BookPage[], options: FillOptions): Evaluation {
  const evaluations = layoutsFor(group.length).map((l) => evaluate(l, group, options))
  const recent = previous.slice(-2).map((p) => p.layoutId)
  const repeating = recent.length === 2 && recent[0] === recent[1] ? recent[0] : null
  const limit = Math.log(ASPECT_LIMIT) + 1e-9
  const passing = evaluations.filter((e) => e.worst <= limit)
  const fresh = (list: Evaluation[]) => list.filter((e) => e.layout.id !== repeating)
  // The aspect limit outranks the rhythm rule; the rhythm rule outranks score.
  const pool = [fresh(passing), passing, fresh(evaluations), evaluations].find((list) => list.length > 0)!
  return pool.reduce((best, e) => (e.score < best.score - 1e-12 ? e : best))
}

let fallbackCounter = 0
const defaultId = () => `pg-${Date.now().toString(36)}-${(fallbackCounter++).toString(36)}`

export function autoFill(photos: FillPhoto[], options: FillOptions): FillResult {
  const newId = options.newId ?? defaultId
  if (photos.length === 0) return { ok: false, message: 'Add at least one photo first.' }

  const pages: BookPage[] = []
  let rest = photos
  if (options.cover) {
    const first = photos[0]
    const coverAspect = options.page.widthMm / options.page.heightMm
    pages.push({ id: newId(), layoutId: 'cover', frames: [{ photoId: first.id, crop: initialCrop(first.aspect, coverAspect, first.face) }] })
    rest = photos.slice(1)
  }

  const n = rest.length
  if (n === 0) return { ok: true, pages }
  const target = options.pageCount === 'auto' ? autoPageCount(n) : Math.floor(options.pageCount)
  if (!(target >= 1)) return { ok: false, message: 'Choose at least one page.' }
  if (n < target) {
    return { ok: false, message: `${plural(n, 'photo')} cannot fill ${target} pages. Add ${plural(target - n, 'more photo')} or choose fewer pages.` }
  }
  if (n > target * MAX_PER_PAGE) {
    const fits = PAGE_COUNT_OPTIONS.find((c) => c >= Math.ceil(n / MAX_PER_PAGE))
    const extra = n - target * MAX_PER_PAGE
    return {
      ok: false,
      message: `${n} photos do not fit on ${target} pages (6 per page at most). Remove ${plural(extra, 'photo')}${fits ? ` or choose ${fits} pages` : ''}.`,
    }
  }

  let at = 0
  for (const count of distribute(n, target)) {
    const group = rest.slice(at, at + count)
    at += count
    const choice = choose(group, pages, options)
    const rects = resolveFrames(choice.layout, options.page, options.style)
    pages.push({
      id: newId(),
      layoutId: choice.layout.id,
      frames: choice.order.map((p, frame) => {
        const photo = group[p]
        const frameAspect = choice.layout.frames[frame].fit === 'photo' ? photo.aspect : rectAspect(rects[frame])
        return { photoId: photo.id, crop: initialCrop(photo.aspect, frameAspect, photo.face) }
      }),
    })
  }
  return { ok: true, pages }
}
```

Note: the "Add 8 more photos" wording comes from `plural(8, 'more photo')` → `8 more photos`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/autoFill.test.ts`
Expected: PASS. If `keeps frames within the aspect limit` fails for a case, print the evaluations for that case and fix the layout data or the chooser, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/autoFill.ts src/lib/autoFill.test.ts
git commit -m "Photo Book: auto-fill pages from the photos"
```

---

### Task 5: Page operations

**Files:**
- Create: `src/lib/bookModel.ts`
- Test: `src/lib/bookModel.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `FrameRef { page: number; frame: number }`, and pure functions that return the **same object** when the change is invalid or does nothing:
  `pageMmOf(book): SizeMm`, `photoAspect(photo): number`, `frameAspect(book, ref): number | null`, `freshCrop(book, ref, photoId): Crop`, `usedPhotoIds(book): Set<string>`, `unusedPhotos(book): BookPhoto[]`, `sortPhotos(photos): BookPhoto[]`, `addPhotos(book, photos): { book; added; duplicates }`, `removePhoto(book, id)`, `setPageLayout(book, pageIndex, layoutId)`, `swapFrames(book, a, b)`, `placePhoto(book, target, photoId)`, `clearFrame(book, ref)`, `setCrop(book, ref, crop)`, `firstPageIndex(book): number`, `addPage(book, afterIndex, layoutId = '1-full'): { book; index }`, `duplicatePage(book, index)`, `deletePage(book, index)`, `movePage(book, from, to)`, `setCover(book, cover | null)`, `setPhotoEnhance(book, photoId, patch)`, `setEnhanceAll(book, byId: Record<string, Required<EnhanceSettings>>)`, `newPageId(): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/bookModel.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookModel.test.ts`
Expected: FAIL, cannot resolve `./bookModel`.

- [ ] **Step 3: Write the implementation**

`src/lib/bookModel.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookModel.ts src/lib/bookModel.test.ts
git commit -m "Photo Book: page and photo operations"
```

---

### Task 6: The `.photobook` file

**Files:**
- Create: `src/lib/bookFile.ts`
- Test: `src/lib/bookFile.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5 (`layoutById, layoutsFor`, `BOOK_SIZES`, `EDIT_PAPER_CHOICES`, `CUSTOM_PAPER_MIN_MM/MAX_MM`, `NEUTRAL_ENHANCE`, `clampStyle`).
- Produces: `BOOK_FILE_EXTENSION = 'photobook'`, `serializeBook(book): string`, `parseBook(text): { ok: true; book: Book } | { ok: false; message: string }`, `relinkPhotos(book, found: Record<string,string>, missingIds: string[]): { book; relinked: string[]; stillMissing: string[] }`, `fileNameOf(path): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/bookFile.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookFile.test.ts`
Expected: FAIL, cannot resolve `./bookFile`.

- [ ] **Step 3: Write the implementation**

`src/lib/bookFile.ts`:

```ts
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
      size: typeof raw.size === 'string' && raw.size in BOOK_SIZES ? (raw.size as BookSizeId) : defaults.size,
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

/** Point missing photos at files of the same name found in another folder. */
export function relinkPhotos(
  book: Book,
  found: Record<string, string>,
  missingIds: string[],
): { book: Book; relinked: string[]; stillMissing: string[] } {
  const missing = new Set(missingIds)
  const relinked: string[] = []
  const photos = book.photos.map((p) => {
    if (!missing.has(p.id)) return p
    const path = found[fileNameOf(p.path).toLowerCase()]
    if (!path) return p
    relinked.push(p.id)
    return { ...p, path }
  })
  return {
    book: relinked.length ? { ...book, photos } : book,
    relinked,
    stillMissing: missingIds.filter((id) => !relinked.includes(id)),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookFile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookFile.ts src/lib/bookFile.test.ts
git commit -m "Photo Book: save file, open and relink"
```

---

### Task 7: Packing pages onto sheets

**Files:**
- Create: `src/lib/bookSheets.ts`
- Test: `src/lib/bookSheets.test.ts`

**Interfaces:**
- Consumes: `RectMm, SizeMm` (Task 1).
- Produces: constants `SHEET_SAFE_MM = 3, CELL_SPACING_MM = 4, BLEED_MM = 2, MARK_OFFSET_MM = 0.5, MARK_LENGTH_MM = 3, LABEL_SIZE_MM = 2`; `SheetSlot { trim: RectMm; rotated: boolean; labelAt: { x; y } | null }`; `CutLine { x1, y1, x2, y2 }`; `SheetPlan = { ok: true; paper: SizeMm; perSheet; slots; bleedMm; borderless } | { ok: false; message }`; `portrait(size)`, `planSheets(page, paper, edgeToEdge): SheetPlan`, `cutLines(plan, occupied): CutLine[]`, `sheetCount(pages, perSheet)`, `pagesOnSheet(sheet, perSheet, pageCount): number[]`.

- [ ] **Step 1: Write the failing test**

`src/lib/bookSheets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { BLEED_MM, cutLines, pagesOnSheet, planSheets, sheetCount, type SheetPlan } from './bookSheets'

const A4 = { widthMm: 210, heightMm: 297 }
const R8 = { widthMm: 203.2, heightMm: 254 }
const P5x6 = { widthMm: 127, heightMm: 152.4 }
const P5x7 = { widthMm: 127, heightMm: 177.8 }

function ok(plan: SheetPlan) {
  if (!plan.ok) throw new Error(plan.message)
  return plan
}

function expectSane(plan: SheetPlan) {
  const p = ok(plan)
  for (const [i, slot] of p.slots.entries()) {
    const b = p.bleedMm
    expect(slot.trim.x - b).toBeGreaterThanOrEqual(-1e-9)
    expect(slot.trim.y - b).toBeGreaterThanOrEqual(-1e-9)
    expect(slot.trim.x + slot.trim.w + b).toBeLessThanOrEqual(p.paper.widthMm + 1e-9)
    expect(slot.trim.y + slot.trim.h + b).toBeLessThanOrEqual(p.paper.heightMm + 1e-9)
    for (const other of p.slots.slice(i + 1)) {
      const sep =
        other.trim.x - b >= slot.trim.x + slot.trim.w + b - 1e-9 ||
        slot.trim.x - b >= other.trim.x + other.trim.w + b - 1e-9 ||
        other.trim.y - b >= slot.trim.y + slot.trim.h + b - 1e-9 ||
        slot.trim.y - b >= other.trim.y + other.trim.h + b - 1e-9
      expect(sep, 'bleeds must not overlap').toBe(true)
    }
  }
  return p
}

describe('planSheets', () => {
  it('fits two 5x6 pages on A4 by turning them', () => {
    const p = expectSane(planSheets(P5x6, A4, false))
    expect(p.perSheet).toBe(2)
    expect(p.slots.every((s) => s.rotated)).toBe(true)
    expect(p.slots[0].trim.w).toBeCloseTo(152.4)
  })

  it('still fits two 5x6 pages with bleed', () => {
    const p = expectSane(planSheets(P5x6, A4, true))
    expect(p.perSheet).toBe(2)
    expect(p.bleedMm).toBe(BLEED_MM)
  })

  it('fits two 5x7 pages on A4', () => {
    expect(expectSane(planSheets(P5x7, A4, true)).perSheet).toBe(2)
  })

  it('keeps the page upright when it fits that way', () => {
    const landscape5x6 = { widthMm: 152.4, heightMm: 127 }
    const p = expectSane(planSheets(landscape5x6, A4, false))
    expect(p.perSheet).toBe(2)
    expect(p.slots.every((s) => !s.rotated)).toBe(true)
  })

  it('shrinks the bleed to the room left for an 8x8 on A4', () => {
    const p = expectSane(planSheets({ widthMm: 203.2, heightMm: 203.2 }, A4, true))
    expect(p.perSheet).toBe(1)
    expect(p.bleedMm).toBeCloseTo(0.4)
    expect(p.borderless).toBe(false)
  })

  it('prints 8x10 on A4 with a trim', () => {
    const p = expectSane(planSheets({ widthMm: 203.2, heightMm: 254 }, A4, false))
    expect(p.perSheet).toBe(1)
    expect(p.borderless).toBe(false)
  })

  it('prints 8x10 on 8R and A4 on A4 borderless, without marks', () => {
    for (const [page, paper] of [[{ widthMm: 203.2, heightMm: 254 }, R8], [A4, A4]] as const) {
      const p = expectSane(planSheets(page, paper, true))
      expect(p.borderless).toBe(true)
      expect(p.bleedMm).toBe(0)
      expect(cutLines(p, 1)).toEqual([])
      expect(p.slots[0].labelAt).toBeNull()
    }
  })

  it('refuses a page larger than the paper', () => {
    expect(planSheets(A4, R8, false)).toEqual({ ok: false, message: 'The page is larger than the paper. Choose a bigger paper or a smaller book size.' })
  })

  it('packs four 5x6 pages on an A3 custom paper', () => {
    expect(expectSane(planSheets(P5x6, { widthMm: 297, heightMm: 420 }, false)).perSheet).toBe(4)
  })

  it('treats a landscape paper the same as portrait', () => {
    const a = ok(planSheets(P5x6, A4, false))
    const b = ok(planSheets(P5x6, { widthMm: 297, heightMm: 210 }, false))
    expect(b.paper).toEqual(A4)
    expect(b.slots).toEqual(a.slots)
  })
})

describe('cut marks', () => {
  it('sit outside every trim and on the paper', () => {
    for (const edge of [false, true]) {
      const p = ok(planSheets(P5x6, A4, edge))
      const lines = cutLines(p, 2)
      expect(lines.length).toBe(16)
      for (const l of lines) {
        for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2], [(l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2]]) {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(p.paper.widthMm)
          expect(y).toBeLessThanOrEqual(p.paper.heightMm)
          for (const s of p.slots) {
            const insideTrim = x > s.trim.x + 1e-9 && x < s.trim.x + s.trim.w - 1e-9 && y > s.trim.y + 1e-9 && y < s.trim.y + s.trim.h - 1e-9
            expect(insideTrim).toBe(false)
          }
        }
      }
    }
  })

  it('marks only the slots that hold a page', () => {
    const p = ok(planSheets(P5x6, A4, false))
    expect(cutLines(p, 1)).toHaveLength(8)
    expect(cutLines(p, 0)).toEqual([])
  })

  it('places page labels on the paper, below their page', () => {
    const p = ok(planSheets(P5x6, A4, false))
    for (const s of p.slots) {
      expect(s.labelAt).not.toBeNull()
      expect(s.labelAt!.y).toBeGreaterThan(s.trim.y + s.trim.h)
      expect(s.labelAt!.y).toBeLessThanOrEqual(p.paper.heightMm)
    }
  })
})

describe('sheets for a book', () => {
  it('counts sheets and fills them in order', () => {
    expect(sheetCount(21, 2)).toBe(11)
    expect(sheetCount(0, 2)).toBe(0)
    expect(sheetCount(5, 0)).toBe(0)
    expect(pagesOnSheet(0, 2, 21)).toEqual([0, 1])
    expect(pagesOnSheet(10, 2, 21)).toEqual([20])
    expect(pagesOnSheet(11, 2, 21)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookSheets.test.ts`
Expected: FAIL, cannot resolve `./bookSheets`.

- [ ] **Step 3: Write the implementation**

`src/lib/bookSheets.ts`:

```ts
/**
 * Book pages laid out on print paper: as many per sheet as fit, turned if
 * that fits more, with cut marks for the trimmer. The paper is always
 * handled portrait, the way it feeds; pages turn instead.
 */

import type { RectMm, SizeMm } from './bookTypes'

/** Kept clear at the paper's edge, where printers cannot reach. */
export const SHEET_SAFE_MM = 3
/** Between neighbouring pages (outside any bleed), room for marks. */
export const CELL_SPACING_MM = 4
export const BLEED_MM = 2
export const MARK_OFFSET_MM = 0.5
export const MARK_LENGTH_MM = 3
export const LABEL_SIZE_MM = 2

export interface SheetSlot {
  /** The trimmed page on the sheet. */
  trim: RectMm
  /** The page is turned 90° clockwise on the sheet. */
  rotated: boolean
  /** Baseline centre for the small page number, or null when there is no room. */
  labelAt: { x: number; y: number } | null
}

export interface CutLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type SheetPlan =
  | { ok: true; paper: SizeMm; perSheet: number; slots: SheetSlot[]; bleedMm: number; borderless: boolean }
  | { ok: false; message: string }

const EPS = 1e-6

export function portrait(size: SizeMm): SizeMm {
  return size.widthMm <= size.heightMm ? size : { widthMm: size.heightMm, heightMm: size.widthMm }
}

interface Grid {
  rotated: boolean
  tw: number
  th: number
  cols: number
  rows: number
  bleed: number
}

function layoutGrid(sheet: SizeMm, g: Grid): SheetPlan {
  const cw = g.tw + 2 * g.bleed
  const ch = g.th + 2 * g.bleed
  const totalW = g.cols * cw + (g.cols - 1) * CELL_SPACING_MM
  const totalH = g.rows * ch + (g.rows - 1) * CELL_SPACING_MM
  const x0 = (sheet.widthMm - totalW) / 2
  const y0 = (sheet.heightMm - totalH) / 2
  const slots: SheetSlot[] = []
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const trim = { x: x0 + c * (cw + CELL_SPACING_MM) + g.bleed, y: y0 + r * (ch + CELL_SPACING_MM) + g.bleed, w: g.tw, h: g.th }
      const cellBottom = trim.y + trim.h + g.bleed
      const room = r < g.rows - 1 ? CELL_SPACING_MM : sheet.heightMm - cellBottom
      const labelAt = room >= LABEL_SIZE_MM + 0.6 ? { x: trim.x + trim.w / 2, y: cellBottom + 0.3 + LABEL_SIZE_MM } : null
      slots.push({ trim, rotated: g.rotated, labelAt })
    }
  }
  return { ok: true, paper: sheet, perSheet: slots.length, slots, bleedMm: g.bleed, borderless: false }
}

export function planSheets(page: SizeMm, paper: SizeMm, edgeToEdge: boolean): SheetPlan {
  const sheet = portrait(paper)
  const desired = edgeToEdge ? BLEED_MM : 0
  const usableW = sheet.widthMm - 2 * SHEET_SAFE_MM
  const usableH = sheet.heightMm - 2 * SHEET_SAFE_MM
  const turns = page.widthMm === page.heightMm ? [false] : [false, true]
  const sides = (rotated: boolean) => (rotated ? { tw: page.heightMm, th: page.widthMm } : { tw: page.widthMm, th: page.heightMm })

  let best: Grid | null = null
  for (const rotated of turns) {
    const { tw, th } = sides(rotated)
    const cw = tw + 2 * desired
    const ch = th + 2 * desired
    if (cw > usableW + EPS || ch > usableH + EPS) continue
    const cols = Math.floor((usableW + CELL_SPACING_MM) / (cw + CELL_SPACING_MM) + EPS)
    const rows = Math.floor((usableH + CELL_SPACING_MM) / (ch + CELL_SPACING_MM) + EPS)
    if (!best || cols * rows > best.cols * best.rows) best = { rotated, tw, th, cols, rows, bleed: desired }
  }
  if (best) return layoutGrid(sheet, best)

  // One page per sheet: give up some bleed for the room that is left.
  for (const rotated of turns) {
    const { tw, th } = sides(rotated)
    if (tw <= usableW + EPS && th <= usableH + EPS) {
      const bleed = Math.max(0, Math.min(desired, (usableW - tw) / 2, (usableH - th) / 2))
      return layoutGrid(sheet, { rotated, tw, th, cols: 1, rows: 1, bleed })
    }
  }

  // The page is the paper (8x10 on 8R, A4 on A4): print borderless, no trim.
  for (const rotated of turns) {
    const { tw, th } = sides(rotated)
    if (tw <= sheet.widthMm + EPS && th <= sheet.heightMm + EPS) {
      const trim = { x: (sheet.widthMm - tw) / 2, y: (sheet.heightMm - th) / 2, w: tw, h: th }
      return { ok: true, paper: sheet, perSheet: 1, slots: [{ trim, rotated, labelAt: null }], bleedMm: 0, borderless: true }
    }
  }

  return { ok: false, message: 'The page is larger than the paper. Choose a bigger paper or a smaller book size.' }
}

/** Two short lines at each trim corner, pointing away from the page. */
export function cutLines(plan: SheetPlan, occupied: number): CutLine[] {
  if (!plan.ok || plan.borderless) return []
  const { widthMm: W, heightMm: H } = plan.paper
  const start = plan.bleedMm + MARK_OFFSET_MM
  const end = start + MARK_LENGTH_MM
  const clampX = (x: number) => Math.min(W, Math.max(0, x))
  const clampY = (y: number) => Math.min(H, Math.max(0, y))
  const lines: CutLine[] = []
  for (const slot of plan.slots.slice(0, Math.max(0, occupied))) {
    const { x, y, w, h } = slot.trim
    for (const [cx, sx] of [[x, -1], [x + w, 1]] as const) {
      for (const [cy, sy] of [[y, -1], [y + h, 1]] as const) {
        const horizontal = { x1: clampX(cx + sx * start), y1: cy, x2: clampX(cx + sx * end), y2: cy }
        const vertical = { x1: cx, y1: clampY(cy + sy * start), x2: cx, y2: clampY(cy + sy * end) }
        for (const l of [horizontal, vertical]) {
          if (Math.hypot(l.x2 - l.x1, l.y2 - l.y1) >= 0.5) lines.push(l)
        }
      }
    }
  }
  return lines
}

export function sheetCount(pages: number, perSheet: number): number {
  return perSheet > 0 ? Math.ceil(pages / perSheet) : 0
}

export function pagesOnSheet(sheet: number, perSheet: number, pageCount: number): number[] {
  const first = sheet * perSheet
  const out: number[] = []
  for (let i = first; i < Math.min(pageCount, first + perSheet); i++) out.push(i)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookSheets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookSheets.ts src/lib/bookSheets.test.ts
git commit -m "Photo Book: pack pages onto sheets with cut marks"
```

---

### Task 8: What to draw on a page

**Files:**
- Create: `src/lib/bookDraw.ts`
- Test: `src/lib/bookDraw.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 and `pageMmOf`, `photoAspect` (Task 5).
- Produces: `DrawFrame { index; photoId; rect: RectMm; source: NormRect | null; missing; lowRes; dpi: number | null }`, `PageDraw { page: SizeMm; bleedMm; color; frames: DrawFrame[] }`, `pageDraw(book, page, options?: { bleedMm?; missing?: ReadonlySet<string> }): PageDraw`, `TextLine { text; font; sizeMm; x; baseline; color }`, `Measure = (text, font, sizeMm) => number`, `approximateMeasure: Measure`, `coverText(cover, page, measure): TextLine[]`, `pageText(book, pageIndex, measure): TextLine[]`, `FONT_FAMILIES`, `FONT_WEIGHTS`, `FONT_LABELS`, `fontCss(font, sizePx): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/bookDraw.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { NEUTRAL_ENHANCE } from './enhance'
import { CENTRED, cropRect } from './bookCrop'
import { approximateMeasure, coverText, pageDraw, pageText } from './bookDraw'
import { resolveFrames, layoutById } from './bookLayouts'
import { DEFAULT_COVER, EDGE_TO_EDGE, newBook, type Book, type BookPhoto } from './bookTypes'

const photo = (id: string, width = 3000, height = 2000): BookPhoto => ({
  id, path: `C:\\${id}.jpg`, name: `${id}.jpg`, width, height, takenAt: null, face: null, enhance: NEUTRAL_ENHANCE,
})

function book(patch: Partial<Book> = {}): Book {
  return {
    ...newBook(),
    photos: [photo('a'), photo('b'), photo('tiny', 300, 200)],
    pages: [
      { id: '1', layoutId: '2-side', frames: [{ photoId: 'a', crop: CENTRED }, { photoId: null, crop: CENTRED }] },
      { id: '2', layoutId: '1-full', frames: [{ photoId: 'b', crop: { cx: 0.5, cy: 0.5, zoom: 2 } }] },
      { id: '3', layoutId: '1-framed', frames: [{ photoId: 'a', crop: CENTRED }] },
      { id: '4', layoutId: 'retired', frames: [] },
    ],
    ...patch,
  }
}

const PAGE = { widthMm: 127, heightMm: 152.4 }

describe('pageDraw', () => {
  it('draws frames where the layout puts them, without bleed', () => {
    const b = book()
    const draw = pageDraw(b, b.pages[0])
    const rects = resolveFrames(layoutById('2-side')!, PAGE, b.style)
    expect(draw.frames.map((f) => f.rect)).toEqual(rects)
    expect(draw.frames[0].source).toEqual(cropRect(1.5, rects[0].w / rects[0].h, CENTRED))
    expect(draw.frames[1].source).toBeNull()
    expect(draw.color).toBe('#FFFFFF')
  })

  it('extends edge frames into the bleed without moving what is inside the trim', () => {
    const b = book({ style: EDGE_TO_EDGE })
    const plain = pageDraw(b, b.pages[1]).frames[0]
    const bled = pageDraw(b, b.pages[1], { bleedMm: 2 }).frames[0]
    expect(bled.rect.x).toBeCloseTo(-2, 9)
    expect(bled.rect.y).toBeCloseTo(-2, 9)
    expect(bled.rect.w).toBeCloseTo(131, 9)
    expect(bled.rect.h).toBeCloseTo(156.4, 9)
    // The source point under the trim corner is the same with and without bleed.
    const at = (f: typeof plain, mmX: number) => f.source!.x + ((mmX - f.rect.x) * f.source!.w) / f.rect.w
    expect(at(bled, 0)).toBeCloseTo(at(plain, 0), 12)
    expect(at(bled, 127)).toBeCloseTo(at(plain, 127), 12)
  })

  it('stops the bleed where the photo ends', () => {
    // Zoom 1 on a matching shape shows the whole photo: nothing left to bleed.
    const b = book({ style: EDGE_TO_EDGE, photos: [photo('a'), photo('b', 1270, 1524), photo('tiny', 300, 200)] })
    const page = { ...b.pages[1], frames: [{ photoId: 'b', crop: CENTRED }] }
    const f = pageDraw(b, page, { bleedMm: 2 }).frames[0]
    for (const [got, want] of [[f.rect.x, 0], [f.rect.y, 0], [f.rect.w, 127], [f.rect.h, 152.4], [f.source!.x, 0], [f.source!.y, 0], [f.source!.w, 1], [f.source!.h, 1]]) {
      expect(got).toBeCloseTo(want, 6)
    }
  })

  it('shrinks a whole-photo frame to the photo and never crops it', () => {
    const b = book()
    const f = pageDraw(b, b.pages[2]).frames[0]
    expect(f.rect.w / f.rect.h).toBeCloseTo(1.5)
    expect(f.source).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('flags missing and low-resolution photos', () => {
    const b = book()
    const missing = pageDraw(b, b.pages[1], { missing: new Set(['b']) }).frames[0]
    expect(missing.missing).toBe(true)
    const small = { ...b.pages[1], frames: [{ photoId: 'tiny', crop: CENTRED }] }
    const f = pageDraw(b, small).frames[0]
    expect(f.lowRes).toBe(true)
    expect(f.dpi).toBeLessThan(200)
    // 3000 px across a centred crop on a 115 mm frame is about 368 DPI.
    const sharp = { ...b.pages[1], frames: [{ photoId: 'b', crop: CENTRED }] }
    expect(pageDraw(b, sharp).frames[0].lowRes).toBe(false)
  })

  it('draws nothing for an unknown layout', () => {
    const b = book()
    expect(pageDraw(b, b.pages[3]).frames).toEqual([])
  })

  it('crops stay inside the photo after the book size changes', () => {
    const edited = book()
    edited.pages[1].frames[0].crop = { cx: 0.98, cy: 0.02, zoom: 1.1 }
    for (const size of ['5x6', '5x7', '8x8', '8x10', 'a4'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const b = { ...edited, size, orientation }
        for (const page of b.pages) {
          for (const f of pageDraw(b, page, { bleedMm: 2 }).frames) {
            if (!f.source) continue
            expect(f.source.x).toBeGreaterThanOrEqual(-1e-9)
            expect(f.source.y).toBeGreaterThanOrEqual(-1e-9)
            expect(f.source.x + f.source.w).toBeLessThanOrEqual(1 + 1e-9)
            expect(f.source.y + f.source.h).toBeLessThanOrEqual(1 + 1e-9)
          }
        }
      }
    }
  })
})

describe('cover text', () => {
  const cover = { ...DEFAULT_COVER, title: 'Juan & Maria', subtitle: '12 October 2026' }

  it('is empty without words', () => {
    expect(coverText({ ...DEFAULT_COVER }, PAGE, approximateMeasure)).toEqual([])
  })

  it('shrinks a long title to fit the page width', () => {
    const long = { ...cover, title: 'A very long title for a wedding book that goes on and on' }
    const [title] = coverText(long, PAGE, approximateMeasure)
    expect(approximateMeasure(title.text, title.font, title.sizeMm)).toBeLessThanOrEqual(PAGE.widthMm * 0.84 + 1e-9)
  })

  it('never goes below the minimum size, even for absurd titles', () => {
    const [title] = coverText({ ...cover, title: 'x'.repeat(2000) }, PAGE, approximateMeasure)
    expect(title.sizeMm).toBe(4)
  })

  it('places the block top, middle or bottom', () => {
    const y = (position: 'top' | 'middle' | 'bottom') => coverText({ ...cover, position }, PAGE, approximateMeasure)[0].baseline
    expect(y('top')).toBeLessThan(y('middle'))
    expect(y('middle')).toBeLessThan(y('bottom'))
    expect(y('bottom')).toBeLessThan(PAGE.heightMm)
  })

  it('only writes text on the cover page', () => {
    const b = { ...book(), cover }
    b.pages = [{ id: 'c', layoutId: 'cover', frames: [{ photoId: 'a', crop: CENTRED }] }, ...b.pages]
    expect(pageText(b, 0, approximateMeasure).map((l) => l.text)).toEqual(['Juan & Maria', '12 October 2026'])
    expect(pageText(b, 1, approximateMeasure)).toEqual([])
    expect(pageText({ ...b, cover: null }, 0, approximateMeasure)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookDraw.test.ts`
Expected: FAIL, cannot resolve `./bookDraw`.

- [ ] **Step 3: Write the implementation**

`src/lib/bookDraw.ts`:

```ts
/**
 * What a page looks like, in millimetres: where each photo goes and which
 * part of it shows, plus the cover text. Pure, so the screen preview and the
 * 300 DPI print are drawn from the same numbers.
 */

import { cropRect, effectiveDpi, LOW_DPI } from './bookCrop'
import { fitRect, layoutById, resolveFrames } from './bookLayouts'
import { pageMmOf, photoAspect } from './bookModel'
import type { Book, BookCover, BookFont, BookPage, NormRect, RectMm, SizeMm } from './bookTypes'

export interface DrawFrame {
  index: number
  photoId: string | null
  /** Where the photo is drawn; extends into the bleed at the trim edge. */
  rect: RectMm
  /** The part of the photo drawn into `rect`, or null for an empty frame. */
  source: NormRect | null
  missing: boolean
  lowRes: boolean
  dpi: number | null
}

export interface PageDraw {
  page: SizeMm
  bleedMm: number
  color: string
  frames: DrawFrame[]
}

const EPS = 1e-6

export function pageDraw(book: Book, page: BookPage, options: { bleedMm?: number; missing?: ReadonlySet<string> } = {}): PageDraw {
  const size = pageMmOf(book)
  const bleed = Math.max(0, options.bleedMm ?? 0)
  const layout = layoutById(page.layoutId)
  const base: PageDraw = { page: size, bleedMm: bleed, color: book.style.color, frames: [] }
  if (!layout) return base
  const rects = resolveFrames(layout, size, book.style)
  base.frames = layout.frames.map((lf, index): DrawFrame => {
    const frame = page.frames[index]
    const photo = frame?.photoId ? book.photos.find((p) => p.id === frame.photoId) : undefined
    const box = rects[index]
    if (!photo || box.w <= EPS || box.h <= EPS) {
      return { index, photoId: photo?.id ?? null, rect: box, source: null, missing: false, lowRes: false, dpi: null }
    }
    const aspect = photoAspect(photo)
    let rect: RectMm
    let source: NormRect
    if (lf.fit === 'photo') {
      rect = fitRect(box, aspect)
      source = { x: 0, y: 0, w: 1, h: 1 }
    } else {
      // Crop for the trim, then grow both rectangles together into the bleed
      // so nothing inside the trim moves.
      const crop = cropRect(aspect, box.w / box.h, frame.crop)
      const sx = crop.w / box.w
      const sy = crop.h / box.h
      const want = (touching: boolean) => (touching ? bleed : 0)
      const l = Math.min(want(box.x <= EPS), crop.x / sx)
      const t = Math.min(want(box.y <= EPS), crop.y / sy)
      const r = Math.min(want(box.x + box.w >= size.widthMm - EPS), (1 - crop.x - crop.w) / sx)
      const b = Math.min(want(box.y + box.h >= size.heightMm - EPS), (1 - crop.y - crop.h) / sy)
      rect = { x: box.x - l, y: box.y - t, w: box.w + l + r, h: box.h + t + b }
      source = { x: crop.x - l * sx, y: crop.y - t * sy, w: crop.w + (l + r) * sx, h: crop.h + (t + b) * sy }
      if (l === 0 && t === 0 && r === 0 && b === 0) {
        rect = box
        source = crop
      }
    }
    const dpi = effectiveDpi(photo, source, rect)
    return { index, photoId: photo.id, rect, source, missing: options.missing?.has(photo.id) ?? false, lowRes: dpi < LOW_DPI, dpi }
  })
  return base
}

// --- cover text ------------------------------------------------------------

export const FONT_FAMILIES: Record<BookFont, string> = {
  archivo: 'Archivo',
  playfair: '"Playfair Display"',
  greatvibes: '"Great Vibes"',
}
export const FONT_WEIGHTS: Record<BookFont, number> = { archivo: 800, playfair: 700, greatvibes: 400 }
export const FONT_LABELS: Record<BookFont, string> = { archivo: 'Modern', playfair: 'Classic', greatvibes: 'Script' }

export function fontCss(font: BookFont, sizePx: number): string {
  return `${FONT_WEIGHTS[font]} ${sizePx}px ${FONT_FAMILIES[font]}`
}

export interface TextLine {
  text: string
  font: BookFont
  sizeMm: number
  /** Centre of the line. */
  x: number
  baseline: number
  color: string
}

/** Width in millimetres of `text` set at `sizeMm`. */
export type Measure = (text: string, font: BookFont, sizeMm: number) => number

/** For tests and as a fallback: an average glyph is 0.55 of the size wide. */
export const approximateMeasure: Measure = (text, _font, sizeMm) => text.length * sizeMm * 0.55

const MIN_TITLE_MM = 4
const MIN_SUBTITLE_MM = 2.5

export function coverText(cover: BookCover, page: SizeMm, measure: Measure): TextLine[] {
  const title = cover.title.trim()
  const subtitle = cover.subtitle.trim()
  if (!title && !subtitle) return []
  const maxW = page.widthMm * 0.84
  const fit = (text: string, start: number, min: number) => {
    let size = start
    while (size > min && measure(text, cover.font, size) > maxW) size *= 0.95
    return Math.max(size, min)
  }
  const titleSize = title ? fit(title, page.widthMm * 0.12, MIN_TITLE_MM) : 0
  const subStart = titleSize ? Math.min(page.widthMm * 0.045, titleSize * 0.45) : page.widthMm * 0.045
  const subSize = subtitle ? fit(subtitle, Math.max(subStart, MIN_SUBTITLE_MM), MIN_SUBTITLE_MM) : 0
  const gap = titleSize && subSize ? subSize * 0.8 : 0
  const block = titleSize + gap + subSize
  const top =
    cover.position === 'top' ? page.heightMm * 0.08 : cover.position === 'middle' ? (page.heightMm - block) / 2 : page.heightMm * 0.92 - block
  const lines: TextLine[] = []
  const x = page.widthMm / 2
  if (title) lines.push({ text: title, font: cover.font, sizeMm: titleSize, x, baseline: top + titleSize * 0.8, color: cover.textColor })
  if (subtitle) lines.push({ text: subtitle, font: cover.font, sizeMm: subSize, x, baseline: top + titleSize + gap + subSize * 0.8, color: cover.textColor })
  return lines
}

export function pageText(book: Book, pageIndex: number, measure: Measure): TextLine[] {
  const page = book.pages[pageIndex]
  if (!page || page.layoutId !== 'cover' || !book.cover) return []
  return coverText(book.cover, pageMmOf(book), measure)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookDraw.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bookDraw.ts src/lib/bookDraw.test.ts
git commit -m "Photo Book: page drawing geometry and cover text"
```

---

### Task 9: Rust: thumbnails, crops, folders and project files

**Files:**
- Modify: `src-tauri/src/image_io.rs` (add `check_extension`, `read_taken_at`, `exif_datetime_to_iso`)
- Create: `src-tauri/src/book.rs`
- Create: `src-tauri/src/book_commands.rs`
- Modify: `src-tauri/src/state.rs` (add `book_thumbs`)
- Modify: `src-tauri/src/lib.rs` (modules and commands)
- Modify: `src/lib/tauri.ts` (bindings)

**Interfaces:**
- Produces (Rust, `book.rs`): `ThumbStore`, `NormRect`, `Thumbnail`, `make_thumbnail(path) -> Result<Thumbnail>`, `largest_face(faces, w, h) -> Option<NormRect>`, `pixel_rect(crop, w, h) -> (u32,u32,u32,u32)`, `render_crop(path, crop, width, height) -> Result<RgbImage>`, `to_rgba(&RgbImage) -> Vec<u8>`, `Expanded { files, skipped }`, `expand_paths(&[String]) -> Expanded`, `find_in_folder(folder, names) -> HashMap<String,String>`, `write_project(path, text)`, `read_project(path)`, `autosave_path(dir)`, `staging_dir()`, `stage_sheet(dir, index, bytes) -> Result<PathBuf>`, `clear_staged(dir)`.
- Produces (commands): `book_add_photos(photos: [{id, path}]) -> BookPhotoInfo[]` (event `book://progress` `{done, total}`), `book_thumb(id) -> bytes`, `book_render_photo(args {path, crop, width, height}) -> RGBA bytes`, `book_clear()`, `book_expand_paths(paths) -> {files, skipped}`, `book_find_in_folder(folder, names) -> {lowercaseName: path}`, `book_read_project(path) -> string`, `book_write_project(path, text)`, `book_autosave_write(text)`, `book_autosave_read() -> {text, savedAtMs} | null`, `book_autosave_clear()`, `book_stage_sheet(args {index, bytes}) -> path`, `book_clear_staged()`.
- Produces (TS, `tauri.ts`): `BookPhotoInfo`, `BookProgress`, `bookAddPhotos`, `bookThumb`, `bookRenderPhoto`, `bookClear`, `bookExpandPaths`, `bookFindInFolder`, `bookReadProject`, `bookWriteProject`, `bookAutosaveWrite`, `bookAutosaveRead`, `bookAutosaveClear`, `bookStageSheet`, `bookClearStaged`, `onBookProgress`.

- [ ] **Step 1: Add the EXIF date helpers to `image_io.rs`**

In `src-tauri/src/image_io.rs`, replace the body of `decode_path`'s extension check with a call to a new public function, and add the date helpers below `read_exif_orientation`:

```rust
/// The extension gate on its own, for callers that read the bytes themselves.
pub fn check_extension(path: &Path) -> Result<()> {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if !is_supported_extension(ext) {
            return Err(AppError::UnsupportedFormat(ext.to_ascii_uppercase()));
        }
    }
    Ok(())
}

pub fn decode_path(path: &Path) -> Result<Decoded> {
    check_extension(path)?;
    let bytes = std::fs::read(path).map_err(|e| AppError::Io {
        path: path.display().to_string(),
        source: e,
    })?;
    decode_bytes(&bytes)
}
```

```rust
/// When the photo was taken, as ISO 8601 ("2026-10-12T14:03:22"), from
/// DateTimeOriginal or, failing that, DateTime.
pub fn read_taken_at(bytes: &[u8]) -> Option<String> {
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(bytes))
        .ok()?;
    let field = exif
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .or_else(|| exif.get_field(exif::Tag::DateTime, exif::In::PRIMARY))?;
    match &field.value {
        exif::Value::Ascii(parts) => parts
            .first()
            .and_then(|raw| std::str::from_utf8(raw).ok())
            .and_then(exif_datetime_to_iso),
        _ => None,
    }
}

/// "2026:10:12 14:03:22" -> "2026-10-12T14:03:22". Cameras with an unset
/// clock write zeros; those are treated as no date.
pub fn exif_datetime_to_iso(raw: &str) -> Option<String> {
    let raw = raw.trim_end_matches('\0').trim();
    let b = raw.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];
    if !digits.iter().all(|&i| b[i].is_ascii_digit()) {
        return None;
    }
    if b[4] != b':' || b[7] != b':' || b[13] != b':' || b[16] != b':' || &raw[0..4] == "0000" {
        return None;
    }
    Some(format!("{}-{}-{}T{}", &raw[0..4], &raw[5..7], &raw[8..10], &raw[11..19]))
}
```

Add to the existing `mod tests` in `image_io.rs`:

```rust
    #[test]
    fn exif_dates_become_iso() {
        assert_eq!(exif_datetime_to_iso("2026:10:12 14:03:22").as_deref(), Some("2026-10-12T14:03:22"));
        assert_eq!(exif_datetime_to_iso("2026:10:12 14:03:22\0").as_deref(), Some("2026-10-12T14:03:22"));
        assert_eq!(exif_datetime_to_iso("0000:00:00 00:00:00"), None);
        assert_eq!(exif_datetime_to_iso("yesterday"), None);
        assert_eq!(exif_datetime_to_iso(""), None);
    }

    #[test]
    fn a_photo_without_exif_has_no_date() {
        assert_eq!(read_taken_at(&[0xFF, 0xD8, 0xFF, 0xD9]), None);
    }
```

- [ ] **Step 2: Run the image_io tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --profile perf --lib image_io`
Expected: PASS (5 tests).

- [ ] **Step 3: Write `book.rs` with its tests**

`src-tauri/src/book.rs`:

```rust
//! Photo Book (docs/superpowers/specs/2026-10-13-photo-book-design.md).
//!
//! The ID flow keeps one decoded original in `ImageStore`. A wedding book has
//! a hundred, which would be gigabytes, so here only the path and a small
//! JPEG thumbnail are kept. Printing reads the original again and hands over
//! just the frame's crop, at the frame's size.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use image::codecs::jpeg::JpegEncoder;
use image::{ImageEncoder, RgbImage};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::face::Face;
use crate::{image_io, resize};

pub const THUMB_MAX: u32 = 1024;
/// A 12 x 12 in frame at 300 DPI is 13 MP; this leaves room and stops typos.
pub const MAX_RENDER_PIXELS: u64 = 100_000_000;
/// How deep a dropped folder is searched (event / camera / day).
pub const FOLDER_DEPTH: usize = 3;
pub const PROJECT_EXTENSION: &str = "photobook";
const MAX_PROJECT_BYTES: u64 = 50 * 1024 * 1024;
/// Formats people drop by mistake; worth saying why they were left out.
const REPORTED_IN_FOLDERS: &[&str] = &["heic", "heif", "tif", "tiff", "gif", "raw", "cr2", "cr3", "nef", "arw", "dng"];

#[derive(Default)]
pub struct ThumbStore {
    thumbs: Mutex<HashMap<String, Arc<Vec<u8>>>>,
}

impl ThumbStore {
    pub fn insert(&self, id: String, jpeg: Vec<u8>) {
        self.thumbs.lock().insert(id, Arc::new(jpeg));
    }

    pub fn get(&self, id: &str) -> Result<Arc<Vec<u8>>> {
        self.thumbs
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::UnknownImage(id.to_owned()))
    }

    pub fn clear(&self) {
        self.thumbs.lock().clear();
    }

    pub fn len(&self) -> usize {
        self.thumbs.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NormRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct Thumbnail {
    pub jpeg: Vec<u8>,
    /// The same thumbnail as pixels, for face detection.
    pub small: RgbImage,
    /// Upright size of the original.
    pub width: u32,
    pub height: u32,
    pub taken_at: Option<String>,
}

fn io_error(path: &Path, e: std::io::Error) -> AppError {
    AppError::Io { path: path.display().to_string(), source: e }
}

fn encode_jpeg(rgb: &RgbImage, quality: u8) -> Result<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut out, quality)
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(AppError::from)?;
    Ok(out.into_inner())
}

pub fn make_thumbnail(path: &Path) -> Result<Thumbnail> {
    image_io::check_extension(path)?;
    let bytes = std::fs::read(path).map_err(|e| io_error(path, e))?;
    let decoded = image_io::decode_bytes(&bytes)?;
    let (width, height) = decoded.rgb.dimensions();
    let scale = (THUMB_MAX as f64 / width.max(height) as f64).min(1.0);
    let tw = ((width as f64 * scale).round() as u32).max(1);
    let th = ((height as f64 * scale).round() as u32).max(1);
    let small = resize::rgb_exact(&decoded.rgb, tw, th)?;
    drop(decoded);
    let jpeg = encode_jpeg(&small, 88)?;
    Ok(Thumbnail { jpeg, small, width, height, taken_at: image_io::read_taken_at(&bytes) })
}

/// The biggest face, in fractions of the image it was found in.
pub fn largest_face(faces: &[Face], width: u32, height: u32) -> Option<NormRect> {
    if width == 0 || height == 0 {
        return None;
    }
    let best = faces.iter().max_by(|a, b| a.area().total_cmp(&b.area()))?;
    let [x, y, w, h] = best.r#box;
    let (fw, fh) = (width as f64, height as f64);
    let x0 = (x as f64 / fw).clamp(0.0, 1.0);
    let y0 = (y as f64 / fh).clamp(0.0, 1.0);
    let x1 = ((x + w) as f64 / fw).clamp(0.0, 1.0);
    let y1 = ((y + h) as f64 / fh).clamp(0.0, 1.0);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    Some(NormRect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

/// A fractional crop as whole pixels, always at least 1 x 1 and inside.
pub fn pixel_rect(crop: NormRect, width: u32, height: u32) -> (u32, u32, u32, u32) {
    let clamp01 = |v: f64| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
    let x0 = clamp01(crop.x);
    let y0 = clamp01(crop.y);
    let x1 = clamp01(crop.x + crop.w).max(x0);
    let y1 = clamp01(crop.y + crop.h).max(y0);
    let px = ((x0 * width as f64).floor() as u32).min(width.saturating_sub(1));
    let py = ((y0 * height as f64).floor() as u32).min(height.saturating_sub(1));
    let pw = ((x1 * width as f64).ceil() as u32).min(width).saturating_sub(px).max(1);
    let ph = ((y1 * height as f64).ceil() as u32).min(height).saturating_sub(py).max(1);
    (px, py, pw, ph)
}

pub fn render_crop(path: &Path, crop: NormRect, width: u32, height: u32) -> Result<RgbImage> {
    if width == 0 || height == 0 || width as u64 * height as u64 > MAX_RENDER_PIXELS {
        return Err(AppError::Other(format!("a {width} x {height} px frame is out of range")));
    }
    let decoded = image_io::decode_path(path)?;
    let (w, h) = decoded.rgb.dimensions();
    let (x, y, cw, ch) = pixel_rect(crop, w, h);
    let view = image::imageops::crop_imm(&decoded.rgb, x, y, cw, ch).to_image();
    drop(decoded);
    resize::rgb_exact(&view, width, height)
}

/// RGB to RGBA, the layout `ImageData` wants.
pub fn to_rgba(rgb: &RgbImage) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgb.as_raw().len() / 3 * 4);
    for px in rgb.as_raw().chunks_exact(3) {
        out.extend_from_slice(&[px[0], px[1], px[2], 255]);
    }
    out
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Expanded {
    pub files: Vec<String>,
    /// File names that were dropped but cannot be used.
    pub skipped: Vec<String>,
}

pub fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn extension_of(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn has_supported_extension(path: &Path) -> bool {
    image_io::is_supported_extension(&extension_of(path))
}

fn sorted_entries(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<PathBuf> = read.filter_map(|e| e.ok().map(|e| e.path())).collect();
    entries.sort_by_key(|p| file_name(p).to_lowercase());
    entries
}

fn push_file(path: &Path, out: &mut Expanded, seen: &mut HashSet<String>) {
    let shown = path.display().to_string();
    if seen.insert(shown.to_lowercase()) {
        out.files.push(shown);
    }
}

fn walk(dir: &Path, depth: usize, out: &mut Expanded, seen: &mut HashSet<String>) {
    if depth > FOLDER_DEPTH {
        return;
    }
    for path in sorted_entries(dir) {
        if file_name(&path).starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk(&path, depth + 1, out, seen);
        } else if has_supported_extension(&path) {
            push_file(&path, out, seen);
        } else if REPORTED_IN_FOLDERS.contains(&extension_of(&path).as_str()) {
            out.skipped.push(file_name(&path));
        }
    }
}

/// Dropped files and folders, as the photo files in them, in name order.
pub fn expand_paths(paths: &[String]) -> Expanded {
    let mut out = Expanded::default();
    let mut seen = HashSet::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() {
            walk(&path, 0, &mut out, &mut seen);
        } else if path.is_file() && has_supported_extension(&path) {
            push_file(&path, &mut out, &mut seen);
        } else {
            out.skipped.push(file_name(&path));
        }
    }
    out
}

fn find_walk(dir: &Path, depth: usize, wanted: &HashSet<String>, found: &mut HashMap<String, String>) {
    if depth > FOLDER_DEPTH || found.len() == wanted.len() {
        return;
    }
    for path in sorted_entries(dir) {
        if path.is_dir() {
            find_walk(&path, depth + 1, wanted, found);
        } else {
            let key = file_name(&path).to_lowercase();
            if wanted.contains(&key) && !found.contains_key(&key) {
                found.insert(key, path.display().to_string());
            }
        }
    }
}

/// Files with these names under `folder`, keyed by lower-cased name.
pub fn find_in_folder(folder: &Path, names: &[String]) -> HashMap<String, String> {
    let wanted: HashSet<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mut found = HashMap::new();
    find_walk(folder, 0, &wanted, &mut found);
    found
}

pub fn write_project(path: &Path, text: &str) -> Result<()> {
    if extension_of(path) != PROJECT_EXTENSION {
        return Err(AppError::Other(format!("a photo book is saved as .{PROJECT_EXTENSION}")));
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| io_error(dir, e))?;
    }
    // Write beside it and swap in, so a crash never leaves half a book.
    let tmp = path.with_extension("photobook.tmp");
    std::fs::write(&tmp, text).map_err(|e| io_error(&tmp, e))?;
    std::fs::rename(&tmp, path).map_err(|e| io_error(path, e))
}

pub fn read_project(path: &Path) -> Result<String> {
    let meta = std::fs::metadata(path).map_err(|e| io_error(path, e))?;
    if meta.len() > MAX_PROJECT_BYTES {
        return Err(AppError::Other("that file is too large to be a photo book".into()));
    }
    std::fs::read_to_string(path).map_err(|e| io_error(path, e))
}

pub fn autosave_path(dir: &Path) -> PathBuf {
    dir.join("book-autosave.photobook")
}

pub fn staging_dir() -> PathBuf {
    std::env::temp_dir().join("philmer-book-print")
}

pub fn stage_sheet(dir: &Path, index: u32, bytes: &[u8]) -> Result<PathBuf> {
    std::fs::create_dir_all(dir).map_err(|e| io_error(dir, e))?;
    let path = dir.join(format!("sheet-{index:04}.img"));
    std::fs::write(&path, bytes).map_err(|e| io_error(&path, e))?;
    Ok(path)
}

pub fn clear_staged(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::face::{Landmarks, Point};
    use image::Rgb;

    fn fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/portrait.jpg")
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("philmer-book-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A JPEG with an EXIF Orientation tag spliced in after SOI.
    fn jpeg_with_orientation(img: &RgbImage, orientation: u8) -> Vec<u8> {
        let plain = encode_jpeg(img, 95).unwrap();
        let mut app1 = vec![0xFF, 0xE1, 0x00, 0x22];
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(&[b'I', b'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
        app1.extend_from_slice(&[0x01, 0x00]);
        app1.extend_from_slice(&[0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00]);
        app1.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        let mut out = plain[..2].to_vec();
        out.extend_from_slice(&app1);
        out.extend_from_slice(&plain[2..]);
        out
    }

    #[test]
    fn thumbnail_fits_1024_and_keeps_the_shape() {
        let t = make_thumbnail(&fixture()).unwrap();
        let (tw, th) = t.small.dimensions();
        assert_eq!(tw.max(th), THUMB_MAX.min(t.width.max(t.height)));
        let original = t.width as f64 / t.height as f64;
        let small = tw as f64 / th as f64;
        assert!((original - small).abs() < 0.01, "{original} vs {small}");
        assert_eq!(&t.jpeg[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn render_crop_returns_exactly_the_frame_size() {
        let out = render_crop(&fixture(), NormRect { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, 321, 123).unwrap();
        assert_eq!(out.dimensions(), (321, 123));
        assert_eq!(to_rgba(&out).len(), 321 * 123 * 4);
    }

    #[test]
    fn render_crop_refuses_absurd_sizes() {
        assert!(render_crop(&fixture(), NormRect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, 0, 10).is_err());
        assert!(render_crop(&fixture(), NormRect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, 20_000, 20_000).is_err());
    }

    #[test]
    fn pixel_rect_survives_garbage() {
        for crop in [
            NormRect { x: f64::NAN, y: -3.0, w: f64::INFINITY, h: 0.0 },
            NormRect { x: 1.5, y: 1.5, w: 1.0, h: 1.0 },
            NormRect { x: 0.99999, y: 0.0, w: 0.0, h: 1.0 },
        ] {
            let (x, y, w, h) = pixel_rect(crop, 40, 20);
            assert!(w >= 1 && h >= 1 && x + w <= 40 && y + h <= 20, "{crop:?} -> {x},{y},{w},{h}");
        }
        assert_eq!(pixel_rect(NormRect { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }, 40, 20), (0, 0, 40, 20));
    }

    #[test]
    fn orientation_6_photo_is_upright_everywhere() {
        // Stored 40 x 20: left half red, right half blue. Orientation 6 turns
        // it 90 degrees clockwise, so upright it is 20 x 40, red on top.
        let mut img = RgbImage::new(40, 20);
        for (x, _, px) in img.enumerate_pixels_mut() {
            *px = if x < 20 { Rgb([230, 20, 20]) } else { Rgb([20, 20, 230]) };
        }
        let dir = temp_dir("orientation");
        let path = dir.join("phone.jpg");
        std::fs::write(&path, jpeg_with_orientation(&img, 6)).unwrap();

        let t = make_thumbnail(&path).unwrap();
        assert_eq!((t.width, t.height), (20, 40));
        assert_eq!(t.small.dimensions(), (20, 40));

        let top = render_crop(&path, NormRect { x: 0.0, y: 0.0, w: 1.0, h: 0.4 }, 10, 10).unwrap();
        let px = top.get_pixel(5, 5);
        assert!(px[0] > 150 && px[2] < 100, "top should be red, got {px:?}");
        let bottom = render_crop(&path, NormRect { x: 0.0, y: 0.6, w: 1.0, h: 0.4 }, 10, 10).unwrap();
        let px = bottom.get_pixel(5, 5);
        assert!(px[2] > 150 && px[0] < 100, "bottom should be blue, got {px:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn largest_face_is_normalised_and_clamped() {
        let p = Point { x: 0.0, y: 0.0 };
        let lm = Landmarks { right_eye: p, left_eye: p, nose: p, mouth_right: p, mouth_left: p };
        let small = Face { r#box: [10.0, 10.0, 10.0, 10.0], score: 0.9, landmarks: lm };
        let big = Face { r#box: [50.0, -10.0, 60.0, 40.0], score: 0.9, landmarks: lm };
        let r = largest_face(&[small, big], 100, 100).unwrap();
        assert_eq!(r, NormRect { x: 0.5, y: 0.0, w: 0.5, h: 0.3 });
        assert_eq!(largest_face(&[], 100, 100), None);
        assert_eq!(largest_face(&[small], 0, 100), None);
    }

    #[test]
    fn expand_paths_takes_photos_from_folders_and_reports_the_rest() {
        let dir = temp_dir("expand");
        std::fs::create_dir_all(dir.join("Day 2")).unwrap();
        std::fs::create_dir_all(dir.join(".thumbnails")).unwrap();
        for name in ["b.jpg", "A.PNG", "notes.txt", "clip.HEIC", "Day 2/c.webp", ".thumbnails/d.jpg"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        let loose = dir.join("notes.txt").display().to_string();
        let out = expand_paths(&[dir.display().to_string(), loose]);
        let names: Vec<String> = out.files.iter().map(|f| file_name(Path::new(f))).collect();
        assert_eq!(names, ["A.PNG", "b.jpg", "c.webp"]);
        assert_eq!(out.skipped, ["clip.HEIC", "notes.txt"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn expand_paths_dedupes_a_folder_and_its_file() {
        let dir = temp_dir("dedupe");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        let file = dir.join("a.jpg").display().to_string();
        let out = expand_paths(&[dir.display().to_string(), file.clone(), file.to_uppercase()]);
        assert_eq!(out.files.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn expand_paths_reports_a_missing_path() {
        let out = expand_paths(&["Z:\\no\\such\\photo.jpg".to_string()]);
        assert!(out.files.is_empty());
        assert_eq!(out.skipped, ["photo.jpg"]);
    }

    #[test]
    fn find_in_folder_matches_unicode_names_ignoring_case() {
        let dir = temp_dir("find");
        std::fs::create_dir_all(dir.join("Kasal ni Juan & María")).unwrap();
        std::fs::write(dir.join("Kasal ni Juan & María").join("María 01.JPG"), b"x").unwrap();
        let found = find_in_folder(&dir, &["MARÍA 01.jpg".to_string(), "absent.jpg".to_string()]);
        assert_eq!(found.len(), 1);
        assert!(found["maría 01.jpg"].ends_with("María 01.JPG"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn projects_round_trip_and_need_the_extension() {
        let dir = temp_dir("project");
        let path = dir.join("nested").join("Juan & María.photobook");
        write_project(&path, "{\"a\":1}").unwrap();
        assert_eq!(read_project(&path).unwrap(), "{\"a\":1}");
        write_project(&path, "{\"a\":2}").unwrap();
        assert_eq!(read_project(&path).unwrap(), "{\"a\":2}");
        assert!(write_project(&dir.join("book.txt"), "x").is_err());
        assert!(read_project(&dir.join("absent.photobook")).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sheets_are_staged_and_cleared() {
        let dir = temp_dir("stage");
        let path = stage_sheet(&dir, 7, b"abc").unwrap();
        assert!(path.ends_with("sheet-0007.img"));
        assert_eq!(std::fs::read(&path).unwrap(), b"abc");
        clear_staged(&dir);
        assert!(!dir.exists());
        clear_staged(&dir);
    }

    #[test]
    fn thumb_store_reports_unknown_ids() {
        let store = ThumbStore::default();
        assert!(store.get("nope").is_err());
        store.insert("a".into(), vec![1, 2]);
        assert_eq!(store.get("a").unwrap().as_slice(), &[1, 2]);
        store.clear();
        assert!(store.is_empty());
    }
}
```

- [ ] **Step 4: Register the module so the tests compile, and run them**

In `src-tauri/src/lib.rs` add `pub mod book;` (alphabetically after `pub mod attire;`).

Run: `cargo test --manifest-path src-tauri/Cargo.toml --profile perf --lib book`
Expected: PASS (12 tests in `book::tests`).

- [ ] **Step 5: Add the shared state and the commands**

In `src-tauri/src/state.rs`, add the field and initialise it:

```rust
use crate::book::ThumbStore;
// in struct AppState:
    /// Photo Book thumbnails; the originals stay on disk (`book.rs`).
    pub book_thumbs: Arc<ThumbStore>,
// in from_app's Ok(Self { ... }):
            book_thumbs: Arc::new(ThumbStore::default()),
```

`src-tauri/src/book_commands.rs`:

```rust
//! The Photo Book's commands. Everything heavy runs on a blocking thread.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::book::{self, Expanded, NormRect};
use crate::error::{AppError, Result};
use crate::face;
use crate::state::AppState;

fn task_failed(name: &str, e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("{name} task failed: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct AddPhoto {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPhotoInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub taken_at: Option<String>,
    pub face: Option<NormRect>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookProgress {
    pub done: usize,
    pub total: usize,
}

#[tauri::command]
pub async fn book_add_photos(
    app: AppHandle,
    state: State<'_, AppState>,
    photos: Vec<AddPhoto>,
) -> Result<Vec<BookPhotoInfo>> {
    let thumbs = Arc::clone(&state.book_thumbs);
    // A missing face model only costs the face-aware first crop.
    let session = state.engine.face_session().ok();
    tauri::async_runtime::spawn_blocking(move || {
        // Each worker holds one full decode; four keeps a 24 MP batch near 300 MB.
        let threads = num_cpus::get_physical().clamp(1, 4);
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let total = photos.len();
        let done = AtomicUsize::new(0);
        let infos = pool.install(|| {
            photos
                .par_iter()
                .map(|p| {
                    let path = Path::new(&p.path);
                    let result = book::make_thumbnail(path);
                    let n = done.fetch_add(1, Ordering::SeqCst) + 1;
                    let _ = app.emit("book://progress", BookProgress { done: n, total });
                    match result {
                        Ok(t) => {
                            let face = session.as_ref().and_then(|s| {
                                let mut s = s.lock();
                                face::detect(&mut s, &t.small).ok()
                            });
                            let face = face.and_then(|f| book::largest_face(&f, t.small.width(), t.small.height()));
                            thumbs.insert(p.id.clone(), t.jpeg);
                            BookPhotoInfo {
                                id: p.id.clone(),
                                path: p.path.clone(),
                                name: book::file_name(path),
                                width: t.width,
                                height: t.height,
                                taken_at: t.taken_at,
                                face,
                                error: None,
                            }
                        }
                        Err(e) => BookPhotoInfo {
                            id: p.id.clone(),
                            path: p.path.clone(),
                            name: book::file_name(path),
                            width: 0,
                            height: 0,
                            taken_at: None,
                            face: None,
                            error: Some(e.to_string()),
                        },
                    }
                })
                .collect::<Vec<_>>()
        });
        log::info!("book: loaded {} of {} photos", infos.iter().filter(|i| i.error.is_none()).count(), total);
        Ok(infos)
    })
    .await
    .map_err(|e| task_failed("book_add_photos", e))?
}

#[tauri::command]
pub fn book_thumb(state: State<'_, AppState>, id: String) -> Result<Response> {
    Ok(Response::new(state.book_thumbs.get(&id)?.as_ref().clone()))
}

#[derive(Debug, Deserialize)]
pub struct RenderPhotoArgs {
    pub path: String,
    pub crop: NormRect,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn book_render_photo(args: RenderPhotoArgs) -> Result<Response> {
    tauri::async_runtime::spawn_blocking(move || {
        let rgb = book::render_crop(Path::new(&args.path), args.crop, args.width, args.height)?;
        Ok(Response::new(book::to_rgba(&rgb)))
    })
    .await
    .map_err(|e| task_failed("book_render_photo", e))?
}

#[tauri::command]
pub fn book_clear(state: State<'_, AppState>) {
    state.book_thumbs.clear();
}

#[tauri::command]
pub async fn book_expand_paths(paths: Vec<String>) -> Result<Expanded> {
    tauri::async_runtime::spawn_blocking(move || Ok(book::expand_paths(&paths)))
        .await
        .map_err(|e| task_failed("book_expand_paths", e))?
}

#[tauri::command]
pub async fn book_find_in_folder(folder: String, names: Vec<String>) -> Result<HashMap<String, String>> {
    tauri::async_runtime::spawn_blocking(move || Ok(book::find_in_folder(Path::new(&folder), &names)))
        .await
        .map_err(|e| task_failed("book_find_in_folder", e))?
}

#[tauri::command]
pub async fn book_read_project(path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || book::read_project(Path::new(&path)))
        .await
        .map_err(|e| task_failed("book_read_project", e))?
}

/// Not licence-gated: saving the operator's work is not producing output.
#[tauri::command]
pub async fn book_write_project(path: String, text: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || book::write_project(Path::new(&path), &text))
        .await
        .map_err(|e| task_failed("book_write_project", e))?
}

fn app_data(app: &AppHandle) -> Result<PathBuf> {
    app.path().app_data_dir().map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn book_autosave_write(app: AppHandle, text: String) -> Result<()> {
    let path = book::autosave_path(&app_data(&app)?);
    tauri::async_runtime::spawn_blocking(move || book::write_project(&path, &text))
        .await
        .map_err(|e| task_failed("book_autosave_write", e))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Autosave {
    pub text: String,
    pub saved_at_ms: u64,
}

#[tauri::command]
pub async fn book_autosave_read(app: AppHandle) -> Result<Option<Autosave>> {
    let path = book::autosave_path(&app_data(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        if !path.is_file() {
            return Ok(None);
        }
        let text = book::read_project(&path)?;
        let saved_at_ms = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Ok(Some(Autosave { text, saved_at_ms }))
    })
    .await
    .map_err(|e| task_failed("book_autosave_read", e))?
}

#[tauri::command]
pub fn book_autosave_clear(app: AppHandle) -> Result<()> {
    let path = book::autosave_path(&app_data(&app)?);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::Io { path: path.display().to_string(), source: e }),
    }
}

#[derive(Debug, Deserialize)]
pub struct StageSheetArgs {
    pub index: u32,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub async fn book_stage_sheet(args: StageSheetArgs) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(book::stage_sheet(&book::staging_dir(), args.index, &args.bytes)?.display().to_string())
    })
    .await
    .map_err(|e| task_failed("book_stage_sheet", e))?
}

#[tauri::command]
pub fn book_clear_staged() {
    book::clear_staged(&book::staging_dir());
}
```

In `src-tauri/src/lib.rs`: add `pub mod book_commands;` and append to `generate_handler!`:

```rust
            book_commands::book_add_photos,
            book_commands::book_thumb,
            book_commands::book_render_photo,
            book_commands::book_clear,
            book_commands::book_expand_paths,
            book_commands::book_find_in_folder,
            book_commands::book_read_project,
            book_commands::book_write_project,
            book_commands::book_autosave_write,
            book_commands::book_autosave_read,
            book_commands::book_autosave_clear,
            book_commands::book_stage_sheet,
            book_commands::book_clear_staged,
```

- [ ] **Step 6: Add the TypeScript bindings**

Append to `src/lib/tauri.ts`:

```ts
// --- photo book -----------------------------------------------------------

export interface BookPhotoInfo {
  id: string
  path: string
  name: string
  width: number
  height: number
  takenAt: string | null
  face: { x: number; y: number; w: number; h: number } | null
  /** Why the file could not be read; the other fields are then empty. */
  error: string | null
}

export interface BookProgress {
  done: number
  total: number
}

export function bookAddPhotos(photos: { id: string; path: string }[]): Promise<BookPhotoInfo[]> {
  return invoke('book_add_photos', { photos })
}

export function bookThumb(id: string): Promise<ArrayBuffer> {
  return invoke('book_thumb', { id })
}

/** RGBA pixels, exactly `width` x `height`. */
export function bookRenderPhoto(args: {
  path: string
  crop: { x: number; y: number; w: number; h: number }
  width: number
  height: number
}): Promise<ArrayBuffer> {
  return invoke('book_render_photo', { args })
}

export function bookClear(): Promise<void> {
  return invoke('book_clear')
}

export function bookExpandPaths(paths: string[]): Promise<{ files: string[]; skipped: string[] }> {
  return invoke('book_expand_paths', { paths })
}

/** Keys are lower-cased file names. */
export function bookFindInFolder(folder: string, names: string[]): Promise<Record<string, string>> {
  return invoke('book_find_in_folder', { folder, names })
}

export function bookReadProject(path: string): Promise<string> {
  return invoke('book_read_project', { path })
}

export function bookWriteProject(path: string, text: string): Promise<void> {
  return invoke('book_write_project', { path, text })
}

export function bookAutosaveWrite(text: string): Promise<void> {
  return invoke('book_autosave_write', { text })
}

export function bookAutosaveRead(): Promise<{ text: string; savedAtMs: number } | null> {
  return invoke('book_autosave_read')
}

export function bookAutosaveClear(): Promise<void> {
  return invoke('book_autosave_clear')
}

export function bookStageSheet(index: number, bytes: ArrayBuffer): Promise<string> {
  return invoke('book_stage_sheet', { args: { index, bytes } })
}

export function bookClearStaged(): Promise<void> {
  return invoke('book_clear_staged')
}

export function onBookProgress(handler: (progress: BookProgress) => void): Promise<UnlistenFn> {
  return listen<BookProgress>('book://progress', (event) => handler(event.payload))
}
```

Note: `bookStageSheet` passes bytes the same way `saveFile` already does (`{ args: { ..., bytes: ArrayBuffer } }` into a `Vec<u8>` field), which this app already relies on.

- [ ] **Step 7: Build and test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --profile perf --lib && npx tsc --noEmit`
Expected: all Rust unit tests pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/image_io.rs src-tauri/src/book.rs src-tauri/src/book_commands.rs src-tauri/src/state.rs src-tauri/src/lib.rs src/lib/tauri.ts
git commit -m "Photo Book: thumbnails, frame crops, folders and project files in Rust"
```

---

### Task 10: Rust: several sheets in one print job

**Files:**
- Modify: `src-tauri/src/printing.rs`
- Modify: `src-tauri/src/commands.rs` (new `print_sheets` command)
- Modify: `src-tauri/src/lib.rs` (register it)
- Modify: `src/lib/tauri.ts` (`printSheets`)

**Interfaces:**
- Produces: `printing::MultiPrintJob { printer: Option<String>, paths: Vec<String>, width_mm, height_mm, copies (default 1), job_name: Option<String> }`, `printing::print_many(job) -> Result<()>`; command `print_sheets(job)` (licence-gated); TS `printSheets(job: { printer?; paths; widthMm; heightMm; copies?; jobName? }): Promise<void>`.

- [ ] **Step 1: Add the job type**

In `src-tauri/src/printing.rs`, below `PrintJob`:

```rust
/// A book: several staged sheets, printed as one job in the queue.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiPrintJob {
    pub printer: Option<String>,
    /// Sheet images on disk, in order (`book_stage_sheet`).
    pub paths: Vec<String>,
    pub width_mm: f64,
    pub height_mm: f64,
    /// Whole-book copies, collated.
    #[serde(default = "one")]
    pub copies: u32,
    pub job_name: Option<String>,
}
```

- [ ] **Step 2: Split `print` into a shared page loop**

Inside `mod imp` (Windows), replace `pub fn print(job: PrintJob) -> Result<()> { ... }` with the three functions below. `print_pages` is the old body generalised: the DC setup is unchanged, the per-page block now fetches each page's image through `page(i)` and names the sheet in every error.

```rust
    /// One print job of `count` pages, the `i`-th drawn from `page(i)`.
    fn print_pages(
        printer: Option<String>,
        job_name: &str,
        width_mm: f64,
        height_mm: f64,
        count: usize,
        page: &dyn Fn(usize) -> Result<image::RgbImage>,
    ) -> Result<()> {
        let printer = match printer.filter(|p| !p.is_empty()) {
            Some(p) => p,
            None => default_printer()
                .ok_or_else(|| AppError::Other("no printer is installed".into()))?,
        };
        let name = wide(&printer);
        let doc_name = wide(job_name);

        unsafe {
            // Use whatever was chosen in the driver's dialog. Without this the
            // DC is created from the driver's defaults and the operator's
            // quality and paper choices are silently dropped.
            let devmode = saved_devmodes().lock().get(&printer).cloned();
            let hdc = match devmode.as_ref() {
                Some(bytes) => {
                    log::info!("printing with the custom settings saved for {printer}");
                    CreateDCW(None, PCWSTR(name.as_ptr()), None, Some(bytes.as_ptr() as *const DEVMODEW))
                }
                None => CreateDCW(None, PCWSTR(name.as_ptr()), None, None),
            };
            if hdc.is_invalid() {
                return Err(AppError::Other(format!("could not open {printer}")));
            }

            let dpi_x = GetDeviceCaps(Some(hdc), LOGPIXELSX);
            let dpi_y = GetDeviceCaps(Some(hdc), LOGPIXELSY);
            // The driver cannot print to the very edge; the origin of the
            // printable area sits this far inside the physical sheet.
            let off_x = GetDeviceCaps(Some(hdc), PHYSICALOFFSETX);
            let off_y = GetDeviceCaps(Some(hdc), PHYSICALOFFSETY);
            let printable_w = GetDeviceCaps(Some(hdc), HORZRES);
            let printable_h = GetDeviceCaps(Some(hdc), VERTRES);

            // True size: millimetres straight into device pixels.
            let target_w = ((width_mm / 25.4) * dpi_x as f64).round() as i32;
            let target_h = ((height_mm / 25.4) * dpi_y as f64).round() as i32;

            log::info!(
                "printing {count} page(s) to {printer}: {target_w}x{target_h} dev px at {dpi_x}x{dpi_y} DPI, \
                 printable {printable_w}x{printable_h}, offset {off_x},{off_y}"
            );
            if target_w > printable_w + off_x || target_h > printable_h + off_y {
                log::warn!(
                    "the sheet ({target_w}x{target_h}) is larger than the printable area; \
                     check the paper size in the printer's settings"
                );
            }

            let doc = DOCINFOW {
                cbSize: size_of::<DOCINFOW>() as i32,
                lpszDocName: PCWSTR(doc_name.as_ptr()),
                ..Default::default()
            };
            if StartDocW(hdc, &doc) <= 0 {
                let _ = DeleteDC(hdc);
                return Err(AppError::Other("the print job was refused".into()));
            }

            let fail = |message: String| -> Result<()> {
                let _ = EndDoc(hdc);
                let _ = DeleteDC(hdc);
                Err(AppError::Other(message))
            };

            for i in 0..count {
                let sheet = i + 1;
                let image = match page(i) {
                    Ok(image) => image,
                    Err(e) => return fail(format!("printing stopped at sheet {sheet}: {e}")),
                };
                let (src_w, src_h) = image.dimensions();
                let header = BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: src_w as i32,
                    // Negative height: our rows run top-down, Windows assumes up.
                    biHeight: -(src_h as i32),
                    biPlanes: 1,
                    biBitCount: 24,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                };
                let info = BITMAPINFO { bmiHeader: header, ..Default::default() };

                // A 24bpp DIB is BGR with every row padded to four bytes.
                let stride = ((src_w * 3 + 3) / 4 * 4) as usize;
                let mut dib = vec![0u8; stride * src_h as usize];
                for y in 0..src_h as usize {
                    let row = &mut dib[y * stride..y * stride + src_w as usize * 3];
                    for x in 0..src_w as usize {
                        let px = image.get_pixel(x as u32, y as u32);
                        row[x * 3] = px.0[2];
                        row[x * 3 + 1] = px.0[1];
                        row[x * 3 + 2] = px.0[0];
                    }
                }
                drop(image);

                if StartPage(hdc) <= 0 {
                    return fail(format!("printing stopped at sheet {sheet}: the page could not be started"));
                }
                // Halftone keeps the downscale of a 300 DPI sheet clean.
                SetStretchBltMode(hdc, HALFTONE);
                let written = StretchDIBits(
                    hdc,
                    // Shift by the unprintable margin so our sheet's origin is
                    // the physical corner of the paper, not the printable one.
                    -off_x,
                    -off_y,
                    target_w,
                    target_h,
                    0,
                    0,
                    src_w as i32,
                    src_h as i32,
                    Some(dib.as_ptr() as *const c_void),
                    &info,
                    DIB_RGB_COLORS,
                    SRCCOPY,
                );
                if written == 0 {
                    let _ = EndPage(hdc);
                    return fail(format!("printing stopped at sheet {sheet}: it could not be drawn"));
                }
                if EndPage(hdc) <= 0 {
                    return fail(format!("printing stopped at sheet {sheet}: the page could not be finished"));
                }
            }

            if EndDoc(hdc) <= 0 {
                let _ = DeleteDC(hdc);
                return Err(AppError::Other("the print job could not be closed".into()));
            }
            let _ = DeleteDC(hdc);
        }
        Ok(())
    }

    pub fn print(job: PrintJob) -> Result<()> {
        // Decode here rather than in the webview: the sheet is a 300 DPI
        // bitmap and pushing raw pixels over IPC would be pointless traffic.
        let image = image::load_from_memory(&job.png)
            .map_err(|e| AppError::Other(format!("could not decode the sheet: {e}")))?
            .to_rgb8();
        let copies = job.copies.clamp(1, 99) as usize;
        print_pages(
            job.printer,
            job.job_name.as_deref().unwrap_or("ID photo sheet"),
            job.width_mm,
            job.height_mm,
            copies,
            &|_| Ok(image.clone()),
        )?;
        log::info!("sent {copies} cop{}", if copies == 1 { "y" } else { "ies" });
        Ok(())
    }

    pub fn print_many(job: MultiPrintJob) -> Result<()> {
        let n = job.paths.len();
        if n == 0 {
            return Err(AppError::Other("there is nothing to print".into()));
        }
        let copies = job.copies.clamp(1, 99) as usize;
        let paths = job.paths;
        print_pages(
            job.printer,
            job.job_name.as_deref().unwrap_or("Photo book"),
            job.width_mm,
            job.height_mm,
            n * copies,
            &|i| {
                let path = &paths[i % n];
                let bytes = std::fs::read(path).map_err(|e| AppError::Io { path: path.clone(), source: e })?;
                Ok(image::load_from_memory(&bytes)
                    .map_err(|e| AppError::Other(format!("could not decode {path}: {e}")))?
                    .to_rgb8())
            },
        )?;
        log::info!("sent {n} sheet(s) x {copies}");
        Ok(())
    }
```

In the non-Windows `mod imp`, add:

```rust
    pub fn print_many(_job: MultiPrintJob) -> Result<()> {
        Err(AppError::Other("printing is only wired up on Windows".into()))
    }
```

Change the last line to:

```rust
pub use imp::{clear_settings, has_custom_settings, list, print, print_many, show_properties};
```

- [ ] **Step 3: Add the command and binding**

In `src-tauri/src/commands.rs`, after `print_sheet`:

```rust
#[tauri::command]
pub async fn print_sheets(job: crate::printing::MultiPrintJob) -> Result<()> {
    crate::license::require_active()?;
    tauri::async_runtime::spawn_blocking(move || crate::printing::print_many(job))
        .await
        .map_err(|e| AppError::Other(format!("print_sheets task failed: {e}")))?
}
```

Register `commands::print_sheets,` in `lib.rs` after `commands::print_sheet,`.

Append to `src/lib/tauri.ts`:

```ts
/** A whole book: staged sheet files printed as one job, copies collated. */
export function printSheets(job: {
  printer?: string
  paths: string[]
  widthMm: number
  heightMm: number
  copies?: number
  jobName?: string
}): Promise<void> {
  return invoke('print_sheets', { job })
}
```

- [ ] **Step 4: Build and run every Rust test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --profile perf -- --nocapture`
Expected: compiles; all tests pass (the GDI path has no automated test, so the ID-sheet print is re-checked by hand in Task 17).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/printing.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/tauri.ts
git commit -m "Print several staged sheets as one job"
```

---

### Task 11: The book store

**Files:**
- Create: `src/store/book.ts`
- Test: `src/store/book.test.ts`
- Modify: `src/store/mode.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5.
- Produces: `BookStep = 'import'|'setup'|'pages'|'print'`, `BOOK_STEPS`, `BOOK_STEP_LABELS`, `UNDO_LIMIT = 50`, `COALESCE_MS = 800`, `FrameSelection`, `useBook` with state `{ step, status: 'empty'|'loading'|'ready', progress, loadErrors, notice, book, missing: string[], past, future, dirty, filePath, selectedPage, selectedFrame, fillError }` and actions `setStep, startLoading, setProgress, photosAdded(photos, errors, duplicates), loadFailed(message), update(change), updateCoalesced(key, change), beginGesture(), endGesture(), undo(), redo(), selectPage(i), selectFrame(sel), buildPages(): boolean, opened(book, path, missing, dirty), setMissing(ids), markSaved(path), dismissLoadErrors(), reset()`.
- `AppMode` becomes `'id' | 'edit' | 'book'`.

- [ ] **Step 1: Write the failing test**

`src/store/book.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/book.test.ts`
Expected: FAIL, cannot resolve `./book`.

- [ ] **Step 3: Write the store**

`src/store/book.ts`:

```ts
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
    set({ coalesceKey: key, coalesceAt: now })
  },

  beginGesture: () => set((s) => ({ gestureStart: s.book })),
  endGesture: () => {
    const { gestureStart: start, book, past } = get()
    if (!start) return
    const changed = start !== book && JSON.stringify(start) !== JSON.stringify(book)
    set(changed ? { gestureStart: null, past: [...past, start].slice(-UNDO_LIMIT), future: [] } : { gestureStart: null, book: start })
  },

  undo: () => {
    const s = get()
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
    set({
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
      selectedPage: 0,
      selectedFrame: null,
      step: book.pages.length ? 'pages' : 'setup',
    }),

  setMissing: (missing) => set({ missing }),
  markSaved: (filePath) => set({ filePath, dirty: false }),

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
```

- [ ] **Step 4: Extend the mode store**

In `src/store/mode.ts`, change the type and the reader:

```ts
export type AppMode = 'id' | 'edit' | 'book'

function readMode(): AppMode {
  try {
    const stored = window.localStorage.getItem(MODE_KEY)
    return stored === 'edit' || stored === 'book' ? stored : 'id'
  } catch {
    // Private mode, blocked storage, or tests with no window.
    return 'id'
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass. If `tsc` reports `cardAt` in `ImportStep.tsx` narrowing `AppMode`, leave it; Task 13 replaces that function.

- [ ] **Step 6: Commit**

```bash
git add src/store/book.ts src/store/book.test.ts src/store/mode.ts
git commit -m "Photo Book: store with undo, coalesced edits and gestures"
```

---

### Task 12: Painting pages in the browser, and the fonts

**Files:**
- Modify: `package.json`, `package-lock.json` (fonts)
- Modify: `src/main.tsx` (font CSS imports)
- Create: `src/features/book/bookPaint.ts`

**Interfaces:**
- Consumes: `pageDraw, pageText, fontCss, Measure, DrawFrame, PageDraw, TextLine` (Task 8), `planSheets` results, `cutLines, pagesOnSheet, LABEL_SIZE_MM` (Task 7), `bookThumb, bookRenderPhoto` (Task 9), `applyEnhance, applyEnhanceInStrips, NEUTRAL_ENHANCE` (`enhance.ts`), `CUT_MARK_WIDTH_MM` (`layout.ts`), `autoEnhance`.
- Produces: `thumbImage(id): Promise<HTMLImageElement>`, `thumbSrc(id): Promise<string>`, `thumbPixels(id): Promise<ImageData>`, `clearThumbCache()`, `PhotoSource`, `previewSource(book)`, `printSource(book)`, `measureText: Measure`, `ensureFonts(): Promise<void>`, `paintPage(ctx, draw, text, options)`, `renderPage(book, index, { dpi, source, preview, missing? }): Promise<OffscreenCanvas>`, `renderSheet(book, plan, sheetIndex, { dpi, source, preview, missing? }): Promise<OffscreenCanvas>`, `pageLabel(book, index): string`, `canvasBytes(canvas, type, quality?): Promise<Uint8Array>`.

- [ ] **Step 1: Install the fonts**

Run: `npm install @fontsource/playfair-display@^5 @fontsource/great-vibes@^5`
Expected: both added to `dependencies`.

In `src/main.tsx`, after `import './styles/index.css'` add:

```ts
// Cover fonts for Photo Book, bundled so they work offline.
import '@fontsource/playfair-display/700.css'
import '@fontsource/great-vibes/400.css'
```

- [ ] **Step 2: Write `bookPaint.ts`**

`src/features/book/bookPaint.ts`:

```ts
/**
 * Pixels for the book: thumbnails for the screen, frame-sized crops from Rust
 * for print. Both go through `paintPage`, so the screen shows what prints.
 */

import { pageDraw, pageText, fontCss, type DrawFrame, type Measure, type PageDraw, type TextLine } from '../../lib/bookDraw'
import { cutLines, LABEL_SIZE_MM, pagesOnSheet, type SheetPlan } from '../../lib/bookSheets'
import type { Book, BookFont } from '../../lib/bookTypes'
import { applyEnhance, applyEnhanceInStrips, NEUTRAL_ENHANCE, type EnhanceSettings } from '../../lib/enhance'
import { CUT_MARK_WIDTH_MM } from '../../lib/layout'
import { bookRenderPhoto, bookThumb } from '../../lib/tauri'

// --- thumbnails -------------------------------------------------------------

const thumbs = new Map<string, Promise<HTMLImageElement>>()

export function thumbImage(id: string): Promise<HTMLImageElement> {
  let pending = thumbs.get(id)
  if (!pending) {
    pending = bookThumb(id).then(
      (bytes) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('the thumbnail could not be shown'))
          }
          img.src = url
        }),
    )
    // A failure is not cached: the photo may be relinked and loaded again.
    pending.catch(() => thumbs.delete(id))
    thumbs.set(id, pending)
  }
  return pending
}

export function thumbSrc(id: string): Promise<string> {
  return thumbImage(id).then((img) => img.src)
}

export async function thumbPixels(id: string): Promise<ImageData> {
  const img = await thumbImage(id)
  const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight)
}

export function clearThumbCache(): void {
  for (const pending of thumbs.values()) pending.then((img) => URL.revokeObjectURL(img.src)).catch(() => {})
  thumbs.clear()
}

// --- photo sources ----------------------------------------------------------

/** The frame's photo at exactly `width` x `height` px, or null to leave it blank. */
export type PhotoSource = (frame: DrawFrame, width: number, height: number) => Promise<CanvasImageSource | null>

const isNeutral = (e: Required<EnhanceSettings>) =>
  (Object.keys(NEUTRAL_ENHANCE) as (keyof EnhanceSettings)[]).every((k) => e[k] === NEUTRAL_ENHANCE[k])

export function previewSource(book: Book): PhotoSource {
  return async (frame, width, height) => {
    if (!frame.photoId || !frame.source) return null
    const photo = book.photos.find((p) => p.id === frame.photoId)
    const img = await thumbImage(frame.photoId).catch(() => null)
    if (!img || !photo) return null
    const s = frame.source
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, s.x * img.naturalWidth, s.y * img.naturalHeight, s.w * img.naturalWidth, s.h * img.naturalHeight, 0, 0, width, height)
    if (!isNeutral(photo.enhance)) {
      const out = applyEnhance(ctx.getImageData(0, 0, width, height), photo.enhance)
      ctx.putImageData(new ImageData(out.data as Uint8ClampedArray, width, height), 0, 0)
    }
    return canvas
  }
}

export function printSource(book: Book): PhotoSource {
  return async (frame, width, height) => {
    if (!frame.photoId || !frame.source) return null
    const photo = book.photos.find((p) => p.id === frame.photoId)
    if (!photo) return null
    const bytes = await bookRenderPhoto({ path: photo.path, crop: frame.source, width, height })
    let image = { width, height, data: new Uint8ClampedArray(bytes) }
    if (!isNeutral(photo.enhance)) image = applyEnhanceInStrips(image, photo.enhance) as typeof image
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')!.putImageData(new ImageData(image.data, width, height), 0, 0)
    return canvas
  }
}

// --- text -------------------------------------------------------------------

let measureContext: OffscreenCanvasRenderingContext2D | null = null

export const measureText: Measure = (text, font: BookFont, sizeMm) => {
  measureContext ??= new OffscreenCanvas(1, 1).getContext('2d')
  if (!measureContext) return text.length * sizeMm * 0.55
  const PX_PER_MM = 10
  measureContext.font = fontCss(font, sizeMm * PX_PER_MM)
  return measureContext.measureText(text).width / PX_PER_MM
}

export async function ensureFonts(): Promise<void> {
  const fonts: BookFont[] = ['archivo', 'playfair', 'greatvibes']
  await Promise.all(fonts.map((f) => document.fonts.load(fontCss(f, 48)).catch(() => [])))
}

// --- painting ---------------------------------------------------------------

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export interface PaintOptions {
  pxPerMm: number
  /** Where the trim's top-left corner lands, in canvas pixels. */
  originPx: { x: number; y: number }
  source: PhotoSource
  /** Draw placeholders for empty and missing frames. */
  preview: boolean
}

export async function paintPage(ctx: Context2D, draw: PageDraw, text: TextLine[], o: PaintOptions): Promise<void> {
  const px = (mm: number) => mm * o.pxPerMm
  const b = draw.bleedMm
  ctx.fillStyle = draw.color
  ctx.fillRect(o.originPx.x - px(b), o.originPx.y - px(b), px(draw.page.widthMm + 2 * b), px(draw.page.heightMm + 2 * b))
  for (const frame of draw.frames) {
    const x = Math.round(o.originPx.x + px(frame.rect.x))
    const y = Math.round(o.originPx.y + px(frame.rect.y))
    const w = Math.round(o.originPx.x + px(frame.rect.x + frame.rect.w)) - x
    const h = Math.round(o.originPx.y + px(frame.rect.y + frame.rect.h)) - y
    if (w < 1 || h < 1) continue
    if (frame.missing || !frame.photoId) {
      if (o.preview) {
        ctx.fillStyle = frame.missing ? '#F4C7C3' : 'rgba(0, 0, 0, 0.07)'
        ctx.fillRect(x, y, w, h)
      }
      continue
    }
    const image = await o.source(frame, w, h).catch(() => null)
    if (image) ctx.drawImage(image, x, y, w, h)
  }
  for (const line of text) {
    ctx.save()
    const size = px(line.sizeMm)
    ctx.font = fontCss(line.font, size)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = line.color
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
    ctx.shadowBlur = size * 0.15
    ctx.fillText(line.text, o.originPx.x + px(line.x), o.originPx.y + px(line.baseline))
    ctx.restore()
  }
}

export interface RenderOptions {
  dpi: number
  source: PhotoSource
  preview: boolean
  missing?: ReadonlySet<string>
}

/** One page, trimmed (no bleed), at `dpi`. */
export async function renderPage(book: Book, index: number, o: RenderOptions): Promise<OffscreenCanvas> {
  const draw = pageDraw(book, book.pages[index], { missing: o.missing })
  const pxPerMm = o.dpi / 25.4
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(draw.page.widthMm * pxPerMm)), Math.max(1, Math.round(draw.page.heightMm * pxPerMm)))
  const ctx = canvas.getContext('2d')!
  await paintPage(ctx, draw, pageText(book, index, measureText), { pxPerMm, originPx: { x: 0, y: 0 }, source: o.source, preview: o.preview })
  return canvas
}

/** "Cover", then inside pages from 1. */
export function pageLabel(book: Book, index: number): string {
  if (book.pages[0]?.layoutId === 'cover') return index === 0 ? 'Cover' : String(index)
  return String(index + 1)
}

/** One print sheet with its pages, cut marks and page numbers. */
export async function renderSheet(book: Book, plan: SheetPlan, sheetIndex: number, o: RenderOptions): Promise<OffscreenCanvas> {
  if (!plan.ok) throw new Error(plan.message)
  const pxPerMm = o.dpi / 25.4
  const px = (mm: number) => mm * pxPerMm
  const canvas = new OffscreenCanvas(Math.round(px(plan.paper.widthMm)), Math.round(px(plan.paper.heightMm)))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const pages = pagesOnSheet(sheetIndex, plan.perSheet, book.pages.length)
  for (const [slotIndex, pageIndex] of pages.entries()) {
    const slot = plan.slots[slotIndex]
    const draw = pageDraw(book, book.pages[pageIndex], { bleedMm: plan.bleedMm, missing: o.missing })
    ctx.save()
    if (slot.rotated) {
      // Page (u, v) lands at (trim.x + trim.w - v, trim.y + u): a quarter turn clockwise.
      ctx.translate(px(slot.trim.x + slot.trim.w), px(slot.trim.y))
      ctx.rotate(Math.PI / 2)
    } else {
      ctx.translate(px(slot.trim.x), px(slot.trim.y))
    }
    await paintPage(ctx, draw, pageText(book, pageIndex, measureText), { pxPerMm, originPx: { x: 0, y: 0 }, source: o.source, preview: o.preview })
    ctx.restore()
    if (slot.labelAt) {
      ctx.fillStyle = '#9E9E9E'
      ctx.font = fontCss('archivo', px(LABEL_SIZE_MM))
      ctx.textAlign = 'center'
      ctx.fillText(pageLabel(book, pageIndex), px(slot.labelAt.x), px(slot.labelAt.y))
    }
  }

  ctx.strokeStyle = 'rgb(158, 158, 158)'
  ctx.lineWidth = Math.max(1, px(CUT_MARK_WIDTH_MM))
  ctx.beginPath()
  for (const l of cutLines(plan, pages.length)) {
    ctx.moveTo(px(l.x1), px(l.y1))
    ctx.lineTo(px(l.x2), px(l.y2))
  }
  ctx.stroke()
  return canvas
}

export async function canvasBytes(canvas: OffscreenCanvas, type: 'image/jpeg' | 'image/png', quality = 0.95): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type, quality })
  return new Uint8Array(await blob.arrayBuffer())
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`applyEnhance` takes a `Bitmap`; `ImageData` satisfies it. If `applyEnhanceInStrips`'s return type is `Bitmap`, the cast above is what keeps `data` typed as `Uint8ClampedArray`.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/features/book/bookPaint.ts
git commit -m "Photo Book: paint pages and sheets, bundle cover fonts"
```

---

### Task 13: Import card, the Photo Book window and Setup

**Files:**
- Create: `src/features/book/bookPipeline.ts`
- Create: `src/features/book/BookApp.tsx`
- Create: `src/features/book/SetupStep.tsx`
- Create: `src/features/book/ThumbImg.tsx`
- Modify: `src/features/import/ImportStep.tsx` (third card, many files, folders)
- Modify: `src/features/edit/PrintExportStep.tsx` (export `LengthField`)
- Modify: `src/app/App.tsx` (render `BookApp`)

**Interfaces:**
- Consumes: store (Task 11), bindings (Task 9), `planSheets` (Task 7), `editPaper`, UI kit.
- Produces: `loadBookPhotos(paths): Promise<void>`, `toBookPhoto(info): BookPhoto`, `newPhotoId(): string`, `paperMmOf(book): SizeMm`, `bookPlan(book): SheetPlan`; components `BookApp`, `SetupCanvas`, `SetupPanel`, `ThumbImg`; `LengthField` exported from `PrintExportStep.tsx`.

- [ ] **Step 1: Write the pipeline**

`src/features/book/bookPipeline.ts`:

```ts
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
```

- [ ] **Step 2: Write the thumbnail component**

`src/features/book/ThumbImg.tsx`:

```tsx
import { useEffect, useState } from 'react'

import { thumbSrc } from './bookPaint'

export function ThumbImg({ id, className, style }: { id: string; className?: string; style?: React.CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSrc(null)
    thumbSrc(id).then((s) => live && setSrc(s)).catch(() => {})
    return () => {
      live = false
    }
  }, [id])
  if (!src) return <div className={className} style={{ ...style, background: 'var(--color-neutral-200)' }} />
  return <img src={src} alt="" draggable={false} className={className} style={{ ...style, objectFit: 'cover' }} />
}
```

- [ ] **Step 3: Export `LengthField`**

In `src/features/edit/PrintExportStep.tsx`, change `function LengthField(` to `export function LengthField(`. Nothing else changes.

- [ ] **Step 4: Write Setup**

`src/features/book/SetupStep.tsx`:

```tsx
/**
 * Setup: every book-wide choice, with the print sheet drawn to scale so the
 * operator sees how many pages land on each sheet before building.
 */

import { useState } from 'react'
import { ask, open as openDialog } from '@tauri-apps/plugin-dialog'

import { Button, Icon, ICONS, Notice, Section, Segmented, Slider, Swatch, TextInput } from '../../app/components/ui'
import { setCover } from '../../lib/bookModel'
import { BOOK_PAPER_CHOICES, BOOK_SIZE_ORDER, BOOK_SIZES, isSquare, type BookOrientation, type BookSizeId } from '../../lib/bookSizes'
import { clampStyle, DEFAULT_COVER, EDGE_TO_EDGE, PAGE_COUNT_OPTIONS, WHITE_BORDER, type BookStyle } from '../../lib/bookTypes'
import { editPaper, type EditPaperChoice, type LengthUnit } from '../../lib/editPaper'
import { useBook } from '../../store/book'
import { LengthField } from '../edit/PrintExportStep'
import { bookPlan, loadBookPhotos } from './bookPipeline'

const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp']
export const PAGE_COLOURS = [
  { hex: '#FFFFFF', label: 'White' },
  { hex: '#F4EFE6', label: 'Cream' },
  { hex: '#F3E1DD', label: 'Blush' },
  { hex: '#111111', label: 'Black' },
]

export async function pickMorePhotos(): Promise<void> {
  const selected = await openDialog({ multiple: true, filters: [{ name: 'Photos', extensions: EXTENSIONS }] })
  if (Array.isArray(selected)) await loadBookPhotos(selected)
  else if (typeof selected === 'string') await loadBookPhotos([selected])
}

export function SetupCanvas() {
  const book = useBook((s) => s.book)
  const plan = bookPlan(book)
  if (!plan.ok) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />}>{plan.message}</Notice>
      </div>
    )
  }
  const paper = editPaper(book.paper, book.customPaper)
  const { widthMm: W, heightMm: H } = plan.paper
  const b = plan.bleedMm
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8" style={{ containerType: 'size' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="shadow-lg" style={{ height: '78cqh', maxWidth: '88cqw', background: '#FFFFFF' }}>
        {plan.slots.map((slot, i) => (
          <g key={i}>
            {b > 0 && (
              <rect x={slot.trim.x - b} y={slot.trim.y - b} width={slot.trim.w + 2 * b} height={slot.trim.h + 2 * b} fill="none" stroke="#E57373" strokeWidth={0.4} strokeDasharray="1.5 1" />
            )}
            <rect x={slot.trim.x} y={slot.trim.y} width={slot.trim.w} height={slot.trim.h} fill={book.style.color} stroke="#9E9E9E" strokeWidth={0.4} />
            <text x={slot.trim.x + slot.trim.w / 2} y={slot.trim.y + slot.trim.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(slot.trim.w, slot.trim.h) / 5} fill="#BDBDBD" fontWeight={800}>
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
      <p className="tabular text-[15px] font-bold">
        {plan.perSheet} page{plan.perSheet === 1 ? '' : 's'} per {book.paper === 'custom' ? 'sheet' : `${paper.label} sheet`}
        {plan.borderless ? ', needs borderless printing' : ''}
      </p>
    </div>
  )
}

export function SetupPanel() {
  const book = useBook((s) => s.book)
  const update = useBook((s) => s.update)
  const updateCoalesced = useBook((s) => s.updateCoalesced)
  const fillError = useBook((s) => s.fillError)
  const loadErrors = useBook((s) => s.loadErrors)
  const notice = useBook((s) => s.notice)
  const dismiss = useBook((s) => s.dismissLoadErrors)
  const [unit, setUnit] = useState<LengthUnit>('in')
  const [showAllErrors, setShowAllErrors] = useState(false)

  const setStyle = (key: string, patch: Partial<BookStyle>) => updateCoalesced(key, (b) => ({ ...b, style: clampStyle({ ...b.style, ...patch }) }))
  const built = book.pages.length > 0

  const build = async () => {
    if (built) {
      const yes = await ask('Rebuilding replaces every page, including your changes. Rebuild the pages?', {
        title: 'Rebuild pages',
        kind: 'warning',
        okLabel: 'Rebuild',
        cancelLabel: 'Keep my pages',
      })
      if (!yes) return
    }
    useBook.getState().buildPages()
  }

  const shownErrors = showAllErrors ? loadErrors : loadErrors.slice(0, 5)

  return (
    <>
      <Section title="Photos">
        <p className="tabular text-sm">{book.photos.length} photo{book.photos.length === 1 ? '' : 's'} in the book</p>
        <Button onClick={() => void pickMorePhotos()}>Add photos…</Button>
        {notice && <Notice tone="info">{notice}</Notice>}
        {loadErrors.length > 0 && (
          <Notice tone="warn" action={<button type="button" onClick={dismiss} className="text-[13px] font-bold underline">OK</button>}>
            <span className="block font-bold">{loadErrors.length} file{loadErrors.length === 1 ? '' : 's'} could not be used</span>
            {shownErrors.map((e) => (
              <span key={e} className="block text-[13px]">{e}</span>
            ))}
            {loadErrors.length > 5 && !showAllErrors && (
              <button type="button" onClick={() => setShowAllErrors(true)} className="text-[13px] underline">
                and {loadErrors.length - 5} more
              </button>
            )}
          </Notice>
        )}
      </Section>

      <Section title="Book size">
        <Segmented<BookSizeId>
          options={BOOK_SIZE_ORDER.map((id) => ({ value: id, label: BOOK_SIZES[id].label }))}
          value={book.size}
          onChange={(size) => update((b) => ({ ...b, size }))}
          columns={5}
        />
        <p className="tabular text-xs text-muted">{BOOK_SIZES[book.size].sublabel}</p>
        <Segmented<BookOrientation>
          options={[
            { value: 'portrait', label: 'Portrait', disabled: isSquare(book.size) },
            { value: 'landscape', label: 'Landscape', disabled: isSquare(book.size) },
          ]}
          value={book.orientation}
          onChange={(orientation) => update((b) => ({ ...b, orientation }))}
          columns={2}
        />
      </Section>

      <Section title="Print paper">
        <Segmented<EditPaperChoice>
          options={BOOK_PAPER_CHOICES.map((id) => ({ value: id, label: editPaper(id, book.customPaper).label }))}
          value={book.paper}
          onChange={(paper) => update((b) => ({ ...b, paper }))}
          columns={3}
        />
        {book.paper === 'custom' && (
          <div className="flex items-end gap-2">
            <LengthField label="Width" mm={book.customPaper.widthMm} unit={unit} onChange={(widthMm) => updateCoalesced('paper-w', (b) => ({ ...b, customPaper: { ...b.customPaper, widthMm } }))} />
            <span className="pb-2 text-muted">×</span>
            <LengthField label="Height" mm={book.customPaper.heightMm} unit={unit} onChange={(heightMm) => updateCoalesced('paper-h', (b) => ({ ...b, customPaper: { ...b.customPaper, heightMm } }))} />
            <Segmented<LengthUnit> options={[{ value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }]} value={unit} onChange={setUnit} columns={2} />
          </div>
        )}
        <p className="tabular text-xs text-muted">{editPaper(book.paper, book.customPaper).sublabel}</p>
      </Section>

      <Section title="Page style">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => update((b) => ({ ...b, style: { ...WHITE_BORDER, color: b.style.color } }))}>White border</Button>
          <Button onClick={() => update((b) => ({ ...b, style: { ...EDGE_TO_EDGE, color: b.style.color } }))}>Edge to edge</Button>
        </div>
        <Slider label="Margin" value={book.style.marginMm} min={0} max={20} step={0.5} defaultValue={WHITE_BORDER.marginMm} format={(v) => `${v} mm`} onChange={(marginMm) => setStyle('margin', { marginMm })} />
        <Slider label="Gap" value={book.style.gapMm} min={0} max={10} step={0.5} defaultValue={WHITE_BORDER.gapMm} format={(v) => `${v} mm`} onChange={(gapMm) => setStyle('gap', { gapMm })} />
        <div className="grid grid-cols-4 gap-2">
          {PAGE_COLOURS.map((c) => (
            <Swatch key={c.hex} hex={c.hex} label={c.label} selected={book.style.color === c.hex} onSelect={() => update((b) => ({ ...b, style: { ...b.style, color: c.hex } }))} />
          ))}
        </div>
        {book.style.marginMm === 0 && <p className="text-xs text-muted">Edge to edge: photos run 2 mm past the cut line so a slightly off cut shows no white.</p>}
      </Section>

      <Section title="Pages">
        <Segmented<string>
          options={[{ value: 'auto', label: 'Auto' }, ...PAGE_COUNT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))]}
          value={String(book.pageCount)}
          onChange={(v) => update((b) => ({ ...b, pageCount: v === 'auto' ? 'auto' : Number(v) }))}
          columns={5}
        />
        <p className="text-xs text-muted">Inside pages. The cover is extra.</p>
      </Section>

      <Section title="Cover">
        <Segmented<'on' | 'off'>
          options={[{ value: 'on', label: 'Cover page' }, { value: 'off', label: 'No cover' }]}
          value={book.cover ? 'on' : 'off'}
          onChange={(v) => update((b) => setCover(b, v === 'on' ? (b.cover ?? DEFAULT_COVER) : null))}
          columns={2}
        />
        {book.cover && (
          <>
            <TextInput value={book.cover.title} placeholder="Title, e.g. Juan & Maria" onChange={(title) => updateCoalesced('cover-title', (b) => (b.cover ? setCover(b, { ...b.cover, title }) : b))} />
            <TextInput value={book.cover.subtitle} placeholder="Subtitle, e.g. 12 October 2026" onChange={(subtitle) => updateCoalesced('cover-subtitle', (b) => (b.cover ? setCover(b, { ...b.cover, subtitle }) : b))} />
          </>
        )}
      </Section>

      <Section title={built ? 'Rebuild' : 'Build'} last>
        {fillError && <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />}>{fillError}</Notice>}
        <Button variant="primary" block onClick={() => void build()} disabled={book.photos.length === 0}>
          {built ? 'Rebuild pages' : 'Build pages'}
        </Button>
      </Section>
    </>
  )
}
```

- [ ] **Step 5: Write the window**

`src/features/book/BookApp.tsx`:

```tsx
/**
 * Photo Book's window: the same shell as the other modes over its own steps.
 * Pages and Print & Export are added in later tasks; until then those steps
 * render nothing.
 */

import { useCallback, useEffect } from 'react'
import { ask } from '@tauri-apps/plugin-dialog'

import { ActionBar, StepHeader } from '../../app/Shell'
import { bookAutosaveClear, bookClear, onBookProgress, type RuntimeInfo } from '../../lib/tauri'
import { BOOK_STEP_LABELS, BOOK_STEPS, useBook, type BookStep } from '../../store/book'
import { ImportStep } from '../import/ImportStep'
import { clearThumbCache } from './bookPaint'
import { SetupCanvas, SetupPanel } from './SetupStep'

/** True when there is nothing unsaved, or the operator agrees to lose it. */
export async function confirmDiscard(): Promise<boolean> {
  if (!useBook.getState().dirty) return true
  return ask('This book has changes that are not saved. Start a new one anyway?', {
    title: 'Unsaved book',
    kind: 'warning',
    okLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  })
}

export async function newCustomer(): Promise<void> {
  if (!(await confirmDiscard())) return
  await bookClear().catch(() => {})
  clearThumbCache()
  void bookAutosaveClear().catch(() => {})
  useBook.getState().reset()
}

function canEnter(step: BookStep): boolean {
  const { book } = useBook.getState()
  if (step === 'setup') return book.photos.length > 0
  if (step === 'pages' || step === 'print') return book.pages.length > 0
  return false
}

export function BookApp({ runtime }: { runtime: RuntimeInfo | null }) {
  const step = useBook((s) => s.step)
  const status = useBook((s) => s.status)
  const pageCount = useBook((s) => s.book.pages.length)
  const setStep = useBook((s) => s.setStep)

  const index = BOOK_STEPS.indexOf(step)
  const nextStep = BOOK_STEPS[index + 1]
  const previousStep = index > 1 ? BOOK_STEPS[index - 1] : undefined

  const goNext = useCallback(() => {
    if (step === 'setup' && pageCount === 0) {
      useBook.getState().buildPages()
      return
    }
    if (nextStep && canEnter(nextStep)) setStep(nextStep)
  }, [step, pageCount, nextStep, setStep])
  const goBack = useCallback(() => previousStep && setStep(previousStep), [previousStep, setStep])

  useEffect(() => {
    const unlisten = onBookProgress((p) => useBook.getState().setProgress(p))
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key.toLowerCase()
      if (event.key === 'ArrowRight') goNext()
      else if (event.key === 'ArrowLeft') goBack()
      else if (key === 'n') void newCustomer()
      else if (key === 'p' && canEnter('print')) setStep('print')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goBack, setStep])

  const showChrome = step !== 'import'
  const nextLabel = step === 'setup' && pageCount === 0 ? 'Build pages' : nextStep ? `Next: ${BOOK_STEP_LABELS[nextStep]}` : 'New book'

  return (
    <div data-app="" className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: 'var(--color-neutral-300)' }}>
      <StepHeader
        runtime={runtime}
        steps={BOOK_STEPS.map((key) => ({ key, label: BOOK_STEP_LABELS[key] }))}
        activeSteps={BOOK_STEPS}
        current={step}
        ready={status === 'ready'}
        onSelect={(key) => canEnter(key as BookStep) && setStep(key as BookStep)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ background: 'var(--canvas)' }}>
          {step === 'import' && <ImportStep />}
          {step === 'setup' && <SetupCanvas />}
        </div>
        {showChrome && (
          <aside className="flex w-[var(--panel-width)] flex-none flex-col overflow-y-auto border-l-2 border-divider" style={{ background: 'var(--panel)' }}>
            {step === 'setup' && <SetupPanel />}
          </aside>
        )}
      </div>
      {showChrome && (
        <ActionBar
          onBack={goBack}
          onNext={goNext}
          canGoBack={Boolean(previousStep)}
          nextLabel={nextLabel}
          onNewPhoto={() => void newCustomer()}
          isLast={!nextStep}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Render the mode**

In `src/app/App.tsx` import `BookApp` and change the return:

```tsx
import { BookApp } from '../features/book/BookApp'
// ...
  if (mode === 'edit') return <EditApp runtime={runtime} />
  if (mode === 'book') return <BookApp runtime={runtime} />
  return <IdApp runtime={runtime} />
```

- [ ] **Step 7: The third Import card**

In `src/features/import/ImportStep.tsx`:

1. Imports: add `import { useBook } from '../../store/book'`, `import { loadBookPhotos } from '../book/bookPipeline'`.
2. `cardAt`: return `mode === 'id' || mode === 'edit' || mode === 'book' ? mode : null`.
3. In `ImportStep`, read the book state and fold it into `busy` and the error:

```tsx
  const bookStatus = useBook((s) => s.status)
  const bookProgress = useBook((s) => s.progress)
  const bookErrors = useBook((s) => s.loadErrors)
  const dismissBookErrors = useBook((s) => s.dismissLoadErrors)
  // ...
  const busy = idStatus === 'loading' || idStatus === 'segmenting' || editStatus === 'loading' || bookStatus === 'loading'
```

and for the error notice when `mode === 'book'`, show `bookErrors.join(' · ')` with `dismissBookErrors` as the dismiss action (keep the existing ID/Photo Print notice for the other modes).

4. `openSource` stays single-file for ID and Photo Print. Add a book path:

```tsx
  const openBook = useCallback(
    (paths: string[]) => {
      setMode('book')
      void loadBookPhotos(paths)
    },
    [setMode],
  )
```

5. `pick(target)`: for `'book'` open with `multiple: true` and call `openBook(Array.isArray(selected) ? selected : selected ? [selected] : [])`.
6. Paste: if the highlighted mode is `'book'`, do not read the clipboard image; call `useBook.getState().loadFailed('Photo Book needs photo files: drop them or click the card to browse.')` and return.
7. Drag-drop `drop` branch: compute `target` first; if `target === 'book'`, call `openBook(payload.paths)` (all paths, folders allowed, no extension check) and return; otherwise keep the existing single-file logic.
8. While `bookStatus === 'loading'` render:

```tsx
  if (bookStatus === 'loading') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ background: 'var(--color-bg)' }}>
        <span className="text-[15px] font-bold">
          {bookProgress ? `Loading ${bookProgress.done} / ${bookProgress.total}` : 'Finding the photos…'}
        </span>
        <div className="relative h-1.5 w-[min(520px,80%)]" style={{ background: 'var(--color-surface)' }}>
          <div className="absolute inset-y-0 left-0" style={{ width: `${bookProgress ? (bookProgress.done / Math.max(1, bookProgress.total)) * 100 : 0}%`, background: 'var(--color-accent)' }} />
        </div>
      </div>
    )
  }
```

9. Cards: change the grid to `grid-cols-3` and add:

```tsx
          <DropCard
            mode="book"
            tour="photo-book-card"
            title="Photo Book"
            sizes="5x6 · 5x7 · 8x8 · 8x10 · A4"
            detail="Many photos laid out as pages, to cut and bind"
            highlighted={(hover ?? mode) === 'book'}
            onClick={() => void pick('book')}
          />
```

10. Help line: `Drop photos onto a card, or click one to browse. Photo Book takes many photos or a whole folder.`

- [ ] **Step 8: Typecheck and run the tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors; all tests pass (the walkthrough test only checks existing anchors).

- [ ] **Step 9: Run the app and check by hand**

Run: `npm run tauri dev`
Check:
- Three cards. Dropping a folder of photos onto Photo Book shows "Loading n / N", then Setup.
- Dropping a `.txt` and a `.heic` along with photos lists both under "could not be used".
- Dropping the same folder again from Setup's "Add photos…" adds nothing and says how many were already in the book.
- The sheet drawing shows 2 pages per A4 for 5x6, 1 for 8x10, "needs borderless printing" for 8x10 on 8R, and an error for A4 on 8R.
- Build pages moves to the Pages step (blank canvas for now).
- ID Photo and Photo Print cards still work as before.

- [ ] **Step 10: Commit**

```bash
git add src/features/book src/features/import/ImportStep.tsx src/features/edit/PrintExportStep.tsx src/app/App.tsx
git commit -m "Photo Book: import card, window and Setup step"
```

---

### Task 14: The Pages step

**Files:**
- Create: `src/features/book/useBookDrag.tsx`
- Create: `src/features/book/PageView.tsx`
- Create: `src/features/book/PageStrip.tsx`
- Create: `src/features/book/PagesPanel.tsx`
- Modify: `src/features/book/BookApp.tsx` (render the step)

**Interfaces:**
- Consumes: store (Task 11), ops (Task 5), `pageDraw, FONT_LABELS` (Task 8), `panCrop, zoomCrop, CENTRED, LOW_DPI` (Task 3), `layoutsFor, BOOK_LAYOUTS` (Task 2), `paintPage, previewSource, measureText, renderPage, thumbPixels, pageLabel, ensureFonts` (Task 12), `autoEnhance` (`enhance.ts`).
- Produces: `DragItem`, `DropTarget`, `useDrag` store, `startDrag(item, event)`, `dropTargetAt(x, y)`, `applyDrop(item, target)`, `DragLayer`; components `PageView`, `PageStrip`, `PagesPanel`, `PagesCanvas`.

- [ ] **Step 1: Pointer drag and drop**

Tauri's native file-drop handling stops HTML5 drag events inside the webview, so dragging inside the app uses pointer events.

`src/features/book/useBookDrag.tsx`:

```tsx
/**
 * Dragging inside the book: photos between frames, from the tray, back to
 * the tray, and pages along the strip. Drop targets carry `data-drop`.
 */

import { create } from 'zustand'

import { clearFrame, movePage, placePhoto, swapFrames } from '../../lib/bookModel'
import { useBook } from '../../store/book'
import { ThumbImg } from './ThumbImg'

export type DragItem =
  | { kind: 'frame'; page: number; frame: number; photoId: string }
  | { kind: 'tray'; photoId: string }
  | { kind: 'page'; index: number }

export type DropTarget = { kind: 'frame'; page: number; frame: number } | { kind: 'tray' } | { kind: 'page'; index: number }

interface DragState {
  item: DragItem | null
  x: number
  y: number
}

export const useDrag = create<DragState>(() => ({ item: null, x: 0, y: 0 }))

export function dropTargetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')
  const parts = el?.dataset.drop?.split(':') ?? []
  if (parts[0] === 'frame' && parts.length === 3) return { kind: 'frame', page: Number(parts[1]), frame: Number(parts[2]) }
  if (parts[0] === 'page' && parts.length === 2) return { kind: 'page', index: Number(parts[1]) }
  if (parts[0] === 'tray') return { kind: 'tray' }
  return null
}

export function applyDrop(item: DragItem, target: DropTarget | null): void {
  if (!target) return
  const { update, selectPage } = useBook.getState()
  if (item.kind === 'frame' && target.kind === 'frame') update((b) => swapFrames(b, item, target))
  else if (item.kind === 'frame' && target.kind === 'tray') update((b) => clearFrame(b, item))
  else if (item.kind === 'tray' && target.kind === 'frame') update((b) => placePhoto(b, target, item.photoId))
  else if (item.kind === 'page' && target.kind === 'page') {
    update((b) => movePage(b, item.index, target.index))
    selectPage(target.index)
  }
}

/** Follow the pointer until release, then drop. Call from a pointer event. */
export function startDrag(item: DragItem, start: { clientX: number; clientY: number }): void {
  useDrag.setState({ item, x: start.clientX, y: start.clientY })
  const move = (e: PointerEvent) => useDrag.setState({ x: e.clientX, y: e.clientY })
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    useDrag.setState({ item: null })
    applyDrop(item, dropTargetAt(e.clientX, e.clientY))
  }
  const cancel = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    useDrag.setState({ item: null })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
}

/** Movement smaller than this is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4

export function DragLayer() {
  const item = useDrag((s) => s.item)
  const x = useDrag((s) => s.x)
  const y = useDrag((s) => s.y)
  if (!item) return null
  const style: React.CSSProperties = { position: 'fixed', left: x - 32, top: y - 32, width: 64, height: 64, pointerEvents: 'none', zIndex: 60, opacity: 0.85 }
  if (item.kind === 'page') {
    return <div style={{ ...style, background: 'var(--color-surface)', border: '2px solid var(--color-accent)' }} />
  }
  return <ThumbImg id={item.photoId} className="shadow-lg" style={style} />
}
```

- [ ] **Step 2: The page view**

`src/features/book/PageView.tsx`:

```tsx
/**
 * The selected page, large. Drag inside a frame to move the photo; drag out
 * of it to swap with another frame or send it back to the tray; scroll to
 * zoom. Every drag or scroll burst is one undo step.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon, ICONS } from '../../app/components/ui'
import { panCrop, zoomCrop } from '../../lib/bookCrop'
import { pageDraw, type DrawFrame } from '../../lib/bookDraw'
import { photoAspect, setCrop } from '../../lib/bookModel'
import { useBook } from '../../store/book'
import { ensureFonts, measureText, paintPage, previewSource } from './bookPaint'
import { pageText } from '../../lib/bookDraw'
import { DRAG_THRESHOLD_PX, startDrag } from './useBookDrag'

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

export function PageView() {
  const book = useBook((s) => s.book)
  const index = useBook((s) => s.selectedPage)
  const missingList = useBook((s) => s.missing)
  const selected = useBook((s) => s.selectedFrame)
  const [ref, size] = useElementSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderToken = useRef(0)
  const wheelTimer = useRef<number | null>(null)
  const [fontsReady, setFontsReady] = useState(false)

  useEffect(() => {
    void ensureFonts().then(() => setFontsReady(true))
  }, [])

  const page = book.pages[index]
  const missing = useMemo(() => new Set(missingList), [missingList])
  const draw = useMemo(() => (page ? pageDraw(book, page, { missing }) : null), [book, page, missing])
  const scale = draw ? Math.max(0, Math.min((size.width - 48) / draw.page.widthMm, (size.height - 48) / draw.page.heightMm)) : 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!draw || !canvas || scale <= 0) return
    const token = ++renderToken.current
    const dpr = window.devicePixelRatio || 1
    const off = new OffscreenCanvas(Math.max(1, Math.round(draw.page.widthMm * scale * dpr)), Math.max(1, Math.round(draw.page.heightMm * scale * dpr)))
    void paintPage(off.getContext('2d')!, draw, pageText(book, index, measureText), {
      pxPerMm: scale * dpr,
      originPx: { x: 0, y: 0 },
      source: previewSource(book),
      preview: true,
    }).then(() => {
      // A newer render started meanwhile; drop this one.
      if (token !== renderToken.current) return
      canvas.width = off.width
      canvas.height = off.height
      canvas.getContext('2d')!.drawImage(off, 0, 0)
    })
  }, [draw, scale, book, index, fontsReady])

  if (!page || !draw) {
    return <div ref={ref} className="flex h-full items-center justify-center text-muted">No pages yet.</div>
  }

  const aspects = (f: DrawFrame) => {
    const photo = book.photos.find((p) => p.id === f.photoId)
    return photo ? { photo: photoAspect(photo), frame: f.rect.w / f.rect.h } : null
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>, f: DrawFrame) => {
    const store = useBook.getState()
    store.selectFrame({ page: index, frame: f.index })
    if (!f.photoId || event.button !== 0) return
    const a = aspects(f)
    if (!a) return
    const el = event.currentTarget
    const box = el.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const startCrop = store.book.pages[index].frames[f.index].crop
    const ref = { page: index, frame: f.index }
    let moved = false
    store.beginGesture()
    el.setPointerCapture(event.pointerId)

    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
      moved = true
      const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom
      if (outside) {
        // Leaving the frame turns the pan into a move: undo the pan, carry the photo.
        finish()
        useBook.getState().update((b) => setCrop(b, ref, startCrop))
        useBook.getState().endGesture()
        startDrag({ kind: 'frame', page: index, frame: f.index, photoId: f.photoId! }, e)
        return
      }
      const crop = panCrop(startCrop, a.photo, a.frame, (e.clientX - startX) / box.width, (e.clientY - startY) / box.height)
      useBook.getState().update((b) => setCrop(b, ref, crop))
    }
    const up = () => {
      finish()
      useBook.getState().endGesture()
    }
    const finish = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>, f: DrawFrame) => {
    const a = aspects(f)
    if (!a) return
    const store = useBook.getState()
    if (wheelTimer.current === null) store.beginGesture()
    else window.clearTimeout(wheelTimer.current)
    wheelTimer.current = window.setTimeout(() => {
      wheelTimer.current = null
      useBook.getState().endGesture()
    }, 400)
    const current = store.book.pages[index].frames[f.index].crop
    const crop = zoomCrop(current, a.photo, a.frame, Math.pow(1.1, -event.deltaY / 100))
    store.update((b) => setCrop(b, { page: index, frame: f.index }, crop))
  }

  return (
    <div ref={ref} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div className="relative shadow-lg" style={{ width: draw.page.widthMm * scale, height: draw.page.heightMm * scale }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {draw.frames.map((f) => {
          const isSelected = selected?.page === index && selected.frame === f.index
          return (
            <div
              key={f.index}
              data-drop={`frame:${index}:${f.index}`}
              onPointerDown={(e) => onPointerDown(e, f)}
              onWheel={(e) => onWheel(e, f)}
              className="absolute"
              style={{
                left: f.rect.x * scale,
                top: f.rect.y * scale,
                width: f.rect.w * scale,
                height: f.rect.h * scale,
                cursor: f.photoId ? 'grab' : 'default',
                outline: isSelected ? '2px solid var(--color-accent)' : undefined,
                touchAction: 'none',
              }}
            >
              {f.missing && (
                <span className="absolute left-1 top-1 bg-[var(--danger)] px-1.5 py-0.5 text-[11px] font-bold text-white">Missing</span>
              )}
              {!f.missing && f.lowRes && (
                <span className="absolute left-1 top-1 flex items-center gap-1 bg-[var(--warn-line)] px-1.5 py-0.5 text-[11px] font-bold text-white" title={`${Math.round(f.dpi ?? 0)} DPI at print size`}>
                  <Icon path={ICONS.warning} size={12} /> Low resolution
                </span>
              )}
              {!f.photoId && (
                <span className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">Drop a photo here</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: The page strip**

`src/features/book/PageStrip.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react'

import { Icon, ICONS } from '../../app/components/ui'
import { addPage, deletePage, duplicatePage, pageMmOf } from '../../lib/bookModel'
import type { Book, BookPage } from '../../lib/bookTypes'
import { useBook } from '../../store/book'
import { pageLabel, previewSource, renderPage } from './bookPaint'
import { DRAG_THRESHOLD_PX, startDrag } from './useBookDrag'

const THUMB_HEIGHT = 88

function PageThumb({ book, page, index, selected }: { book: Book; page: BookPage; index: number; selected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The photos on this page; a change to their enhance redraws the thumb.
  const photos = useMemo(() => page.frames.map((f) => book.photos.find((p) => p.id === f.photoId)), [page, book.photos])
  useEffect(() => {
    let live = true
    const dpi = THUMB_HEIGHT / (pageMmOf(book).heightMm / 25.4)
    void renderPage(book, index, { dpi: dpi * (window.devicePixelRatio || 1), source: previewSource(book), preview: true }).then((off) => {
      const canvas = canvasRef.current
      if (!live || !canvas) return
      canvas.width = off.width
      canvas.height = off.height
      canvas.getContext('2d')!.drawImage(off, 0, 0)
    })
    return () => {
      live = false
    }
    // Re-render when this page, the book's look or its photos' enhance change.
  }, [page, photos, book.size, book.orientation, book.style, book.cover, index])

  return (
    <canvas
      ref={canvasRef}
      className="block bg-white"
      style={{ height: THUMB_HEIGHT, outline: selected ? '2px solid var(--color-accent)' : '1px solid var(--color-divider)' }}
    />
  )
}

export function PageStrip() {
  const book = useBook((s) => s.book)
  const selected = useBook((s) => s.selectedPage)
  const selectPage = useBook((s) => s.selectPage)
  const update = useBook((s) => s.update)
  const isCover = book.pages[selected]?.layoutId === 'cover'

  const onPointerDown = (event: React.PointerEvent, index: number) => {
    selectPage(index)
    if (book.pages[index]?.layoutId === 'cover' || event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
      cleanup()
      startDrag({ kind: 'page', index }, e)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
  }

  const add = () => {
    const result = addPage(useBook.getState().book, selected)
    update(() => result.book)
    selectPage(result.index)
  }

  return (
    <div className="flex h-[132px] flex-none items-center gap-3 border-t-2 border-divider px-4" style={{ background: 'var(--panel)' }}>
      <div className="flex min-w-0 flex-1 items-end gap-3 overflow-x-auto py-2">
        {book.pages.map((page, i) => (
          <div key={page.id} data-drop={`page:${i}`} onPointerDown={(e) => onPointerDown(e, i)} className="flex flex-none cursor-pointer flex-col items-center gap-1" style={{ touchAction: 'none' }}>
            <PageThumb book={book} page={page} index={i} selected={i === selected} />
            <span className="tabular text-[11px] text-muted">{pageLabel(book, i)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-none flex-col gap-1.5">
        <button type="button" onClick={add} className="h-8 border border-divider px-3 text-[13px] font-bold hover:bg-[var(--hover)]">+ Page</button>
        <button type="button" onClick={() => update((b) => duplicatePage(b, selected))} disabled={isCover} className="h-8 border border-divider px-3 text-[13px] font-bold hover:bg-[var(--hover)] disabled:opacity-45">Duplicate</button>
        <button type="button" onClick={() => update((b) => deletePage(b, selected))} disabled={isCover} className="flex h-8 items-center justify-center gap-1 border border-divider px-3 text-[13px] font-bold hover:bg-[var(--hover)] disabled:opacity-45">
          <Icon path={ICONS.close} size={14} /> Delete
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: The panel**

`src/features/book/PagesPanel.tsx`:

```tsx
/**
 * Pages panel: the selected page's layout (or the cover's text), the
 * selected photo's crop and enhance, whole-book enhance, and the tray of
 * photos not yet on a page.
 */

import { useState } from 'react'
import { ask } from '@tauri-apps/plugin-dialog'

import { Button, Notice, Section, Segmented, Slider, Swatch, TextInput } from '../../app/components/ui'
import { CENTRED, MAX_ZOOM } from '../../lib/bookCrop'
import { FONT_LABELS, pageDraw } from '../../lib/bookDraw'
import { BOOK_LAYOUTS, type BookLayout } from '../../lib/bookLayouts'
import { clearFrame, setCover, setCrop, setEnhanceAll, setPageLayout, setPhotoEnhance, unusedPhotos } from '../../lib/bookModel'
import type { BookCover, BookFont, CoverPosition } from '../../lib/bookTypes'
import { autoEnhance, NEUTRAL_ENHANCE, type EnhanceSettings } from '../../lib/enhance'
import { useBook } from '../../store/book'
import { thumbPixels } from './bookPaint'
import { pickMorePhotos } from './SetupStep'
import { ThumbImg } from './ThumbImg'
import { DRAG_THRESHOLD_PX, startDrag } from './useBookDrag'

function LayoutIcon({ layout, active, onPick }: { layout: BookLayout; active: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} title={layout.label} aria-pressed={active} className="p-1" style={{ outline: active ? '2px solid var(--color-accent)' : '1px solid var(--color-divider)' }}>
      <svg viewBox="0 0 40 50" className="block h-[50px] w-[40px]">
        <rect width="40" height="50" fill="var(--color-surface)" />
        {layout.frames.map((f, i) => (
          <rect key={i} x={2 + f.x * 36 + 0.5} y={2 + f.y * 46 + 0.5} width={f.w * 36 - 1} height={f.h * 46 - 1} fill="var(--color-neutral-400)" rx={f.fit ? 0 : 0} />
        ))}
      </svg>
    </button>
  )
}

function CoverSection({ cover }: { cover: BookCover }) {
  const updateCoalesced = useBook((s) => s.updateCoalesced)
  const update = useBook((s) => s.update)
  const set = (key: string, patch: Partial<BookCover>) => updateCoalesced(key, (b) => (b.cover ? setCover(b, { ...b.cover, ...patch }) : b))
  return (
    <Section title="Cover">
      <TextInput value={cover.title} placeholder="Title" onChange={(title) => set('cover-title', { title })} />
      <TextInput value={cover.subtitle} placeholder="Subtitle" onChange={(subtitle) => set('cover-subtitle', { subtitle })} />
      <Segmented<BookFont> options={(['playfair', 'greatvibes', 'archivo'] as const).map((f) => ({ value: f, label: FONT_LABELS[f] }))} value={cover.font} onChange={(font) => set('cover-font', { font })} columns={3} />
      <Segmented<CoverPosition> options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} value={cover.position} onChange={(position) => set('cover-position', { position })} columns={3} />
      <div className="grid grid-cols-4 gap-2">
        {[{ hex: '#FFFFFF', label: 'White' }, { hex: '#111111', label: 'Black' }, { hex: '#C9A227', label: 'Gold' }, { hex: '#F4EFE6', label: 'Ivory' }].map((c) => (
          <Swatch key={c.hex} hex={c.hex} label={c.label} selected={cover.textColor === c.hex} onSelect={() => set('cover-color', { textColor: c.hex })} />
        ))}
      </div>
      <Button onClick={() => update((b) => setCover(b, null))}>Remove the cover</Button>
    </Section>
  )
}

const SLIDERS: { key: keyof EnhanceSettings; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -50, max: 50 },
  { key: 'contrast', label: 'Contrast', min: -50, max: 50 },
  { key: 'warmth', label: 'Warmth', min: -50, max: 50 },
  { key: 'saturation', label: 'Saturation', min: -50, max: 50 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 50 },
]

function PhotoSection() {
  const book = useBook((s) => s.book)
  const selected = useBook((s) => s.selectedFrame)
  const update = useBook((s) => s.update)
  const updateCoalesced = useBook((s) => s.updateCoalesced)
  const [busy, setBusy] = useState(false)
  const page = selected ? book.pages[selected.page] : undefined
  const frame = selected && page ? page.frames[selected.frame] : undefined
  const photo = frame?.photoId ? book.photos.find((p) => p.id === frame.photoId) : undefined
  if (!selected || !page || !frame || !photo) {
    return (
      <Section title="Photo">
        <p className="text-sm text-muted">Click a photo on the page to adjust it. Drag inside it to move it, scroll to zoom, drag it out to swap or remove it.</p>
      </Section>
    )
  }
  const draw = pageDraw(book, page).frames[selected.frame]
  const auto = async () => {
    setBusy(true)
    try {
      const tone = autoEnhance(await thumbPixels(photo.id))
      update((b) => setPhotoEnhance(b, photo.id, tone))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Photo">
      <p className="truncate text-sm font-bold" title={photo.path}>{photo.name}</p>
      {draw?.dpi && Number.isFinite(draw.dpi) && (
        <p className={`tabular text-xs ${draw.lowRes ? 'font-bold text-[var(--warn)]' : 'text-muted'}`}>
          {Math.round(draw.dpi)} DPI at print size{draw.lowRes ? ': may print soft' : ''}
        </p>
      )}
      <Slider label="Zoom" value={frame.crop.zoom} min={1} max={MAX_ZOOM} step={0.05} defaultValue={1} format={(v) => `${v.toFixed(2)}x`} onChange={(zoom) => updateCoalesced(`zoom-${selected.page}-${selected.frame}`, (b) => setCrop(b, selected, { ...frame.crop, zoom }))} />
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => update((b) => setCrop(b, selected, CENTRED))}>Re-centre</Button>
        <Button onClick={() => update((b) => clearFrame(b, selected))}>Remove from page</Button>
      </div>
      <Button onClick={() => void auto()} disabled={busy}>{busy ? 'Enhancing…' : 'Auto enhance'}</Button>
      {SLIDERS.map((s) => (
        <Slider key={s.key} label={s.label} value={photo.enhance[s.key]} min={s.min} max={s.max} onChange={(v) => updateCoalesced(`enhance-${photo.id}-${s.key}`, (b) => setPhotoEnhance(b, photo.id, { [s.key]: v }))} />
      ))}
    </Section>
  )
}

function BookEnhanceSection() {
  const update = useBook((s) => s.update)
  const [progress, setProgress] = useState<string | null>(null)
  const enhanceAll = async () => {
    const { photos } = useBook.getState().book
    const byId: Record<string, Required<EnhanceSettings>> = {}
    for (const [i, photo] of photos.entries()) {
      setProgress(`Enhancing ${i + 1} / ${photos.length}`)
      try {
        byId[photo.id] = { ...photo.enhance, ...autoEnhance(await thumbPixels(photo.id)) }
      } catch {
        // A missing photo keeps its settings.
      }
    }
    update((b) => setEnhanceAll(b, byId))
    setProgress(null)
  }
  const resetAll = () => update((b) => setEnhanceAll(b, Object.fromEntries(b.photos.map((p) => [p.id, NEUTRAL_ENHANCE]))))
  return (
    <Section title="Whole book">
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => void enhanceAll()} disabled={progress !== null}>Auto enhance all</Button>
        <Button onClick={resetAll} disabled={progress !== null}>Reset all</Button>
      </div>
      {progress && <Notice tone="info">{progress}</Notice>}
    </Section>
  )
}

function TraySection() {
  const book = useBook((s) => s.book)
  const tray = unusedPhotos(book)
  const onPointerDown = (event: React.PointerEvent, photoId: string) => {
    if (event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
      cleanup()
      startDrag({ kind: 'tray', photoId }, e)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
  }
  return (
    <Section title={`Not on a page (${tray.length})`} last>
      <div data-drop="tray" className="grid min-h-[96px] grid-cols-3 gap-2 border border-dashed border-divider p-2">
        {tray.length === 0 && <p className="col-span-3 self-center text-center text-xs text-muted">Every photo is on a page. Drag one here to take it off.</p>}
        {tray.map((p) => (
          <div key={p.id} onPointerDown={(e) => onPointerDown(e, p.id)} title={p.name} className="cursor-grab" style={{ touchAction: 'none' }}>
            <ThumbImg id={p.id} className="block aspect-square w-full" />
          </div>
        ))}
      </div>
      <Button onClick={() => void pickMorePhotos()}>Add photos…</Button>
    </Section>
  )
}

export function PagesPanel() {
  const book = useBook((s) => s.book)
  const index = useBook((s) => s.selectedPage)
  const update = useBook((s) => s.update)
  const missing = useBook((s) => s.missing)
  const page = book.pages[index]
  if (!page) return null
  const isCover = page.layoutId === 'cover'

  const rebuild = async () => {
    const yes = await ask('Rebuilding replaces every page, including your changes. Rebuild the pages?', { title: 'Rebuild pages', kind: 'warning', okLabel: 'Rebuild', cancelLabel: 'Keep my pages' })
    if (yes) useBook.getState().buildPages()
  }

  return (
    <>
      {missing.length > 0 && (
        <div className="px-6 pt-5">
          <Notice tone="danger">{missing.length} photo{missing.length === 1 ? ' is' : 's are'} missing. Use “Locate photos” in the Book file section.</Notice>
        </div>
      )}
      {isCover && book.cover ? (
        <CoverSection cover={book.cover} />
      ) : (
        <Section title="Layout">
          {[1, 2, 3, 4, 5, 6].map((count) => (
            <div key={count} className="flex flex-wrap gap-2">
              {BOOK_LAYOUTS.filter((l) => l.count === count && !l.cover).map((l) => (
                <LayoutIcon key={l.id} layout={l} active={l.id === page.layoutId} onPick={() => update((b) => setPageLayout(b, index, l.id))} />
              ))}
            </div>
          ))}
        </Section>
      )}
      <PhotoSection />
      <BookEnhanceSection />
      <Section title="Pages">
        <Button onClick={() => void rebuild()}>Rebuild all pages…</Button>
      </Section>
      <TraySection />
    </>
  )
}

export function PagesCanvas({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col">{children}</div>
}
```

- [ ] **Step 5: Wire the step into `BookApp`**

In `BookApp.tsx`, import `PageView`, `PageStrip`, `PagesPanel`, `DragLayer`, then:

```tsx
          {step === 'pages' && (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1"><PageView /></div>
              <PageStrip />
            </div>
          )}
```

in the canvas area, `{step === 'pages' && <PagesPanel />}` in the aside, and `<DragLayer />` as the last child of the root `div`. Add Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z to the key handler:

```tsx
      else if (key === 'z' && !event.shiftKey) useBook.getState().undo()
      else if (key === 'y' || (key === 'z' && event.shiftKey)) useBook.getState().redo()
```

- [ ] **Step 6: Typecheck and test**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors; all tests pass.

- [ ] **Step 7: Check by hand**

Run: `npm run tauri dev`, build a book from about 30 photos, then check:
- Dragging inside a frame moves the photo, scrolling zooms, Ctrl+Z undoes the whole drag in one step.
- Dragging a photo onto another frame swaps them; dragging it onto the tray empties the frame and the photo shows in the tray.
- Dragging a tray photo into a frame places it, and the old photo returns to the tray.
- Changing a page's layout keeps its photos in order; fewer frames send extras to the tray.
- Dragging a page along the strip reorders it; the cover cannot be dragged, duplicated or deleted.
- Auto enhance changes the selected photo; "Auto enhance all" shows progress and is one undo step.
- A cover with a long title shrinks to fit; Script / Classic / Modern fonts all render.
- A small photo (e.g. 640x480) on a full 8x10 page shows "Low resolution".

- [ ] **Step 8: Commit**

```bash
git add src/features/book
git commit -m "Photo Book: page editor with drag, crop, layouts, cover and enhance"
```

---

### Task 15: Print & Export

**Files:**
- Create: `src/features/book/useBookOutput.ts`
- Create: `src/features/book/BookPrintStep.tsx`
- Modify: `src/features/book/BookApp.tsx`
- Modify: `src-tauri/capabilities/default.json` (`dialog:allow-ask`)

**Interfaces:**
- Consumes: `renderPage, renderSheet, printSource, canvasBytes, pageLabel` (Task 12), `bookPlan` (Task 13), `sheetCount, pagesOnSheet` (Task 7), `bookStageSheet, bookClearStaged, printSheets, saveFile` (Tasks 9–10), `setJpegDpi, mmToPoints` (`dpi.ts`), pdf-lib, `PrintDialog`, `useLicense`.
- Produces: `pageFileName(book, index): string`, `bookIssues(book, missing): { empty: number; lowRes: number; missing: number }`, `exportApprovalPdf(...)`, `exportPrintPdf(...)`, `exportJpgs(...)`, `printBook(...)`, `Cancelled` error; components `BookPrintCanvas`, `BookPrintPanel`, `BookPrintButton`.

- [ ] **Step 1: Allow the confirmation dialog**

In `src-tauri/capabilities/default.json` add `"dialog:allow-ask",` after `"dialog:allow-message",`.

- [ ] **Step 2: Write the output functions**

`src/features/book/useBookOutput.ts`:

```ts
/**
 * Everything that leaves the app: the approval PDF, the print PDF, JPGs and
 * printing. Sheets and pages are rendered one at a time and handed on at
 * once, so memory stays flat however long the book is.
 */

import { PDFDocument } from 'pdf-lib'

import { pageDraw } from '../../lib/bookDraw'
import { pagesOnSheet, sheetCount } from '../../lib/bookSheets'
import type { Book } from '../../lib/bookTypes'
import { mmToPoints, setJpegDpi } from '../../lib/dpi'
import { PRINT_DPI } from '../../lib/presets'
import { bookClearStaged, bookStageSheet, printSheets, saveFile } from '../../lib/tauri'
import { canvasBytes, pageLabel, printSource, renderPage, renderSheet } from './bookPaint'
import { bookPlan } from './bookPipeline'

export const APPROVAL_DPI = 150

export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
  }
}

export interface Progress {
  report: (message: string) => void
  cancelled: () => boolean
}

function check(p: Progress) {
  if (p.cancelled()) throw new Cancelled()
}

export function pageFileName(book: Book, index: number): string {
  const label = pageLabel(book, index)
  if (label === 'Cover') return 'cover.jpg'
  const inside = book.pages.length - (book.pages[0]?.layoutId === 'cover' ? 1 : 0)
  return `page-${label.padStart(Math.max(2, String(inside).length), '0')}.jpg`
}

export function bookIssues(book: Book, missing: ReadonlySet<string>): { empty: number; lowRes: number; missing: number } {
  let empty = 0
  let lowRes = 0
  let gone = 0
  for (const page of book.pages) {
    for (const f of pageDraw(book, page, { missing }).frames) {
      if (!f.photoId) empty++
      else if (f.missing) gone++
      else if (f.lowRes) lowRes++
    }
  }
  return { empty, lowRes, missing: gone }
}

export async function exportApprovalPdf(book: Book, missing: ReadonlySet<string>, path: string, p: Progress): Promise<void> {
  const doc = await PDFDocument.create()
  doc.setTitle(book.cover?.title || 'Photo book')
  doc.setProducer('Philmer ID Photo Studio')
  for (let i = 0; i < book.pages.length; i++) {
    check(p)
    p.report(`Page ${i + 1} / ${book.pages.length}`)
    const canvas = await renderPage(book, i, { dpi: APPROVAL_DPI, source: printSource(book), preview: false, missing })
    const image = await doc.embedJpg(await canvasBytes(canvas, 'image/jpeg', 0.85))
    const w = mmToPoints((canvas.width / APPROVAL_DPI) * 25.4)
    const h = mmToPoints((canvas.height / APPROVAL_DPI) * 25.4)
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h })
  }
  const bytes = await doc.save()
  await saveFile({ path, bytes: bytes.buffer as ArrayBuffer })
}

export async function exportPrintPdf(book: Book, missing: ReadonlySet<string>, path: string, p: Progress): Promise<void> {
  const plan = bookPlan(book)
  if (!plan.ok) throw new Error(plan.message)
  const doc = await PDFDocument.create()
  doc.setTitle(`${book.cover?.title || 'Photo book'} (print sheets)`)
  doc.setProducer('Philmer ID Photo Studio')
  const count = sheetCount(book.pages.length, plan.perSheet)
  for (let s = 0; s < count; s++) {
    check(p)
    p.report(`Sheet ${s + 1} / ${count}`)
    const canvas = await renderSheet(book, plan, s, { dpi: PRINT_DPI, source: printSource(book), preview: false, missing })
    const image = await doc.embedJpg(await canvasBytes(canvas, 'image/jpeg', 0.92))
    const w = mmToPoints(plan.paper.widthMm)
    const h = mmToPoints(plan.paper.heightMm)
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h })
  }
  const bytes = await doc.save()
  await saveFile({ path, bytes: bytes.buffer as ArrayBuffer })
}

export async function exportJpgs(book: Book, missing: ReadonlySet<string>, folder: string, p: Progress): Promise<number> {
  const sep = folder.includes('\\') ? '\\' : '/'
  for (let i = 0; i < book.pages.length; i++) {
    check(p)
    p.report(`Page ${i + 1} / ${book.pages.length}`)
    const canvas = await renderPage(book, i, { dpi: PRINT_DPI, source: printSource(book), preview: false, missing })
    const bytes = setJpegDpi(await canvasBytes(canvas, 'image/jpeg', 0.95), PRINT_DPI)
    await saveFile({ path: `${folder.replace(/[\\/]$/, '')}${sep}${pageFileName(book, i)}`, bytes: bytes.buffer as ArrayBuffer })
  }
  return book.pages.length
}

/** Sheets `from`..`to` (0-based, inclusive), as one print job. */
export async function printBook(
  book: Book,
  missing: ReadonlySet<string>,
  range: { from: number; to: number },
  request: { printer?: string; copies: number },
  p: Progress,
): Promise<void> {
  const plan = bookPlan(book)
  if (!plan.ok) throw new Error(plan.message)
  const count = sheetCount(book.pages.length, plan.perSheet)
  const from = Math.max(0, Math.min(range.from, count - 1))
  const to = Math.max(from, Math.min(range.to, count - 1))
  await bookClearStaged()
  try {
    const paths: string[] = []
    for (let s = from; s <= to; s++) {
      check(p)
      p.report(`Preparing sheet ${s + 1} / ${to + 1}`)
      const canvas = await renderSheet(book, plan, s, { dpi: PRINT_DPI, source: printSource(book), preview: false, missing })
      const bytes = await canvasBytes(canvas, 'image/jpeg', 0.95)
      paths.push(await bookStageSheet(s, bytes.buffer as ArrayBuffer))
    }
    check(p)
    p.report('Sending to the printer…')
    await printSheets({
      printer: request.printer,
      paths,
      widthMm: plan.paper.widthMm,
      heightMm: plan.paper.heightMm,
      copies: request.copies,
      jobName: `Photo book ${book.cover?.title || ''}`.trim(),
    })
  } finally {
    await bookClearStaged().catch(() => {})
  }
}

export { pagesOnSheet }
```

- [ ] **Step 3: Write the step**

`src/features/book/BookPrintStep.tsx`:

```tsx
/**
 * Print & Export: the packed sheets as they will print, problems to fix
 * first, and the four outputs.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ask, open as openDialog, save } from '@tauri-apps/plugin-dialog'

import { Button, Icon, ICONS, Notice, Section } from '../../app/components/ui'
import { sheetCount } from '../../lib/bookSheets'
import { editPaper } from '../../lib/editPaper'
import { useBook } from '../../store/book'
import { useLicense } from '../license/LicenseDialog'
import { PrintDialog, type PrintRequest } from '../sheet/PrintDialog'
import { previewSource, renderSheet } from './bookPaint'
import { bookPlan } from './bookPipeline'
import { bookIssues, Cancelled, exportApprovalPdf, exportJpgs, exportPrintPdf, printBook, type Progress } from './useBookOutput'

const PREVIEW_DPI = 40

function SheetPreview({ index }: { index: number }) {
  const book = useBook((s) => s.book)
  const missingList = useBook((s) => s.missing)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    const plan = bookPlan(book)
    if (!plan.ok) return
    void renderSheet(book, plan, index, { dpi: PREVIEW_DPI * (window.devicePixelRatio || 1), source: previewSource(book), preview: true, missing: new Set(missingList) }).then((off) => {
      const canvas = ref.current
      if (!live || !canvas) return
      canvas.width = off.width
      canvas.height = off.height
      canvas.getContext('2d')!.drawImage(off, 0, 0)
    })
    return () => {
      live = false
    }
  }, [book, index, missingList])
  return <canvas ref={ref} className="block w-full bg-white shadow-lg" />
}

export function BookPrintCanvas() {
  const book = useBook((s) => s.book)
  const plan = bookPlan(book)
  if (!plan.ok) {
    return <div className="flex h-full items-center justify-center p-8"><Notice tone="danger">{plan.message}</Notice></div>
  }
  const count = sheetCount(book.pages.length, plan.perSheet)
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto grid max-w-[900px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <SheetPreview index={i} />
            <span className="tabular text-center text-xs text-muted">Sheet {i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function useJob() {
  const [message, setMessage] = useState<{ tone: 'info' | 'ok' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef(false)
  const run = async (task: (p: Progress) => Promise<string>) => {
    setBusy(true)
    cancelRef.current = false
    try {
      const done = await task({ report: (text) => setMessage({ tone: 'info', text }), cancelled: () => cancelRef.current })
      setMessage({ tone: 'ok', text: done })
    } catch (error) {
      setMessage(error instanceof Cancelled ? { tone: 'info', text: 'Stopped.' } : { tone: 'danger', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }
  return { message, busy, run, cancel: () => (cancelRef.current = true), dismiss: () => setMessage(null) }
}

async function confirmProblems(missing: number): Promise<boolean> {
  if (missing === 0) return true
  return ask(`${missing} photo${missing === 1 ? ' is' : 's are'} missing and will print as blank space. Continue anyway?`, { title: 'Missing photos', kind: 'warning', okLabel: 'Continue', cancelLabel: 'Go back' })
}

export function BookPrintPanel() {
  const book = useBook((s) => s.book)
  const missingList = useBook((s) => s.missing)
  const missing = useMemo(() => new Set(missingList), [missingList])
  const { canProduce, open: openLicence } = useLicense()
  const job = useJob()
  const plan = bookPlan(book)
  const issues = useMemo(() => bookIssues(book, missing), [book, missing])
  const title = (book.cover?.title || 'photo-book').replace(/[\\/:*?"<>|]+/g, '').trim() || 'photo-book'
  const disabled = job.busy || !canProduce || !plan.ok || book.pages.length === 0

  const approval = async () => {
    const path = await save({ defaultPath: `${title} - for approval.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!path || !(await confirmProblems(issues.missing))) return
    await job.run(async (p) => {
      await exportApprovalPdf(book, missing, path, p)
      return `Saved ${book.pages.length} pages for approval.`
    })
  }
  const printPdf = async () => {
    const path = await save({ defaultPath: `${title} - print sheets.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!path || !(await confirmProblems(issues.missing))) return
    await job.run(async (p) => {
      await exportPrintPdf(book, missing, path, p)
      return 'Saved the print sheets.'
    })
  }
  const jpgs = async () => {
    const folder = await openDialog({ directory: true, title: 'Choose a folder for the page JPGs' })
    if (typeof folder !== 'string' || !(await confirmProblems(issues.missing))) return
    await job.run(async (p) => `Saved ${await exportJpgs(book, missing, folder, p)} JPGs at 300 DPI.`)
  }

  const paper = editPaper(book.paper, book.customPaper)
  const sheets = plan.ok ? sheetCount(book.pages.length, plan.perSheet) : 0

  return (
    <>
      {!canProduce && (
        <div className="px-6 pt-5">
          <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />} action={<button type="button" onClick={openLicence} className="whitespace-nowrap text-[13px] font-bold underline">Enter key</button>}>
            The trial has ended. Saving and printing need a licence.
          </Notice>
        </div>
      )}
      <Section title="Summary">
        {plan.ok ? (
          <p className="tabular text-sm">
            {book.pages.length} pages → {sheets} {book.paper === 'custom' ? 'custom' : paper.label} sheet{sheets === 1 ? '' : 's'}
            {plan.borderless ? ' (borderless)' : ''}
          </p>
        ) : (
          <Notice tone="danger">{plan.message}</Notice>
        )}
        {issues.missing > 0 && <Notice tone="danger">{issues.missing} missing photo{issues.missing === 1 ? '' : 's'}.</Notice>}
        {issues.empty > 0 && <Notice tone="warn">{issues.empty} empty frame{issues.empty === 1 ? '' : 's'} will print as blank space.</Notice>}
        {issues.lowRes > 0 && <Notice tone="warn">{issues.lowRes} photo{issues.lowRes === 1 ? '' : 's'} may print soft (under 200 DPI).</Notice>}
      </Section>
      <Section title="Send to the customer">
        <Button onClick={() => void approval()} disabled={disabled}>Export PDF for approval</Button>
        <p className="text-xs text-muted">Pages at 150 DPI, small enough for Messenger.</p>
      </Section>
      <Section title="Save" last>
        <Button onClick={() => void printPdf()} disabled={disabled}>Export PDF for print</Button>
        <Button onClick={() => void jpgs()} disabled={disabled}>Export page JPGs</Button>
        {job.message && (
          <Notice tone={job.message.tone} action={job.busy ? <button type="button" onClick={job.cancel} className="text-[13px] font-bold underline">Cancel</button> : <button type="button" onClick={job.dismiss}>OK</button>}>
            {job.message.text}
          </Notice>
        )}
      </Section>
    </>
  )
}

export function BookPrintButton() {
  const book = useBook((s) => s.book)
  const missingList = useBook((s) => s.missing)
  const { canProduce, open: openLicence } = useLicense()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; message: string } | null>(null)
  const plan = bookPlan(book)
  const sheets = plan.ok ? sheetCount(book.pages.length, plan.perSheet) : 0
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(sheets)
  useEffect(() => setTo(sheets), [sheets])
  const cancelRef = useRef(false)

  const onPrint = async (request: PrintRequest) => {
    const missing = new Set(missingList)
    if (!(await confirmProblems(bookIssues(book, missing).missing))) return
    setBusy(true)
    cancelRef.current = false
    setStatus(null)
    try {
      await printBook(book, missing, { from: from - 1, to: to - 1 }, request, {
        report: (message) => setStatus({ tone: 'ok', message }),
        cancelled: () => cancelRef.current,
      })
      setStatus({ tone: 'ok', message: `Sent sheets ${from}–${to} to the printer.` })
    } catch (error) {
      setStatus({ tone: 'danger', message: error instanceof Cancelled ? 'Stopped before printing.' : error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const paper = editPaper(book.paper, book.customPaper)
  const valid = plan.ok && sheets > 0 && from >= 1 && to <= sheets && from <= to

  return (
    <>
      <button
        type="button"
        onClick={canProduce ? () => { setStatus(null); setOpen(true) } : openLicence}
        disabled={!plan.ok || sheets === 0}
        className="flex h-11 items-center justify-center gap-2 px-5 text-[15px] font-extrabold disabled:opacity-45"
        style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
      >
        <Icon path={ICONS.save} size={18} />
        {canProduce ? 'Print' : 'Licence needed'}
      </button>
      {open && (
        <PrintDialog
          title="Print book"
          summary={`Sheets ${from}–${to} of ${sheets}, ${plan.ok && plan.borderless ? 'borderless, ' : ''}at true size. Copies print the whole range each time.`}
          paperLabel={book.paper === 'custom' ? paper.longLabel : paper.label}
          busy={busy || !valid}
          status={status}
          onPrint={(r) => void onPrint(r)}
          onClose={() => {
            if (busy) cancelRef.current = true
            else setOpen(false)
          }}
        />
      )}
      {open && (
        <div className="fixed bottom-4 left-1/2 z-[51] flex -translate-x-1/2 items-center gap-2 bg-[var(--color-surface)] p-2 text-sm shadow-lg">
          <span>Sheets</span>
          <input type="number" min={1} max={sheets} value={from} onChange={(e) => setFrom(Math.max(1, Math.min(sheets, Number(e.target.value) || 1)))} className="tabular h-8 w-16 border border-divider px-2" />
          <span>to</span>
          <input type="number" min={1} max={sheets} value={to} onChange={(e) => setTo(Math.max(1, Math.min(sheets, Number(e.target.value) || sheets)))} className="tabular h-8 w-16 border border-divider px-2" />
          {busy && <button type="button" onClick={() => (cancelRef.current = true)} className="h-8 border border-divider px-3 font-bold">Cancel</button>}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Wire the step into `BookApp`**

In `BookApp.tsx`: `{step === 'print' && <BookPrintCanvas />}` in the canvas area, `{step === 'print' && <BookPrintPanel />}` in the aside, and pass `primaryAction={step === 'print' ? <BookPrintButton /> : undefined}` to `ActionBar`.

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors; all pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/book src-tauri/capabilities/default.json
git commit -m "Photo Book: print sheets, approval PDF, print PDF and page JPGs"
```

---

### Task 16: Save, open, autosave and keys

**Files:**
- Create: `src/features/book/bookProject.ts`
- Create: `src/features/book/BookFileSection.tsx`
- Modify: `src/features/book/BookApp.tsx` (autosave, Ctrl+S, file section on Pages and Print)
- Modify: `src/features/import/ImportStep.tsx` ("Open saved book…", restore offer)

**Interfaces:**
- Consumes: `serializeBook, parseBook, relinkPhotos, fileNameOf` (Task 6), bindings (Task 9), store (Task 11), `clearThumbCache` (Task 12).
- Produces: `saveBook(saveAs?): Promise<boolean>`, `openBookDialog(): Promise<string | null>`, `openBookText(text, path, dirty): Promise<string | null>`, `locateMissing(): Promise<string | null>`, `useBookAutosave()`, `suggestedFileName(book)`; component `BookFileSection`, `AutosaveOffer`.

- [ ] **Step 1: Write the project functions**

`src/features/book/bookProject.ts`:

```ts
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
```

- [ ] **Step 2: The file section and restore offer**

`src/features/book/BookFileSection.tsx`:

```tsx
import { useEffect, useState } from 'react'

import { Button, Notice, Section } from '../../app/components/ui'
import { bookAutosaveClear, bookAutosaveRead } from '../../lib/tauri'
import { useBook } from '../../store/book'
import { fileNameOf } from '../../lib/bookFile'
import { locateMissing, openBookText, saveBook } from './bookProject'

export function BookFileSection() {
  const filePath = useBook((s) => s.filePath)
  const dirty = useBook((s) => s.dirty)
  const missing = useBook((s) => s.missing)
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  const run = async (task: () => Promise<string | null>, ok: string) => {
    try {
      const error = await task()
      setMessage(error ? { tone: 'danger', text: error } : { tone: 'ok', text: ok })
    } catch (error) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : String(error) })
    }
  }
  return (
    <Section title="Book file">
      <p className="truncate text-xs text-muted" title={filePath ?? undefined}>
        {filePath ? fileNameOf(filePath) : 'Not saved yet'}
        {dirty ? ' · unsaved changes' : ''}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => void run(async () => ((await saveBook()) ? null : 'Not saved.'), 'Saved.')}>Save</Button>
        <Button onClick={() => void run(async () => ((await saveBook(true)) ? null : 'Not saved.'), 'Saved.')}>Save as…</Button>
      </div>
      {missing.length > 0 && <Button onClick={() => void run(locateMissing, 'Photos found.')}>Locate photos…</Button>}
      {message && <Notice tone={message.tone} action={<button type="button" onClick={() => setMessage(null)}>OK</button>}>{message.text}</Notice>}
    </Section>
  )
}

/** On Import: offer the book that was open when the app last closed unexpectedly. */
export function AutosaveOffer() {
  const [saved, setSaved] = useState<{ text: string; savedAtMs: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    bookAutosaveRead().then(setSaved).catch(() => setSaved(null))
  }, [])
  if (!saved) return error ? <Notice tone="danger">{error}</Notice> : null
  const when = new Date(saved.savedAtMs).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })
  return (
    <Notice
      tone="info"
      action={
        <span className="flex gap-3">
          <button type="button" className="font-bold underline" onClick={() => void openBookText(saved.text, null, true).then((e) => (e ? setError(e) : setSaved(null)))}>Restore</button>
          <button type="button" className="underline" onClick={() => void bookAutosaveClear().then(() => setSaved(null))}>Discard</button>
        </span>
      }
    >
      Restore the unsaved book from {when}?
    </Notice>
  )
}
```

- [ ] **Step 3: Wire it in**

`BookApp.tsx`:
- Call `useBookAutosave()` at the top of `BookApp`.
- Key handler: `else if (key === 's') void saveBook(event.shiftKey)`. Put it **before** the input-target early return so Ctrl+S also works while typing a title:

```tsx
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (useBook.getState().book.photos.length > 0) void saveBook(event.shiftKey)
        return
      }
      const target = event.target as HTMLElement | null
      // ... existing handling
```

- Render `<BookFileSection />` at the top of the aside on the `pages` and `print` steps.
- Ask before closing the window with unsaved changes:

```tsx
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (useBook.getState().dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])
```

`ImportStep.tsx`, below the cards when `mode === 'book'`:

```tsx
        {mode === 'book' && (
          <div className="flex flex-col gap-3">
            <AutosaveOffer />
            <div className="flex gap-2">
              <Button onClick={() => void openBookDialog().then((e) => e && useBook.getState().loadFailed(e))}>Open saved book…</Button>
              <Button onClick={() => void openDialog({ directory: true }).then((d) => typeof d === 'string' && openBook([d]))}>Choose a folder…</Button>
            </div>
          </div>
        )}
```

with imports `Button` from the UI kit, `AutosaveOffer` from `../book/BookFileSection`, `openBookDialog` from `../book/bookProject`. Dropping a `.photobook` file onto the Photo Book card opens it: in the drop branch, if `target === 'book'` and exactly one path ends with `.photobook`, call `bookReadProject(path).then((t) => openBookText(t, path, false))` instead of `openBook`.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no errors; all pass.

- [ ] **Step 5: Check by hand**

Run: `npm run tauri dev`
- Build a book, Ctrl+S, close the app, reopen: Import → Open saved book… opens it on Pages with every edit intact; nothing is marked unsaved.
- Rename the photo folder, open the book: the prompt offers "Find folder"; choosing the renamed folder restores every photo. Choosing "Open without them" shows red "Missing" frames and a "Locate photos…" button.
- Make changes, wait 35 s, kill the app from Task Manager, start it: Import offers "Restore the unsaved book from …"; Restore brings it back marked unsaved; Discard removes the offer.
- Ctrl+N with unsaved changes asks first.

- [ ] **Step 6: Commit**

```bash
git add src/features/book src/features/import/ImportStep.tsx
git commit -m "Photo Book: save, open, relink moved photos and autosave"
```

---

### Task 17: Final verification and docs

**Files:**
- Modify: `README.md` (one paragraph on Photo Book)
- Modify: `docs/superpowers/specs/2026-10-13-photo-book-design.md` (status line and the amendments from this plan)

- [ ] **Step 1: Full automated run**

Run: `npx vitest run && npx tsc --noEmit && cargo test --manifest-path src-tauri/Cargo.toml --profile perf -- --nocapture`
Expected: every test passes; record the counts in the commit message.

- [ ] **Step 2: Real-world print check**

1. Build a 5x6 White-border book from about 60 photos with a cover.
2. Print sheet 1 only (range 1–1) on A4 with the printer at 100%, no scaling.
3. Trim on the cut marks and measure: **127 x 152.4 mm** (±0.5 mm).
4. Switch to Edge to edge, print sheet 2, trim: no white sliver on any edge.
5. Print the ID-photo 2x2 sheet once and measure 50.8 mm, to confirm the refactored `print` still prints true size.
6. Export the approval PDF and confirm it is under 20 MB for 40 pages.

- [ ] **Step 3: Update docs**

In the spec, set `Status: implemented 2026-10-xx; see plan docs/superpowers/plans/2026-10-13-photo-book.md` and copy this plan's "Spec amendments" section into it. In `README.md`, under the feature list, add: "Photo Book: many photos auto-laid-out into 5x6, 5x7, 8x8, 8x10 or A4 pages, adjusted by hand, printed several to a sheet with cut marks for manual binding; books save as `.photobook` files."

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-13-photo-book-design.md
git commit -m "Photo Book: docs and spec status"
```
