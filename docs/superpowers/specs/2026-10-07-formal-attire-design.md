# Formal attire: design

Date: 2026-10-07. Status: decisions approved in conversation; awaiting spec
review.

## Why

Passport and many ID photos need formal clothing: a collared shirt with a
necktie, or a blazer. Customers often arrive in a T-shirt. Today the operator
leaves the app, opens Photoshop, drags a suit PNG over the customer, and lines
it up by hand. The goal is to do this inside the app in a few seconds, with
the result carried through to the print sheet and every export.

`BUILD_PLAN.md` lists clothing replacement as a v1 non-goal. This spec lifts
that for template overlays only; generative clothing stays out of scope.

## Decisions made with the owner

- **Template overlay, not AI.** A transparent PNG of clothing (neck opening
  at the top, shoulders and chest below) is placed over the customer, which
  is what operators already do by hand.
- **A new Attire step** between Background and Print sheet:
  Import → Adjust → Background → **Attire** → Print sheet → Export.
  It defaults to **None**, so a job that needs no attire is one click
  (Next).
- **Available for every photo size**, not just passport.
- **Default templates plus operator uploads.** The app ships with a default
  set; operators can add their own PNGs and remove ones they added.
- **Shipped defaults are placeholders for now.** The owner's nine downloaded
  templates (Pngtree, Pikbest and similar) are installed as the **local
  library on the owner's machine only**: never committed to git, never
  bundled in the installer, because their licences have not been confirmed
  for redistribution. The Pngtree grey suit whose watermarks were stripped
  is never shipped. Licensed or self-photographed templates replace the
  placeholders in a later release by dropping them into the defaults folder.
- **Fitting = snap from the face, then fine-tune** (option 1). No per-template
  calibration on upload; anchors are measured automatically from the PNG.
  Upload-time calibration (clicking neck and shoulders) is a possible later
  addition if some uploads do not snap well.

## Templates

### What a template is

A PNG with transparency. The app measures two anchors from its alpha
channel when it is loaded (`measureTemplate`, below):

- **Neck point**: where the customer's chin/neck meets the clothing.
- **Shoulder width**: the width of the widest opaque row in the top 60 % of
  the clothing.

A template is rejected on upload if it is not a PNG, has no transparent
pixels, or has no opaque region to measure — with a message saying which.

### Where templates live

| Source | Location | In git? | In installer? | Removable in app? |
|---|---|---|---|---|
| Shipped defaults | `src/assets/attire/` (+ `index.ts` manifest) | yes | yes (Vite bundle) | no |
| Operator uploads | `%APPDATA%\art.philmerdigi.idphotostudio\attire\` (+ `attire.json`) | no | no | yes |

The shipped defaults are **two placeholder templates** drawn as SVG
(a white collared shirt with a dark necktie, and a dark blazer over a white
shirt with a tie). They are deliberately simple and labelled
"Placeholder" in the picker. SVG keeps them small and resolution-free; they
are rasterised in the browser like any other image before measuring.

`attire.json` in the user folder lists each upload:

```ts
interface AttireEntry {
  id: string            // file stem, e.g. "a1b2c3"
  name: string          // shown in the picker, default from the file name
  group: 'men' | 'women' | 'other'
  file: string          // "a1b2c3.png", inside the attire folder
  addedAt: string       // ISO date
}
```

The owner's nine files are added on this machine through the same upload
path during implementation (named and grouped men/women), so the local
library is exercised end to end.

### Rust commands (`src-tauri/src/attire.rs`, wired in `commands.rs`)

Following `import_model`'s pattern (copy to a staging name, validate,
rename):

| Command | Does |
|---|---|
| `list_attire() -> Vec<AttireEntry>` | Read `attire.json`; drop entries whose file is missing |
| `import_attire({ path, name, group }) -> AttireEntry` | Check the PNG signature and that it has transparency (an alpha channel or a `tRNS` chunk); copy as `<id>.png`; append to `attire.json` |
| `remove_attire({ id })` | Delete the file and its entry |
| `read_attire({ id }) -> bytes` | Return the PNG bytes |

The attire folder is created next to `models` in `state.rs`. Writes to
`attire.json` go through a temp file and rename so a crash cannot corrupt it.

## Fitting

### Pure functions (`src/lib/attire.ts`, tested in `attire.test.ts`)

```ts
interface TemplateAnchors {
  neck: { x: number; y: number }   // template pixels
  shoulderWidth: number            // template pixels
}

/** Measure neck point and shoulder width from a template's alpha. */
measureTemplate(template: Bitmap): TemplateAnchors

/**
 * Where the attire sits on the finished photo, resolution-free:
 * neck position as fractions of the photo's width/height, the template's
 * shoulder width as a fraction of the photo width, and rotation in degrees.
 */
interface AttireFit { x: number; y: number; scale: number; rotation: number }

/** Snap a template under the face. */
autoFit(face: Face | null, chinY: number, photo: { width: number; height: number }): AttireFit

/** Draw the attire onto a finished photo (mutates a copy, returns it). */
applyAttire(photo: Bitmap, template: Bitmap, anchors: TemplateAnchors,
            fit: AttireFit, chinY: number): Bitmap
```

**Neck point.** Scan rows from the top of the opaque region. The neck
opening is the gap between the two collar sides; the neck point is the
centre of that gap at the row where the gap closes (the lowest row where
the region is still split left/right of the centre), or, for templates with
no gap (a high collar), the top-centre of the opaque region.

**Shoulder width.** The widest opaque run in the top 60 % of the opaque
region's height.

**Auto-fit.** The neck point goes at the chin's x (the midpoint between
the mouth corners, as `autoCrop.mouthMidpoint`) and slightly below the
chin line (`chinY + 0.04 × face height`). Shoulder width is set to
`2.6 × face width` (a constant tuned against the owner's nine templates
during implementation; recorded in the code with the reason). Rotation
follows the face roll from `rollDegrees` when Level eyes is off, and is 0
when Level eyes is on (the photo is already levelled). With no face
detected, the attire is centred horizontally with the neck at 72 % of the
photo height and shoulders at 90 % of the photo width.

**Layering.** The attire is drawn **over** the composited photo (subject
already on its background), then **erased above the chin line** with a
short feather (a few pixels at output resolution), so the template can
never cover the face or jaw even when the operator drags it high. The
original clothing outside the template stays visible; the operator scales
the template to cover it. If the template's bottom edge ends above the
bottom of the photo, the panel shows a warning: "The attire stops above the
bottom edge — make it larger or move it down."

## The Attire step

### Store

`useJob` gains:

```ts
attireId: string | null      // null = None (default)
attireFit: AttireFit | null  // null until a template is chosen
attireTouched: boolean       // operator has moved/scaled/rotated it
setAttire: (id: string | null) => void   // choosing a template runs autoFit
setAttireFit: (patch: Partial<AttireFit>) => void
resetAttireFit: () => void   // re-run autoFit for the current template
```

`reset()` (New customer) sets `attireId` back to None. Changing the preset
or re-cropping in Adjust re-runs auto-fit only if the operator has not
moved the attire (`attireTouched` is false); otherwise the fit is kept, because it is stored relative
to the photo.

A small `src/store/attire.ts` holds the library: the shipped defaults plus
`list_attire()`, each decoded once to a preview-size bitmap with its
anchors cached. It is loaded on app start and refreshed after an upload or
removal.

### Canvas (`src/features/attire/AttireCanvas.tsx`)

The same finished-photo preview the Background step shows, with the attire
on top as a Konva image the operator can:

- **drag** to move,
- **scroll** to scale (around the neck point),
- use the corner handles of a Konva Transformer to scale/rotate.

The chin line is drawn as a faint guide while dragging.

### Panel (`src/features/attire/AttireStep.tsx`)

- **Picker**: thumbnail grid with **None** first, then groups *Men*,
  *Women*, *Other*, *Placeholder*. Selection is highlighted. Uploaded
  templates show a remove (×) button with a confirm in the panel (not a
  browser dialog).
- **Add template…**: native file dialog (`.png`), then a small inline form
  for name and group, then `import_attire`.
- **Fit**: Size and Rotation sliders mirroring the canvas, and a **Re-fit**
  button that runs auto-fit again.
- The warning described under Layering, when it applies.

### Rest of the flow

- `Step` gains `'attire'`; `ACTIVE_STEPS`, `ALL_STEPS`, `STEP_LABELS` and
  `App.tsx`'s canvas/panel switch are updated.
- **Export** (`useExport.buildPhoto`): after `composite(...)` and before
  `withNameTag(...)`, if an attire is chosen, read the template at full
  resolution (`read_attire` or the bundled asset), and `applyAttire` at the
  output pixel size. The name tag is drawn last so it stays on top. The
  sheet, PDF, image and print all go through `buildPhoto`, so they all get
  the attire.
- **Print sheet preview** uses the same finished preview, so it shows the
  attire too.
- **Tutorial** (`script.ts`) gains one entry on the Attire step pointing at
  the picker: "Customer not in formal wear? Pick a shirt or suit — it snaps
  under the chin. Drag or scroll to adjust."

## Files

New:

| File | Purpose |
|---|---|
| `src/lib/attire.ts` | `measureTemplate`, `autoFit`, `applyAttire` — pure |
| `src/lib/attire.test.ts` | Unit tests |
| `src/store/attire.ts` | Template library state |
| `src/features/attire/AttireStep.tsx` | Panel |
| `src/features/attire/AttireCanvas.tsx` | Canvas |
| `src/assets/attire/*.svg`, `index.ts` | Two placeholder templates and their manifest |
| `src-tauri/src/attire.rs` | Library folder, manifest, import/remove/read |

Changed:

| File | Change |
|---|---|
| `src/store/job.ts` | `'attire'` step; `attireId`, `attireFit` and setters |
| `src/app/App.tsx` | Render the Attire canvas and panel |
| `src/features/export/useExport.ts` | Apply attire before the name tag |
| `src/lib/tauri.ts` | Bindings for the four commands |
| `src/features/tutorial/script.ts` | One Attire entry |
| `src-tauri/src/commands.rs`, `lib.rs`, `state.rs` | Register commands; create the attire folder |
| `BUILD_PLAN.md` | Move "clothing/suit replacement" out of non-goals, noting template overlay only |

## Testing

- **`attire.test.ts`**: `measureTemplate` on synthetic templates (a
  V-neck shape, a high collar with no gap, a single opaque block);
  `autoFit` with a face and with none; `applyAttire` leaves every pixel
  above the chin line unchanged and covers pixels inside the template;
  fits are resolution-free (the same fit at preview and output size puts
  the neck at the same relative position).
- **Rust unit tests** for `attire.rs`: a non-PNG, a PNG without alpha, and
  a good PNG; a missing file is dropped by `list_attire`; manifest
  round-trip.
- **Run the app**: load a T-shirt test photo, pick each of the owner's nine
  templates and both placeholders, check the snap, adjust, export a single
  JPG and a sheet PDF, and confirm the attire matches the canvas and the
  face is never covered.
- `npm test`, `npm run typecheck`, `cargo test`.

## Out of scope

- Generative/AI clothing.
- Upload-time calibration of neck and shoulders (possible later).
- Recolouring templates or changing tie colour in the app.
- Shipping the owner's downloaded templates in the installer.

## Changes made during implementation

Found while testing in the running app with the owner's nine templates:

- **Anchor at the collar top, not a neck point.** A "neck point" means
  something different on a V-collar suit (where the collar closes) and on a
  high blouse (the top of the blouse), and the blouse templates landed far
  too low. Every template is now placed by the top centre of its collar,
  `COLLAR_DROP = 0.06` face heights below the chin; shoulders are
  `SHOULDER_PER_FACE = 3` face widths.
- **Hide old clothes** (on by default, a checkbox in Fit). Below the chin,
  outside the neck, the photo is painted with the background colour before
  the attire goes on — what operators did by hand. The painted region follows
  a shoulder slope from the face edge at the chin to the neck edge at the
  collar, with blurred edges.
- **Old clothes are traced, not guessed** (`clothesMask` in `attire.ts`).
  Skin colour is sampled from the cheeks (median Cb/Cr); the old clothes are
  flooded from the bottom and sides of the photo through person pixels that
  are not skin (chroma distance > 30) and have no sharp colour edge, never
  above 0.35 face heights over the chin. That region is painted with the
  background before the attire goes on, so the neck and jaw keep their real
  outline. If the cheeks do not look like skin, it falls back to the
  geometric shoulder-slope guess.
- Below the jaw (0.15 face heights under the chin), every person pixel that
  is not skin joined to the face is old clothing, so badges, logos and
  skin-coloured patches go too.
- **The head is protected along its real outline**: person pixels above the
  chin that are not old clothing, with background removal's soft edge, are
  cut out of the attire. Dragging the attire up over the face leaves the head
  intact with no box around it. Untraced photos fall back to a box 1.1 face
  widths wide.
- **Dragging moves the person, not the attire** (owner's choice): the suit
  stays put and the head is dragged into it, as with a suit template in
  Photoshop. Scrolling (or the Person size slider, 50–200 %) resizes the
  person around the middle of the face; Shift+drag and Shift+scroll move and
  resize the attire. The move and resize are `headShift` and `headScale` on
  top of Adjust's crop; every output uses `framedCrop`, and returning to
  Adjust solves the equivalent zoom and pan from the final crop and folds
  them in, so Adjust's guides judge the real framing.
  Moving the person counts as placing the attire by hand, so re-framing keeps
  it. While dragging, the preview renders at half size without fringe
  clean-up (~64 ms per move instead of ~440 ms).
- **Blending.** Skin must lean red over blue (Cr − Cb ≥ 20), so light grey
  and white tops are never kept as "skin". Inside the attire's collar
  opening, the neck is carried a short way down (0.2 face heights) in its own
  colour, darkening then fading out, so there is no pale gap under the neck;
  further down an open neckline the customer's own top is kept, as what they
  wear under the jacket. A soft contact shadow of the attire falls on the
  customer's own skin and hair (never the backdrop), and the Blend section
  has Shadow, Attire brightness and Attire warmth to match the photo's light.
- **Eraser** (Touch up section: Move | Eraser). Brush kinds: *Skin & hair*
  removes the photo there, so the attire shows where it reaches (the head no
  longer covers it) and the backdrop elsewhere, *Attire* cuts the attire away,
  *Restore* undoes either; size 1–20 % of the photo width (scroll sizes it),
  soft edges, Undo and Clear all. Strokes are stored in photo fractions
  (`attireStrokes`) and replayed in order in `withAttire`, so preview, sheet
  and export match. Cleared on a new customer or a different template; New
  photo also returns the tool to Move.
- Rotation defaults to 0; corner handles were not built (drag, scroll and the
  Size/Rotate sliders cover the same adjustments).

Known limits: open-neck templates (blouse, open jacket) show the customer's
own top inside the V; a high-collared garment can still show beside the jaw.
The operator can resize, move, or switch Hide old clothes off.
