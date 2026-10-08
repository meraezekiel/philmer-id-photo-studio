# Recent jobs and reprint: design

Date: 2026-09-28. Status: approved in conversation; revised after a check
against the code; awaiting spec review.

## Why

Customers come back for more copies. Today the operator has to find the
original photo, wait ~15 s for background removal again, and redo the crop,
background, name and sheet. The goal is a 10-second reprint, and a way to
reopen an old job to change it (e.g. 2x2 last time, 1x1 now).

## Decisions made with the owner

- Both actions: **Reprint** (same job, straight to print) and **Open** (reload
  to edit).
- Keep jobs **30 days**, then delete automatically.
- Save the **full original** (about 3.5 MB per job, about 3 GB at 30
  customers a day), not only the cropped area, so Open can re-crop freely.

## Where it is stored

`app_local_data_dir()/jobs/<job-id>/`, i.e.
`%LOCALAPPDATA%\art.philmerdigi.idphotostudio\jobs\`. Local, not Roaming
(`app_data_dir`, where `models/` lives): 3 GB does not belong in a roaming
profile. `<job-id>` is `YYYYMMDD-HHMMSS-<4 hex>`, which sorts by time and
never collides.

Known consequences, accepted:
- Dev builds and the installed app share this folder (same identifier,
  tauri.conf.json:5), so test jobs show up in the installed app on this PC.
- Tauri's NSIS uninstaller offers "delete app data"; ticking it deletes the
  jobs. HOW-TO-SELL-AND-LICENSE.txt gets one line saying so.

## What is saved

| File | Contents |
|---|---|
| `original.jpg` | The in-memory photo (already upright, image_io.rs:45-47), JPEG quality 92, full resolution |
| `mask.png` | The cached full-resolution mask, 8-bit grayscale |
| `thumb.jpg` | The finished single photo from `buildPhoto`, longest edge 160 px |
| `job.json` | `{ version: 1, id, label, createdAt, updatedAt, width, height, settings }` |

A reprint is therefore not bit-identical to the first print (the original is
re-encoded once at q92); the difference is not visible on paper.

`settings` is a snapshot of the job store's operator choices: `presetId`,
`zoom`, `rotation`, `offsetX`, `offsetY`, `levelEyes`, `crownOverride`,
`chinOverride`, `cropRect`, `paper`, `sheetMode`, `quantity`, `packageRows`,
`cutMarks`, `photoBorders`, `paperOrientation`, `sheetOffsetXMm`,
`sheetOffsetYMm`, `photoOffsets`, `background`, `edgeSoftness`, `hairDetail`,
`tone`, `nameTag`, and `faces`.

Not saved: transient UI state (`step`, `status`, `progress`, `error`,
`selectedPhotos`), bitmaps, and `quality` — nothing in the UI changes it
(`setQuality` has no caller), and restoring `'hd'` on a PC without the HD
model would fail.

`label` is the name-tag text when one was typed, otherwise empty; the UI then
shows the preset and time.

## Prerequisite fix: crop offsets independent of window size

`offsetX`/`offsetY` are stored in screen pixels (AdjustCanvas.tsx:186), and
the crop box is 66% of the canvas height (lines 96-99). Every time Adjust
mounts, `cropRect` is re-derived from them (lines 149-163). So the same
offsets give a different crop in a different-sized window. That is a latent
bug today (resize the window mid-job and the crop shifts), and it would make
Open restore the wrong framing.

Fix: store the offsets as a fraction of the crop box height and convert to
pixels only inside AdjustCanvas. Add a unit test that the same offsets give the
same `cropRect` at two canvas sizes.

## Prerequisite fix: `segment` checks the cache first

`segment` loads the ONNX session before looking at the cached mask
(commands.rs:165), so a reopened job still waits for the 224 MB model to load
on first use, and fails with `ModelMissing` if that model is absent. Move the
cache check above the session load.

## When it saves

After a **successful** print or file save, never on failure or a cancelled
save dialog. There are two success points in `useExport.ts`:

- `run` when the task returns a result (lines 109-114): Sheet as PDF, Sheet as
  JPG, Single photo as JPG/PNG. A cancelled dialog returns `null` there.
- `printDirect` (lines 230-246), which bypasses `run`. It is used by
  SheetPrintButton on both the Print sheet and Export steps.

The save goes into `useExport`, where the `buildPhoto` output is available for
the thumbnail. The store keeps `historyId: string | null`:

- `null` → `save_job` creates a folder and the store remembers its id.
- set → `save_job` rewrites `job.json` and `thumb.jpg` in that folder and bumps
  `updatedAt`; `original.jpg` and `mask.png` are written only on creation.

`reset()` (New photo) clears `historyId`. Opening a job sets it, so edits to a
reopened job update that entry, and its 30 days restart from `updatedAt`.

A failed history save never fails the print: it is logged and shown as a
small non-blocking notice.

## Rust: `src-tauri/src/history.rs` + commands

- `save_job({ imageId, historyId?, label, settings, thumbJpeg })` → `{ id }`.
  Encodes `original.jpg` and `mask.png` from the `ImageStore` entry. An image
  with no cached mask is an error (a job is only saved after export, when the
  mask exists).
- `list_jobs()` → `[{ id, label, createdAt, updatedAt, presetId }]`, newest
  `updatedAt` first. Unreadable folders are skipped and logged.
- `job_thumb({ id })` → JPEG bytes (thumbnails go through a command, not the
  `asset:` protocol, which would need a scope).
- `open_job({ id })` → decodes `original.jpg` into the `ImageStore` with
  `exif_orientation = 1`, puts `mask.png` in that image's mask cache
  (store.rs:20, set after `insert`), and returns
  `{ info: LoadedImageInfo, settings }`.
- `delete_job({ id })`.
- `prune_jobs` runs once from `setup` (lib.rs:33) on a background thread and
  deletes folders whose `updatedAt` is older than 30 days.
- Every `id` argument is validated against the id pattern before touching the
  file system, so a crafted id cannot escape the `jobs` folder.

## Frontend

- `src/lib/history.ts`: pure `snapshotSettings(state)` and
  `restoreSettings(json)`, plus typed command wrappers in `src/lib/tauri.ts`.
  `restoreSettings` fills missing fields from defaults and converts
  `photoOffsets` keys back to numbers (JSON makes them strings).
- The restore is applied with a single raw `set`, not the public setters:
  `setPreset`, `setPaper`, `setSheetMode` and `setPaperOrientation` clear
  sheet offsets and `nameTag.enabled` as a side effect (job.ts:214-227,
  271-272, 320-321).
- `usePhotoPipeline` gets `openSaved(id)`:
  1. `releaseImage()`, so the previous photo leaves Rust memory. (`run` has
     the same gap today when the operator goes Back to Import and loads
     another photo; fix it there too.)
  2. `open_job`, then fetch the preview and call `segment` (now a cache hit).
  3. Set faces and preview, then apply the restored settings and `historyId`
     in one `set`.
  While this runs, the Processing screen says "Opening saved job…", not the
  segmentation labels.
- **Reprint** never mounts Adjust, so the saved `cropRect` is used as is. It
  jumps to Export and opens the print dialog. That dialog's open state is
  local to SheetPrintButton (line 25), so add a one-shot store flag
  (`printRequested`) that the Export step's print button consumes. The
  first-run tour must not pop its Export tips over the dialog.
- **Open** jumps to Adjust. The crop is re-derived from the restored
  (now size-independent) offsets, so it matches what was printed.
- **Import screen:** a "Recent" strip under the drop zone, inside the existing
  centred column (ImportStep.tsx:126-176), in the slot DESIGN_BRIEF.md:59
  reserves. The tour anchor `data-tour="dropzone"` stays. Each card shows the
  thumbnail, the label (or preset), and relative time ("today 3:10 PM",
  "Sep 12"), with **Reprint**, **Open** and a small delete button. The strip
  is hidden when there are no jobs. It shows the newest 12, with "Show all"
  and a search box that filters by label.
- The licence gate applies unchanged: it is enforced in Rust (commands.rs:321,
  license.rs:422) and the UI (SheetPrintButton.tsx:78, ExportStep.tsx:88-91).

## Testing

- Rust unit tests (temp dir): save then list round-trips; saving with an
  existing id updates in place; prune deletes only folders older than the
  cutoff; ids with `..`, slashes or the wrong shape are rejected; a corrupt
  `job.json` is skipped by `list_jobs`; `segment` on an image with a cached
  mask does not need a session.
- Vitest: `restoreSettings(snapshotSettings(state))` returns the same operator
  choices, including numeric `photoOffsets` keys; missing fields from an older
  `version` fall back to defaults instead of throwing; the same offsets give
  the same `cropRect` at two canvas sizes.
- In the running app, driven via WebView2 remote debugging: print a job and see
  it in Recent; Reprint reaches the print dialog with no segmentation in the
  log; Open restores the same crop after the window is resized; New photo
  followed by a new print creates a separate entry; delete removes the folder.

## Out of scope

Syncing across PCs, export or backup of the archive, a settings screen for
the 30-day period, and combining several customers on one sheet (#2).
