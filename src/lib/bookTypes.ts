/**
 * The photo book as plain data: exactly what a `.photobook` file holds.
 * Runtime state (thumbnails, load progress, undo) lives in the store.
 */

import type { EnhanceSettings } from './enhance'
import type { CustomPaper, EditPaperChoice } from './editPaper'
import type { BookOrientation, BookSizeId } from './bookSizes'
import { NEUTRAL_ENHANCE } from './enhance'

/** A rectangle in fractions (0..1) of a photo's width and height. */
export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

/** A rectangle in millimetres, origin at the page's top-left trim corner. */
export interface RectMm {
  x: number
  y: number
  w: number
  h: number
}

export interface SizeMm {
  widthMm: number
  heightMm: number
}

/** Which part of the photo a frame shows: centre (0..1) and zoom (1 = cover). */
export interface Crop {
  cx: number
  cy: number
  zoom: number
}

export interface BookFrame {
  photoId: string | null
  crop: Crop
}

export interface BookPage {
  id: string
  layoutId: string
  frames: BookFrame[]
}

export interface BookPhoto {
  id: string
  path: string
  /** File name, for the tray and for relinking a moved folder. */
  name: string
  /** Upright (EXIF-corrected) size of the original, in pixels. */
  width: number
  height: number
  /** ISO date from EXIF, or null. */
  takenAt: string | null
  /** Largest face, in fractions of the photo, or null. */
  face: NormRect | null
  enhance: Required<EnhanceSettings>
}

export type BookFont = 'archivo' | 'playfair' | 'greatvibes'
export type CoverPosition = 'top' | 'middle' | 'bottom'

export interface BookCover {
  title: string
  subtitle: string
  font: BookFont
  textColor: string
  position: CoverPosition
}

export interface BookStyle {
  marginMm: number
  gapMm: number
  color: string
}

/** Inside pages; the cover is extra. */
export type PageCountTarget = 'auto' | number

export interface Book {
  version: 1
  size: BookSizeId
  orientation: BookOrientation
  paper: EditPaperChoice
  customPaper: CustomPaper
  style: BookStyle
  pageCount: PageCountTarget
  cover: BookCover | null
  photos: BookPhoto[]
  pages: BookPage[]
}

export const BOOK_VERSION = 1
export const PAGE_COUNT_OPTIONS = [20, 30, 40, 50] as const
export const STYLE_LIMITS = { marginMm: [0, 20], gapMm: [0, 10] } as const

export const WHITE_BORDER: BookStyle = { marginMm: 6, gapMm: 3, color: '#FFFFFF' }
export const EDGE_TO_EDGE: BookStyle = { marginMm: 0, gapMm: 1.5, color: '#FFFFFF' }

export const DEFAULT_COVER: BookCover = {
  title: '',
  subtitle: '',
  font: 'playfair',
  textColor: '#FFFFFF',
  position: 'bottom',
}

export function isEdgeToEdge(style: BookStyle): boolean {
  return style.marginMm === 0
}

const HEX = /^#[0-9a-f]{6}$/i

function clampNumber(value: number, [min, max]: readonly [number, number]): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function clampStyle(style: BookStyle): BookStyle {
  return {
    marginMm: clampNumber(style.marginMm, STYLE_LIMITS.marginMm),
    gapMm: clampNumber(style.gapMm, STYLE_LIMITS.gapMm),
    color: HEX.test(style.color) ? style.color : '#FFFFFF',
  }
}

export function newBook(): Book {
  return {
    version: BOOK_VERSION,
    size: '5x6',
    orientation: 'portrait',
    paper: 'a4',
    customPaper: { widthMm: 210, heightMm: 297 },
    style: WHITE_BORDER,
    pageCount: 'auto',
    cover: null,
    photos: [],
    pages: [],
  }
}

export const NEUTRAL_PHOTO_ENHANCE: Required<EnhanceSettings> = NEUTRAL_ENHANCE
