# Edit Photo mode: design

Date: 2026-09-30. Status: implemented 2026-10-12; see plan
`docs/superpowers/plans/2026-10-08-photo-print-mode.md`.

## Why

The app today is an ID-photo wizard: every step assumes a face, a preset size
and a crop. Customers also bring ordinary photos — often full-body DSLR shots
whose exposure or colour is off — and want them fixed and printed, sometimes
with the background removed or replaced. The goal is to do that inside the
app, on the whole photo, without disturbing the ID flow.

## Decisions made with the owner

- Three jobs to support, all on the **full, uncropped** photo:
  1. Remove the background only and save the full image (transparent).
  2. Remove the background and put in a colour or an **uploaded image**.
  3. Enhance only, keeping the original background.
- Full-body photos must work (not just head and shoulders).
- **Enhance = correction, not AI.** DSLR photos are already sharp and large;
  the problems are exposure, colour cast from studio lights and flat contrast.
  Manual sliders plus a one-click Auto enhance. No upscaling, denoising or face
  restoration model.
- **Output = save the file and print on standard photo paper** (single photo
  per sheet). No multi-copy layout.
- **Structure = a separate mode** with its own store and screens (approach 1).
  The ID wizard and `useJob` are not modified except where listed below.

## Structure

### Mode choice

*Revised 2026-10-08 with the owner: two drop cards instead of a toggle.*

The Import screen's single drop zone becomes **two cards side by side**, and
each card is its own drop zone and browse button:

- **ID Photo**: "1x1 · 2x2 · Passport". Background, attire, a sheet of copies.
- **Photo Print**: "3R · 4R · 5R · 8R · A4". Keeps the background, fits the
  photo to the paper, prints.

Dropping onto a card (or clicking it to browse) chooses the mode and loads
the photo in one action. The operator never drops a photo before saying what
the job is, so the ID flow's face detection and background removal never run
on a print job. The last-used card is highlighted, remembered in
`localStorage` the same way the tutorial remembers it has been seen
(`TutorialProvider.tsx`), falling back to ID Photo. **Ctrl+V** pastes into the
highlighted card. While a file is dragged over the window, the card under the
pointer lights up. New customer (Ctrl+N) returns to Import with the same card
highlighted.

Operator-facing text calls this mode **Photo Print**; code keeps the name
`edit` (`mode: 'id' | 'edit'`, `src/features/edit/`).

A new `src/store/mode.ts` (tiny zustand store: `mode: 'id' | 'edit'`) decides
which flow `App.tsx` renders. `App.tsx` chooses the step list, canvas and
panel by mode; the header stepper shows that mode's steps.

### Edit Photo steps

**Import → Edit → Print & Export.**

### Loading a photo

Reuses `loadImage` and the preview decode from `usePhotoPipeline` (factored
into a shared helper so both flows call the same code).

- Face detection is **not** run.
- Background removal is **lazy**: it starts only when the operator picks a
  background option that needs a cutout (Transparent, Colour, Image). An
  enhance-only job never waits the ~12–15 s. Once computed, the mask is cached
  (Rust already caches it per image), so switching options back and forth is
  instant. Progress uses the existing `onSegmentProgress` events.
- Model: the bundled **BiRefNet general** (`lite`) is the default in this mode —
  it is trained on whole scenes and handles full bodies. The optional `hd`
  model is portrait-trained; the quality control labels it "Best for head and
  shoulders".

### Files

New:

| File | Purpose |
|---|---|
| `src/store/mode.ts` | Current mode |
| `src/store/edit.ts` | Edit job state (below) |
| `src/features/edit/EditStep.tsx` | Canvas + panel for the Edit step |
| `src/features/edit/PrintExportStep.tsx` | Canvas + panel for Print & Export |
| `src/features/edit/useEditExport.ts` | Build the full-resolution result; save; print |
| `src/lib/enhance.ts` | Auto-enhance analysis and the tone/saturation/sharpness maths, pure |
| `src/lib/enhance.test.ts` | Unit tests |
| `src/lib/fitToPaper.ts` (+ test) | Place a photo on a paper in fit or fill mode |

Changed:

| File | Change |
|---|---|
| `src/lib/composite.ts` | Background can be a colour, **transparent**, or an **image**; tone moves out to `enhance.ts` and is imported back |
| `src/lib/presets.ts` | Add papers `3r` (88.9 × 127 mm, 3.5 × 5 in), `5r` (127 × 177.8 mm, 5 × 7 in) and `8r` (203.2 × 254 mm, 8 × 10 in) |
| `src/app/App.tsx` | Render by mode |
| `src/features/import/ImportStep.tsx` | Two drop cards (ID Photo, Photo Print) |
| `src/features/import/usePhotoPipeline.ts` | Extract shared load helper |
| `src/features/background/BackgroundStep.tsx` | Add Auto enhance button to the tone section (ID flow) |

3R, 5R and 8R are added to `PAPERS` but **not** to the ID sheet's `PAPER_ORDER`,
so the ID print sheet is unchanged. Edit mode has its own paper list
`EDIT_PAPER_ORDER = ['3r', '4r', '5r', '8r', 'a4']`.

## The Edit step

### Edit store (`src/store/edit.ts`)

```ts
type BackgroundMode = 'original' | 'transparent' | 'color' | 'image'

interface EditState {
  status, error, progress, info, preview, previewMask   // as in useJob
  maskStatus: 'none' | 'running' | 'ready' | 'error'
  backgroundMode: BackgroundMode           // default 'original'
  backgroundColor: string                  // default '#FFFFFF'
  backgroundImage: Bitmap | null           // decoded upload, preview size
  backgroundImagePath: string | null       // re-read at full res on export
  backgroundFit: { zoom: number; offsetX: number; offsetY: number } // image placement
  edgeSoftness: number; hairDetail: number; quality: SegModel
  enhance: EnhanceSettings                 // below
  paper: PaperId; paperFit: 'fit' | 'fill'; orientation: 'auto'|'portrait'|'landscape'
  copies: number
}
```

`reset()` releases the image in Rust as `useJob.reset` does, and clears the
photo, mask, background image and enhance settings; it keeps background mode,
colour, quality and paper.

### Canvas

The whole photo, fitted to the canvas, with the same draggable
**Before | After** divider as the Background step (reuse that component rather
than copy it). Transparent is shown over a checkerboard. While the mask is
running, the After side shows the enhanced original with a progress bar.

### Panel — Background

Segmented control: **Original** | **Transparent** | **Colour** | **Image**.

- **Original** — no cutout; enhance applies to the whole photo.
- **Transparent** — output alpha = mask. Export forces PNG.
- **Colour** — the existing swatches plus a custom picker.
- **Image** — "Choose image…" opens a file dialog (JPG/PNG). The background
  image is drawn **cover-fit** behind the subject at the photo's aspect ratio,
  then zoom (100–300 %) and drag to reposition. "Change" and "Remove" buttons.
- Edge softness and hair detail sliders (existing ranges) show for every mode
  except Original.

### Panel — Enhance

- **Auto enhance** button: analyses the photo and *sets the sliders* (it never
  applies hidden changes). Pressing it again re-analyses; Reset returns every
  slider to neutral.
- Sliders, each −50..+50, neutral 0:
  - Brightness, Contrast, Warmth (the existing uncommitted work)
  - **Saturation** (new)
  - **Sharpness** (new, 0..+50 only: unsharp mask)

What enhance applies to:
- **Original** → the whole photo.
- **Transparent / Colour / Image** → the subject only; the chosen background
  is left exactly as picked (same rule as the ID flow, so white stays white).

### `src/lib/enhance.ts`

Pure functions on `Bitmap`, no DOM:

- `autoEnhance(image: Bitmap, mask?: Bitmap): EnhanceSettings` — computes, on a
  downsampled copy (≤ 512 px):
  - **Exposure / contrast**: the 0.5 % and 99.5 % luminance percentiles
    (over the subject only when a mask is given); brightness moves the median
    toward mid-tone, contrast stretches the percentiles toward 0..255. Both
    clamped to ±35 so it never overshoots.
  - **Warmth**: grey-world estimate of the colour cast (mean R vs B over
    mid-tone pixels), mapped onto the warmth slider, clamped to ±35.
  - Saturation 0, sharpness 0 (auto leaves those to the operator).
- `enhanceTables(settings)` — the per-channel LUTs (the current `toneTables`,
  moved here).
- `applyEnhance(image, settings)` — LUTs, then saturation (blend each pixel
  toward/away from its luminance), then sharpness (unsharp mask using the
  existing `boxBlur`, radius scaled to image size so a 24 MP photo and a
  1400 px preview look alike).

`composite()` calls `applyEnhance` on the foreground before blending, as tone
does today; the Original mode calls `applyEnhance` directly with no mask.

## Print & Export

### Canvas

The chosen paper drawn to scale with the photo on it, as it will print.

### Panel

- **Save**: **PNG** | **JPG** (JPG disabled with a note when Transparent is
  chosen). Saves the full original resolution — never cropped, never
  downscaled. DPI metadata is stamped at 300 using the existing `setJpegDpi` /
  `setPngDpi`. Default file name: `<original name>-edited.<ext>`.
- **Print**:
  - Paper: 3R, 4R, 5R, 8R, A4.
  - **Fit** (whole photo visible, white border on the short side) |
    **Fill** (paper covered edge to edge, overflow cropped from the centre).
    Default Fit.
  - Orientation: Auto (matches the photo) | Portrait | Landscape.
  - Copies (1–20), passed as `copies` to `print_sheet`.
  - Printer picker and the existing print dialog/properties flow.
- Both buttons go through `useLicense().canProduce`, exactly as the ID export
  does; an expired trial opens the licence dialog.

### Building the output (`useEditExport`)

1. Fetch the full-resolution photo (`getImageBytes maxDim 0`) and, if the
   background mode needs it, the full-resolution mask (`segment`).
2. For Image mode, decode the uploaded background at full size and cover-fit
   it to the photo's dimensions with the saved zoom/offset.
3. Composite (or `applyEnhance` for Original).
4. Save: encode → stamp DPI → `saveFile`.
   Print: `fitToPaper` renders the result onto a white paper bitmap at 300 DPI
   (e.g. 4R = 1200 × 1800 px) — **downsample first**, so printing never
   processes the full 24 MP image — then `printSheet({ png, widthMm, heightMm,
   copies })`. Transparent prints on white.

### Memory: full-resolution compositing

A 24 MP DSLR photo is the realistic worst case. `estimateForeground` allocates
several float planes per image (~100 MB each at 24 MP), which risks running
the webview out of memory. The save path therefore composites in **horizontal
strips** (e.g. 512 rows) with an overlap of `RADIUS_LARGE` rows above and
below, discarding the overlap — the result is identical to one pass because
every operation is local. The first implementation task measures a single
pass on a 24 MP test image; if peak memory is under ~1 GB, strips are left out
(YAGNI) and this section is struck.

**As built:** every full-size save works in 512-row strips: a cut-out
through `compositeInStrips` (overlap 40 rows plus the sharpening radius),
Original through `applyEnhanceInStrips` (overlap four sharpening radii), both
with the whole photo's sharpening radius. Print copies, made at print size,
use one pass. They were built without measuring the single
pass first, because phone photos now reach 48–50 MP; a test proves the
strips match one pass (within one level per channel for a cut-out,
exactly for Original). Peak memory on a large
photo is still to be measured in the running app.

## ID flow change

The Background step's tone section gets the same **Auto enhance** button, using
`autoEnhance(preview, previewMask)` so it measures the face, not the backdrop.
It sets brightness, contrast and warmth only; saturation and sharpness are not
added to the ID flow.

## Error handling

- Background removal fails → the error shows in the panel, background mode
  falls back to Original, enhance still works.
- Uploaded background can't be decoded → a notice under the Image option;
  mode stays where it was.
- Save/print failures use the same `ExportPhase` failed state and message as
  the ID export.

## Testing

- `enhance.test.ts`: neutral settings are the identity; a synthetic dark image
  gets positive brightness; a synthetic blue-cast image gets positive warmth;
  clamping holds; saturation −50 on a colour pixel moves it to its luminance;
  sharpness increases edge contrast on a step edge.
- `composite.test.ts`: transparent mode writes alpha = mask and leaves RGB as
  the decontaminated foreground; image mode blends onto the given bitmap;
  existing colour-mode tests unchanged. If strips are used: strip output equals
  single-pass output on a random image.
- `fitToPaper.test.ts`: fit keeps the whole photo and centres it; fill covers
  the paper; auto orientation follows the photo; 4R at 300 DPI is 1200 × 1800.
- Manual check in the app: a full-body DSLR photo through each of the four
  background modes, saved and printed on 4R.

## Out of scope

- AI enhancement (upscale, denoise, face restore).
- Several photos, or several copies, laid out on one sheet in Edit mode.
- Crop/rotate in Edit mode.
- Tutorial steps for Edit mode (the first-run tutorial stays ID-only for now).
- Saving Edit jobs to the Recent Jobs feature (separate spec, 2026-09-28).

## Changes made during implementation

The operator-facing name is **Photo Print**; the code keeps `edit`
(`mode: 'id' | 'edit'`, `src/features/edit/`, `useEdit`).

- **Auto enhance measures warmth over the whole photo**, never subject-only:
  skin is not grey, so a grey-world estimate over a face would always cool
  it. Exposure and contrast still use the subject when a mask exists.
- **Auto enhance sets three sliders only** (brightness, contrast, warmth,
  each within ±35); the operator's saturation and sharpness are left alone.
- **The background picture is loaded through Rust** (`loadImage`, kept by
  id) instead of by path, so EXIF orientation is handled and no fs
  permission is needed; it is released on Remove and on New photo.
- **Background picture placement uses Zoom / Horizontal / Vertical
  sliders**, not dragging, because dragging on the canvas already moves the
  Before | After divider.
- **No HD-model control** in Photo Print; like the ID flow, it uses the
  bundled Lite model.
- **Copies are chosen in the shared print dialog** (1–99), not stored in
  `useEdit`. The dialog now takes a `title` and `summary`, and keeps its
  paper name for the "set the paper in Printer settings" reminder.
- **`reset()` turns an Image background back to Original**, since the
  picture itself is cleared.
- **The Before | After box is shared** (`CompareView`) between the ID
  Background step and Photo Print's Edit step.
- **Full-size saves composite in strips** (see Memory above).
- The end-to-end run in the app (every background mode, save, print on 4R
  and 3R, New photo during background removal, paste, the unchanged ID
  flow) is left to the owner, who is testing the running app.
