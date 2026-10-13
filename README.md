# Philmer ID Photo Studio

A Windows desktop app that turns an ordinary photo into print-ready ID photos.
Fully offline after install: AI background removal at the photo's **original
resolution**, automatic face alignment, size presets, and print sheets at true
300 DPI.

**Photo Book:** many photos auto-laid-out into 5x6, 5x7, 8x8, 8x10 or A4 pages, adjusted by hand, printed several to a sheet with cut marks for manual binding; books save as `.photobook` files.

See `BUILD_PLAN.md` for the engineering plan and `DESIGN_BRIEF.md` for the UI.

**Status: milestone M0 (scaffold + runtime smoke test).**

---

## Getting started

Prerequisites: Node 20+, Rust (MSVC toolchain), VS 2022 Build Tools (C++),
WebView2 (preinstalled on Windows 11).

```powershell
npm install
./scripts/fetch-models.ps1        # one-time: downloads + verifies the models
npm run tauri dev
```

`fetch-models.ps1` fills `src-tauri/resources/` with the ONNX Runtime and the
two bundled models. They are not in git: they are large, and the licences are
tracked per file in `scripts/models.json`. Downloads resume, and every file is
checked against a pinned SHA-256.

Add `-HD` to also fetch the optional 973 MB HD portrait model. The app does not
need it; it is the "best hair detail" option in Settings.

## Commands

| Command | What it does |
|---|---|
| `npm run tauri dev` | Run the app |
| `npm test` | Vitest: `layout.ts`, `dpi.ts` |
| `npm run typecheck` | `tsc --noEmit` |
| `cargo test --manifest-path src-tauri/Cargo.toml --profile perf -- --nocapture` | Rust unit + smoke tests |
| `cargo test --manifest-path src-tauri/Cargo.toml --profile perf --test bench -- --ignored --nocapture` | Segmentation benchmark (thread, scheduling and input-size sweeps) |
| `npm run tauri build` | NSIS installer in `src-tauri/target/release/bundle/nsis/` |
| `node scripts/make-icon.mjs && npx tauri icon design/app-icon.png` | Regenerate app icons |

Run the Rust tests under `--profile perf`, not `--release`: `perf` is release
speed without link-time optimisation, so it links in seconds rather than the
~14 minutes a full LTO relink of the dependency tree costs. A plain debug build
is far too slow for the timing assertion to mean anything.

`PHOTO_STUDIO_INTRA_THREADS=<n>` overrides the inference thread count (default:
physical core count) without a rebuild.

## How it fits together

```
src/                      React + TypeScript
  app/App.tsx             M0 runtime check (the 5-step wizard lands in M1/M2)
  lib/presets.ts          photo sizes, papers, swatches, packages — data only
  lib/layout.ts           sheet packing (pure, unit-tested against BUILD_PLAN §7)
  lib/dpi.ts              mm<->px, JFIF density and PNG pHYs writers
  lib/tauri.ts            typed wrappers for every Rust command
  styles/tokens.css       design tokens (light + dark)
src-tauri/                Rust
  src/commands.rs         the Rust -> JS contract
  src/engine.rs           ONNX Runtime lifecycle, cached sessions
  src/segment.rs          BiRefNet pre/post-processing
  src/face.rs             YuNet anchor decode + NMS
  src/image_io.rs         decode + EXIF orientation
  src/models.rs           paths, pinned checksums, HD import
  resources/              onnxruntime.dll, *.onnx (fetched, not committed)
```

**All machine learning runs in Rust, never in the webview.** BiRefNet has a Swin
backbone; under WASM it is slow and runs out of memory on a 12 MP photo. Native
ONNX Runtime on the CPU is several times faster and stable. The frontend owns UI
and compositing only.

**The mask is upscaled, never the photo downscaled.** BiRefNet runs at
1024x1024 because that is its training resolution, and the resulting mask is
then resampled back up to the photo's real size. This is the fix for the
remove.bg free-tier quality loss that motivated the app.

## Models

| Purpose | File | Size | Licence |
|---|---|---|---|
| Background removal (bundled) | BiRefNet Lite (`...swin_v1_tiny...`) | 224 MB | MIT |
| Background removal (optional) | BiRefNet Portrait HD | 973 MB | MIT |
| Face + landmarks | YuNet 2023mar | 227 KB | MIT |
| Runtime | onnxruntime.dll (win-x64 1.28.2) | 15 MB | MIT |

The ONNX Runtime version must match what the `ort` crate targets — `ort
2.0.0-rc.13` expects **1.28**. If you bump `ort`, bump `ortVersion` in
`scripts/models.json` and re-run the fetch script.

BRIA RMBG (non-commercial) and imgly/background-removal (AGPL) are deliberately
not used: this app is used commercially.
