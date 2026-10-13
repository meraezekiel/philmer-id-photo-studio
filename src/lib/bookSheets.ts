/**
 * Book pages laid out on print paper: as many per sheet as fit, turned if
 * that fits more, with cut marks for the trimmer. The paper is always
 * handled portrait, the way it feeds; pages turn instead.
 */

import type { RectMm, SizeMm } from './bookTypes'

/** Kept clear at the paper's edge, where printers cannot reach. */
export const SHEET_SAFE_MM = 3
/** Between neighbouring pages (outside any bleed), room for marks. */
export const CELL_SPACING_MM = 4
export const BLEED_MM = 2
export const MARK_OFFSET_MM = 0.5
export const MARK_LENGTH_MM = 3
export const LABEL_SIZE_MM = 2

export interface SheetSlot {
  /** The trimmed page on the sheet. */
  trim: RectMm
  /** The page is turned 90° clockwise on the sheet. */
  rotated: boolean
  /** Baseline centre for the small page number, or null when there is no room. */
  labelAt: { x: number; y: number } | null
}

export interface CutLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type SheetPlan =
  | { ok: true; paper: SizeMm; perSheet: number; slots: SheetSlot[]; bleedMm: number; borderless: boolean }
  | { ok: false; message: string }

const EPS = 1e-6

export function portrait(size: SizeMm): SizeMm {
  return size.widthMm <= size.heightMm ? size : { widthMm: size.heightMm, heightMm: size.widthMm }
}

interface Grid {
  rotated: boolean
  tw: number
  th: number
  cols: number
  rows: number
  bleed: number
}

function layoutGrid(sheet: SizeMm, g: Grid): SheetPlan {
  const cw = g.tw + 2 * g.bleed
  const ch = g.th + 2 * g.bleed
  const totalW = g.cols * cw + (g.cols - 1) * CELL_SPACING_MM
  const totalH = g.rows * ch + (g.rows - 1) * CELL_SPACING_MM
  const x0 = (sheet.widthMm - totalW) / 2
  const y0 = (sheet.heightMm - totalH) / 2
  const slots: SheetSlot[] = []
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const trim = { x: x0 + c * (cw + CELL_SPACING_MM) + g.bleed, y: y0 + r * (ch + CELL_SPACING_MM) + g.bleed, w: g.tw, h: g.th }
      const cellBottom = trim.y + trim.h + g.bleed
      const room = r < g.rows - 1 ? CELL_SPACING_MM : sheet.heightMm - cellBottom
      const labelAt = room >= LABEL_SIZE_MM + 0.6 ? { x: trim.x + trim.w / 2, y: cellBottom + 0.3 + LABEL_SIZE_MM } : null
      slots.push({ trim, rotated: g.rotated, labelAt })
    }
  }
  return { ok: true, paper: sheet, perSheet: slots.length, slots, bleedMm: g.bleed, borderless: false }
}

export function planSheets(page: SizeMm, paper: SizeMm, edgeToEdge: boolean): SheetPlan {
  const sheet = portrait(paper)
  const desired = edgeToEdge ? BLEED_MM : 0
  const usableW = sheet.widthMm - 2 * SHEET_SAFE_MM
  const usableH = sheet.heightMm - 2 * SHEET_SAFE_MM
  const turns = page.widthMm === page.heightMm ? [false] : [false, true]
  const sides = (rotated: boolean) => (rotated ? { tw: page.heightMm, th: page.widthMm } : { tw: page.widthMm, th: page.heightMm })

  let best: Grid | null = null
  for (const rotated of turns) {
    const { tw, th } = sides(rotated)
    const cw = tw + 2 * desired
    const ch = th + 2 * desired
    if (cw > usableW + EPS || ch > usableH + EPS) continue
    const cols = Math.floor((usableW + CELL_SPACING_MM) / (cw + CELL_SPACING_MM) + EPS)
    const rows = Math.floor((usableH + CELL_SPACING_MM) / (ch + CELL_SPACING_MM) + EPS)
    if (!best || cols * rows > best.cols * best.rows) best = { rotated, tw, th, cols, rows, bleed: desired }
  }
  if (best) return layoutGrid(sheet, best)

  // One page per sheet: give up some bleed for the room that is left.
  for (const rotated of turns) {
    const { tw, th } = sides(rotated)
    if (tw <= usableW + EPS && th <= usableH + EPS) {
      const bleed = Math.max(0, Math.min(desired, (usableW - tw) / 2, (usableH - th) / 2))
      return layoutGrid(sheet, { rotated, tw, th, cols: 1, rows: 1, bleed })
    }
  }

  // The page is the paper (8x10 on 8R, A4 on A4): print borderless, no trim.
  for (const rotated of turns) {
    const { tw, th } = sides(rotated)
    if (tw <= sheet.widthMm + EPS && th <= sheet.heightMm + EPS) {
      const trim = { x: (sheet.widthMm - tw) / 2, y: (sheet.heightMm - th) / 2, w: tw, h: th }
      return { ok: true, paper: sheet, perSheet: 1, slots: [{ trim, rotated, labelAt: null }], bleedMm: 0, borderless: true }
    }
  }

  return { ok: false, message: 'The page is larger than the paper. Choose a bigger paper or a smaller book size.' }
}

/** A borderless page still needs trimming on an axis it is inset this far. */
const BORDERLESS_TRIM_MM = 2

/** Two short lines at each trim corner, pointing away from the page. */
export function cutLines(plan: SheetPlan, occupied: number): CutLine[] {
  if (!plan.ok) return []
  const { widthMm: W, heightMm: H } = plan.paper
  // Borderless, the page fills the paper on at least one axis: only the
  // margins of an axis it does not fill (8x8 on 8R) get marks.
  let marginsX = true
  let marginsY = true
  if (plan.borderless) {
    const inset = (from: number, size: number, paper: number) => Math.min(from, paper - from - size) >= BORDERLESS_TRIM_MM - EPS
    marginsX = plan.slots.every((s) => inset(s.trim.x, s.trim.w, W))
    marginsY = plan.slots.every((s) => inset(s.trim.y, s.trim.h, H))
    if (!marginsX && !marginsY) return []
  }
  const start = plan.bleedMm + MARK_OFFSET_MM
  const end = start + MARK_LENGTH_MM
  const clampX = (x: number) => Math.min(W, Math.max(0, x))
  const clampY = (y: number) => Math.min(H, Math.max(0, y))
  const lines: CutLine[] = []
  for (const slot of plan.slots.slice(0, Math.max(0, occupied))) {
    const { x, y, w, h } = slot.trim
    for (const [cx, sx] of [[x, -1], [x + w, 1]] as const) {
      for (const [cy, sy] of [[y, -1], [y + h, 1]] as const) {
        const horizontal = { x1: clampX(cx + sx * start), y1: cy, x2: clampX(cx + sx * end), y2: cy }
        const vertical = { x1: cx, y1: clampY(cy + sy * start), x2: cx, y2: clampY(cy + sy * end) }
        // A horizontal mark lies in the left or right margin, a vertical one above or below.
        const wanted = [...(marginsX ? [horizontal] : []), ...(marginsY ? [vertical] : [])]
        for (const l of wanted) {
          if (Math.hypot(l.x2 - l.x1, l.y2 - l.y1) >= 0.5) lines.push(l)
        }
      }
    }
  }
  return lines
}

export function sheetCount(pages: number, perSheet: number): number {
  return perSheet > 0 ? Math.ceil(pages / perSheet) : 0
}

export function pagesOnSheet(sheet: number, perSheet: number, pageCount: number): number[] {
  const first = sheet * perSheet
  const out: number[] = []
  for (let i = first; i < Math.min(pageCount, first + perSheet); i++) out.push(i)
  return out
}
