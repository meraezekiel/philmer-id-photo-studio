# Photo Book mode: design

Date: 2026-10-13.

Status: implemented 2026-10-13 (printer check pending); see plan docs/superpowers/plans/2026-10-13-photo-book.md

## Why

After the owner posted a video of the app's output, customers asked for
**photo books** (e.g. wedding pictures). The customer hands over a batch of
photos; the shop lays them out into pages — full-page photos and collages —
prints them, cuts them by hand and binds them. Reference examples (TikTok):
a 5x6 in softbound book trimmed from A4 sheets with a full-bleed photo cover
and a large title; a shop selling 20/30/40/50-page books whose layout and
cover are sent to the customer for approval before printing.

## Decisions made with the owner

- A **third mode**, *Photo Book*, beside ID Photo and Photo Print, with its
  own store and screens. The ID flow and Photo Print are not modified except
  for the Import screen's third card.
- **Single-sided** printing; pages are glued back to back. No duplex page
  ordering.
- The shop defines the formats; the customer only supplies photos.
- **Book page sizes:** 5x6, 5x7, 8x8, 8x10 in and A4, portrait or landscape
  (8x8 is square). One size per book.
- **Print paper is separate from page size:** A4, 8R or custom. The app packs
  as many pages per sheet as fit, with cut marks.
- **Workflow: auto-fill, then adjust.** The app builds a first draft of every
  page; the operator changes layouts, swaps photos, re-crops, adds and
  removes pages.
- **Page style is chosen per book:** margin, gap, page colour, with presets
  *White border* and *Edge to edge*.
- First version includes: **cover / title text**, **save and reopen**,
  **enhance** (reusing Photo Print's), **export JPG / PDF**.
- **Architecture: approach 1.** Pages are drawn in the frontend; Rust keeps
  only file paths and small thumbnails and hands back each photo already
  cropped and resized to its frame when printing. (Rejected: drawing in Rust —
  duplicates the enhance maths and needs font rendering in Rust; drawing from
  full-size photos in the frontend — 100 x 24 MP photos would need ~7 GB.)

Operator-facing text calls this mode **Photo Book**; code uses `book`
(`mode: 'id' | 'edit' | 'book'`, `src/features/book/`).

## Flow

**Import → Setup → Pages → Print & Export.**

### Import

A third card, **Photo Book**, "5x6 · 5x7 · 8x8 · 8x10 · A4". Dropping or
browsing accepts **many files or a folder**. The card also offers **Open saved
book…**. The last-used card highlighting and Ctrl+V behave as for the other
cards (`src/store/mode.ts` gains `'book'`).

### Setup

One screen holding every book-wide setting:

- **Book size** and orientation.
- **Print paper**: A4, 8R or custom (reuses `editPaper.ts`'s custom paper
  entry). A live line shows "2 pages per A4 sheet".
- **Page style**: margin (mm), gap (mm), page colour. Presets: *White border*
  (margin 6 mm, gap 3 mm, white) and *Edge to edge* (margin 0, gap 1.5 mm).
- **Target page count**: Auto, 20, 30, 40, 50.
- **Cover**: on/off, title, subtitle.
- **Build pages** runs auto-fill and moves to Pages.

### Pages

- Bottom **page strip** of thumbnails: drag to reorder; add, duplicate,
  delete page.
- The **selected page** fills the canvas. Drag a photo onto another frame to
  swap; drag inside a frame to pan the crop; scroll wheel to zoom.
- Panel:
  - **Layout picker** for the selected page.
  - **Photo tray** of unused photos; drag one onto a frame to replace.
  - Per-photo **Auto enhance** and sliders; **Enhance whole book**.
  - On the cover: title / subtitle text, font, size, colour, position
    (top / middle / bottom).
- Frames whose photo is under 200 DPI at print size get a yellow badge.
- **Undo / redo** (Ctrl+Z / Ctrl+Y) for page edits.
- Re-running auto-fill asks first, since it replaces manual edits.

### Print & Export

- Preview of the packed **sheets** with cut marks; "40 pages → 20 A4 sheets".
- Printer choice, **Print all** or a **sheet range**.
- **Export PDF for approval**, **Export PDF for print**, **Export JPGs**.

### Keys

Ctrl+S save; Ctrl+N new customer (asks if there are unsaved changes); the
existing Ctrl+Left/Right step navigation.

## Layouts (`src/lib/bookLayouts.ts`)

A layout is data: an id, a photo count, and frames as fractions of the area
inside the margins (`{x, y, w, h}` in 0..1). Gaps are subtracted when frames
are resolved to millimetres, so one layout serves every size, margin and gap.

| Photos | Layouts |
|---|---|
| 1 | Full page; centred with wide border |
| 2 | Side by side; stacked; big + small |
| 3 | One big + two small (big left / right / top); three in a row |
| 4 | 2x2 grid; one big + three small |
| 6 | 2x3 grid |
| Cover | Full-page photo with a title text area |

`resolveFrames(layout, pageMm, style)` returns frame rectangles in mm.

## Auto-fill (`src/lib/autoFill.ts`)

Pure function: `autoFill(photos, { pageCount: 'auto' | number, cover, pageAspect }) → Page[] | { error }`.

- Photos keep **book order**: sorted by EXIF date taken, then by filename.
- Layouts are chosen to suit the **shape** of the next photos: landscape
  photos prefer wide frames, portraits tall ones. A frame's aspect may differ
  from its photo's by at most a factor of 1.6; otherwise that layout is not a
  candidate for those photos.
- **Rhythm**: never the same layout on three pages in a row; a full-page
  photo every 4–6 pages.
- **Auto** page count aims at about 2.5 photos per page. A fixed count spreads
  the photos across exactly that many pages (more full pages with few photos,
  more grids with many). If even 6 per page cannot fit them, it returns an
  error saying how many photos to remove or which larger count fits.
- With a cover, the first photo goes on the cover.
- Each frame starts with a centred **fill** crop (covers the frame, never
  distorts). When the photo has a detected face (existing detector, run on the
  thumbnail), the crop keeps the face inside the frame.

## Photos and memory (Rust: `src-tauri/src/book.rs`)

Separate from `ImageStore`, which holds full originals and stays as is.

- `book_add_photos(paths) → BookPhotoInfo[]`: decodes each file once, in
  parallel, to make a **1024 px JPEG thumbnail** (~150 KB) and read size, EXIF
  orientation and date taken. Keeps only `{path, thumbnail}` per photo. Emits
  progress events ("Loading 37 / 120"). Unreadable files come back as errors
  per file, not a failed call.
- `book_thumb(id) → JPEG bytes`.
- `book_render_photo(id, crop, width, height) → RGBA or PNG`: reopens the
  original, applies EXIF orientation, crops (crop in source-pixel space) and
  resizes to exactly `width x height`. Used only for print and export.
- `book_clear()`: drops all thumbnails (new customer).
- Face detection for auto-fill runs on the thumbnail.

## Book data (`src/store/book.ts`)

```ts
interface Book {
  version: 1
  size: BookSizeId              // '5x6' | '5x7' | '8x8' | '8x10' | 'a4'
  orientation: 'portrait' | 'landscape'
  paper: EditPaperChoice; customPaper: CustomPaper
  style: { marginMm: number; gapMm: number; color: string }
  cover: { title: string; subtitle: string; font: BookFont;
           textColor: string; position: 'top' | 'middle' | 'bottom' } | null
  photos: { id: string; path: string; width: number; height: number;
            takenAt: string | null; enhance: EnhanceSettings }[]
  pages: { layoutId: string;
           frames: { photoId: string | null; crop: { x: number; y: number; zoom: number } }[] }[]
}
```

Runtime-only state (thumbnails, load status, undo stack, dirty flag) lives
beside the book, not in it.

### Saving (`src/lib/bookFile.ts`)

- Ctrl+S writes a `.photobook` JSON file that **references photos by path**.
- On open, missing photos trigger **Locate photo folder**, which re-links by
  filename. Photos still missing show as red frames.
- A file with a newer `version` than the app understands is refused with a
  message.
- **Autosave** every 30 s to the app data folder; on start, offer to restore
  an unsaved book ("Restore the unsaved book from 2:41 PM?").

## Drawing (`src/lib/bookRender.ts`)

`renderPage(page, book, source, dpi)` draws one page: page colour, then each
frame's photo with its enhance applied by the existing `enhance.ts`, then cover
text. `source` is either the thumbnails (screen preview) or
`book_render_photo` at frame size x 300 DPI (print/export) — the same function,
so the preview matches the print.

Fonts are bundled in `public/fonts` for offline use: Archivo (already there),
plus one serif and one script font under the OFL (e.g. Playfair Display,
Great Vibes).

## Sheets (`src/lib/bookSheets.ts`)

Pure: `packSheets(pageMm, paperMm, style) → { perSheet, placements }`.

- Tries the page as is and rotated 90°, keeps the one fitting more pages.
- Keeps a printer safety margin from the paper edge.
- **Edge to edge** pages get **2 mm bleed** around the trim line; the packer
  reserves room for it.
- Cut marks at every page corner, same faint grey as the ID sheet
  (`layout.ts` `cutMarks`).
- Pages fill sheets in book order; each page gets a small grey page number in
  the trim area.

Expected: 5x6 and 5x7 → 2 per A4; 8x8, 8x10, A4 → 1 per sheet.

## Printing and export

- **Print** reuses `printing.rs`. `PrintJob` gains support for **several
  sheets in one job** so a book is one entry in the print queue. Sheets are
  rendered and handed over one at a time to keep memory flat. Progress
  "Preparing sheet 7 / 20" with Cancel. Print all or a sheet range.
- **PDF for approval**: pages (not sheets), 150 DPI JPEG — small enough for
  Messenger.
- **PDF for print**: packed sheets at 300 DPI with cut marks (pdf-lib, JPEG
  embedded).
- **JPGs**: one 300 DPI file per page, `page-01.jpg`…, DPI written with
  `dpi.ts`.

## Errors

- Unreadable files at import are listed and skipped; the rest load.
- Missing photos after reopening: locate prompt; print warns "2 photos missing
  — print anyway?".
- Low resolution (< 200 DPI at print size): warning badge, not a block.
- Too many photos for the chosen page count: auto-fill reports it.
- Printer failure mid-job: the message names the last sheet sent; reprint
  from that sheet.
- Licence and trial rules apply as in the other modes.

## Files

New:

| File | Purpose |
|---|---|
| `src/store/book.ts` (+ test) | Book state, undo, dirty flag |
| `src/features/book/BookApp.tsx` | Window and steps |
| `src/features/book/SetupStep.tsx` | Setup screen |
| `src/features/book/PagesStep.tsx` | Page editor, strip, tray |
| `src/features/book/BookPrintStep.tsx` | Sheets preview, print, export |
| `src/lib/bookLayouts.ts` (+ test) | Layouts and frame resolution |
| `src/lib/autoFill.ts` (+ test) | Auto-fill |
| `src/lib/bookSheets.ts` (+ test) | Packing pages onto sheets |
| `src/lib/bookRender.ts` | Drawing a page |
| `src/lib/bookFile.ts` (+ test) | Save, open, re-link |
| `src-tauri/src/book.rs` | Thumbnails, render photo |

Changed:

| File | Change |
|---|---|
| `src/store/mode.ts` | Add `'book'` |
| `src/app/App.tsx` | Render `BookApp` |
| `src/features/import/ImportStep.tsx` | Third card; multi-file / folder; Open saved book |
| `src/lib/presets.ts` | Book sizes `5x6`, `5x7`, `8x8`, `8x10`, `a4` |
| `src-tauri/src/printing.rs` | Several sheets per job |
| `src-tauri/src/commands.rs`, `lib.rs` | Register book commands |
| `src/lib/tauri.ts` | Book command bindings |

## Testing

- Vitest:
  - layouts: frames inside the page, gaps correct;
  - auto-fill: order kept, aspect limit respected, page count respected,
    error when photos cannot fit;
  - packing: 5x6 → 2 per A4, bleed reserved, rotation tried;
  - crop maths;
  - save file: round trip, re-link by filename, newer version refused.
- Rust: `book_render_photo` crop, EXIF orientation and exact output size on
  the existing test portrait.
- Real-world check: a 5x6 book from ~60 photos, print one A4 sheet, trim, and
  measure 127 x 152.4 mm.

## Out of scope (later)

Double-sided printing and its page ordering; copying photos into the book
file; free-form frames; stickers and decorations; text on inside pages;
background removal inside the book.

## Amendments made while planning and building

Decided while planning:

- A **5-photo** layout family is added (counts 1-6), so auto-fill can distribute any count without parity problems.
- Layout frames may be marked `fit: 'photo'`: the frame shrinks to the photo's shape and never crops ("Whole photo"). This guarantees a non-cropping choice for single photos of any shape.
- The cover is a page with `layoutId: 'cover'` that is always `pages[0]` while `book.cover` is set. The target page count counts **inside pages**; the cover is extra.
- Printing stages each rendered sheet as a temp JPEG and Rust prints them in **one** job by reading them one at a time (memory stays flat; no printer handle crosses IPC calls).
- Book project files are read and written by dedicated, **unlicensed** Rust commands (saving work is not "producing output"); exports and printing keep the licence gate.
- Fonts come from `@fontsource/playfair-display` and `@fontsource/great-vibes` (OFL, bundled by Vite, offline).

Decided while building:

- Printing calls AbortDoc on any failure, so a failed job never leaves a partial book at the printer.
- Print and export errors stop the job instead of leaving blank frames in the output.
- One photo load runs at a time; a load started before New customer is discarded.
- Undo is paused during a drag.
- The sheet range is chosen in the Print & Export panel; Cancel lives in the print dialog.
- Closing the window with an unsaved book asks first.
- Relinked photo paths are not an undo step.
