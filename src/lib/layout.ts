/**
 * Print-sheet packing. Pure, no DOM, no canvas — BUILD_PLAN §7.
 *
 * All geometry is in millimetres with the origin at the paper's top-left.
 * Rendering (canvas preview, PDF) converts to its own units; this module never
 * touches pixels, so the same numbers drive the on-screen preview and the PDF.
 */

import {
  DEFAULT_GAP_MM,
  PAPERS,
  PHOTO_PRESETS,
  type PackageItem,
  type PaperId,
  type PhotoPresetId,
} from './presets'

/**
 * Millimetre sizes are decimals like 215.9, so `(215.9 - 10 + 2) / 27.4` can
 * land a hair under an exact integer. Without this slack a photo that fits
 * precisely would be dropped.
 */
const EPS = 1e-6

export interface SizeMm {
  widthMm: number
  heightMm: number
}

export interface LayoutOptions {
  /** Defaults to the paper's own margin (3 mm on 4R, 5 mm elsewhere). */
  marginMm?: number
  gapMm?: number
  /** `'auto'` tries both photo orientations and keeps the better one. */
  orientation?: 'auto' | 'portrait' | 'landscape'
  /** Cap the count; `undefined` means "fill the sheet". */
  quantity?: number
}

export interface Placement {
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  /** True when the photo is turned 90 degrees to fit more per sheet. */
  rotated: boolean
  /** Which package item produced this cell; `0` for single-size fills. */
  itemIndex: number
}

export interface SheetLayout {
  paper: PaperId
  marginMm: number
  gapMm: number
  placements: Placement[]
  /** How many fit at most, before `quantity` was applied. */
  capacity: number
  cols: number
  rows: number
  rotated: boolean
}

function floorFit(available: number, step: number): number {
  if (step <= 0) return 0
  return Math.max(0, Math.floor(available / step + EPS))
}

/** Grid count for one photo orientation. */
function grid(
  printableW: number,
  printableH: number,
  w: number,
  h: number,
  gap: number,
): { cols: number; rows: number; count: number } {
  // A grid of n items needs n*size + (n-1)*gap, which rearranges to
  // floor((printable + gap) / (size + gap)).
  const cols = floorFit(printableW + gap, w + gap)
  const rows = floorFit(printableH + gap, h + gap)
  return { cols, rows, count: cols * rows }
}

export function photoSizeMm(presetId: PhotoPresetId, custom?: SizeMm): SizeMm {
  if (presetId === 'custom') {
    if (!custom) throw new Error('a custom preset needs an explicit size')
    return custom
  }
  const p = PHOTO_PRESETS[presetId]
  return { widthMm: p.widthMm, heightMm: p.heightMm }
}

/**
 * Single-size fill: try the photo both ways up, keep whichever yields more,
 * and centre the resulting grid on the paper.
 *
 * Rotating the *paper* is not tried because a grid's count is `cols * rows`,
 * which is unchanged when the paper's width and height swap. Only rotating the
 * photo can change the answer — and for Passport on 4R it changes 6 into 8.
 */
export function fillSheet(
  paperId: PaperId,
  photo: SizeMm,
  options: LayoutOptions = {},
): SheetLayout {
  const paper = PAPERS[paperId]
  const marginMm = options.marginMm ?? paper.defaultMarginMm
  const gapMm = options.gapMm ?? DEFAULT_GAP_MM
  const orientation = options.orientation ?? 'auto'

  const printableW = paper.widthMm - marginMm * 2
  const printableH = paper.heightMm - marginMm * 2

  const upright = grid(printableW, printableH, photo.widthMm, photo.heightMm, gapMm)
  const turned = grid(printableW, printableH, photo.heightMm, photo.widthMm, gapMm)

  let rotated: boolean
  if (orientation === 'portrait') rotated = false
  else if (orientation === 'landscape') rotated = true
  else rotated = turned.count > upright.count

  const chosen = rotated ? turned : upright
  const cellW = rotated ? photo.heightMm : photo.widthMm
  const cellH = rotated ? photo.widthMm : photo.heightMm

  const capacity = chosen.count
  const wanted =
    options.quantity === undefined ? capacity : Math.max(0, Math.min(options.quantity, capacity))

  // Centre the block of cells rather than hugging the top-left margin.
  const blockW = chosen.cols * cellW + Math.max(0, chosen.cols - 1) * gapMm
  const blockH = chosen.rows * cellH + Math.max(0, chosen.rows - 1) * gapMm
  const originX = (paper.widthMm - blockW) / 2
  const originY = (paper.heightMm - blockH) / 2

  const placements: Placement[] = []
  for (let i = 0; i < wanted; i++) {
    const col = i % chosen.cols
    const row = Math.floor(i / chosen.cols)
    placements.push({
      xMm: originX + col * (cellW + gapMm),
      yMm: originY + row * (cellH + gapMm),
      widthMm: cellW,
      heightMm: cellH,
      rotated,
      itemIndex: 0,
    })
  }

  return {
    paper: paperId,
    marginMm,
    gapMm,
    placements,
    capacity,
    cols: chosen.cols,
    rows: chosen.rows,
    rotated,
  }
}

/** Convenience for the "Fill sheet" label: how many of this size fit. */
export function capacity(
  paperId: PaperId,
  photo: SizeMm,
  options: LayoutOptions = {},
): number {
  return fillSheet(paperId, photo, { ...options, quantity: undefined }).capacity
}

export interface PackageRequest {
  presetId: PhotoPresetId
  qty: number
  /** Required when `presetId` is `'custom'`. */
  custom?: SizeMm
}

export interface PackageResult extends Omit<SheetLayout, 'capacity' | 'cols' | 'rows' | 'rotated'> {
  fits: boolean
  /** Items that could not be placed, so the UI can say what is missing. */
  unplaced: { presetId: PhotoPresetId; qty: number }[]
}

/**
 * Mixed sizes on one sheet — "4 pcs 1x1 + 2 pcs 2x2".
 *
 * Shelf packing, tallest first: fill a row left to right, and when the next
 * photo does not fit, start a new shelf below whose height is the tallest
 * photo on the previous one. It is not optimal, but it is stable and
 * predictable, which matters more than density when a customer is watching the
 * preview. Nothing is silently dropped: whatever does not fit comes back in
 * `unplaced` so the UI can offer a bigger paper.
 */
export function packPackage(
  paperId: PaperId,
  items: PackageRequest[],
  options: LayoutOptions = {},
): PackageResult {
  const paper = PAPERS[paperId]
  const marginMm = options.marginMm ?? paper.defaultMarginMm
  const gapMm = options.gapMm ?? DEFAULT_GAP_MM

  const printableW = paper.widthMm - marginMm * 2
  const printableH = paper.heightMm - marginMm * 2

  // Expand to individual photos, tallest first so tall items claim a shelf
  // before short ones fragment the sheet.
  const units = items
    .flatMap((item, itemIndex) => {
      const size = photoSizeMm(item.presetId, item.custom)
      return Array.from({ length: Math.max(0, item.qty) }, () => ({
        ...size,
        itemIndex,
        presetId: item.presetId,
      }))
    })
    .sort((a, b) => b.heightMm - a.heightMm || b.widthMm - a.widthMm)

  const placements: Placement[] = []
  const unplacedCounts = new Map<PhotoPresetId, number>()

  let shelfY = 0
  let shelfH = 0
  let cursorX = 0

  for (const unit of units) {
    const needsNewShelf = cursorX > 0 && cursorX + gapMm + unit.widthMm > printableW + EPS
    if (needsNewShelf) {
      shelfY += shelfH + gapMm
      shelfH = 0
      cursorX = 0
    }

    const x = cursorX === 0 ? 0 : cursorX + gapMm
    const fitsAcross = x + unit.widthMm <= printableW + EPS
    const fitsDown = shelfY + unit.heightMm <= printableH + EPS

    if (!fitsAcross || !fitsDown) {
      unplacedCounts.set(unit.presetId, (unplacedCounts.get(unit.presetId) ?? 0) + 1)
      continue
    }

    placements.push({
      xMm: marginMm + x,
      yMm: marginMm + shelfY,
      widthMm: unit.widthMm,
      heightMm: unit.heightMm,
      rotated: false,
      itemIndex: unit.itemIndex,
    })
    cursorX = x + unit.widthMm
    shelfH = Math.max(shelfH, unit.heightMm)
  }

  // Centre the packed block as a whole, matching fillSheet's look.
  if (placements.length > 0) {
    const usedRight = Math.max(...placements.map((p) => p.xMm + p.widthMm))
    const usedBottom = Math.max(...placements.map((p) => p.yMm + p.heightMm))
    const dx = (paper.widthMm - (usedRight - marginMm)) / 2 - marginMm
    const dy = (paper.heightMm - (usedBottom - marginMm)) / 2 - marginMm
    for (const p of placements) {
      p.xMm += dx
      p.yMm += dy
    }
  }

  return {
    paper: paperId,
    marginMm,
    gapMm,
    placements,
    fits: unplacedCounts.size === 0,
    unplaced: [...unplacedCounts].map(([presetId, qty]) => ({ presetId, qty })),
  }
}

/** Resolve a saved package preset's items into layout input. */
export function packageItemsToRequests(items: PackageItem[]): PackageRequest[] {
  return items.map((i) => ({ presetId: i.presetId, qty: i.qty }))
}

/**
 * Cut marks sit in the gaps and margins, never across a photo: short ticks
 * extending outward from each cell edge. 0.2 mm, gray (BUILD_PLAN §7).
 */
export interface CutMark {
  x1Mm: number
  y1Mm: number
  x2Mm: number
  y2Mm: number
}

export const CUT_MARK_WIDTH_MM = 0.2

export function cutMarks(layout: Pick<SheetLayout, 'placements' | 'gapMm'>): CutMark[] {
  const tick = Math.max(1.5, layout.gapMm)
  const marks: CutMark[] = []
  const seen = new Set<string>()

  const push = (m: CutMark) => {
    const key = `${m.x1Mm.toFixed(3)},${m.y1Mm.toFixed(3)},${m.x2Mm.toFixed(3)},${m.y2Mm.toFixed(3)}`
    if (!seen.has(key)) {
      seen.add(key)
      marks.push(m)
    }
  }

  for (const p of layout.placements) {
    const right = p.xMm + p.widthMm
    const bottom = p.yMm + p.heightMm
    for (const x of [p.xMm, right]) {
      push({ x1Mm: x, y1Mm: p.yMm - tick, x2Mm: x, y2Mm: p.yMm })
      push({ x1Mm: x, y1Mm: bottom, x2Mm: x, y2Mm: bottom + tick })
    }
    for (const y of [p.yMm, bottom]) {
      push({ x1Mm: p.xMm - tick, y1Mm: y, x2Mm: p.xMm, y2Mm: y })
      push({ x1Mm: right, y1Mm: y, x2Mm: right + tick, y2Mm: y })
    }
  }
  return marks
}
