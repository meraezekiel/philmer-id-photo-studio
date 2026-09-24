# ID Photo Studio: Design Brief (handover for Claude Design)

> **Product:** Philmer ID Photo Studio (working name), by Philmer Digi Art
> **Platform:** Windows desktop app (Tauri + React). Design at **1366×768 minimum** and **1920×1080 typical**. Mouse and keyboard, not touch.
> **Companion doc:** `BUILD_PLAN.md` (engineering, handled by Claude Code). Features, sizes and papers listed there are fixed. This brief covers how they look and feel.

---

## 1. Context and users

- **Primary user:** the shop owner or staff at a small printing/photocopy counter in the Philippines, making ID photos for walk-in customers (students, job applicants, passport applicants).
- **Situation:** a customer is waiting. The owner needs to go from photo to printed sheet in **under 2 minutes**, often several customers in a row.
- **Skill level:** comfortable with computers, not a photo editor. Customers sometimes look at the screen too, so the preview should look professional.
- **Printer:** Epson L121 inkjet (4R photo paper, A4, short and long bond).

**Design goals, in priority order**
1. **Fast and linear:** a clear step flow, with sensible defaults so most jobs are "import → next → next → print."
2. **Trustworthy output:** the preview shows exactly what will print, at true proportions, with visible size guides.
3. **Calm and professional:** a neutral UI so the photo is the hero. No clutter.
4. **Forgiving:** every auto step (face align, background removal) can be adjusted or undone.

---

## 2. Information architecture

A single window with a **5-step flow**, shown as a stepper in the top bar. Users can jump back to any finished step.

1. **Import**
2. **Adjust** (crop & align)
3. **Background**
4. **Print sheet**
5. **Export / Print**

Plus: **Settings** (modal or side sheet) and a **Model manager** inside Settings.

**Size preset choice** (1x1 / 2x2 / Passport / Custom) should be visible and changeable from **Adjust onward**, because it drives the crop. Put it at the top of the right panel.

### Layout skeleton (steps 2–4)
```
┌───────────────────────────────────────────────────────────────┐
│ Logo  ① Import ─ ② Adjust ─ ③ Background ─ ④ Sheet ─ ⑤ Export │ ⚙
├──────────────────────────────────────────────┬────────────────┤
│                                              │  Properties    │
│              Canvas (photo hero)             │  panel         │
│        guides · crop box · handles           │  (320–360 px)  │
│                                              │                │
├──────────────────────────────────────────────┴────────────────┤
│ zoom −/＋ · fit · before/after        [ Back ]   [ Next → ]     │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. Screens to design

### 3.1 Import (empty state = app home)
- A large drop zone: "Drop a photo here, or click to browse". Also supports paste (Ctrl+V).
- Supported formats line: JPG, PNG, WebP, BMP.
- A small "Recent" strip of the last few exported jobs (thumbnail + size + time) as an optional v1.1 slot. Leave room for it.
- After drop, show a **processing state**: the photo preview with an elegant progress indicator and the labels "Removing background…" and "Finding face…". Typical wait is 3–10 s, so make the wait feel intentional (e.g. a subtle scan shimmer over the photo).

### 3.2 Adjust (crop & align)
- The canvas shows the full photo, dimmed outside an **aspect-locked crop box**.
- **Guide overlays** inside the crop, per preset (a key design element, so make them clear but unobtrusive):
  - crown line, a chin *band* (min–max), eye line, vertical center line
  - Colors: guides in an accent color; they turn **green when the head is within range** and **amber when out of range**, with a small text status: "Head size OK" / "Head too small, zoom in".
- Draggable **crown and chin handles** for manual correction.
- Right panel:
  - **Size preset** segmented control: 1x1 · 2x2 · Passport · Custom (Custom reveals W×H inputs with an mm/in toggle).
  - **Auto-align** button (re-run) + "Level eyes" toggle.
  - Zoom slider, rotate slider (−15°…+15°), reset.
  - Face picker if more than 1 face ("3 faces found, click one").
- Show the background already removed here (with the chosen bg color) so the user sees the final look early.

### 3.3 Background
- The canvas shows the **final photo at true aspect**, large, with a **Before/After** compare (a split slider or hold-to-compare).
- Right panel:
  - **Color swatches** (big and easy to click): White, Blue `#1E5BC6`, Light Blue `#8EC5FF`, Red `#C62828`, Light Gray `#E9E9E9`, and **Custom** (color picker + hex).
  - **Edges:** "Edge softness" slider (−2…+2) and "Hair detail" slider.
  - **Adjust photo** (collapsible): Brightness, Contrast, Warmth.
  - **Name tag** (collapsible, 1x1/2x2 only): toggle + text field + live preview strip. Disabled for Passport, with a tooltip explaining why.
  - For Passport, show an info chip if the bg isn't white: "Passports usually require a white background."
- **Zoom to 100%** option to inspect hair edges. This matters for trust.

### 3.4 Print sheet
- The canvas shows **paper at true proportions** with photos tiled, margins shown faintly, and cut marks.
- Right panel:
  - **Paper:** 4R · A4 · Short bond · Long bond (with dimensions shown in small text).
  - **Mode:** "Fill sheet" (shows the count, e.g. "15 photos") · "Exact quantity" (stepper) · "Package" (mixed sizes).
  - **Package builder:** rows of *size × qty* with add/remove. Live fit status: ✅ "Fits" / ⚠️ "Doesn't fit on 4R, try A4" + a one-click "Switch to A4".
  - Saved packages dropdown (e.g. "4R Combo: 2 pcs 2x2 + 4 pcs 1x1").
  - Toggles: cut marks, orientation (auto/portrait/landscape).
- Callout for the common case: 2x2 only fits 2 on 4R, so suggest a Package or a bigger paper.

### 3.5 Export / Print
- A summary card: thumbnail, size, bg color, paper, count, 300 DPI.
- **Primary: Print** (opens the PDF in the viewer) with a clear tip: "In the print dialog, choose **Actual size / 100%**, not Fit to page."
- Secondary: Save sheet as PDF · Save sheet as JPG/PNG · Save single photo (JPG/PNG).
- After success: a toast with "Open folder" and a prominent **"New photo"** button to start the next customer (resets to Import but keeps the preset, bg and paper).

### 3.6 Settings
- Defaults: size preset, bg color, paper, margins per paper (mm), gap (mm), cut marks on/off, export folder, file name pattern.
- **Models:** a card per model:
  - "Standard (Lite): Installed, built-in"
  - "HD Portrait: 973 MB, slower, best hair detail". Actions: **Download** (progress bar, pause/resume, checksum verified ✓) or **Import file…**, Remove.
  - A quality toggle used during processing: Standard / HD.
- About: version, licenses (BiRefNet MIT, YuNet MIT, ONNX Runtime MIT).

---

## 4. States to cover (please design each)

| State | Where | Notes |
|---|---|---|
| Empty | Import | First run, friendly, shows supported formats |
| Processing | Import→Adjust | Progress + labels, cancel option |
| No face found | Adjust | Inline banner "No face detected, adjust the crop manually." Guides still shown |
| Multiple faces | Adjust | Click-to-select overlay on each face |
| Head out of range | Adjust | Amber guides + hint text |
| Unsupported file (HEIC etc.) | Import | "HEIC isn't supported yet. Please convert to JPG." |
| Low resolution warning | Adjust | "This photo is small; the print may look soft" (when crop < output px) |
| Doesn't fit on paper | Sheet | Warning + suggested fix button |
| HD model not installed | Settings / quality toggle | Disabled HD option with a "Get HD model" link |
| Download in progress / failed / checksum mismatch | Settings | Retry + import-file alternative |
| Export success / failure | Export | Toast; failure explains (e.g. folder not writable) |

---

## 5. Visual direction

- **Mood:** clean, modern photo-studio tool. Neutral surfaces, one confident accent. Think "pro utility," not a playful consumer app.
- **Theme:** **light theme default** (matches printed output and counter lighting), plus a dark theme. The canvas area uses a neutral mid-gray or checkerboard-off background in both themes so photo colors are judged correctly.
- **Accent:** propose one (suggestion: a deep teal or indigo that doesn't clash with blue ID backgrounds). Include success/warning/danger colors.
- **Typography:** a clean sans for UI (e.g. Inter or Segoe UI Variable to feel native on Windows). Use tabular numerals for sizes and counts.
- **Density:** comfortable. Big hit targets on the primary actions (Next, Print, swatches).
- **Iconography:** a single outline icon set (e.g. Lucide).
- **Motion:** subtle. Step transitions ≤200 ms and a processing shimmer. No bouncy animations.
- **Brand:** small "Philmer Digi Art" mark in the top-left and About. Propose a simple app icon (camera/ID-card motif, **original**, readable at 16 px and 256 px).

---

## 6. Interaction details

- **Keyboard:** `Ctrl+O` open · `Ctrl+V` paste image · `Enter`/`Ctrl+→` next step · `Ctrl+←` back · `Ctrl+P` print · `Ctrl+S` save · `Ctrl+Z / Ctrl+Y` undo/redo (crop & adjustments) · `Space`+drag pan · `Ctrl+scroll` zoom · `\` hold for before/after · `Ctrl+N` new photo.
- Every slider has a double-click-to-reset behavior and shows its numeric value.
- Units: show mm by default with inches in secondary text (e.g. "50.8 × 50.8 mm · 2 × 2 in").
- The Next button label is contextual ("Next: Background", "Next: Print sheet").

---

## 7. Deliverables I need from Claude Design

1. **Hi-fi mockups** for each screen in §3 at 1920×1080, plus Adjust and Sheet at 1366×768.
2. The **states** in §4 (can be smaller frames or annotated variants).
3. **Design tokens** (color, type scale, spacing, radius, shadow, light and dark) exported as **CSS variables** so Claude Code can drop them into `src/styles/tokens.css`.
4. **Component specs:** stepper, segmented control, swatch, slider with value, package row, model card, banners/toasts, primary/secondary buttons, canvas guide styles (line weights, colors, labels).
5. **App icon** (SVG + 256/48/32/16 px PNG).
6. A short **handoff note** listing anything that deviates from `BUILD_PLAN.md`.

Place everything in a `/design` folder in the repo so Claude Code can find it.
