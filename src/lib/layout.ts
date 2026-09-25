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
  /**
   * Nudge the whole block, in millimetres, from its top-left anchor. This is
   * what the drag on the sheet preview writes.
   */
  offsetXMm?: number
  offsetYMm?: number
  /**
   * Turn the *paper* sideways. For a uniform grid this cannot change the count
   * (`cols * rows` is symmetric under swapping the paper's sides), but for a
   * mixed-size package it very much can, because shelf packing is not.
   */
  paperLandscape?: boolean
}

/** Paper dimensions, honouring `paperLandscape`. */
function paperSize(paperId: PaperId, landscape: boolean): { widthMm: number; heightMm: number } {
  const paper = PAPERS[paperId]
  return landscape
    ? { widthMm: paper.heightMm, heightMm: paper.widthMm }
    : { widthMm: paper.widthMm, heightMm: paper.heightMm }
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
  /** True when the *photo* is turned sideways in its cell. */
  rotated: boolean
  /** True when the *paper* is turned sideways. */
  paperLandscape: boolean
  /** The paper size actually used, after any orientation swap. */
  paperWidthMm: number
  paperHeightMm: number
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
  const marginMm = options.marginMm ?? PAPERS[paperId].defaultMarginMm
  const gapMm = options.gapMm ?? DEFAULT_GAP_MM
  const orientation = options.orientation ?? 'auto'
  const paperLandscape = options.paperLandscape ?? false
  const paper = paperSize(paperId, paperLandscape)

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

  // Anchor at the top-left of the printable area. Starting at the top is what
  // the shop wants: you cut from the top down and whatever paper is left over
  // stays in one usable piece, instead of being stranded above and below a
  // centred block.
  const originX = marginMm + (options.offsetXMm ?? 0)
  const originY = marginMm + (options.offsetYMm ?? 0)

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
    paperLandscape,
    paperWidthMm: paper.widthMm,
    paperHeightMm: paper.heightMm,
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

export interface PackageResult
  extends Omit<SheetLayout, 'capacity' | 'cols' | 'rows' | 'rotated'> {
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
  const marginMm = options.marginMm ?? PAPERS[paperId].defaultMarginMm
  const gapMm = options.gapMm ?? DEFAULT_GAP_MM
  const paperLandscape = options.paperLandscape ?? false
  const paper = paperSize(paperId, paperLandscape)

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

  // Shift the packed block by the operator's drag. The pack itself already
  // starts at the top-left margin, which is where a cutting job wants it.
  const dx = options.offsetXMm ?? 0
  const dy = options.offsetYMm ?? 0
  if (dx !== 0 || dy !== 0) {
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
    paperLandscape,
    paperWidthMm: paper.widthMm,
    paperHeightMm: paper.heightMm,
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

/**
 * Hairline rule drawn on each photo's edge so the blade has a line to follow.
 *
 * 0.25 mm is about 3 px at 300 DPI: the thinnest that still reads clearly on
 * paper under counter lighting. It straddles the cut boundary, so it costs the
 * photo about an eighth of a millimetre — invisible at ID sizes.
 */
export const PHOTO_BORDER_MM = 0.25

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

export type PaperOrientation = 'auto' | 'portrait' | 'landscape'

/**
 * Pick the paper orientation, then lay out.
 *
 * `auto` prefers whichever way round fits more photos — for a package, whichever
 * leaves fewest unplaced. The design does the same, and it matters: a uniform
 * grid is symmetric under swapping the paper's sides, but shelf packing is not,
 * so a package that overflows a portrait sheet can fit the same sheet sideways.
 */
export function fillSheetAuto(
  paperId: PaperId,
  photo: SizeMm,
  orientation: PaperOrientation,
  options: LayoutOptions = {},
): SheetLayout {
  if (orientation !== 'auto') {
    return fillSheet(paperId, photo, { ...options, paperLandscape: orientation === 'landscape' })
  }
  const portrait = fillSheet(paperId, photo, { ...options, paperLandscape: false })
  const landscape = fillSheet(paperId, photo, { ...options, paperLandscape: true })
  return landscape.capacity > portrait.capacity ? landscape : portrait
}

export function packPackageAuto(
  paperId: PaperId,
  items: PackageRequest[],
  orientation: PaperOrientation,
  options: LayoutOptions = {},
): PackageResult {
  if (orientation !== 'auto') {
    return packPackage(paperId, items, {
      ...options,
      paperLandscape: orientation === 'landscape',
    })
  }
  const portrait = packPackage(paperId, items, { ...options, paperLandscape: false })
  if (portrait.fits) return portrait
  const landscape = packPackage(paperId, items, { ...options, paperLandscape: true })
  if (landscape.fits) return landscape
  // Neither fits: keep the one that placed more, so the warning names the
  // smallest possible shortfall.
  return landscape.placements.length > portrait.placements.length ? landscape : portrait
}

/** Total photos a package asks for, for the "3 of 8 don't fit" message. */
export function requestedCount(items: PackageRequest[]): number {
  return items.reduce((n, i) => n + Math.max(0, i.qty), 0)
}

/**
 * Deleting photos off the sheet is an edit to the order.
 *
 * Every placement carries the package row it came from, so removing photos
 * means asking for that many fewer of that size. The alternative — hiding
 * individual slots — leaves the order saying 14 while the sheet shows 8, and
 * the next touch of the quantity box brings the hidden ones back.
 *
 * A row that reaches zero is dropped: an order line for nothing is noise.
 */
export function reduceRequest<T extends { qty: number }>(
  rows: T[],
  removedItemIndices: number[],
): T[] {
  const perRow = new Map<number, number>()
  for (const i of removedItemIndices) perRow.set(i, (perRow.get(i) ?? 0) + 1)
  return rows
    .map((row, i) => ({ ...row, qty: Math.max(0, row.qty - (perRow.get(i) ?? 0)) }))
    .filter((row) => row.qty > 0)
}
