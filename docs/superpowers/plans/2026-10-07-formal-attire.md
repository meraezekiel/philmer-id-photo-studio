# Formal Attire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Attire step that overlays a clothing template (shipped placeholder or operator upload) on the customer, snapped under the chin and fine-tunable, carried into every preview and export.

**Architecture:** Pure geometry in `src/lib/attire.ts` (template anchors, face-to-photo mapping, auto-fit, chin clip) tested in Node; canvas drawing in `src/lib/attireDraw.ts`; library state in `src/store/attire.ts`; per-job fit in `useJob`; uploads stored by Rust in `%APPDATA%\…\attire` with a JSON manifest.

**Tech Stack:** React 18, zustand, Vite, vitest; Tauri 2 / Rust.

**Spec:** `docs/superpowers/specs/2026-10-07-formal-attire-design.md`

## Global Constraints

- Step order: Import → Adjust → Background → Attire → Print sheet → Export; Attire defaults to None.
- Fit is stored resolution-free: neck position as fractions of the finished photo, `scale` = template shoulder width / photo width, `rotation` in degrees.
- Attire is drawn after `composite(...)` and before `withNameTag(...)` everywhere.
- Nothing above the chin line is ever covered by attire.
- Owner's downloaded templates go only into the app-data attire folder on this machine; never into git or `src/assets`.
- Builds on the owner's uncommitted, tested changes in the working tree; do not commit them as part of this work.

## Review Focus

- Template with no transparent pixels or not a PNG → rejected with a readable message, nothing written.
- Photo with no detected face → attire still placeable (centred default fit), no crash.
- New customer (Ctrl+N) → attire back to None; next customer's photo is never dressed in the last one's fit.
- Re-cropping in Adjust after choosing attire → fit follows the face unless the operator moved it.
- `attire.json` missing or corrupt → library shows shipped templates only; upload rewrites a valid manifest.

---

### Task 1: Pure attire geometry

**Files:** Create `src/lib/attire.ts`, `src/lib/attire.test.ts`

**Produces:**
```ts
export interface TemplateAnchors { neck: { x: number; y: number }; shoulderWidth: number; bottom: number }
export interface AttireFit { x: number; y: number; scale: number; rotation: number }
export interface FaceFrame { chinX: number; chinY: number; faceWidth: number; faceHeight: number } // photo fractions
export function measureTemplate(t: Bitmap): TemplateAnchors          // throws if no opaque pixels
export function faceFrame(face: Face | null, cropRect: CropRect | null, image: { width: number; height: number }): FaceFrame | null
export function autoFit(frame: FaceFrame | null): AttireFit
export function attireMatrix(fit: AttireFit, a: TemplateAnchors, w: number, h: number): [number, number, number, number, number, number] // canvas setTransform
export function chinClipAlpha(y: number, chinPx: number, featherPx: number): number // 0 above chin, ramps to 1
export function attireBottomFraction(fit: AttireFit, a: TemplateAnchors, w: number, h: number): number
```
Constants: `NECK_DROP = 0.3` (neck point below chin, × face height), `SHOULDER_PER_FACE = 2.6`, no-face default `{x:.5,y:.72,scale:.9,rotation:0}`. Rotation defaults to 0 (the crop already levels the eyes).

- [ ] Tests: V-neck synthetic template → neck at centre where gap closes; high collar → neck at top centre; shoulder = widest run in top 60 %; empty template throws; `faceFrame` with no crop = box/width; with a 90° crop rotation maps a point correctly; `autoFit(null)` = default; `autoFit(frame)` puts neck at chinY + 0.3·faceHeight; `attireMatrix` maps template neck to `(x·w, y·h)` at two sizes; `chinClipAlpha` 0 above, 1 below, between in feather.
- [ ] Implement; `npx vitest run src/lib/attire.test.ts` passes.

### Task 2: Rust attire library

**Files:** Create `src-tauri/src/attire.rs`; modify `lib.rs`, `commands.rs`, `state.rs`.

**Produces (commands):** `list_attire() -> Vec<AttireEntry>`, `import_attire({path,name,group}) -> AttireEntry`, `remove_attire({id})`, `read_attire({id}) -> bytes`. `AttireEntry { id, name, group, file, addedAt }` (camelCase).

- [ ] Unit tests in `attire.rs`: `png_has_transparency` true for RGBA, true for RGB+tRNS, false for RGB, error for non-PNG; `list` drops entries whose file is missing; corrupt manifest → empty list; import → list → remove round-trip in a temp dir.
- [ ] Implement with temp-file + rename writes; folder `app_data_dir/attire` created in `state.rs`.
- [ ] `cargo test attire` passes.

### Task 3: Bindings, library store, drawing, placeholders

**Files:** Modify `src/lib/tauri.ts`; create `src/store/attire.ts`, `src/lib/attireDraw.ts`, `src/assets/attire/{shirt-tie,blazer-tie}.svg`, `src/assets/attire/index.ts`.

**Produces:**
```ts
// store/attire.ts
export interface AttireTemplate { id: string; name: string; group: 'men'|'women'|'other'|'placeholder'; source: 'bundled'|'user'; url: string; bitmap: ImageData; anchors: TemplateAnchors }
export const useAttireLibrary: { templates: AttireTemplate[]; status: 'idle'|'loading'|'ready'|'error'; error: string|null; load(): Promise<void>; add(path, name, group): Promise<void>; remove(id): Promise<void> }
// lib/attireDraw.ts
export function withAttire(photo: Bitmap, layer: { template: AttireTemplate; fit: AttireFit; chinY: number | null } | null): Bitmap
```
- [ ] Implement; `npm run typecheck` clean.

### Task 4: Job state and the Attire step

**Files:** Modify `src/store/job.ts`, `src/app/App.tsx`, `src/features/tutorial/script.ts`; create `src/features/attire/AttireStep.tsx` (canvas + panel), `src/features/attire/useAttireLayer.ts`.

- `Step` gains `'attire'`; `attireId`, `attireFit`, `attireTouched`; `setAttire(id)` runs `autoFit(faceFrame(largestFace(faces), cropRect, info))`; `setAttireFit(patch)` sets touched; `resetAttireFit()`; `setCropRect` re-fits when not touched; `reset()` clears.
- Canvas: finished preview with attire; drag moves, wheel scales; chin guide while dragging.
- Panel: None + grouped thumbnails, remove (×) with inline confirm on uploads, Add template… (dialog + name/group form), Size/Rotation sliders, Re-fit, bottom-edge warning.
- [ ] Store tests in `src/store/job.test.ts`: default None; setAttire with no face gives default fit; setCropRect re-fits untouched and keeps touched; reset clears.
- [ ] `npm test` (tutorial tests cover the new step), typecheck.

### Task 5: Attire in previews and exports

**Files:** Modify `src/features/export/useExport.ts`, `src/features/export/ExportStep.tsx`, `src/features/sheet/SheetStep.tsx`.

- [ ] `withAttire` between `composite` and `withNameTag` in `buildPhoto`, the Export preview and the sheet preview hook.
- [ ] Typecheck + tests.

### Task 6: Load owner templates, verify in the app, docs

- [ ] Import the nine Downloads PNGs through `import_attire` (men: suits; women: blouse and blazers).
- [ ] Drive the app: T-shirt-style photo → Attire → each template; export single JPG and sheet; confirm face uncovered and output matches canvas. Tune `NECK_DROP`/`SHOULDER_PER_FACE` if the snap is off.
- [ ] `BUILD_PLAN.md`: move clothing replacement out of non-goals (template overlay only).
