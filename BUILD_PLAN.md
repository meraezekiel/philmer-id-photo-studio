# ID Photo Studio: Build Plan (handover for Claude Code)

> **Working name:** Philmer ID Photo Studio (keep the name in one config constant so it can change later)
> **Owner:** Louie / Philmer Digi Art
> **Target:** Windows 10/11 desktop app, installed with an `.exe` and **fully offline** after install
> **Companion doc:** `DESIGN_BRIEF.md` (UI/UX, handled by Claude Design). If design files are in `/design`, follow them. Otherwise use the defaults in this plan.

---

## 1. What we're building

A desktop app for a small printing counter that turns an ordinary photo into print-ready ID photos:

1. **Import** a photo (drag-drop / file picker / paste).
2. **AI background removal** at **full original resolution** (fixes the remove.bg free-tier degradation).
3. **Auto face align.** The app detects the face and places the crop so head size and position match the chosen size's standard. The user can then adjust it.
4. **Crop** with the aspect ratio locked to the chosen size (zoom / pan / rotate).
5. **Background color:** white, blue, red, light gray, or custom.
6. **Size:** 1x1, 2x2, Passport 35×45 mm, or custom (mm or inches).
7. **Print sheet:** tile copies on 4R, A4, Short bond (Letter), or Long bond (8.5×13) with cut lines, including mixed "packages" (e.g. 4 pcs 1x1 + 2 pcs 2x2).
8. **Export** a 300 DPI JPG/PNG/PDF and **print** at true size.

Non-goals for v1: AI clothing replacement (template attire overlays are in — see docs/superpowers/specs/2026-10-07-formal-attire-design.md), skin retouching, cloud features, accounts, macOS build.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | **Tauri v2** | Small installer, NSIS target |
| Frontend | **React 18 + TypeScript + Vite** | |
| State | Zustand | One store per job (image, mask, crop, settings) |
| Canvas | react-konva (Konva) | Crop box, guides, handles, sheet preview |
| Styling | Tailwind CSS + tokens from Claude Design | Put design tokens in `src/styles/tokens.css` |
| PDF | `pdf-lib` (npm) | Exact mm page and photo sizes |
| Inference | **Rust `ort` crate (ONNX Runtime) with `load-dynamic` feature** | Native CPU inference, much faster than WASM in the webview |
| Image I/O (Rust) | `image`, `fast_image_resize`, `kamadak-exif`, `ndarray` | EXIF orientation is a must (phone photos) |
| Settings | `tauri-plugin-store` | Paper margins, default size, last bg color |
| Files | `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-opener` | Open the PDF in the default viewer for printing |

### Why inference runs in Rust and not in the browser
BiRefNet is a large model (Swin backbone). In onnxruntime-web (WASM) it's slow and can run out of memory. Native ORT on CPU with all cores is several times faster and more stable. Keep all ML in Rust and keep the frontend for UI and compositing.

---

## 3. AI models (all offline, all permissive licenses)

| Purpose | Model file | Size | License | Source |
|---|---|---|---|---|
| Background removal (default, **bundled**) | `BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx` ("BiRefNet Lite") | ~224 MB | MIT | `https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx` |
| Background removal (HD, **optional download**) | `BiRefNet-portrait-epoch_150.onnx` | ~973 MB | MIT | `https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-portrait-epoch_150.onnx` |
| Face + landmarks | YuNet `face_detection_yunet_2023mar.onnx` | ~230 KB | MIT | opencv_zoo repo `models/face_detection_yunet/` (Git LFS, so download via the "raw"/media URL) |
| Runtime | `onnxruntime.dll` (win-x64) | ~12 MB | MIT | Microsoft's onnxruntime GitHub release zip `onnxruntime-win-x64-<ver>.zip`. **Match the ORT version the `ort` crate expects** (check the ort docs for the version you pin). |

**Model handling rules**
- Bundle the Lite model, YuNet, and `onnxruntime.dll` as Tauri resources (`src-tauri/resources/`). The app must work with **no internet** right after install.
- The HD Portrait model goes in **Settings → Models**: "Download (973 MB)" with progress, resume, and a **SHA-256 check**, *or* "Import model file…" for offline transfer by USB. Store it in `%APPDATA%/<app-id>/models/`.
- Compute and pin the SHA-256 of every model in `src-tauri/src/models.rs` when you first download them.
- Don't commit `.onnx` files to git. Add a `scripts/fetch-models.ps1` (and `.sh`) that downloads them into `src-tauri/resources/` and verifies the checksums.
- Initialize ORT with `ort::init_from(<resource path>/onnxruntime.dll)` at startup. Load sessions lazily and cache them in Tauri state. Set `intra_threads` = physical core count.
- **Don't use** BRIA RMBG (non-commercial license) or imgly/background-removal (AGPL). This app is used commercially.

---

## 4. Architecture

```
src/                         (React)
  app/                       routes / step wizard
  features/import/
  features/align/            crop canvas, guides, auto-align call
  features/background/       color picker, edge controls, preview
  features/size/             presets, custom size
  features/sheet/            print sheet layout + preview
  features/export/           jpg/png/pdf + print
  features/settings/         paper margins, models, defaults
  lib/presets.ts             photo size + paper presets (data only)
  lib/layout.ts              sheet packing algorithm (pure, unit tested)
  lib/composite.ts           mask + bg color + decontamination on canvas
  lib/dpi.ts                 px<->mm, JPEG JFIF density / PNG pHYs writers
  store/job.ts
src-tauri/
  src/main.rs
  src/commands.rs            tauri commands (below)
  src/image_io.rs            decode + EXIF orientation
  src/segment.rs             BiRefNet pre/post-processing
  src/face.rs                YuNet decode + NMS
  src/models.rs              paths, checksums, download/import
  resources/                 onnxruntime.dll, *.onnx
```

### Tauri commands (Rust → JS contract)

| Command | Input | Output |
|---|---|---|
| `load_image` | `path` or bytes | `{ id, width, height }` (orientation already applied, original kept in memory) |
| `segment` | `{ id, model: "lite" \| "hd" }` | Full-resolution 8-bit alpha mask as PNG bytes (binary IPC response). Emits `segment://progress` events |
| `detect_faces` | `{ id }` | `[{ box:[x,y,w,h], score, landmarks:{ rightEye, leftEye, nose, mouthRight, mouthLeft } }]` in original image px |
| `get_image_bytes` | `{ id }` | Oriented original as PNG/JPEG bytes for the canvas |
| `model_status` / `download_model` / `import_model` | | Model manager |
| `save_file` | `{ path, bytes }` | Write the export |

Run heavy work in `tauri::async_runtime::spawn_blocking`. Never block the UI thread.

---

## 5. Processing pipeline

**On import (runs automatically, in parallel):**
1. Decode and apply EXIF orientation. Supported: JPG, PNG, WebP, BMP. For HEIC, show a friendly "Please convert to JPG" message (v1).
2. **Segmentation (BiRefNet):**
   - Resize the RGB image to **1024×1024** (bilinear, no letterbox, the same as rembg).
   - Normalize to float32: `(px/255 − mean) / std`, mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]`, NCHW.
   - Run the model. Take output[0] `[1,1,1024,1024]` and **apply sigmoid**.
   - **Upscale the mask to the original image size** (bilinear or bicubic) → 8-bit alpha. *Never downscale the photo itself. This is the core quality fix.*
3. **Face detection (YuNet 2023mar):**
   - Letterbox to 640×640, BGR, 0–255 float, no normalization. Inspect the input/output names with ORT metadata first.
   - Decode strides 8/16/32: `score = sqrt(cls·obj)`, `cx=(col+b0)·s`, `cy=(row+b1)·s`, `w=exp(b2)·s`, `h=exp(b3)·s`, landmarks `x=(k+col)·s`. Threshold 0.6, NMS IoU 0.3. Map back through the letterbox.
   - 0 faces → manual mode with a notice. >1 face → pick the largest, and let the user click a different face.

**Auto-align (pure TS function `autoCrop(face, maskBBox, preset)`):**
- `eyeMid` = midpoint of the eyes. **Roll angle** = atan2 of the eye line, then rotate to level it (limit ±15°).
- **Crown** = the top-most foreground pixel of the mask inside the column spanning the face box width (this includes hair).
- **Chin** ≈ `mouthMid.y + 0.85 × (mouthMid.y − eyeMid.y)`. Keep 0.85 as a tunable constant (`CHIN_FACTOR`) and check it against test photos.
- `headHeight = chin − crown`. Crop height `= headHeight / preset.headRatio`. Crop width = crop height × aspect.
- Place the crown at `preset.topGapRatio` of the crop height from the top, and center horizontally on `eyeMid.x`.
- If the crop goes outside the image, pad with the background color (allowed, because the background gets replaced anyway).

**Compositing (frontend, `composite.ts`):**
1. Crop/rotate the **original** pixels and the mask with the same transform.
2. Resample to the output px size (`round(mm / 25.4 × 300)`) using a high-quality downscale (step-down or Lanczos via `pica`).
3. **Edge color decontamination** (removes the old background's halo): for alpha between 0.02 and 0.98, estimate foreground color `F = blur(I·α) / blur(α)` at radius ~4 px and ~16 px (take the small radius when valid). Then `out = F·α + bg·(1−α)`.
4. Controls: **Edge softness** (−2…+2 px erode/dilate + feather) and **Hair detail** (mask gamma).
5. Optional adjustments: brightness, contrast, warmth (simple, applied before compositing).
6. Optional **name tag** strip (1x1 and 2x2 only; turned off for Passport): a white strip at the bottom inside the photo, ~18% of height, centered text in uppercase Arial Bold, font size auto-fits.

---

## 6. Presets (data, editable in `presets.ts`)

| Preset | Size | Output px @300 DPI | Head height (crown–chin) | Top gap | Default bg |
|---|---|---|---|---|---|
| 1x1 | 25.4 × 25.4 mm | 300 × 300 | 62% of height | 10% | White |
| 2x2 | 50.8 × 50.8 mm | 600 × 600 | 60% (range 50–69%) | 10% | White |
| Passport (ICAO / PH DFA) | 35 × 45 mm | 413 × 531 | 34 mm = 75.5% (range 32–36 mm) | 4 mm | White (lock with a warning if changed) |
| Custom | user mm/in | computed | 62% | 10% | last used |

Background swatches: White `#FFFFFF`, Blue `#1E5BC6` (standard ID blue), Light Blue `#8EC5FF`, Red `#C62828`, Light Gray `#E9E9E9`, plus a custom picker. Keep the swatch list in data.

Show guide overlays for the active preset: crown line, chin line (min/max band), eye line, and center line.

---

## 7. Print sheet

**Papers** (`presets.ts`): 4R 101.6×152.4 mm · A4 210×297 · Short bond / Letter 215.9×279.4 · Long bond 215.9×330.2. Default margins: 3 mm (4R) and 5 mm (others), editable in Settings. Default gap between photos is 2 mm.

**Algorithm (`layout.ts`, pure and unit-tested):**
- **Single-size fill:** try portrait and landscape; `cols = floor((W − 2m + g)/(w + g))`, `rows = floor((H − 2m + g)/(h + g))`; pick the larger count; center the grid.
- **Package mode** (mixed sizes, e.g. "4×1x1 + 2×2x2"): shelf-pack largest first, left to right and top to bottom, then center. If it doesn't fit, show "Doesn't fit on 4R, try A4" instead of silently dropping photos.
- **Quantity:** "Fill sheet" (default) or an exact number.
- Draw **cut marks** (thin 0.2 mm gray lines in the gaps/corners, toggleable).

**Expected counts (unit-test fixtures, gap 2 mm, default margins):**

| Paper | 1x1 | 2x2 | Passport |
|---|---|---|---|
| 4R | 15 | 2 | 8 |
| A4 | 70 | 15 | 30 |
| Short bond | 63 | 15 | 28 |
| Long bond | 77 | 18 | 32 |

(2x2 only fits 2 on 4R because the printer needs margins. The UI should suggest Package mode or a bigger paper.)

**Package presets:** e.g. "4R Combo: 2 pcs 2x2 + 4 pcs 1x1", "A4 Combo: 4 pcs 2x2 + 8 pcs 1x1 + 4 pcs Passport". Only ship combos that `layout.ts` confirms fit with the default margins (add them as unit tests). Users can save their own packages.

---

## 8. Export and printing

- **Single photo:** JPG (quality 95) or PNG at exact px, with **300 DPI written into the file** (JFIF density units=1, 300×300; PNG `pHYs` = 11811 px/m).
- **Sheet:** PDF via `pdf-lib` with the page size in exact mm and photos placed in points (`mm × 72/25.4`), images embedded at 300 DPI. Also allow a sheet JPG/PNG at 300 DPI.
- **Print button:** write the PDF to temp and open it with the default app (`tauri-plugin-opener`). Show the tip "Print at *Actual size / 100%*, not *Fit to page*". Don't rely on `window.print()` for sizing because WebView2 scaling is unreliable.
- Default file name: `IDPhoto_{size}_{yyyyMMdd-HHmm}.{ext}` and remember the last folder.

---

## 9. Milestones and acceptance criteria

**M0: Scaffold and runtime smoke test**
- Tauri v2 + React + TS app runs with `npm run tauri dev` on Windows.
- `scripts/fetch-models.ps1` downloads and verifies the models.
- Rust integration test: segment `tests/fixtures/portrait.jpg` and write the mask PNG. Detect 1 face with landmarks.
- ✅ Lite segmentation of a 12 MP photo finishes in under ~10 s on a typical 4-core laptop CPU (log the timing).

**M1: Background removal and single export**
- Import → mask → replace bg → export PNG/JPG at the original crop resolution.
- ✅ The exported image's pixel dimensions equal the crop's source pixels (no downscale). Hair edges show no visible halo on white/blue.

**M2: Presets and auto-align**
- Preset picker, aspect-locked crop, zoom/pan/rotate, guide overlays, auto-align.
- ✅ On 10 test photos, auto-align puts the head height inside the preset's range for at least 8 of them. Single outputs are exactly 300×300 / 600×600 / 413×531 px with 300 DPI metadata.

**M3: Print sheet**
- Paper, fill/quantity, package mode, cut marks, PDF + image export, Print.
- ✅ `layout.ts` unit tests match the table in §7. A 2x2 printed on the Epson L121 at "Actual size" measures 50.8 mm ±0.5 mm.

**M4: Polish**
- Adjustments, name tag, settings (margins, defaults), model manager (HD download/import with checksum), all error/empty/loading states from DESIGN_BRIEF, keyboard shortcuts.
- ✅ The app works with networking disabled (Wi-Fi off) from launch to print.

**M5: Packaging**
- NSIS installer (per-user install, no admin needed), app icon, version 1.0.0, resources bundled, WebView2 bootstrapper set to `embedBootstrapper`.
- ✅ Clean install on a fresh Windows 10/11 machine and run offline. The uninstaller removes the app (it asks before deleting downloaded models).

---

## 10. Risks and notes

- **Chin estimate is heuristic.** Keep manual crown/chin handles on the canvas so the user can always correct it.
- **Performance:** show a progress state during segmentation. Cache the mask per image so crop changes are instant. DirectML GPU acceleration is a v1.1 option (`onnxruntime-directml` build + DirectML EP with CPU fallback).
- **Memory:** 24+ MP photos. Downscale the *preview* for the canvas, but always composite the export from the full-resolution original and mask.
- **Passport rules** vary by country. Show a small "Check the latest requirements of the requesting agency" note on the Passport preset.
- **Windows build prereqs:** Rust (MSVC toolchain), Node 20+, VS 2022 Build Tools (C++), WebView2 (preinstalled on Win 11).

## 11. Commands

```bash
npm install
./scripts/fetch-models.ps1        # one-time, downloads + verifies models
npm run tauri dev                 # develop
npm run test                      # vitest: layout.ts, autoCrop, dpi writers
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build               # -> src-tauri/target/release/bundle/nsis/*.exe
```

## 12. Suggested first prompt to Claude Code

> Read `BUILD_PLAN.md` and `DESIGN_BRIEF.md` (and `/design` if present). Implement milestone M0, then stop and show me the smoke-test results before continuing to M1. Use a task list, write unit tests for `layout.ts` using the §7 table, and don't commit model files.
