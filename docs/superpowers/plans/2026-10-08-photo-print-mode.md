# Photo Print Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second flow, **Photo Print**, beside the ID wizard: drop a whole photo onto its card, optionally enhance it or replace its background, then save it at full resolution or print it one-per-sheet on 3R, 4R, 5R, 8R or A4.

**Architecture:** A tiny `useMode` store picks which flow `App` renders. Photo Print has its own zustand store (`useEdit`), its own three steps (Import → Edit → Print & Export) and its own export hook; it shares the ID flow's loader, compositor, compare view, print dialog and shell. New pixel maths (`enhance.ts`, `fitToPaper.ts`) is pure and tested in Node; anything needing a canvas lives in `bitmap.ts`, as today.

**Tech Stack:** React 18 + TypeScript, zustand, Vitest (Node environment, no canvas), Tauri 2 (Rust commands wrapped in `src/lib/tauri.ts`), Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-30-edit-photo-mode-design.md` (revised 2026-10-08: two drop cards, 3R paper, operator-facing name "Photo Print").

## Global Constraints

- Operator-facing name is **Photo Print**; code keeps `edit` (`mode: 'id' | 'edit'`, `src/features/edit/`, `useEdit`).
- Edit steps are exactly **Import → Edit → Print & Export**.
- Face detection is **never** run in Photo Print. Background removal runs **only** when the background mode is Transparent, Colour or Image.
- Background modes: `'original' | 'transparent' | 'color' | 'image'`, default `'original'`.
- Enhance sliders: Brightness, Contrast, Warmth, Saturation −50..+50; Sharpness 0..+50; neutral 0.
- Auto enhance clamps brightness, contrast and warmth to ±35 and only ever **sets sliders**.
- Enhance on a cut-out applies to the subject only; the chosen background is left exactly as picked.
- Papers: `EDIT_PAPER_ORDER = ['3r', '4r', '5r', '8r', 'a4']`. 3R = 88.9 × 127 mm, 5R = 127 × 177.8 mm, 8R = 203.2 × 254 mm. The ID sheet's `PAPER_ORDER` is unchanged.
- Print: Fit (default) | Fill; orientation Auto | Portrait | Landscape; 300 DPI; Transparent prints on white.
- Save: PNG | JPG at full original resolution, DPI stamped at 300, default name `<original name>-edited.<ext>`; JPG disabled when Transparent.
- Save and print go through `useLicense().canProduce`, as the ID export does.
- The ID flow's behaviour and output must not change (only addition: an Auto enhance button in its Light & colour section).
- Every `localStorage` access is wrapped in try/catch (see `TutorialProvider.tsx`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No Python on this machine; use the editor tools or `node` for scripted edits.

**Deliberate deviations from the spec (decided while planning):**
- Auto enhance measures **warmth over the whole photo**, never subject-only: skin is not grey, so a grey-world estimate over a face would always cool it. Exposure and contrast still use the subject when a mask exists.
- Auto enhance returns brightness, contrast and warmth only; it leaves the operator's saturation and sharpness alone.
- The background image is loaded through Rust (`loadImage`, kept by id) instead of by path, so EXIF orientation is handled and no fs permission is needed; it is released on Remove and on New photo.
- Background image placement uses Zoom / Horizontal / Vertical sliders, not dragging, because dragging on the canvas already moves the Before | After divider.
- No HD-model control in Photo Print: the ID flow has none either; both use the bundled `lite` model.
- Copies are chosen in the shared print dialog (1–99), not stored in `useEdit`.
- `reset()` turns an `image` background mode back to `original`, since the image itself is cleared.

## Review Focus

1. **Next customer loaded while the previous mask is still computing** → the late mask must not attach to the new photo. Pinned in Task 5 (`maskReady` with a stale id is ignored).
2. **Background removal fails** (model missing, inference error) → panel shows the error, mode falls back to Original, enhance keeps working. Pinned in Task 5 (`maskFailed`) and Task 6 (`ensureMask` rejection).
3. **A flat or blank photo** (every pixel one value) → Auto enhance must not produce NaN/Infinity contrast. Pinned in Task 2.
4. **Landscape photo, or a panorama in Fill mode** → Auto orientation turns the paper; Fill still covers every edge. Pinned in Task 4.
5. **Pasted photo (no file name) or a name with odd characters** → default save name is still sane (`photo-edited.png`). Pinned in Task 4 (`editedFileName`).

---

## File Structure

New:

| File | Responsibility |
|---|---|
| `src/lib/pixels.ts` | `Bitmap`, `Rgb`, `createBitmap`, `parseHex`, `boxBlur`, `clamp` — shared pixel primitives (moved out of `composite.ts`, re-exported there) |
| `src/lib/enhance.ts` (+ `.test.ts`) | `toneTables` (moved), `applyEnhance`, `autoEnhance`, `sharpenRadius`, `NEUTRAL_ENHANCE` |
| `src/lib/fitToPaper.ts` (+ `.test.ts`) | `placeOnPaper`, `coverSourceRect` — placement geometry |
| `src/store/mode.ts` | `useMode`: `'id' \| 'edit'`, remembered |
| `src/store/edit.ts` (+ `.test.ts`) | `useEdit`: the Photo Print job |
| `src/features/edit/editPipeline.ts` (+ `.test.ts`) | `loadEditPhoto`, `ensureMask`, `chooseBackground`, `setBackgroundImageFromPath` |
| `src/features/edit/useEditResult.ts` | The preview-size result bitmap, shared by both canvases |
| `src/features/edit/EditStep.tsx` | `EditCanvas`, `EditPanel` |
| `src/features/edit/PrintExportStep.tsx` | `PrintCanvas`, `PrintPanel`, `EditPrintButton` |
| `src/features/edit/useEditExport.ts` | Build full-res / print-size output; save; print |
| `src/features/edit/EditApp.tsx` | The Photo Print shell: steps, keys, action bar |
| `src/app/Shell.tsx` | `StepHeader`, `ActionBar` (moved out of `App.tsx`, made step-list generic) |
| `src/app/components/CompareView.tsx` | Before / After divider (moved out of `BackgroundStep.tsx`) |

Changed: `src/lib/composite.ts`, `src/lib/presets.ts`, `src/lib/dpi.ts`, `src/lib/bitmap.ts`, `src/lib/layout.test.ts`, `src/app/App.tsx`, `src/features/import/ImportStep.tsx`, `src/features/import/usePhotoPipeline.ts`, `src/features/background/BackgroundStep.tsx`, `src/features/sheet/PrintDialog.tsx`, `src/features/sheet/SheetPrintButton.tsx`, spec.

Commands used throughout (run from the repo root):

- Tests: `npx vitest run <file>`; all: `npx vitest run`
- Types: `npx tsc --noEmit`
- App: `npm run tauri dev`

---

### Task 1: Shared pixel primitives (`pixels.ts`)

Pure refactor so `enhance.ts` can use `boxBlur` without importing `composite.ts` (which will import `enhance.ts` — a cycle otherwise). No behaviour change.

**Files:**
- Create: `src/lib/pixels.ts`
- Modify: `src/lib/composite.ts:16-95` (remove the moved definitions, re-export them), `src/lib/composite.ts:457-459` (`clamp`)

**Interfaces:**
- Produces: `Bitmap`, `Rgb`, `createBitmap(w, h)`, `parseHex(hex)`, `boxBlur(src, w, h, r)`, `clamp(v, min, max)` from `./pixels`; `composite.ts` keeps exporting `Bitmap`, `Rgb`, `createBitmap`, `parseHex`, `boxBlur` so no importer changes.

- [ ] **Step 1: Create `src/lib/pixels.ts`**

Move these from `composite.ts` verbatim (doc comments included): the `Bitmap` and `Rgb` interfaces, `createBitmap`, `parseHex`, `boxBlur`. Add `clamp` as an export:

```ts
/**
 * Pixel primitives shared by the compositor and the enhancer.
 *
 * Plain `{ width, height, data }` buffers, so everything stays testable in
 * Node with no canvas. A DOM `ImageData` satisfies `Bitmap` structurally.
 */

/** Structurally compatible with the DOM's `ImageData`. */
export interface Bitmap {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export function createBitmap(width: number, height: number): Bitmap & { data: Uint8ClampedArray } {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

// boxBlur: paste the existing function and its doc comment from composite.ts unchanged.

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
```

- [ ] **Step 2: Point `composite.ts` at it**

Delete the moved definitions and the private `clamp` at the bottom of `composite.ts`, and add at the top (after the file comment):

```ts
import { boxBlur, clamp, createBitmap, parseHex, type Bitmap, type Rgb } from './pixels'

export { boxBlur, createBitmap, parseHex }
export type { Bitmap, Rgb }
```

- [ ] **Step 3: Verify nothing changed**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass (169).

- [ ] **Step 4: Commit**

```bash
git add src/lib/pixels.ts src/lib/composite.ts
git commit -m "Move pixel primitives into pixels.ts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Enhance maths (`enhance.ts`)

**Files:**
- Create: `src/lib/enhance.ts`, `src/lib/enhance.test.ts`
- Modify: `src/lib/composite.ts:311-341` (move `ToneOptions` and `toneTables` out; re-export)

**Interfaces:**
- Consumes: `boxBlur`, `clamp`, `createBitmap`, `Bitmap` from `./pixels` (Task 1).
- Produces:
  - `interface ToneOptions { brightness?: number; contrast?: number; warmth?: number }`
  - `interface EnhanceSettings extends ToneOptions { saturation?: number; sharpness?: number }`
  - `const NEUTRAL_ENHANCE: Required<EnhanceSettings>`
  - `toneTables(options: ToneOptions): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] | null`
  - `sharpenRadius(width: number, height: number): number`
  - `applyEnhance(image: Bitmap, settings: EnhanceSettings, options?: { radius?: number }): Bitmap`
  - `autoEnhance(image: Bitmap, mask?: Bitmap): Required<ToneOptions>`
  - `composite.ts` re-exports `ToneOptions` and `toneTables` (existing importers: `attireDraw.ts`, `job.ts`, `SheetStep.tsx`).

- [ ] **Step 1: Write the failing tests** — `src/lib/enhance.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import { applyEnhance, autoEnhance, NEUTRAL_ENHANCE } from './enhance'
import { createBitmap, type Bitmap } from './pixels'

function solid(width: number, height: number, r: number, g: number, b: number): Bitmap & { data: Uint8ClampedArray } {
  const bmp = createBitmap(width, height)
  for (let i = 0; i < width * height; i++) bmp.data.set([r, g, b, 255], i * 4)
  return bmp
}

/** Left half `low`, right half `high`, grey. */
function stepEdge(width: number, height: number, low: number, high: number) {
  const bmp = createBitmap(width, height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = x < width / 2 ? low : high
      bmp.data.set([v, v, v, 255], (y * width + x) * 4)
    }
  return bmp
}

describe('applyEnhance', () => {
  it('leaves the photo untouched at neutral settings', () => {
    const img = stepEdge(20, 4, 60, 180)
    expect(Array.from(applyEnhance(img, NEUTRAL_ENHANCE).data)).toEqual(Array.from(img.data))
  })

  it('takes a colour to its own luminance at saturation -50', () => {
    const out = applyEnhance(solid(2, 2, 200, 100, 50), { saturation: -50 })
    const l = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50)
    expect(Math.abs(out.data[0] - l)).toBeLessThanOrEqual(1)
    expect(Math.abs(out.data[1] - l)).toBeLessThanOrEqual(1)
    expect(Math.abs(out.data[2] - l)).toBeLessThanOrEqual(1)
  })

  it('raises contrast across an edge when sharpening', () => {
    const img = stepEdge(20, 6, 60, 180)
    const out = applyEnhance(img, { sharpness: 50 }, { radius: 2 })
    const at = (x: number) => out.data[(3 * 20 + x) * 4]
    expect(at(9)).toBeLessThan(60) // dark side of the edge gets darker
    expect(at(10)).toBeGreaterThan(180) // bright side gets brighter
    expect(at(0)).toBe(60) // flat areas are left alone
  })

  it('keeps alpha', () => {
    const img = solid(2, 1, 100, 100, 100)
    img.data[3] = 40
    expect(applyEnhance(img, { brightness: 20, saturation: 10 }).data[3]).toBe(40)
  })
})

describe('autoEnhance', () => {
  it('brightens a dark photo', () => {
    expect(autoEnhance(solid(40, 40, 50, 50, 50)).brightness).toBeGreaterThan(0)
  })

  it('warms a blue cast', () => {
    expect(autoEnhance(solid(40, 40, 90, 120, 170)).warmth).toBeGreaterThan(0)
  })

  it('never goes past ±35', () => {
    for (const img of [solid(40, 40, 5, 5, 5), solid(40, 40, 250, 250, 250), solid(40, 40, 30, 60, 250)]) {
      const s = autoEnhance(img)
      for (const v of [s.brightness, s.contrast, s.warmth]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(35)
      }
    }
  })

  it('returns finite numbers for a completely flat photo', () => {
    const s = autoEnhance(solid(30, 30, 128, 128, 128))
    expect(Number.isFinite(s.brightness)).toBe(true)
    expect(Number.isFinite(s.contrast)).toBe(true)
    expect(Number.isFinite(s.warmth)).toBe(true)
    expect(s.contrast).toBe(0)
  })

  it('measures exposure on the subject when given a mask', () => {
    // Bright backdrop, dark subject in the left quarter (so the whole
    // photo's median is the backdrop's).
    const img = createBitmap(40, 40)
    const mask = createBitmap(40, 40)
    for (let i = 0; i < 1600; i++) {
      const subject = i % 40 < 10
      const v = subject ? 50 : 240
      img.data.set([v, v, v, 255], i * 4)
      const m = subject ? 255 : 0
      mask.data.set([m, m, m, 255], i * 4)
    }
    expect(autoEnhance(img, mask).brightness).toBeGreaterThan(autoEnhance(img).brightness)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/enhance.test.ts`
Expected: FAIL — `Failed to resolve import "./enhance"`.

- [ ] **Step 3: Write `src/lib/enhance.ts`**

```ts
/**
 * Light and colour correction, pure — Photo Print's Enhance panel and the ID
 * flow's Light & colour section.
 *
 * DSLR photos are already sharp and large; what goes wrong is exposure,
 * colour cast from studio lights and flat contrast. So this is correction,
 * not AI: lookup tables, a saturation blend and an unsharp mask.
 */

import { boxBlur, clamp, createBitmap, type Bitmap } from './pixels'

export interface ToneOptions {
  /** -50..+50. Lifts or lowers every channel. */
  brightness?: number
  /** -50..+50. Stretches channels away from mid-grey, or flattens them. */
  contrast?: number
  /** -50..+50. Positive shifts toward red/yellow, negative toward blue. */
  warmth?: number
}

export interface EnhanceSettings extends ToneOptions {
  /** -50..+50. -50 is greyscale, +50 doubles the distance from grey. */
  saturation?: number
  /** 0..+50. Unsharp mask strength. */
  sharpness?: number
}

export const NEUTRAL_ENHANCE: Required<EnhanceSettings> = {
  brightness: 0,
  contrast: 0,
  warmth: 0,
  saturation: 0,
  sharpness: 0,
}

/**
 * One lookup table per channel. Walk-in photos are often dark or yellow from
 * the shop's own lights; this corrects the subject without an outside editor.
 */
export function toneTables(options: ToneOptions): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] | null {
  const brightness = clamp(options.brightness ?? 0, -50, 50)
  const contrast = clamp(options.contrast ?? 0, -50, 50)
  const warmth = clamp(options.warmth ?? 0, -50, 50)
  if (brightness === 0 && contrast === 0 && warmth === 0) return null

  const gain = 1 + contrast / 100
  const lift = brightness * 1.5
  const shift = warmth * 0.6
  const table = (offset: number) => {
    const t = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) t[v] = (v - 128) * gain + 128 + lift + offset
    return t
  }
  return [table(shift), table(0), table(-shift)]
}

/**
 * Unsharp-mask radius for an image of this size, so a 24 MP original and its
 * 1400 px preview look equally sharpened.
 */
export function sharpenRadius(width: number, height: number): number {
  return Math.max(1, Math.round(Math.max(width, height) / 1400))
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** Tables, then saturation, then sharpening. Alpha is carried through. */
export function applyEnhance(image: Bitmap, settings: EnhanceSettings, options: { radius?: number } = {}): Bitmap {
  const tables = toneTables(settings)
  const saturation = clamp(settings.saturation ?? 0, -50, 50)
  const sharpness = clamp(settings.sharpness ?? 0, 0, 50)
  if (!tables && saturation === 0 && sharpness === 0) return image

  const { width, height } = image
  const n = width * height
  const src = image.data
  const out = createBitmap(width, height)
  const s = 1 + saturation / 50

  for (let i = 0; i < n; i++) {
    let r = src[i * 4]
    let g = src[i * 4 + 1]
    let b = src[i * 4 + 2]
    if (tables) {
      r = tables[0][r]
      g = tables[1][g]
      b = tables[2][b]
    }
    if (saturation !== 0) {
      const l = luma(r, g, b)
      r = l + (r - l) * s
      g = l + (g - l) * s
      b = l + (b - l) * s
    }
    out.data[i * 4] = r
    out.data[i * 4 + 1] = g
    out.data[i * 4 + 2] = b
    out.data[i * 4 + 3] = src[i * 4 + 3]
  }

  if (sharpness > 0) {
    // Sharpen luminance only, so edges gain contrast without colour fringes.
    const lum = new Float32Array(n)
    for (let i = 0; i < n; i++) lum[i] = luma(out.data[i * 4], out.data[i * 4 + 1], out.data[i * 4 + 2])
    const blurred = boxBlur(lum, width, height, options.radius ?? sharpenRadius(width, height))
    const amount = (sharpness / 50) * 1.5
    for (let i = 0; i < n; i++) {
      const d = (lum[i] - blurred[i]) * amount
      if (d === 0) continue
      out.data[i * 4] += d
      out.data[i * 4 + 1] += d
      out.data[i * 4 + 2] += d
    }
  }
  return out
}

/** Clamp an auto value to the slider's safe range, as a whole number. */
const auto = (v: number) => Math.round(clamp(v, -35, 35))

/**
 * Analyse the photo and propose brightness, contrast and warmth. It only
 * proposes: the caller puts these on the sliders, where the operator sees
 * and can undo them.
 *
 * Exposure and contrast are measured on the subject when a mask is given (a
 * white backdrop must not make the face look bright enough). Warmth is always
 * measured on the whole photo: skin is not grey, so a grey-world estimate over
 * a face alone would always cool it.
 */
export function autoEnhance(image: Bitmap, mask?: Bitmap): Required<ToneOptions> {
  const { width, height, data } = image
  // Work on at most ~512 px along the long edge.
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 512))
  const maskStride = mask ? mask.data.length / (mask.width * mask.height) : 0

  const histogram = new Uint32Array(256)
  let counted = 0
  let sumR = 0
  let sumB = 0
  let mid = 0

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      const l = Math.round(luma(r, g, b))
      if (l >= 40 && l <= 215) {
        sumR += r
        sumB += b
        mid++
      }
      if (mask && mask.data[i * maskStride] < 128) continue
      histogram[l]++
      counted++
    }
  }

  if (counted === 0) return { brightness: 0, contrast: 0, warmth: 0 }

  const percentile = (p: number) => {
    const target = p * counted
    let seen = 0
    for (let v = 0; v < 256; v++) {
      seen += histogram[v]
      if (seen >= target) return v
    }
    return 255
  }
  const low = percentile(0.005)
  const high = percentile(0.995)
  const median = percentile(0.5)

  const brightness = (128 - median) / 1.5
  const spread = high - low
  const contrast = spread >= 8 ? (235 / spread - 1) * 100 : 0
  // Warmth moves R up and B down by 0.6 each per step: 1.2 per step on R - B.
  const warmth = mid > 0 ? (sumB / mid - sumR / mid) / 1.2 : 0

  return { brightness: auto(brightness), contrast: auto(contrast), warmth: auto(warmth) }
}
```

- [ ] **Step 4: Move tone out of `composite.ts`**

In `composite.ts`, delete the `// --- light and colour ---` block (`ToneOptions` and `toneTables`) and add next to the Task 1 imports:

```ts
import { toneTables, type ToneOptions } from './enhance'

export { toneTables }
export type { ToneOptions }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/enhance.test.ts && npx tsc --noEmit && npx vitest run`
Expected: enhance tests PASS; no type errors; full suite passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/enhance.ts src/lib/enhance.test.ts src/lib/composite.ts
git commit -m "Add enhance maths: saturation, sharpening and auto enhance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Compositor backgrounds — transparent, image, and full enhance

**Files:**
- Modify: `src/lib/composite.ts` (`CompositeOptions`, `composite`)
- Test: `src/lib/composite.test.ts`

**Interfaces:**
- Consumes: `applyEnhance`, `sharpenRadius`, `toneTables`, `EnhanceSettings` (Task 2).
- Produces:
  - `type CompositeBackground = string | Bitmap` — a `#RRGGBB` colour, the literal `'transparent'`, or a background bitmap the same size as the image.
  - `interface CompositeOptions extends MaskOptions, EnhanceSettings { image; mask; background: CompositeBackground; skipDecontamination?; sharpenRadius?: number }`
  - `composite(options)` unchanged signature. Transparent output: alpha = shaped mask × 255, RGB = (enhanced) foreground. Image output: per-pixel blend onto the bitmap.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/composite.test.ts`

```ts
describe('composite backgrounds', () => {
  function uniform(width: number, height: number, rgb: [number, number, number]) {
    const bmp = createBitmap(width, height)
    for (let i = 0; i < width * height; i++) bmp.data.set([...rgb, 255], i * 4)
    return bmp
  }

  it('writes the mask into alpha when transparent', () => {
    const image = uniform(4, 1, [200, 50, 50])
    const mask = maskFrom([1, 1, 0, 0], 4, 1)
    const out = composite({ image, mask, background: 'transparent' })
    expect(out.data[3]).toBe(255)
    expect(out.data[11]).toBe(0)
    expect(out.data[0]).toBe(200) // opaque pixel keeps its colour
  })

  it('blends onto a background image, pixel by pixel', () => {
    const image = uniform(2, 1, [255, 0, 0])
    const mask = maskFrom([0, 0], 2, 1)
    const bg = createBitmap(2, 1)
    bg.data.set([0, 0, 255, 255, 0, 255, 0, 255])
    const out = composite({ image, mask, background: bg })
    expect(Array.from(out.data.slice(0, 3))).toEqual([0, 0, 255])
    expect(Array.from(out.data.slice(4, 7))).toEqual([0, 255, 0])
  })

  it('rejects a background image of the wrong size', () => {
    const image = uniform(2, 2, [1, 2, 3])
    expect(() =>
      composite({ image, mask: maskFrom([1, 1, 1, 1], 2, 2), background: createBitmap(3, 3) }),
    ).toThrow(/background/)
  })

  it('applies saturation to the subject but not to a colour background', () => {
    const image = uniform(2, 1, [200, 100, 50])
    const mask = maskFrom([1, 0], 2, 1)
    const out = composite({ image, mask, background: '#3366CC', saturation: -50 })
    expect(Math.abs(out.data[0] - out.data[1])).toBeLessThanOrEqual(1) // subject went grey
    expect(Array.from(out.data.slice(4, 7))).toEqual([0x33, 0x66, 0xcc]) // backdrop untouched
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/composite.test.ts`
Expected: FAIL — `'transparent'` throws `not a 6-digit hex colour`; the bitmap background is a type error / throws.

- [ ] **Step 3: Implement**

Replace `CompositeOptions` and `composite` in `src/lib/composite.ts` with:

```ts
/**
 * A `#RRGGBB` colour, the literal `'transparent'`, or a bitmap the same size
 * as the image (Photo Print's own background picture, already placed).
 */
export type CompositeBackground = string | Bitmap

export interface CompositeOptions extends MaskOptions, EnhanceSettings {
  /** Cropped source pixels, RGBA. */
  image: Bitmap
  /** Alpha mask, the same size as `image`. */
  mask: Bitmap
  background: CompositeBackground
  /**
   * Skip foreground estimation. Only for measuring what the estimation is
   * worth — the halo it removes is the reason this module exists.
   */
  skipDecontamination?: boolean
  /** Unsharp radius; defaults to `sharpenRadius` of this image. Strips pass the whole photo's. */
  sharpenRadius?: number
}

/**
 * The subject on the chosen background, with the old background's colour
 * removed from the fringe. Enhance applies to the subject before it meets the
 * background, so a white backdrop stays exactly white however far the
 * sliders go. Transparent output keeps the shaped mask as alpha.
 */
export function composite(options: CompositeOptions): Bitmap & { data: Uint8ClampedArray } {
  const { image, mask, background } = options
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error(
      `mask is ${mask.width}x${mask.height} but the image is ${image.width}x${image.height}`,
    )
  }
  const { width, height } = image
  const transparent = background === 'transparent'
  const bgImage = typeof background === 'string' ? null : background
  if (bgImage && (bgImage.width !== width || bgImage.height !== height)) {
    throw new Error(`background is ${bgImage.width}x${bgImage.height} but the image is ${width}x${height}`)
  }
  const bg = typeof background === 'string' && !transparent ? parseHex(background) : { r: 0, g: 0, b: 0 }

  const alpha = shapeMask(maskToAlpha(mask), width, height, options)
  const n = width * height

  // The foreground colour of every pixel, as float planes.
  let fr: ArrayLike<number>
  let fg: ArrayLike<number>
  let fb: ArrayLike<number>
  if (options.skipDecontamination) {
    const r = new Float32Array(n)
    const g = new Float32Array(n)
    const b = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      r[i] = image.data[i * 4]
      g[i] = image.data[i * 4 + 1]
      b[i] = image.data[i * 4 + 2]
    }
    fr = r
    fg = g
    fb = b
  } else {
    const f = estimateForeground(image, alpha)
    fr = f.r
    fg = f.g
    fb = f.b
  }

  // Saturation and sharpening need whole-image passes; tone alone stays a
  // per-pixel table so the ID flow's output is unchanged.
  let tables = toneTables(options)
  if ((options.saturation ?? 0) !== 0 || (options.sharpness ?? 0) > 0) {
    const fgBitmap = createBitmap(width, height)
    for (let i = 0; i < n; i++) {
      fgBitmap.data[i * 4] = fr[i]
      fgBitmap.data[i * 4 + 1] = fg[i]
      fgBitmap.data[i * 4 + 2] = fb[i]
      fgBitmap.data[i * 4 + 3] = 255
    }
    const enhanced = applyEnhance(fgBitmap, options, {
      radius: options.sharpenRadius ?? sharpenRadius(width, height),
    })
    const r = new Float32Array(n)
    const g = new Float32Array(n)
    const b = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      r[i] = enhanced.data[i * 4]
      g[i] = enhanced.data[i * 4 + 1]
      b[i] = enhanced.data[i * 4 + 2]
    }
    fr = r
    fg = g
    fb = b
    tables = null
  }
  const [tr, tg, tb] = tables ?? [null, null, null]

  const out = createBitmap(width, height)
  for (let i = 0; i < n; i++) {
    const a = alpha[i]
    const r = tr ? tr[Math.round(fr[i])] : fr[i]
    const g = tg ? tg[Math.round(fg[i])] : fg[i]
    const b = tb ? tb[Math.round(fb[i])] : fb[i]
    if (transparent) {
      out.data[i * 4] = r
      out.data[i * 4 + 1] = g
      out.data[i * 4 + 2] = b
      out.data[i * 4 + 3] = Math.round(a * 255)
      continue
    }
    const br = bgImage ? bgImage.data[i * 4] : bg.r
    const bgg = bgImage ? bgImage.data[i * 4 + 1] : bg.g
    const bb = bgImage ? bgImage.data[i * 4 + 2] : bg.b
    out.data[i * 4] = r * a + br * (1 - a)
    out.data[i * 4 + 1] = g * a + bgg * (1 - a)
    out.data[i * 4 + 2] = b * a + bb * (1 - a)
    out.data[i * 4 + 3] = 255
  }
  return out
}
```

Update the enhance import from Task 2 to: `import { applyEnhance, sharpenRadius, toneTables, type EnhanceSettings, type ToneOptions } from './enhance'`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, including every existing colour-mode test (the ID flow's output is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/composite.ts src/lib/composite.test.ts
git commit -m "Composite onto transparency or a picture, with full enhance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Papers, placement geometry and the save name

**Files:**
- Create: `src/lib/fitToPaper.ts`, `src/lib/fitToPaper.test.ts`
- Modify: `src/lib/presets.ts:102-149`, `src/lib/dpi.ts` (add `editedFileName`), `src/lib/dpi.test.ts`, `src/lib/layout.test.ts:30`

**Interfaces:**
- Produces:
  - `PaperId = '3r' | '4r' | '5r' | '8r' | 'a4' | 'short' | 'long'`; `SheetPaperId = '4r' | 'a4' | 'short' | 'long'`; `PAPER_ORDER: SheetPaperId[]` (unchanged contents); `EditPaperId = '3r' | '4r' | '5r' | '8r' | 'a4'`; `EDIT_PAPER_ORDER: EditPaperId[]`.
  - `type PaperFit = 'fit' | 'fill'`; `type PaperOrientation = 'auto' | 'portrait' | 'landscape'`
  - `interface PaperPlacement { paper: { width: number; height: number }; rect: { x: number; y: number; width: number; height: number }; landscape: boolean }` (pixels at `dpi`)
  - `placeOnPaper(photo: { width: number; height: number }, paperMm: { widthMm: number; heightMm: number }, fit: PaperFit, orientation: PaperOrientation, dpi?: number): PaperPlacement`
  - `interface BackgroundView { zoom: number; offsetX: number; offsetY: number }` — zoom 1..3, offsets −1..1
  - `coverSourceRect(src: { width: number; height: number }, dst: { width: number; height: number }, view: BackgroundView): { x: number; y: number; width: number; height: number }`
  - `editedFileName(sourceName: string | null, ext: string): string`

- [ ] **Step 1: Write the failing tests** — `src/lib/fitToPaper.test.ts`

```ts
import { describe, expect, it } from 'vitest'

import { coverSourceRect, placeOnPaper } from './fitToPaper'
import { PAPERS } from './presets'

describe('placeOnPaper', () => {
  it('makes 4R 1200 x 1800 at 300 DPI', () => {
    const p = placeOnPaper({ width: 2000, height: 3000 }, PAPERS['4r'], 'fit', 'portrait')
    expect(p.paper).toEqual({ width: 1200, height: 1800 })
  })

  it('fit keeps the whole photo and centres it', () => {
    const p = placeOnPaper({ width: 3000, height: 4000 }, PAPERS['4r'], 'fit', 'portrait')
    expect(p.rect.width).toBe(1200)
    expect(p.rect.height).toBe(1600)
    expect(p.rect.x).toBe(0)
    expect(p.rect.y).toBe(100)
  })

  it('fill covers the paper and crops from the centre', () => {
    const p = placeOnPaper({ width: 3000, height: 4000 }, PAPERS['4r'], 'fill', 'portrait')
    expect(p.rect.height).toBe(1800)
    expect(p.rect.width).toBe(1350)
    expect(p.rect.x).toBe(-75)
    expect(p.rect.y).toBe(0)
  })

  it('auto turns the paper for a landscape photo', () => {
    const p = placeOnPaper({ width: 4000, height: 3000 }, PAPERS['4r'], 'fit', 'auto')
    expect(p.landscape).toBe(true)
    expect(p.paper).toEqual({ width: 1800, height: 1200 })
  })

  it('fill still covers every edge for a panorama', () => {
    const p = placeOnPaper({ width: 9000, height: 2000 }, PAPERS['4r'], 'fill', 'auto')
    expect(p.rect.x).toBeLessThanOrEqual(0)
    expect(p.rect.y).toBeLessThanOrEqual(0)
    expect(p.rect.x + p.rect.width).toBeGreaterThanOrEqual(p.paper.width)
    expect(p.rect.y + p.rect.height).toBeGreaterThanOrEqual(p.paper.height)
  })

  it('honours a forced orientation', () => {
    const p = placeOnPaper({ width: 4000, height: 3000 }, PAPERS['3r'], 'fit', 'portrait')
    expect(p.paper.width).toBeLessThan(p.paper.height)
  })
})

describe('coverSourceRect', () => {
  it('crops the centre at zoom 1', () => {
    const r = coverSourceRect({ width: 4000, height: 2000 }, { width: 100, height: 100 }, { zoom: 1, offsetX: 0, offsetY: 0 })
    expect(r).toEqual({ x: 1000, y: 0, width: 2000, height: 2000 })
  })

  it('zooms in around the centre and moves within bounds', () => {
    const r = coverSourceRect({ width: 2000, height: 2000 }, { width: 100, height: 100 }, { zoom: 2, offsetX: 1, offsetY: -1 })
    expect(r).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 })
  })
})
```

Append to `src/lib/dpi.test.ts` (add `editedFileName` to its import from `./dpi`):

```ts
describe('editedFileName', () => {
  it('adds -edited to the original name', () => {
    expect(editedFileName('IMG_0042', 'jpg')).toBe('IMG_0042-edited.jpg')
  })
  it('falls back to photo for a pasted image', () => {
    expect(editedFileName(null, 'png')).toBe('photo-edited.png')
  })
  it('drops characters Windows will not take', () => {
    expect(editedFileName('a:b*c?', 'png')).toBe('a_b_c_-edited.png')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/fitToPaper.test.ts src/lib/dpi.test.ts`
Expected: FAIL — `./fitToPaper` missing, `PAPERS['3r']` undefined, `editedFileName` not exported.

- [ ] **Step 3: Add the papers** — `src/lib/presets.ts`

Replace `export type PaperId = '4r' | 'a4' | 'short' | 'long'` with:

```ts
export type PaperId = '3r' | '4r' | '5r' | '8r' | 'a4' | 'short' | 'long'
/** Papers the ID print sheet offers. */
export type SheetPaperId = '4r' | 'a4' | 'short' | 'long'
/** Papers Photo Print offers. */
export type EditPaperId = '3r' | '4r' | '5r' | '8r' | 'a4'
```

Add to `PAPERS` (before `'4r'`, then after it):

```ts
  '3r': {
    id: '3r',
    label: '3R',
    sublabel: '88.9 x 127 mm - 3.5 x 5 in',
    widthMm: 88.9,
    heightMm: 127,
    defaultMarginMm: 3,
  },
```

```ts
  '5r': {
    id: '5r',
    label: '5R',
    sublabel: '127 x 177.8 mm - 5 x 7 in',
    widthMm: 127,
    heightMm: 177.8,
    defaultMarginMm: 3,
  },
  '8r': {
    id: '8r',
    label: '8R',
    sublabel: '203.2 x 254 mm - 8 x 10 in',
    widthMm: 203.2,
    heightMm: 254,
    defaultMarginMm: 3,
  },
```

Change `PAPER_ORDER` and add the edit list:

```ts
export const PAPER_ORDER: SheetPaperId[] = ['4r', 'a4', 'short', 'long']

export const EDIT_PAPER_ORDER: EditPaperId[] = ['3r', '4r', '5r', '8r', 'a4']
```

In `src/lib/layout.test.ts` change `Record<PaperId, …>` on line 30 to `Record<SheetPaperId, …>`, the two `as PaperId[]` casts to `as SheetPaperId[]`, and import `SheetPaperId` from `./presets` alongside `PaperId`.

- [ ] **Step 4: Write `src/lib/fitToPaper.ts`**

```ts
/**
 * Where a whole photo goes on a sheet of photo paper, and which part of a
 * background picture covers a box. Geometry only, in pixels.
 */

import { mmToPx } from './dpi'
import { PRINT_DPI } from './presets'

export type PaperFit = 'fit' | 'fill'
export type PaperOrientation = 'auto' | 'portrait' | 'landscape'

export interface PaperPlacement {
  /** The paper at `dpi`, already turned for the orientation. */
  paper: { width: number; height: number }
  /** The photo on it; in Fill mode it runs past the edges and is cropped. */
  rect: { x: number; y: number; width: number; height: number }
  landscape: boolean
}

/**
 * Fit shows the whole photo with a white border on the short side; Fill
 * covers the paper edge to edge and crops the overflow from the centre.
 * Auto orientation turns the paper to match the photo.
 */
export function placeOnPaper(
  photo: { width: number; height: number },
  paperMm: { widthMm: number; heightMm: number },
  fit: PaperFit,
  orientation: PaperOrientation,
  dpi: number = PRINT_DPI,
): PaperPlacement {
  const landscape = orientation === 'auto' ? photo.width > photo.height : orientation === 'landscape'
  const short = mmToPx(Math.min(paperMm.widthMm, paperMm.heightMm), dpi)
  const long = mmToPx(Math.max(paperMm.widthMm, paperMm.heightMm), dpi)
  const paper = landscape ? { width: long, height: short } : { width: short, height: long }

  const sx = paper.width / photo.width
  const sy = paper.height / photo.height
  const scale = fit === 'fit' ? Math.min(sx, sy) : Math.max(sx, sy)
  const width = Math.round(photo.width * scale)
  const height = Math.round(photo.height * scale)
  return {
    paper,
    rect: {
      x: Math.round((paper.width - width) / 2),
      y: Math.round((paper.height - height) / 2),
      width,
      height,
    },
    landscape,
  }
}

/** How a background picture sits behind the subject. */
export interface BackgroundView {
  /** 1..3: 1 is the smallest crop that still covers. */
  zoom: number
  /** -1..1: -1 shows the left (top) edge of the picture, 1 the right (bottom). */
  offsetX: number
  offsetY: number
}

export const DEFAULT_VIEW: BackgroundView = { zoom: 1, offsetX: 0, offsetY: 0 }

/** The part of `src` that covers a `dst`-shaped box, zoomed and moved. */
export function coverSourceRect(
  src: { width: number; height: number },
  dst: { width: number; height: number },
  view: BackgroundView,
): { x: number; y: number; width: number; height: number } {
  const dstAspect = dst.width / dst.height
  let width = src.width
  let height = src.height
  if (src.width / src.height > dstAspect) width = src.height * dstAspect
  else height = src.width / dstAspect
  const zoom = Math.min(3, Math.max(1, view.zoom))
  width /= zoom
  height /= zoom
  const ox = Math.min(1, Math.max(-1, view.offsetX))
  const oy = Math.min(1, Math.max(-1, view.offsetY))
  const cx = src.width / 2 + (ox * (src.width - width)) / 2
  const cy = src.height / 2 + (oy * (src.height - height)) / 2
  return { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width: Math.round(width), height: Math.round(height) }
}
```

- [ ] **Step 5: Add `editedFileName`** — append to `src/lib/dpi.ts`

```ts
/** `IMG_0042-edited.jpg` — Photo Print keeps the customer's own file name. */
export function editedFileName(sourceName: string | null, ext: string): string {
  const base = (sourceName ?? '').replace(/[<>:"/\\|?*]/g, '_').trim() || 'photo'
  return `${base}-edited.${ext}`
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors (if `SheetStep.tsx` reports `PaperId` vs `SheetPaperId` mismatches, type its local `order` as `SheetPaperId[]`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/fitToPaper.ts src/lib/fitToPaper.test.ts src/lib/presets.ts src/lib/dpi.ts src/lib/dpi.test.ts src/lib/layout.test.ts src/features/sheet/SheetStep.tsx
git commit -m "Add 3R, 5R and 8R papers and whole-photo placement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Mode and Photo Print stores

**Files:**
- Create: `src/store/mode.ts`, `src/store/edit.ts`, `src/store/edit.test.ts`

**Interfaces:**
- Consumes: `NEUTRAL_ENHANCE`, `EnhanceSettings` (Task 2); `BackgroundView`, `DEFAULT_VIEW`, `PaperFit`, `PaperOrientation` (Task 4); `EditPaperId` (Task 4); `releaseImage`, `asAppError`, `AppErrorShape`, `LoadedImageInfo`, `SegModel`, `SegmentProgress` from `../lib/tauri`; `Bitmap` from `../lib/composite`.
- Produces:
  - `useMode`: `{ mode: AppMode; setMode(mode: AppMode): void }`, `type AppMode = 'id' | 'edit'`, persisted under `localStorage['philmer.mode']`.
  - `useEdit` with state and actions exactly as in the code below. Later tasks use: `step, status, error, progress, info, sourceName, preview, previewMask, maskStatus, maskError, backgroundMode, backgroundColor, backgroundImage, backgroundImageId, backgroundView, edgeSoftness, hairDetail, quality, enhance, paper, paperFit, orientation` and `setStep, startLoading, setLoaded, setError, setProgress, setBackgroundMode, setBackgroundColor, setBackgroundImage, clearBackgroundImage, setBackgroundView, setEdgeSoftness, setHairDetail, setEnhance, resetEnhance, setPaper, setPaperFit, setOrientation, maskStarted, maskReady, maskFailed, reset`.
  - `type BackgroundMode = 'original' | 'transparent' | 'color' | 'image'`; `needsMask(mode: BackgroundMode): boolean`; `type EditStep = 'import' | 'edit' | 'print'`; `EDIT_STEPS: EditStep[]`; `EDIT_STEP_LABELS: Record<EditStep, string>`.

- [ ] **Step 1: Write the failing tests** — `src/store/edit.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/tauri', async (original) => ({
  ...(await original<typeof import('../lib/tauri')>()),
  releaseImage: vi.fn(() => Promise.resolve()),
}))

import { releaseImage } from '../lib/tauri'
import { createBitmap } from '../lib/pixels'
import { useEdit } from './edit'

const info = { id: 'p1', width: 300, height: 400, megapixels: 0.12, exifOrientation: 1 }
const preview = createBitmap(30, 40)

describe('the Photo Print store', () => {
  beforeEach(() => {
    useEdit.getState().reset()
    vi.mocked(releaseImage).mockClear()
  })

  it('starts on Original, Fit, 4R', () => {
    const s = useEdit.getState()
    expect(s.backgroundMode).toBe('original')
    expect(s.paperFit).toBe('fit')
    expect(s.paper).toBe('4r')
    expect(s.step).toBe('import')
  })

  it('goes to the Edit step once the photo is loaded', () => {
    useEdit.getState().setLoaded(info, 'IMG_1', preview)
    const s = useEdit.getState()
    expect(s.step).toBe('edit')
    expect(s.status).toBe('ready')
    expect(s.sourceName).toBe('IMG_1')
  })

  it('ignores a mask that arrives for the previous photo', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().maskStarted()
    useEdit.getState().setLoaded({ ...info, id: 'p2' }, null, preview)
    useEdit.getState().maskReady('p1', createBitmap(30, 40))
    expect(useEdit.getState().previewMask).toBeNull()
    expect(useEdit.getState().maskStatus).toBe('none')
  })

  it('falls back to Original when background removal fails', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().setBackgroundMode('transparent')
    useEdit.getState().maskStarted()
    useEdit.getState().maskFailed('model missing')
    const s = useEdit.getState()
    expect(s.backgroundMode).toBe('original')
    expect(s.maskStatus).toBe('error')
    expect(s.maskError).toBe('model missing')
    expect(s.status).toBe('ready') // enhance still works
  })

  it('only takes segmentation progress for its own photo', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().setProgress({ id: 'other', stage: 'running', label: '', fraction: 0.5 })
    expect(useEdit.getState().progress).toBeNull()
    useEdit.getState().setProgress({ id: 'p1', stage: 'running', label: '', fraction: 0.5 })
    expect(useEdit.getState().progress?.fraction).toBe(0.5)
  })

  it('keeps colour and paper for the next customer but drops the photo and enhance', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().setBackgroundMode('color')
    useEdit.getState().setBackgroundColor('#1E5BC6')
    useEdit.getState().setPaper('5r')
    useEdit.getState().setEnhance({ brightness: 20 })
    useEdit.getState().reset()
    const s = useEdit.getState()
    expect(s.backgroundMode).toBe('color')
    expect(s.backgroundColor).toBe('#1E5BC6')
    expect(s.paper).toBe('5r')
    expect(s.enhance.brightness).toBe(0)
    expect(s.info).toBeNull()
    expect(releaseImage).toHaveBeenCalledWith('p1')
  })

  it('turns an image background back to Original on reset, and releases the picture', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().setBackgroundImage(createBitmap(10, 10), 'bg1')
    useEdit.getState().reset()
    expect(useEdit.getState().backgroundMode).toBe('original')
    expect(useEdit.getState().backgroundImage).toBeNull()
    expect(releaseImage).toHaveBeenCalledWith('bg1')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/store/edit.test.ts`
Expected: FAIL — `Failed to resolve import "./edit"`.

- [ ] **Step 3: Write `src/store/mode.ts`**

```ts
/**
 * Which flow the app is in: the ID wizard or Photo Print. Remembered per
 * machine so a shop that mostly prints photos starts on that card.
 */

import { create } from 'zustand'

export type AppMode = 'id' | 'edit'

const MODE_KEY = 'philmer.mode'

function readMode(): AppMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'edit' ? 'edit' : 'id'
  } catch {
    // Private mode, blocked storage, or tests with no window.
    return 'id'
  }
}

interface ModeState {
  mode: AppMode
  setMode: (mode: AppMode) => void
}

export const useMode = create<ModeState>((set) => ({
  mode: readMode(),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* the choice simply is not remembered */
    }
    set({ mode })
  },
}))
```

- [ ] **Step 4: Write `src/store/edit.ts`**

```ts
/**
 * The Photo Print job: one whole photo, optionally enhanced or re-backed,
 * saved at full size or printed one per sheet. Separate from `useJob` so the
 * ID wizard is not disturbed.
 */

import { create } from 'zustand'

import type { Bitmap } from '../lib/composite'
import { NEUTRAL_ENHANCE, type EnhanceSettings } from '../lib/enhance'
import { DEFAULT_VIEW, type BackgroundView, type PaperFit, type PaperOrientation } from '../lib/fitToPaper'
import type { EditPaperId } from '../lib/presets'
import {
  asAppError,
  releaseImage,
  type AppErrorShape,
  type LoadedImageInfo,
  type SegModel,
  type SegmentProgress,
} from '../lib/tauri'

export type EditStep = 'import' | 'edit' | 'print'
export const EDIT_STEPS: EditStep[] = ['import', 'edit', 'print']
export const EDIT_STEP_LABELS: Record<EditStep, string> = {
  import: 'Import',
  edit: 'Edit',
  print: 'Print & Export',
}

export type BackgroundMode = 'original' | 'transparent' | 'color' | 'image'

/** Whether this background needs the subject cut out. */
export function needsMask(mode: BackgroundMode): boolean {
  return mode !== 'original'
}

export interface EditState {
  step: EditStep
  status: 'empty' | 'loading' | 'ready' | 'error'
  /** Why the photo could not be opened; shown on the Import screen. */
  error: AppErrorShape | null
  progress: SegmentProgress | null

  info: LoadedImageInfo | null
  /** File name without extension, for the save name; null when pasted. */
  sourceName: string | null
  preview: Bitmap | null
  previewMask: Bitmap | null
  maskStatus: 'none' | 'running' | 'ready' | 'error'
  /** Why background removal failed; shown in the Edit panel. */
  maskError: string | null

  backgroundMode: BackgroundMode
  backgroundColor: string
  /** The operator's background picture at preview size. */
  backgroundImage: Bitmap | null
  /** Its id in the Rust image store, re-read at full size on export. */
  backgroundImageId: string | null
  backgroundView: BackgroundView
  edgeSoftness: number
  hairDetail: number
  quality: SegModel
  enhance: Required<EnhanceSettings>

  paper: EditPaperId
  paperFit: PaperFit
  orientation: PaperOrientation

  setStep: (step: EditStep) => void
  startLoading: () => void
  setLoaded: (info: LoadedImageInfo, sourceName: string | null, preview: Bitmap) => void
  setError: (error: unknown) => void
  setProgress: (progress: SegmentProgress | null) => void
  setBackgroundMode: (mode: BackgroundMode) => void
  setBackgroundColor: (hex: string) => void
  setBackgroundImage: (image: Bitmap, id: string) => void
  clearBackgroundImage: () => void
  setBackgroundView: (patch: Partial<BackgroundView>) => void
  setEdgeSoftness: (value: number) => void
  setHairDetail: (value: number) => void
  setEnhance: (patch: EnhanceSettings) => void
  resetEnhance: () => void
  setPaper: (paper: EditPaperId) => void
  setPaperFit: (fit: PaperFit) => void
  setOrientation: (orientation: PaperOrientation) => void
  maskStarted: () => void
  maskReady: (imageId: string, previewMask: Bitmap) => void
  maskFailed: (message: string) => void
  /** New customer: keep background mode, colour, quality and paper; drop the photo. */
  reset: () => void
}

const PHOTO_FIELDS = {
  status: 'empty' as const,
  error: null,
  progress: null,
  info: null,
  sourceName: null,
  preview: null,
  previewMask: null,
  maskStatus: 'none' as const,
  maskError: null,
}

export const useEdit = create<EditState>((set, get) => ({
  step: 'import',
  ...PHOTO_FIELDS,
  backgroundMode: 'original',
  backgroundColor: '#FFFFFF',
  backgroundImage: null,
  backgroundImageId: null,
  backgroundView: DEFAULT_VIEW,
  edgeSoftness: 0,
  hairDetail: 0,
  quality: 'lite',
  enhance: NEUTRAL_ENHANCE,
  paper: '4r',
  paperFit: 'fit',
  orientation: 'auto',

  setStep: (step) => set({ step }),
  startLoading: () => set({ ...PHOTO_FIELDS, status: 'loading' }),
  setLoaded: (info, sourceName, preview) =>
    set({ ...PHOTO_FIELDS, status: 'ready', info, sourceName, preview, step: 'edit' }),
  setError: (error) =>
    set(error === null ? { error: null } : { error: asAppError(error), status: 'error' }),
  setProgress: (progress) => {
    if (progress && progress.id !== get().info?.id) return
    set({ progress })
  },
  setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
  setBackgroundColor: (backgroundColor) => set({ backgroundColor }),
  setBackgroundImage: (backgroundImage, backgroundImageId) => {
    const previous = get().backgroundImageId
    if (previous && previous !== backgroundImageId) void releaseImage(previous)
    set({ backgroundImage, backgroundImageId, backgroundView: DEFAULT_VIEW, backgroundMode: 'image' })
  },
  clearBackgroundImage: () => {
    const id = get().backgroundImageId
    if (id) void releaseImage(id)
    set({
      backgroundImage: null,
      backgroundImageId: null,
      backgroundView: DEFAULT_VIEW,
      backgroundMode: get().backgroundMode === 'image' ? 'color' : get().backgroundMode,
    })
  },
  setBackgroundView: (patch) => set((s) => ({ backgroundView: { ...s.backgroundView, ...patch } })),
  setEdgeSoftness: (edgeSoftness) => set({ edgeSoftness }),
  setHairDetail: (hairDetail) => set({ hairDetail }),
  setEnhance: (patch) => set((s) => ({ enhance: { ...s.enhance, ...patch } })),
  resetEnhance: () => set({ enhance: NEUTRAL_ENHANCE }),
  setPaper: (paper) => set({ paper }),
  setPaperFit: (paperFit) => set({ paperFit }),
  setOrientation: (orientation) => set({ orientation }),
  maskStarted: () => set({ maskStatus: 'running', maskError: null, progress: null }),
  maskReady: (imageId, previewMask) => {
    // The operator may have moved on to the next customer meanwhile.
    if (get().info?.id !== imageId) return
    set({ previewMask, maskStatus: 'ready', progress: null })
  },
  maskFailed: (maskError) =>
    set({ maskStatus: 'error', maskError, backgroundMode: 'original', progress: null }),

  reset: () => {
    const { info, backgroundImageId, backgroundMode } = get()
    // Hand the native side its buffers back, as useJob.reset does.
    if (info) void releaseImage(info.id)
    if (backgroundImageId) void releaseImage(backgroundImageId)
    set({
      step: 'import',
      ...PHOTO_FIELDS,
      backgroundImage: null,
      backgroundImageId: null,
      backgroundView: DEFAULT_VIEW,
      backgroundMode: backgroundMode === 'image' ? 'original' : backgroundMode,
      enhance: NEUTRAL_ENHANCE,
    })
  },
}))
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/store/edit.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/mode.ts src/store/edit.ts src/store/edit.test.ts
git commit -m "Add the mode and Photo Print stores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Loading, lazy background removal and the background picture

**Files:**
- Modify: `src/features/import/usePhotoPipeline.ts` (extract `previewFor`; progress listener feeds both stores)
- Create: `src/features/edit/editPipeline.ts`, `src/features/edit/editPipeline.test.ts`
- Modify: `src/lib/bitmap.ts` (add `coverFit`)

**Interfaces:**
- Consumes: `useEdit`, `needsMask`, `BackgroundMode` (Task 5); `coverSourceRect`, `BackgroundView` (Task 4); `loadImage`, `getImageBytes`, `segment` (`src/lib/tauri.ts`); `decodeToBitmap`, `resampleBitmap` (`src/lib/bitmap.ts`).
- Produces:
  - `previewFor(info: LoadedImageInfo): Promise<ImageData>` and `PREVIEW_MAX_DIM` exported from `usePhotoPipeline.ts`.
  - `loadEditPhoto(source: { path?: string; bytes?: ArrayBuffer }): Promise<void>`
  - `ensureMask(): Promise<void>` — no-op unless a photo is loaded and the mask is `none` or `error`.
  - `chooseBackground(mode: BackgroundMode): void` — sets the mode and starts the mask when needed.
  - `setBackgroundImageFromPath(path: string): Promise<string | null>` — resolves to an error message or null.
  - `sourceNameOf(path?: string): string | null`
  - `coverFit(bg: Bitmap, width: number, height: number, view: BackgroundView): Promise<ImageData>` in `bitmap.ts`.

- [ ] **Step 1: Write the failing tests** — `src/features/edit/editPipeline.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/tauri', async (original) => ({
  ...(await original<typeof import('../../lib/tauri')>()),
  releaseImage: vi.fn(() => Promise.resolve()),
  segment: vi.fn(),
}))
vi.mock('../../lib/bitmap', async (original) => ({
  ...(await original<typeof import('../../lib/bitmap')>()),
  decodeToBitmap: vi.fn(async () => ({ width: 30, height: 40, data: new Uint8ClampedArray(30 * 40 * 4) })),
  resampleBitmap: vi.fn(async (_b: unknown, width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  })),
}))

import { segment } from '../../lib/tauri'
import { createBitmap } from '../../lib/pixels'
import { useEdit } from '../../store/edit'
import { chooseBackground, ensureMask, sourceNameOf } from './editPipeline'

const info = { id: 'p1', width: 300, height: 400, megapixels: 0.12, exifOrientation: 1 }

describe('Photo Print pipeline', () => {
  beforeEach(() => {
    useEdit.getState().reset()
    vi.mocked(segment).mockReset()
    useEdit.getState().setLoaded(info, null, createBitmap(30, 40))
  })

  it('does not remove the background for Original', () => {
    chooseBackground('original')
    expect(segment).not.toHaveBeenCalled()
  })

  it('removes the background once, when a cutout mode is chosen', async () => {
    vi.mocked(segment).mockResolvedValue(new ArrayBuffer(8))
    chooseBackground('transparent')
    await vi.waitFor(() => expect(useEdit.getState().maskStatus).toBe('ready'))
    chooseBackground('color')
    expect(segment).toHaveBeenCalledTimes(1)
    expect(useEdit.getState().previewMask?.width).toBe(30)
  })

  it('reports a failed removal and goes back to Original', async () => {
    vi.mocked(segment).mockRejectedValue({ kind: 'modelMissing', message: 'model missing' })
    chooseBackground('color')
    await vi.waitFor(() => expect(useEdit.getState().maskStatus).toBe('error'))
    expect(useEdit.getState().backgroundMode).toBe('original')
    expect(useEdit.getState().maskError).toBe('model missing')
  })

  it('names the photo after its file', () => {
    expect(sourceNameOf('C:\\Users\\shop\\IMG_0042.JPG')).toBe('IMG_0042')
    expect(sourceNameOf(undefined)).toBeNull()
  })

  it('does nothing without a photo', async () => {
    useEdit.getState().reset()
    await ensureMask()
    expect(segment).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/edit/editPipeline.test.ts`
Expected: FAIL — `Failed to resolve import "./editPipeline"`.

- [ ] **Step 3: Share the loader** — `src/features/import/usePhotoPipeline.ts`

Export the cap and add the helper; use it in `run`:

```ts
/** Canvas preview cap. The export always re-fetches at full resolution. */
export const PREVIEW_MAX_DIM = 1400

/** The canvas copy of a loaded photo, shared by both flows. */
export async function previewFor(info: LoadedImageInfo): Promise<ImageData> {
  const bytes = await getImageBytes({ id: info.id, maxDim: PREVIEW_MAX_DIM })
  return decodeToBitmap(bytes, 'image/jpeg')
}
```

In `run`, replace the two `previewBytes`/`preview` lines with `const preview = await previewFor(info)`. Import `type LoadedImageInfo` from `../../lib/tauri`.

Make the progress listener feed Photo Print too (it filters by photo id itself):

```ts
export function useSegmentProgressListener(): void {
  const setProgress = useJob((s) => s.setProgress)
  useEffect(() => {
    const unlisten = onSegmentProgress((progress) => {
      setProgress(progress)
      useEdit.getState().setProgress(progress)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setProgress])
}
```

(import `useEdit` from `../../store/edit`).

- [ ] **Step 4: Add `coverFit`** — append to `src/lib/bitmap.ts`

```ts
/**
 * A background picture cut to exactly `width` x `height`: the part chosen by
 * `view`, scaled to cover, so it can go straight behind the subject.
 */
export async function coverFit(
  bg: Bitmap,
  width: number,
  height: number,
  view: BackgroundView,
): Promise<ImageData> {
  const r = coverSourceRect(bg, { width, height }, view)
  const cut = cropRotate(bg, r, 0)
  return resampleBitmap(cut, width, height)
}
```

Add imports: `import { coverSourceRect, type BackgroundView } from './fitToPaper'`.

- [ ] **Step 5: Write `src/features/edit/editPipeline.ts`**

```ts
/**
 * Photo Print's side of loading: decode for the canvas straight away, and
 * remove the background only once the operator asks for a cutout. A print
 * that keeps its original background never waits for the model.
 */

import { decodeToBitmap, resampleBitmap } from '../../lib/bitmap'
import { asAppError, getImageBytes, loadImage, segment } from '../../lib/tauri'
import { needsMask, useEdit, type BackgroundMode } from '../../store/edit'
import { PREVIEW_MAX_DIM, previewFor } from '../import/usePhotoPipeline'

/** `C:\shop\IMG_0042.JPG` → `IMG_0042`. */
export function sourceNameOf(path?: string): string | null {
  if (!path) return null
  const file = path.split(/[\\/]/).pop() ?? ''
  return file.replace(/\.[^.]+$/, '') || null
}

export async function loadEditPhoto(source: { path?: string; bytes?: ArrayBuffer }): Promise<void> {
  useEdit.getState().startLoading()
  try {
    const info = await loadImage(source)
    const preview = await previewFor(info)
    useEdit.getState().setLoaded(info, sourceNameOf(source.path), preview)
    // The last customer's cutout mode carries over; start its mask now.
    if (needsMask(useEdit.getState().backgroundMode)) void ensureMask()
  } catch (error) {
    useEdit.getState().setError(error)
  }
}

/** Compute the preview mask once per photo. Rust caches the full mask. */
export async function ensureMask(): Promise<void> {
  const s = useEdit.getState()
  if (!s.info || !s.preview) return
  if (s.maskStatus === 'running' || s.maskStatus === 'ready') return
  const id = s.info.id
  s.maskStarted()
  try {
    const bytes = await segment({ id, model: s.quality })
    const full = await decodeToBitmap(bytes, 'image/png')
    const current = useEdit.getState()
    if (current.info?.id !== id || !current.preview) return
    const mask = await resampleBitmap(full, current.preview.width, current.preview.height)
    useEdit.getState().maskReady(id, mask)
  } catch (error) {
    if (useEdit.getState().info?.id === id) useEdit.getState().maskFailed(asAppError(error).message)
  }
}

export function chooseBackground(mode: BackgroundMode): void {
  useEdit.getState().setBackgroundMode(mode)
  if (needsMask(mode)) void ensureMask()
}

/**
 * Load the operator's background picture through Rust (EXIF orientation is
 * handled there), keep it by id for the full-size export, and decode a
 * preview-sized copy for the canvas. Resolves to an error message, or null.
 */
export async function setBackgroundImageFromPath(path: string): Promise<string | null> {
  try {
    const info = await loadImage({ path })
    const bytes = await getImageBytes({ id: info.id, maxDim: PREVIEW_MAX_DIM })
    const image = await decodeToBitmap(bytes, 'image/jpeg')
    useEdit.getState().setBackgroundImage(image, info.id)
    if (needsMask('image')) void ensureMask()
    return null
  } catch (error) {
    return `That picture could not be opened: ${asAppError(error).message}`
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/import/usePhotoPipeline.ts src/features/edit/editPipeline.ts src/features/edit/editPipeline.test.ts src/lib/bitmap.ts
git commit -m "Load photos for Photo Print and remove backgrounds on demand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Two drop cards, and an app shell for either flow

**Files:**
- Create: `src/app/Shell.tsx`, `src/features/edit/EditApp.tsx`
- Modify: `src/app/App.tsx`, `src/features/import/ImportStep.tsx`

**Interfaces:**
- Consumes: `useMode` (Task 5); `useEdit`, `EDIT_STEPS`, `EDIT_STEP_LABELS` (Task 5); `loadEditPhoto` (Task 6); `usePhotoPipeline().run` (existing).
- Produces:
  - `StepHeader({ runtime, steps, activeSteps, current, ready, onSelect })` where `steps: { key: string; label: string }[]`, `activeSteps: string[]`, `current: string`, `ready: boolean`, `onSelect: (key: string) => void`.
  - `ActionBar(...)` — the existing component, moved unchanged.
  - `EditApp()` — renders the Photo Print flow; Task 8 and Task 9 fill in its canvas/panel slots (`EditCanvas`, `EditPanel`, `PrintCanvas`, `PrintPanel`, `EditPrintButton`). Until then this task renders placeholders `null` for those slots — see Step 4.

- [ ] **Step 1: Move the header and action bar into `src/app/Shell.tsx`**

Move `Header` and `ActionBar` out of `App.tsx` into `Shell.tsx`. Rename `Header` → `StepHeader` and give it the step list as props instead of reading `useJob`:

```tsx
export function StepHeader({
  runtime,
  steps,
  activeSteps,
  current,
  ready,
  onSelect,
}: {
  runtime: RuntimeInfo | null
  steps: { key: string; label: string }[]
  activeSteps: string[]
  current: string
  ready: boolean
  onSelect: (key: string) => void
}) {
  const { open: openLicense } = useLicense()
  const { start: startTutorial } = useTutorial()
  const currentIndex = steps.findIndex((s) => s.key === current)
  // …the existing JSX, with these substitutions:
  //   ALL_STEPS.map((candidate, i)      → steps.map(({ key: candidate, label }, i)
  //   ACTIVE_STEPS.includes(candidate)  → activeSteps.includes(candidate)
  //   status === 'ready'                → ready
  //   setStep(candidate)                → onSelect(candidate)
  //   STEP_LABELS[candidate]            → label
}
```

`ActionBar` moves as is. Export both.

- [ ] **Step 2: Make `App.tsx` pick the flow**

Rename the current `App` body to `IdApp` (keeping everything it does). Inside it, replace `<Header runtime={runtime} />` with:

```tsx
<StepHeader
  runtime={runtime}
  steps={ALL_STEPS.map((key) => ({ key, label: STEP_LABELS[key] }))}
  activeSteps={ACTIVE_STEPS}
  current={step}
  ready={status === 'ready'}
  onSelect={(key) => setStep(key as Step)}
/>
```

(add `const status = useJob((s) => s.status)`; import `type Step` from `../store/job`). Pass `runtime` in as a prop from `App`.

New `App`:

```tsx
export function App() {
  const mode = useMode((s) => s.mode)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  useSegmentProgressListener()

  useEffect(() => {
    runtimeInfo()
      .then(setRuntime)
      .catch(() => setRuntime(null))
  }, [])

  // Ctrl+P must never reach the webview in either flow (BUILD_PLAN §8):
  // WebView2 would print the app's own interface. Each flow adds its own
  // meaning on top of this.
  useEffect(() => {
    const block = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') event.preventDefault()
    }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
  }, [])

  return mode === 'edit' ? <EditApp runtime={runtime} /> : <IdApp runtime={runtime} />
}
```

- [ ] **Step 3: Rewrite the drop zone as two cards** — `src/features/import/ImportStep.tsx`

Replace the single `<button …data-tour="dropzone">` with two cards and route every source to the right flow. Key parts:

```tsx
import { loadEditPhoto } from '../edit/editPipeline'
import { useEdit } from '../../store/edit'
import { useMode, type AppMode } from '../../store/mode'

/** Which card is under a native drag position (physical pixels), if any. */
function cardAt(position?: { x: number; y: number }): AppMode | null {
  if (!position) return null
  const ratio = window.devicePixelRatio || 1
  const el = document.elementFromPoint(position.x / ratio, position.y / ratio)
  const mode = el?.closest<HTMLElement>('[data-mode]')?.dataset.mode
  return mode === 'id' || mode === 'edit' ? mode : null
}
```

In `ImportStep`:

```tsx
const mode = useMode((s) => s.mode)
const setMode = useMode((s) => s.setMode)
const idStatus = useJob((s) => s.status)
const idError = useJob((s) => s.error)
const setIdError = useJob((s) => s.setError)
const editStatus = useEdit((s) => s.status)
const editError = useEdit((s) => s.error)
const setEditError = useEdit((s) => s.setError)
const { run } = usePhotoPipeline()

const busy = idStatus === 'loading' || idStatus === 'segmenting' || editStatus === 'loading'
const error = mode === 'edit' ? editError : idError
const setError = mode === 'edit' ? setEditError : setIdError
/** The card the pointer is over while a file is dragged. */
const [hover, setHover] = useState<AppMode | null>(null)

/** Choosing a card and loading the photo are one action. */
const openSource = useCallback(
  (target: AppMode, source: { path?: string; bytes?: ArrayBuffer }) => {
    setMode(target)
    if (target === 'edit') void loadEditPhoto(source)
    else void run(source)
  },
  [run, setMode],
)

const pick = useCallback(
  async (target: AppMode) => {
    const selected = await openDialog({ multiple: false, filters: [{ name: 'Photos', extensions: EXTENSIONS }] })
    if (typeof selected === 'string') openSource(target, { path: selected })
  },
  [openSource],
)
```

Change the dialog import to `import { open as openDialog } from '@tauri-apps/plugin-dialog'` and delete the old `pick` and `fromFile` callbacks.

Paste goes to the highlighted card: in the paste handler call `openSource(useMode.getState().mode, { bytes: await file.arrayBuffer() })`.

Native drag-drop: on `enter`/`over` set `setHover(cardAt(payload.position))`; on `leave` `setHover(null)`; on `drop` use `const target = cardAt(payload.position) ?? useMode.getState().mode`, keep the extension check (calling the *target's* `setError`), then `openSource(target, { path })`.

`if (idStatus === 'loading' || idStatus === 'segmenting') return <Processing />`; for `editStatus === 'loading'` render a centred `"Opening the photo…"` line on the same background (Photo Print has no long wait here).

The cards (both are `<button>`s in a two-column grid inside the existing `max-w-[1040px]` column):

```tsx
<div className="grid w-full grid-cols-2 gap-4">
  <DropCard
    mode="id"
    tour="dropzone"
    title="ID Photo"
    sizes="1x1 · 2x2 · Passport"
    detail="Background, attire, a sheet of copies"
    highlighted={(hover ?? mode) === 'id'}
    onClick={() => void pick('id')}
  />
  <DropCard
    mode="edit"
    tour="photo-print-card"
    title="Photo Print"
    sizes="3R · 4R · 5R · 8R · A4"
    detail="Keep the background, fit to paper, print"
    highlighted={(hover ?? mode) === 'edit'}
    onClick={() => void pick('edit')}
  />
</div>
<p className="text-muted" style={{ fontSize: 'clamp(13px, 1.2vw, 17px)' }}>
  Drop a photo onto a card, or click one to browse. Ctrl+V pastes into the highlighted card.
</p>
```

```tsx
function DropCard({
  mode,
  tour,
  title,
  sizes,
  detail,
  highlighted,
  onClick,
}: {
  mode: AppMode
  tour: string
  title: string
  sizes: string
  detail: string
  highlighted: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-mode={mode}
      data-tour={tour}
      onClick={onClick}
      aria-pressed={highlighted}
      className="flex w-full cursor-pointer flex-col items-start justify-end gap-3 border-2 border-dashed text-left transition-colors duration-[var(--duration-fast)]"
      style={{
        height: 'clamp(240px, 52vh, 460px)',
        padding: 'clamp(20px, 3vw, 40px)',
        borderColor: highlighted ? 'var(--color-accent)' : 'var(--color-divider)',
        background: highlighted
          ? 'color-mix(in srgb, var(--color-accent) 5%, var(--color-surface))'
          : 'var(--color-surface)',
      }}
    >
      <Icon path={ICONS.upload} size={36} strokeWidth={1.6} />
      <span className="font-heading font-extrabold leading-[1.1] tracking-[-0.015em]" style={{ fontSize: 'var(--display-size)' }}>
        {title}
      </span>
      <span className="tabular text-[15px] font-bold">{sizes}</span>
      <span className="text-muted" style={{ fontSize: 'clamp(13px, 1.2vw, 16px)' }}>{detail}</span>
      <span className="mt-2 flex gap-2">
        {FORMAT_TAGS.map((tag) => (
          <span key={tag} className="border border-divider px-2.5 py-1 text-[13px] font-semibold">{tag}</span>
        ))}
      </span>
    </button>
  )
}
```

`tour="dropzone"` keeps the existing walkthrough anchor (the tutorial test greps the source for `tour="dropzone"`).

- [ ] **Step 4: Write `src/features/edit/EditApp.tsx`** (canvas/panel slots filled in Tasks 8–9)

```tsx
/**
 * Photo Print's window: the same shell as the ID wizard — header, canvas,
 * panel, action bar — over its own three steps.
 */

import { useCallback, useEffect } from 'react'

import { ActionBar, StepHeader } from '../../app/Shell'
import type { RuntimeInfo } from '../../lib/tauri'
import { EDIT_STEP_LABELS, EDIT_STEPS, useEdit, type EditStep } from '../../store/edit'
import { ImportStep } from '../import/ImportStep'

export function EditApp({ runtime }: { runtime: RuntimeInfo | null }) {
  const step = useEdit((s) => s.step)
  const status = useEdit((s) => s.status)
  const setStep = useEdit((s) => s.setStep)
  const reset = useEdit((s) => s.reset)

  const index = EDIT_STEPS.indexOf(step)
  const nextStep = EDIT_STEPS[index + 1]
  const previousStep = index > 1 ? EDIT_STEPS[index - 1] : undefined

  const goNext = useCallback(() => nextStep && setStep(nextStep), [nextStep, setStep])
  const goBack = useCallback(() => previousStep && setStep(previousStep), [previousStep, setStep])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key.toLowerCase()
      if (event.key === 'ArrowRight') goNext()
      else if (event.key === 'ArrowLeft') goBack()
      else if (key === 'n') reset()
      else if (key === 'p' && status === 'ready') setStep('print')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goBack, reset, status, setStep])

  const showChrome = step !== 'import'

  return (
    <div data-app="" className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: 'var(--color-neutral-300)' }}>
      <StepHeader
        runtime={runtime}
        steps={EDIT_STEPS.map((key) => ({ key, label: EDIT_STEP_LABELS[key] }))}
        activeSteps={EDIT_STEPS}
        current={step}
        ready={status === 'ready'}
        onSelect={(key) => key !== 'import' && setStep(key as EditStep)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ background: 'var(--canvas)' }}>
          {step === 'import' && <ImportStep />}
          {/* Task 8: {step === 'edit' && <EditCanvas />} */}
          {/* Task 9: {step === 'print' && <PrintCanvas />} */}
        </div>
        {showChrome && (
          <aside
            className="flex w-[var(--panel-width)] flex-none flex-col overflow-y-auto border-l-2 border-divider"
            style={{ background: 'var(--panel)' }}
          >
            {/* Task 8: {step === 'edit' && <EditPanel />} */}
            {/* Task 9: {step === 'print' && <PrintPanel />} */}
          </aside>
        )}
      </div>
      {showChrome && (
        <ActionBar
          onBack={goBack}
          onNext={goNext}
          canGoBack={Boolean(previousStep)}
          nextLabel={nextStep ? `Next: ${EDIT_STEP_LABELS[nextStep]}` : 'New photo'}
          onNewPhoto={reset}
          isLast={!nextStep}
        />
      )}
    </div>
  )
}
```

The commented slots are replaced by real components in Tasks 8 and 9; they are not left in the finished code.

- [ ] **Step 5: Check it in the app**

Run: `npx tsc --noEmit && npx vitest run` (expect pass; the tutorial anchor test still finds `dropzone`), then `npm run tauri dev`.
Expected: Import shows two cards; the last-used card is outlined in accent. Dropping a photo on **ID Photo** runs the ID flow exactly as before. Dropping on **Photo Print** goes straight to the (still empty) Edit step with the header reading Import → Edit → Print & Export, and **no** "Removing the background" screen. New photo returns to Import with Photo Print still highlighted. Restart the app: the highlight is remembered.

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx src/app/Shell.tsx src/features/import/ImportStep.tsx src/features/edit/EditApp.tsx
git commit -m "Start each job from an ID Photo or Photo Print card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Edit step — compare view, background and enhance panels

**Files:**
- Create: `src/app/components/CompareView.tsx`, `src/features/edit/useEditResult.ts`, `src/features/edit/EditStep.tsx`
- Modify: `src/features/background/BackgroundStep.tsx` (use `CompareView`), `src/features/edit/EditApp.tsx` (fill the Edit slots)

**Interfaces:**
- Consumes: `useEdit` (Task 5); `chooseBackground`, `setBackgroundImageFromPath` (Task 6); `composite`, `CompositeBackground` (Task 3); `applyEnhance`, `autoEnhance` (Task 2); `coverFit` (Task 6); `BACKGROUND_SWATCHES` (`presets.ts`).
- Produces:
  - `CompareView({ before, after, boxStyle, checkerboard?, inspecting? })` — `before`/`after: Bitmap`, `boxStyle: React.CSSProperties`.
  - `useEditResult(): Bitmap | null` — the preview-size result (Task 9's print canvas uses it too).
  - `EditCanvas()`, `EditPanel()`.

- [ ] **Step 1: Extract `CompareView`**

Create `src/app/components/CompareView.tsx` containing the box from `BackgroundCanvas` (the `boxRef` div with the two canvases, the divider, the BEFORE/AFTER labels), the split state, the mouse-drag effect and the `\` key effect — moved, not copied. Props:

```tsx
export function CompareView({
  before,
  after,
  boxStyle,
  checkerboard = false,
  inspecting = false,
}: {
  before: Bitmap
  after: Bitmap
  /** Size and aspect of the box; the caller knows its own layout. */
  boxStyle: React.CSSProperties
  /** Show transparency in `after` against a checkerboard. */
  checkerboard?: boolean
  inspecting?: boolean
})
```

It draws `before` and `after` with `drawBitmap` in effects keyed on each. When `checkerboard` is set, the after canvas gets
`background: 'repeating-conic-gradient(#d9d9d9 0 25%, #ffffff 0 50%) 0 0 / 16px 16px'`.

In `BackgroundCanvas`, delete the moved code and render:

```tsx
<CompareView
  before={preview}
  after={result ?? preview}
  inspecting={inspecting}
  boxStyle={{ height: '78%', aspectRatio: `${preset.widthMm / preset.heightMm}` }}
/>
```

keeping the size chip and the Inspect edges button where they are.

Run: `npx tsc --noEmit`, then `npm run tauri dev` and check the ID Background step still drags, labels and holds `\` exactly as before.

- [ ] **Step 2: Write `src/features/edit/useEditResult.ts`**

```ts
/**
 * The finished photo at preview size: enhanced, and on its new background
 * once the mask is ready. While the mask is computing, a cutout mode shows the
 * enhanced original, so the operator is never looking at a blank canvas.
 */

import { useEffect, useMemo, useState } from 'react'

import { coverFit } from '../../lib/bitmap'
import { composite, type Bitmap, type CompositeBackground } from '../../lib/composite'
import { applyEnhance } from '../../lib/enhance'
import { useEdit } from '../../store/edit'

export function useEditResult(): Bitmap | null {
  const preview = useEdit((s) => s.preview)
  const previewMask = useEdit((s) => s.previewMask)
  const mode = useEdit((s) => s.backgroundMode)
  const color = useEdit((s) => s.backgroundColor)
  const bgImage = useEdit((s) => s.backgroundImage)
  const view = useEdit((s) => s.backgroundView)
  const edgeSoftness = useEdit((s) => s.edgeSoftness)
  const hairDetail = useEdit((s) => s.hairDetail)
  const enhance = useEdit((s) => s.enhance)

  // The background picture, cut to the photo's shape (needs a canvas, so async).
  const [placed, setPlaced] = useState<Bitmap | null>(null)
  useEffect(() => {
    if (mode !== 'image' || !bgImage || !preview) {
      setPlaced(null)
      return
    }
    let live = true
    void coverFit(bgImage, preview.width, preview.height, view).then((b) => live && setPlaced(b))
    return () => {
      live = false
    }
  }, [mode, bgImage, preview, view])

  return useMemo(() => {
    if (!preview) return null
    if (mode === 'original' || !previewMask) return applyEnhance(preview, enhance)
    const background: CompositeBackground =
      mode === 'transparent' ? 'transparent' : mode === 'image' && placed ? placed : color
    return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail, ...enhance })
  }, [preview, previewMask, mode, color, placed, edgeSoftness, hairDetail, enhance])
}
```

- [ ] **Step 3: Write `src/features/edit/EditStep.tsx`**

```tsx
/**
 * Photo Print — Edit: the whole photo, Before | After, with the background
 * choice and the enhance sliders beside it.
 */

import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { CompareView } from '../../app/components/CompareView'
import { Button, Icon, ICONS, Notice, ResetButton, Section, Segmented, Slider } from '../../app/components/ui'
import { autoEnhance } from '../../lib/enhance'
import { BACKGROUND_SWATCHES } from '../../lib/presets'
import { useEdit, type BackgroundMode } from '../../store/edit'
import { chooseBackground, setBackgroundImageFromPath } from './editPipeline'
import { useEditResult } from './useEditResult'

export function EditCanvas() {
  const preview = useEdit((s) => s.preview)
  const mode = useEdit((s) => s.backgroundMode)
  const maskStatus = useEdit((s) => s.maskStatus)
  const progress = useEdit((s) => s.progress)
  const result = useEditResult()
  if (!preview) return null
  const aspect = preview.width / preview.height

  return (
    <div className="relative flex h-full w-full items-center justify-center p-8" style={{ containerType: 'size' }}>
      <CompareView
        before={preview}
        after={result ?? preview}
        checkerboard={mode === 'transparent'}
        // As large as fits either way, at the photo's own shape.
        boxStyle={{ width: `min(92cqw, calc(86cqh * ${aspect}))`, aspectRatio: `${aspect}` }}
      />
      {maskStatus === 'running' && (
        <div className="absolute bottom-5 left-6 flex w-64 flex-col gap-1.5 p-3 text-sm shadow-sm" style={{ background: 'var(--color-bg)' }}>
          <span className="font-bold">Removing the background…</span>
          <div className="relative h-1.5" style={{ background: 'var(--color-surface)' }}>
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${(progress?.fraction ?? 0) * 100}%`, background: 'var(--color-accent)' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const MODES: { value: BackgroundMode; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'transparent', label: 'Transparent' },
  { value: 'color', label: 'Colour' },
  { value: 'image', label: 'Image' },
]

export function EditPanel() {
  return (
    <>
      <BackgroundSection />
      <EnhanceSection />
    </>
  )
}

function BackgroundSection() {
  const mode = useEdit((s) => s.backgroundMode)
  const color = useEdit((s) => s.backgroundColor)
  const setColor = useEdit((s) => s.setBackgroundColor)
  const bgImage = useEdit((s) => s.backgroundImage)
  const clearImage = useEdit((s) => s.clearBackgroundImage)
  const view = useEdit((s) => s.backgroundView)
  const setView = useEdit((s) => s.setBackgroundView)
  const edgeSoftness = useEdit((s) => s.edgeSoftness)
  const setEdgeSoftness = useEdit((s) => s.setEdgeSoftness)
  const hairDetail = useEdit((s) => s.hairDetail)
  const setHairDetail = useEdit((s) => s.setHairDetail)
  const maskError = useEdit((s) => s.maskError)
  const [imageError, setImageError] = useState<string | null>(null)

  const chooseImage = async () => {
    const path = await open({ multiple: false, filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] })
    if (typeof path !== 'string') return
    setImageError(await setBackgroundImageFromPath(path))
  }

  return (
    <>
      <Section title="Background">
        <Segmented
          options={MODES}
          value={mode}
          onChange={(m) => (m === 'image' && !bgImage ? void chooseImage() : chooseBackground(m))}
          columns={4}
        />
        {mode === 'original' && <p className="text-xs text-muted">The photo keeps its own background.</p>}
        {mode === 'transparent' && <p className="text-xs text-muted">Saved as PNG with no background. Prints on white.</p>}

        {mode === 'color' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {BACKGROUND_SWATCHES.map((swatch) => {
                const selected = color.toUpperCase() === swatch.hex.toUpperCase()
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    onClick={() => setColor(swatch.hex)}
                    aria-pressed={selected}
                    className={`flex items-center gap-2 border p-1.5 text-left text-[13px] ${selected ? 'border-accent' : 'border-divider hover:bg-[var(--hover)]'}`}
                  >
                    <span className="h-6 w-6 flex-none border border-divider" style={{ background: swatch.hex }} />
                    {swatch.label}
                  </button>
                )
              })}
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <span className="text-muted">Custom</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="h-8 w-10 cursor-pointer border border-divider bg-surface"
              />
              <span className="tabular text-muted">{color.toUpperCase()}</span>
            </label>
          </>
        )}

        {mode === 'image' && bgImage && (
          <>
            <div className="flex gap-2">
              <Button onClick={() => void chooseImage()}>Change</Button>
              <Button variant="ghost" onClick={clearImage}>Remove</Button>
            </div>
            <Slider label="Zoom" value={Math.round(view.zoom * 100)} min={100} max={300} step={5} defaultValue={100}
              format={(v) => `${v}%`} onChange={(v) => setView({ zoom: v / 100 })} />
            <Slider label="Horizontal" value={Math.round(view.offsetX * 100)} min={-100} max={100} step={1} defaultValue={0}
              format={(v) => `${v}`} onChange={(v) => setView({ offsetX: v / 100 })} />
            <Slider label="Vertical" value={Math.round(view.offsetY * 100)} min={-100} max={100} step={1} defaultValue={0}
              format={(v) => `${v}`} onChange={(v) => setView({ offsetY: v / 100 })} />
          </>
        )}
        {imageError && <Notice tone="warn">{imageError}</Notice>}
        {maskError && (
          <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />}>
            The background could not be removed: {maskError}
          </Notice>
        )}
      </Section>

      {mode !== 'original' && (
        <Section title="Edges">
          <Slider label="Edge softness" value={edgeSoftness} min={-2} max={2} step={1} defaultValue={0}
            format={(v) => (v > 0 ? `+${v} px` : `${v} px`)} onChange={setEdgeSoftness} />
          <Slider label="Hair detail" value={hairDetail} min={-1} max={1} step={0.1} defaultValue={0}
            format={(v) => v.toFixed(1)} onChange={setHairDetail} />
        </Section>
      )}
    </>
  )
}

function EnhanceSection() {
  const enhance = useEdit((s) => s.enhance)
  const setEnhance = useEdit((s) => s.setEnhance)
  const resetEnhance = useEdit((s) => s.resetEnhance)
  const preview = useEdit((s) => s.preview)
  const previewMask = useEdit((s) => s.previewMask)
  const mode = useEdit((s) => s.backgroundMode)
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`)

  const auto = () => {
    if (!preview) return
    // Measure the person when they are being cut out; the whole scene otherwise.
    setEnhance(autoEnhance(preview, mode !== 'original' && previewMask ? previewMask : undefined))
  }

  return (
    <Section title="Enhance" action={<ResetButton onClick={resetEnhance} />} last>
      <Button onClick={auto} block>Auto enhance</Button>
      <Slider label="Brightness" value={enhance.brightness} min={-50} max={50} step={1} defaultValue={0} format={signed}
        onChange={(brightness) => setEnhance({ brightness })} />
      <Slider label="Contrast" value={enhance.contrast} min={-50} max={50} step={1} defaultValue={0} format={signed}
        onChange={(contrast) => setEnhance({ contrast })} />
      <Slider label="Warmth" value={enhance.warmth} min={-50} max={50} step={1} defaultValue={0} format={signed}
        onChange={(warmth) => setEnhance({ warmth })} />
      <Slider label="Saturation" value={enhance.saturation} min={-50} max={50} step={1} defaultValue={0} format={signed}
        onChange={(saturation) => setEnhance({ saturation })} />
      <Slider label="Sharpness" value={enhance.sharpness} min={0} max={50} step={1} defaultValue={0} format={signed}
        onChange={(sharpness) => setEnhance({ sharpness })} />
      <p className="text-xs text-muted">Auto enhance only moves the sliders; you can change or reset them.</p>
    </Section>
  )
}
```

If `Button` has no `block` prop, check `src/app/components/ui.tsx:12-50` (it does: `block ? 'w-full' : ''`).

- [ ] **Step 4: Fill the Edit slots in `EditApp.tsx`**

Import `EditCanvas, EditPanel` from `./EditStep` and replace the two `Task 8` comments with `{step === 'edit' && <EditCanvas />}` and `{step === 'edit' && <EditPanel />}`.

- [ ] **Step 5: Check it in the app**

Run: `npx tsc --noEmit && npx vitest run`, then `npm run tauri dev` with one of the shop's sample portraits (for example the three in `C:\Users\PC\Downloads\*.jfif`) dropped on **Photo Print**.
Expected:
- Original: Before | After divider drags; Brightness and Saturation change the After side only; Auto enhance moves the sliders.
- Transparent: "Removing the background…" bar shows once; the After side turns to a checkerboard behind the person. Switching to Colour is instant (no second wait).
- Colour: swatches and Custom recolour the backdrop; enhance never tints the backdrop.
- Image: picking a picture puts it behind the person; Zoom / Horizontal / Vertical move it; Remove returns to Colour.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/CompareView.tsx src/features/background/BackgroundStep.tsx src/features/edit/useEditResult.ts src/features/edit/EditStep.tsx src/features/edit/EditApp.tsx
git commit -m "Edit step: background choice and enhance for Photo Print

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Print & Export — save at full size, print on photo paper

**Files:**
- Create: `src/features/edit/useEditExport.ts`, `src/features/edit/PrintExportStep.tsx`
- Modify: `src/lib/bitmap.ts` (add `renderOnPaper`), `src/features/sheet/PrintDialog.tsx` (title and summary props), `src/features/sheet/SheetPrintButton.tsx`, `src/features/edit/EditApp.tsx`

**Interfaces:**
- Consumes: `useEdit` (Task 5); `useEditResult` (Task 8); `placeOnPaper`, `PaperPlacement` (Task 4); `editedFileName` (Task 4); `composite`, `applyEnhance`; `coverFit` (Task 6); `getImageBytes`, `segment`, `saveFile`, `printSheet`; `setJpegDpi`, `setPngDpi`; `ExportPhase` type from `../export/useExport`; `useLicense`.
- Produces:
  - `PrintDialog` props change: `photoCount`/`paperLabel` → `title: string` and `summary: string`.
  - `renderOnPaper(photo: Bitmap, placement: PaperPlacement): Promise<ImageData>` in `bitmap.ts`.
  - `useEditExport(): { state: ExportPhase; dismiss(): void; save(format: 'jpeg' | 'png'): Promise<void>; printDirect(request: PrintRequest): Promise<void>; placement: PaperPlacement | null }`
  - `PrintCanvas()`, `PrintPanel()`, `EditPrintButton()`.

- [ ] **Step 1: Let the print dialog describe any job** — `src/features/sheet/PrintDialog.tsx`

Replace the `paperLabel` and `photoCount` props with `title: string` and `summary: string`; render `<h4 …>{title}</h4>` and `<p className="text-sm text-muted">{summary}</p>`. In `SheetPrintButton.tsx` pass:

```tsx
title="Print sheet"
summary={`${sheet.count} ${sheet.count === 1 ? 'photo' : 'photos'} on ${PAPERS[paper].label}, at true size.`}
```

Run: `npx tsc --noEmit` — expect no errors (only these two files use the dialog).

- [ ] **Step 2: Add `renderOnPaper`** — append to `src/lib/bitmap.ts`

```ts
/**
 * The photo on white paper at print pixels. `photo` is already at
 * `placement.rect` size; in Fill mode it runs past the edges and the canvas
 * crops it. Transparency prints on white.
 */
export async function renderOnPaper(photo: Bitmap, placement: PaperPlacement): Promise<ImageData> {
  const { paper, rect } = placement
  const src = new OffscreenCanvas(photo.width, photo.height)
  src.getContext('2d')?.putImageData(new ImageData(photo.data, photo.width, photo.height), 0, 0)
  const out = new OffscreenCanvas(paper.width, paper.height)
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('could not get a 2D context')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, paper.width, paper.height)
  ctx.drawImage(src, rect.x, rect.y, rect.width, rect.height)
  return ctx.getImageData(0, 0, paper.width, paper.height)
}
```

(import `type PaperPlacement` from `./fitToPaper`).

- [ ] **Step 3: Write `src/features/edit/useEditExport.ts`**

```ts
/**
 * Photo Print's outputs. Save keeps the full original resolution; print works
 * from a copy fetched at the size it will print, so a 24 MP photo is never
 * composited just to fill a 4R.
 */

import { useCallback, useMemo, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'

import { coverFit, decodeToBitmap, encodeBitmap, renderOnPaper, resampleBitmap } from '../../lib/bitmap'
import { composite, type Bitmap, type CompositeBackground } from '../../lib/composite'
import { editedFileName, setJpegDpi, setPngDpi } from '../../lib/dpi'
import { applyEnhance } from '../../lib/enhance'
import { placeOnPaper } from '../../lib/fitToPaper'
import { PAPERS, PRINT_DPI } from '../../lib/presets'
import { getImageBytes, printSheet, saveFile, segment } from '../../lib/tauri'
import { needsMask, useEdit } from '../../store/edit'
import type { ExportPhase } from '../export/useExport'
import type { PrintRequest } from '../sheet/PrintDialog'

export function useEditExport() {
  const preview = useEdit((s) => s.preview)
  const paper = useEdit((s) => s.paper)
  const paperFit = useEdit((s) => s.paperFit)
  const orientation = useEdit((s) => s.orientation)
  const [state, setState] = useState<ExportPhase>({ phase: 'idle' })

  // Placement from the preview's shape; the preview is the oriented photo.
  const placement = useMemo(
    () => (preview ? placeOnPaper(preview, PAPERS[paper], paperFit, orientation) : null),
    [preview, paper, paperFit, orientation],
  )

  /** The finished photo, from a copy at most `maxDim` on its long edge (0 = original). */
  const build = useCallback(async (maxDim: number, report: (m: string) => void): Promise<Bitmap> => {
    const s = useEdit.getState()
    if (!s.info) throw new Error('no photo is loaded')
    report('Fetching the photo…')
    const image = await decodeToBitmap(
      await getImageBytes({ id: s.info.id, maxDim, format: 'png' }),
      'image/png',
    )
    if (!needsMask(s.backgroundMode)) {
      report('Enhancing…')
      return applyEnhance(image, s.enhance)
    }
    report('Fetching the cutout…')
    const fullMask = await decodeToBitmap(await segment({ id: s.info.id, model: s.quality }), 'image/png')
    const mask = await resampleBitmap(fullMask, image.width, image.height)
    let background: CompositeBackground = s.backgroundMode === 'transparent' ? 'transparent' : s.backgroundColor
    if (s.backgroundMode === 'image' && s.backgroundImageId) {
      report('Placing the background picture…')
      const bg = await decodeToBitmap(
        await getImageBytes({ id: s.backgroundImageId, maxDim: 0, format: 'png' }),
        'image/png',
      )
      background = await coverFit(bg, image.width, image.height, s.backgroundView)
    }
    report('Replacing the background…')
    return composite({
      image,
      mask,
      background,
      edgeSoftness: s.edgeSoftness,
      hairDetail: s.hairDetail,
      ...s.enhance,
    })
  }, [])

  const save_ = useCallback(
    async (format: 'jpeg' | 'png') => {
      const ext = format === 'jpeg' ? 'jpg' : 'png'
      try {
        const path = await save({
          defaultPath: editedFileName(useEdit.getState().sourceName, ext),
          filters: [{ name: format === 'jpeg' ? 'JPEG' : 'PNG', extensions: [ext] }],
        })
        if (!path) return
        const report = (message: string) => setState({ phase: 'working', message })
        const photo = await build(0, report)
        report('Encoding…')
        const encoded = await encodeBitmap(photo, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.95)
        const stamped = format === 'jpeg' ? setJpegDpi(encoded, PRINT_DPI) : setPngDpi(encoded, PRINT_DPI)
        await saveFile({ path, bytes: stamped.buffer as ArrayBuffer })
        setState({ phase: 'done', message: `Saved ${photo.width} × ${photo.height} px at 300 DPI`, path })
      } catch (error) {
        setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
    [build],
  )

  const printDirect = useCallback(
    async (request: PrintRequest) => {
      if (!placement) throw new Error('no photo is loaded')
      const { rect, paper: paperPx } = placement
      const photo = await build(Math.max(rect.width, rect.height), () => {})
      const sized = await resampleBitmap(photo, rect.width, rect.height)
      const sheet = await renderOnPaper(sized, placement)
      const png = await encodeBitmap(sheet, 'image/png')
      const p = PAPERS[useEdit.getState().paper]
      const short = Math.min(p.widthMm, p.heightMm)
      const long = Math.max(p.widthMm, p.heightMm)
      await printSheet({
        printer: request.printer,
        png: png.buffer as ArrayBuffer,
        widthMm: paperPx.width > paperPx.height ? long : short,
        heightMm: paperPx.width > paperPx.height ? short : long,
        copies: request.copies,
        jobName: `Photo print ${p.label}`,
      })
    },
    [build, placement],
  )

  return { state, dismiss: () => setState({ phase: 'idle' }), save: save_, printDirect, placement }
}
```

- [ ] **Step 4: Write `src/features/edit/PrintExportStep.tsx`**

```tsx
/**
 * Photo Print — Print & Export: the paper drawn to scale with the photo on
 * it, as it will print; save the full-size file or print.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, Icon, ICONS, Notice, Section, Segmented } from '../../app/components/ui'
import { drawBitmap } from '../../lib/bitmap'
import type { PaperFit, PaperOrientation } from '../../lib/fitToPaper'
import { EDIT_PAPER_ORDER, PAPERS, type EditPaperId } from '../../lib/presets'
import { useEdit } from '../../store/edit'
import { useLicense } from '../license/LicenseDialog'
import { PrintDialog, type PrintRequest } from '../sheet/PrintDialog'
import { useEditExport } from './useEditExport'
import { useEditResult } from './useEditResult'

export function PrintCanvas() {
  const result = useEditResult()
  const { placement } = useEditExport()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (result && canvasRef.current) drawBitmap(canvasRef.current, result)
  }, [result])
  if (!placement || !result) return null
  const { paper, rect } = placement
  const pct = (v: number, of: number) => `${(v / of) * 100}%`

  return (
    <div className="flex h-full w-full items-center justify-center p-8" style={{ containerType: 'size' }}>
      <div
        className="relative overflow-hidden bg-white shadow-lg"
        style={{
          width: `min(88cqw, calc(86cqh * ${paper.width / paper.height}))`,
          aspectRatio: `${paper.width / paper.height}`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute"
          style={{
            left: pct(rect.x, paper.width),
            top: pct(rect.y, paper.height),
            width: pct(rect.width, paper.width),
            height: pct(rect.height, paper.height),
          }}
        />
      </div>
    </div>
  )
}

export function PrintPanel() {
  const paper = useEdit((s) => s.paper)
  const setPaper = useEdit((s) => s.setPaper)
  const paperFit = useEdit((s) => s.paperFit)
  const setPaperFit = useEdit((s) => s.setPaperFit)
  const orientation = useEdit((s) => s.orientation)
  const setOrientation = useEdit((s) => s.setOrientation)
  const mode = useEdit((s) => s.backgroundMode)
  const info = useEdit((s) => s.info)
  const { state, dismiss, save } = useEditExport()
  const { canProduce, open: openLicence } = useLicense()
  const busy = state.phase === 'working' || !canProduce

  return (
    <>
      {!canProduce && (
        <div className="px-6 pt-5">
          <Notice
            tone="danger"
            icon={<Icon path={ICONS.warning} size={18} />}
            action={<button type="button" onClick={openLicence} className="whitespace-nowrap text-[13px] font-bold underline">Enter key</button>}
          >
            The trial has ended. Saving and printing need a licence.
          </Notice>
        </div>
      )}

      <Section title="Paper">
        <Segmented<EditPaperId>
          options={EDIT_PAPER_ORDER.map((id) => ({ value: id, label: PAPERS[id].label }))}
          value={paper}
          onChange={setPaper}
          columns={5}
        />
        <p className="tabular text-xs text-muted">{PAPERS[paper].sublabel}</p>
        <Segmented<PaperFit>
          options={[{ value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }]}
          value={paperFit}
          onChange={setPaperFit}
          columns={2}
        />
        <p className="text-xs text-muted">
          {paperFit === 'fit' ? 'The whole photo, with a white border on the short side.' : 'Edge to edge; the overflow is cropped from the centre.'}
        </p>
        <Segmented<PaperOrientation>
          options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]}
          value={orientation}
          onChange={setOrientation}
          columns={3}
        />
      </Section>

      <Section title="Save the file" last>
        {info && <p className="tabular text-xs text-muted">Full size, {info.width} × {info.height} px, 300 DPI.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void save('png')} disabled={busy}>Save PNG</Button>
          <Button onClick={() => void save('jpeg')} disabled={busy || mode === 'transparent'}>Save JPG</Button>
        </div>
        {mode === 'transparent' && <p className="text-xs text-muted">JPG cannot keep transparency; save as PNG.</p>}
        {state.phase === 'working' && <Notice tone="info">{state.message}</Notice>}
        {state.phase === 'done' && <Notice tone="ok" action={<button type="button" onClick={dismiss}>OK</button>}>{state.message}</Notice>}
        {state.phase === 'failed' && <Notice tone="danger" action={<button type="button" onClick={dismiss}>OK</button>}>{state.message}</Notice>}
      </Section>
    </>
  )
}

export function EditPrintButton() {
  const { printDirect } = useEditExport()
  const paper = useEdit((s) => s.paper)
  const { canProduce, open: openLicence } = useLicense()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; message: string } | null>(null)

  const onPrint = useCallback(
    async (request: PrintRequest) => {
      setBusy(true)
      setStatus(null)
      try {
        await printDirect(request)
        setStatus({ tone: 'ok', message: `Sent ${request.copies} ${request.copies === 1 ? 'copy' : 'copies'} to the printer.` })
      } catch (error) {
        setStatus({ tone: 'danger', message: error instanceof Error ? error.message : String(error) })
      } finally {
        setBusy(false)
      }
    },
    [printDirect],
  )

  // Ctrl+P on this step opens the dialog (App already keeps it from WebView2).
  const openRef = useRef(() => setOpen(true))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        if (canProduce) openRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canProduce])

  return (
    <>
      <button
        type="button"
        onClick={canProduce ? () => { setStatus(null); setOpen(true) } : openLicence}
        className="flex h-11 items-center justify-center gap-2 px-5 text-[15px] font-extrabold"
        style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
      >
        <Icon path={ICONS.save} size={18} />
        {canProduce ? 'Print' : 'Licence needed'}
      </button>
      {open && (
        <PrintDialog
          title="Print photo"
          summary={`One photo on ${PAPERS[paper].label}, at true size.`}
          busy={busy}
          status={status}
          onPrint={onPrint}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 5: Fill the Print slots in `EditApp.tsx`**

Import `EditPrintButton, PrintCanvas, PrintPanel` from `./PrintExportStep`; replace the `Task 9` comments with `{step === 'print' && <PrintCanvas />}` and `{step === 'print' && <PrintPanel />}`, and pass `primaryAction={step === 'print' ? <EditPrintButton /> : undefined}` to `ActionBar`. Leave `EditApp`'s Ctrl+P branch as it is: on the Edit step it moves to Print & Export, and on that step `EditPrintButton`'s own listener opens the dialog.

- [ ] **Step 6: Check it in the app, and measure memory**

Run: `npx tsc --noEmit && npx vitest run`, then `npm run tauri dev`.
Expected:
- The canvas shows the paper with the photo placed; Fit / Fill / orientation and each paper change it at once; a landscape photo turns the paper on Auto.
- Save PNG / JPG writes `<name>-edited.<ext>` at the photo's full pixel size (check the file's properties: 300 DPI). Save JPG is disabled on Transparent.
- Print opens the shared dialog titled "Print photo"; a test print on 4R comes out at true size (measure: 101.6 × 152.4 mm), Transparent prints on white.
- **Memory:** open the largest photo available (24 MP if possible; otherwise note the size used), choose Transparent, and Save PNG while watching the WebView2 process in Task Manager. Record the peak in the spec's "Memory" section. **If the peak exceeds ~1 GB or the save fails, do Task 10; otherwise skip Task 10 and strike that section of the spec in Task 12.**

- [ ] **Step 7: Commit**

```bash
git add src/lib/bitmap.ts src/features/sheet/PrintDialog.tsx src/features/sheet/SheetPrintButton.tsx src/features/edit/useEditExport.ts src/features/edit/PrintExportStep.tsx src/features/edit/EditApp.tsx
git commit -m "Print & Export for Photo Print: full-size save, true-size print

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10 (only if Task 9's measurement exceeded ~1 GB): Composite in strips

**Files:**
- Modify: `src/lib/composite.ts` (add `compositeInStrips`), `src/features/edit/useEditExport.ts` (use it for `maxDim === 0`)
- Test: `src/lib/composite.test.ts`

**Interfaces:**
- Consumes: `composite`, `CompositeOptions` (Task 3); `sharpenRadius` (Task 2).
- Produces: `compositeInStrips(options: CompositeOptions, stripRows?: number): Bitmap & { data: Uint8ClampedArray }` — same result as `composite` (within 1 level per channel), at a fraction of the peak memory.

- [ ] **Step 1: Write the failing test** — append to `src/lib/composite.test.ts` (add `compositeInStrips` to the import)

```ts
describe('compositeInStrips', () => {
  it('matches a single pass', () => {
    const width = 40
    const height = 300
    const image = createBitmap(width, height)
    const mask = createBitmap(width, height)
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < width * height; i++) {
      image.data.set([rand() * 255, rand() * 255, rand() * 255, 255], i * 4)
      const a = (i % width) < 15 ? 255 : (i % width) < 25 ? Math.round(rand() * 255) : 0
      mask.data.set([a, a, a, 255], i * 4)
    }
    const options = { image, mask, background: '#2050A0', edgeSoftness: 1, saturation: 20, sharpness: 30 }
    const whole = composite(options)
    const strips = compositeInStrips(options, 64)
    let worst = 0
    for (let i = 0; i < whole.data.length; i++) worst = Math.max(worst, Math.abs(whole.data[i] - strips.data[i]))
    expect(worst).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/composite.test.ts`
Expected: FAIL — `compositeInStrips` is not exported.

- [ ] **Step 3: Implement** — append to `src/lib/composite.ts`

```ts
/**
 * `composite` over horizontal strips, for full-resolution saves: foreground
 * estimation allocates several float planes per pixel, which a 24 MP photo
 * cannot afford in one go. Every step is local, so each strip is computed
 * with `overlap` extra rows above and below and only its middle is kept; the
 * result matches a single pass.
 */
export function compositeInStrips(options: CompositeOptions, stripRows = 512): Bitmap & { data: Uint8ClampedArray } {
  const { image, mask, background } = options
  const { width, height } = image
  // Mask shaping (≤4) + foreground estimation (16, twice in the fallback) + sharpening.
  const radius = options.sharpenRadius ?? sharpenRadius(width, height)
  const overlap = 40 + radius
  if (height <= stripRows + overlap * 2) return composite(options)

  const slice = (b: Bitmap, y0: number, y1: number): Bitmap => ({
    width,
    height: y1 - y0,
    data: b.data.subarray(y0 * width * 4, y1 * width * 4),
  })
  const out = createBitmap(width, height)
  for (let top = 0; top < height; top += stripRows) {
    const rows = Math.min(stripRows, height - top)
    const y0 = Math.max(0, top - overlap)
    const y1 = Math.min(height, top + rows + overlap)
    const part = composite({
      ...options,
      image: slice(image, y0, y1),
      mask: slice(mask, y0, y1),
      background: typeof background === 'string' ? background : slice(background, y0, y1),
      sharpenRadius: radius,
    })
    const from = (top - y0) * width * 4
    out.data.set(part.data.subarray(from, from + rows * width * 4), top * width * 4)
  }
  return out
}
```

- [ ] **Step 4: Use it for the full-size save** — in `useEditExport.ts` `build`, replace `return composite({ … })` with:

```ts
const options = { image, mask, background, edgeSoftness: s.edgeSoftness, hairDetail: s.hairDetail, ...s.enhance }
return maxDim === 0 ? compositeInStrips(options) : composite(options)
```

(import `compositeInStrips` from `../../lib/composite`).

- [ ] **Step 5: Run the tests and re-measure**

Run: `npx vitest run && npx tsc --noEmit`; then repeat Task 9 Step 6's memory measurement.
Expected: tests pass; peak memory well under the first measurement; the saved file looks identical.

- [ ] **Step 6: Commit**

```bash
git add src/lib/composite.ts src/lib/composite.test.ts src/features/edit/useEditExport.ts
git commit -m "Composite full-size saves in strips to bound memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Auto enhance in the ID flow

**Files:**
- Modify: `src/features/background/BackgroundStep.tsx` (`ToneSection`, ~line 300)

**Interfaces:**
- Consumes: `autoEnhance` (Task 2); `useJob` `preview`, `previewMask`, `setTone` (existing).
- Produces: nothing new.

- [ ] **Step 1: Add the button**

In `ToneSection`, read the photo and add the button above the Brightness slider:

```tsx
const preview = useJob((s) => s.preview)
const previewMask = useJob((s) => s.previewMask)
```

```tsx
<Button
  block
  disabled={!preview}
  // Measures the face, not the old backdrop; only brightness, contrast and warmth.
  onClick={() => preview && setTone(autoEnhance(preview, previewMask ?? undefined))}
>
  Auto enhance
</Button>
```

Import `Button` from `../../app/components/ui` and `autoEnhance` from `../../lib/enhance`. Change the help line to: `Auto enhance only moves the sliders. Lower warmth to take the yellow out of indoor light.`

- [ ] **Step 2: Check it**

Run: `npx tsc --noEmit && npx vitest run`, then in the app on an ID photo press Auto enhance on the Background step.
Expected: the three sliders move (each within ±35); the backdrop colour stays exactly the swatch; Reset puts them back to 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/background/BackgroundStep.tsx
git commit -m "Auto enhance on the ID Background step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End-to-end check and spec upkeep

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-edit-photo-mode-design.md`

- [ ] **Step 1: Full manual run** (`npm run tauri dev`)

With one full-body photo, run each background mode end to end — Original, Transparent, Colour, Image — and for each: Auto enhance, save PNG, save JPG (not Transparent), and print one copy on 4R (Fit), then one on 3R (Fill). Then:
- New photo (Ctrl+N) during a running background removal, drop the next photo on Photo Print: the first photo's mask never appears on the second.
- Paste (Ctrl+V) on Import with Photo Print highlighted opens in Photo Print; save name is `photo-edited.png`.
- Drop on ID Photo: the full ID flow (Adjust → … → Export) is unchanged, including the Attire step and the print sheet.

Expected: every item behaves as described; note any that do not and fix before Step 2.

- [ ] **Step 2: Update the spec**

- Status line: "Implemented 2026-10-xx; see plan `docs/superpowers/plans/2026-10-08-photo-print-mode.md`."
- Replace the "Note on current working tree" section (tone was committed in `97bd48b`) with a "Changes made during implementation" section listing the deviations from this plan's Global Constraints (warmth measured on the whole photo; auto sets three sliders; background picture by Rust id; slider placement instead of drag; no HD control; copies in the dialog; reset turns Image to Original), plus anything found in Step 1.
- Memory section: record the measured peak, and either strike the strips paragraph (Task 10 skipped) or note that strips are in use.

- [ ] **Step 3: Run everything and commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

```bash
git add docs/superpowers/specs/2026-09-30-edit-photo-mode-design.md
git commit -m "Spec: record how Photo Print was built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
