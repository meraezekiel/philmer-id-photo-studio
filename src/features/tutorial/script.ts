/**
 * Everything the tutorial says, in one file.
 *
 * Two reasons it lives apart from the components. A shop owner learning the
 * app is the hardest reader this product has, so the wording deserves to be
 * read straight through as prose rather than hunted for across ten files.
 * And when the time comes for Tagalog or Bisaya, this is the only file that
 * has to be translated.
 *
 * Each tip names the control it points at with a `data-tour` attribute. If
 * that control is not on screen, the tip is skipped rather than pointing at
 * nothing — which is what happens when a step's panel is scrolled or a
 * feature is hidden.
 */

import type { Step } from '../../store/job'

export interface Tip {
  id: string
  /** Which step of the flow this belongs to; the tour follows the operator. */
  step: Step
  /** `data-tour` value of the element to highlight; empty means centre screen. */
  anchor: string
  title: string
  body: string
  /** Shown instead of "Next" on the last tip of a step. */
  waitFor?: string
}

export const TOUR: Tip[] = [
  // --- Import ---------------------------------------------------------
  {
    id: 'import-drop',
    step: 'import',
    anchor: 'dropzone',
    title: 'Start with any photo',
    body: 'Drag a photo here from a folder, or click to browse. A photo taken on a phone is fine, as long as the face is clear and looking at the camera.',
    waitFor: 'Drop a photo to continue',
  },

  // --- Adjust ---------------------------------------------------------
  {
    id: 'adjust-done',
    step: 'adjust',
    anchor: 'adjust-canvas',
    title: 'The hard part is already done',
    body: 'The background is removed and the face is framed to the size rules. Most photos need nothing here. The green lines show where the top of the head and the chin must sit.',
  },
  {
    id: 'adjust-size',
    step: 'adjust',
    anchor: 'size-preset',
    title: 'Pick the size the customer asked for',
    body: '1x1 and 2x2 are the usual ID sizes. Passport is 35 x 45 mm, and it prints the name across the bottom the way the agencies here expect.',
  },
  {
    id: 'adjust-align',
    step: 'adjust',
    anchor: 'auto-align',
    title: 'If the framing looks wrong',
    body: 'Press Auto-align to let the app try again, or drag the green crown and chin lines on the photo yourself. The label at the top left turns green when the head size is correct.',
    waitFor: 'Press Next: Background',
  },

  // --- Background -----------------------------------------------------
  {
    id: 'background-colour',
    step: 'background',
    anchor: 'background-swatches',
    title: 'Choose the background',
    body: 'White is right for almost every ID. Blue is asked for by some schools and offices. Passport is locked to white on purpose, because a coloured one gets rejected.',
  },
  {
    id: 'background-compare',
    step: 'background',
    anchor: 'background-canvas',
    title: 'Check the edge before you print',
    body: 'Drag the divider to compare with the original. Look at the hair. If it looks rough, the two sliders below fix it — but leave them alone when it already looks right.',
  },
  {
    id: 'background-name',
    step: 'background',
    anchor: 'name-section',
    title: 'The name on the photo',
    body: 'Type the name as SURNAME, FIRST MIDDLE. It prints in a white band inside the bottom of the photo. Switch it off for any ID that does not want a name.',
    waitFor: 'Press Next: Attire',
  },

  // --- Attire ---------------------------------------------------------
  {
    id: 'attire-pick',
    step: 'attire',
    anchor: 'attire-picker',
    title: 'Customer not in formal wear?',
    body: 'Pick a shirt and tie or a suit — it snaps under the chin. Drag it on the photo to move it and scroll to resize. Leave it on None when the customer is already dressed for the ID. Add template… brings in your own PNG with a transparent background.',
    waitFor: 'Press Next: Print sheet',
  },

  // --- Print sheet ----------------------------------------------------
  {
    id: 'sheet-paper',
    step: 'sheet',
    anchor: 'paper-picker',
    title: 'Match the paper in your printer',
    body: 'Choose the paper you actually loaded. 4R is normal photo paper. The app then prints at true size, so a 2x2 measures exactly two inches with a ruler.',
  },
  {
    id: 'sheet-layout',
    step: 'sheet',
    anchor: 'layout-picker',
    title: 'How many photos on the sheet',
    body: 'Fill sheet gives the most copies the paper can hold. Exact quantity gives the number the customer paid for. Package mixes sizes, such as two 2x2 and four 1x1 on one sheet.',
  },
  {
    id: 'sheet-arrange',
    step: 'sheet',
    anchor: 'sheet-canvas',
    title: 'Move photos if you need to',
    body: 'Drag across the paper to highlight photos, then drag any of them to move the group. Arrow keys nudge by one millimetre. Delete takes photos off the sheet and lowers the quantity to match.',
  },
  {
    id: 'sheet-zoom',
    step: 'sheet',
    anchor: 'sheet-zoom',
    title: 'Check it before you spend paper',
    body: 'Zoom in and read the name and the face at full size. A misspelled name found here costs nothing; found after printing it costs a sheet.',
  },
  {
    id: 'sheet-print',
    step: 'sheet',
    anchor: 'print-button',
    title: 'Print',
    body: 'This goes straight to the printer at true size. Set the paper and quality once in Printer settings and the app remembers them. Never let the printer "fit to page".',
    waitFor: 'Press Print sheet, or Next: Export',
  },

  // --- Export ---------------------------------------------------------
  {
    id: 'export-save',
    step: 'export',
    anchor: 'export-save',
    title: 'Give the customer a file too',
    body: 'Save a JPG if they want a copy for online forms. It comes out at the exact size and 300 DPI, which is what those forms check.',
  },
  {
    id: 'export-new',
    step: 'export',
    anchor: 'new-photo',
    title: 'Next customer',
    body: 'New photo clears everything and starts again, keeping your size and background choices. That is the whole job: drop a photo, check it, print.',
  },
]

/** Shown once the last tip is dismissed. */
export const FINISHED = {
  title: "That's the whole app",
  body: 'Press the question mark at the top right any time to run through this again.',
}

export const WELCOME = {
  title: 'Welcome to Philmer ID Photo Studio',
  body: 'This takes about a minute. It points at each button as you use it on a real photo, so nothing has to be remembered.',
  start: 'Show me how',
  skip: 'I will work it out',
}
