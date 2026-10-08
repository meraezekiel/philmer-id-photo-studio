/**
 * Data only — every size, paper and swatch the app offers.
 *
 * BUILD_PLAN §6 and §7. Nothing here computes; keeping it declarative means a
 * new passport rule or paper size is a one-line change with no code to review.
 */

/** Working name, in one place so it can change later (BUILD_PLAN header). */
export const APP_NAME = 'Philmer ID Photo Studio'
export const VENDOR = 'Philmer Digi Art'

export const PRINT_DPI = 300
export const MM_PER_INCH = 25.4

export type PhotoPresetId = '1x1' | '2x2' | 'passport'

export interface PhotoPreset {
  id: PhotoPresetId
  label: string
  /** Secondary label, e.g. "25.4 x 25.4 mm - 1 x 1 in". */
  sublabel: string
  widthMm: number
  heightMm: number
  /**
   * Crown line: top of the photo to the top of the head, as a fraction of
   * photo height.
   */
  crownRatio: number
  /**
   * Chin band: where the chin may sit, as a fraction of photo height. The
   * guides read green inside this band and amber outside it.
   *
   * Stored as an absolute band rather than a head height because that is what
   * the overlay draws and what the operator drags a handle against; head
   * height is the derived quantity (see `headRatioRange`).
   */
  chinMin: number
  chinMax: number
  defaultBackground: string
  /** Passport rules are set by the agency, not by us. */
  lockBackgroundToWhite?: boolean
  allowNameTag: boolean
  /**
   * Whether the name strip starts switched on for this size. Philippine
   * passport photos are handed over with the name printed across the bottom,
   * so Passport starts on; the operator can switch it off for an agency that
   * wants the plain international format.
   */
  nameTagByDefault?: boolean
  note?: string
}

/**
 * Passport figures are the ICAO / PH DFA standard: 35 x 45 mm with a
 * 32-36 mm head, so 34/45 = 0.7556 nominal and 0.711-0.800 as the band. The
 * 4 mm top gap is 4/45.
 */
export const PHOTO_PRESETS: Record<PhotoPresetId, PhotoPreset> = {
  '1x1': {
    id: '1x1',
    label: '1x1',
    sublabel: '25.4 x 25.4 mm - 1 x 1 in',
    widthMm: 25.4,
    heightMm: 25.4,
    crownRatio: 0.1,
    chinMin: 0.7,
    chinMax: 0.8,
    defaultBackground: '#FFFFFF',
    allowNameTag: true,
  },
  '2x2': {
    id: '2x2',
    label: '2x2',
    sublabel: '50.8 x 50.8 mm - 2 x 2 in',
    widthMm: 50.8,
    heightMm: 50.8,
    crownRatio: 0.12,
    chinMin: 0.64,
    chinMax: 0.74,
    defaultBackground: '#FFFFFF',
    allowNameTag: true,
  },
  passport: {
    id: 'passport',
    label: 'Passport',
    sublabel: '35 x 45 mm - ICAO / PH DFA',
    widthMm: 35,
    heightMm: 45,
    crownRatio: 4 / 45,
    chinMin: (4 + 32) / 45,
    chinMax: (4 + 36) / 45,
    defaultBackground: '#FFFFFF',
    lockBackgroundToWhite: true,
    allowNameTag: true,
    nameTagByDefault: true,
    note: 'Check the latest requirements of the requesting agency.',
  },
}

export const PHOTO_PRESET_ORDER: PhotoPresetId[] = ['1x1', '2x2', 'passport']

export type PaperId = '3r' | '4r' | '5r' | '8r' | 'a4' | 'short' | 'long'
/** Papers the ID print sheet offers. */
export type SheetPaperId = '4r' | 'a4' | 'short' | 'long'
/** Papers Photo Print offers. */
export type EditPaperId = '3r' | '4r' | '5r' | '8r' | 'a4'

export interface PaperPreset {
  id: PaperId
  label: string
  sublabel: string
  widthMm: number
  heightMm: number
  /** 4R is borderless-ish photo stock; plain paper needs more (BUILD_PLAN §7). */
  defaultMarginMm: number
}

export const PAPERS: Record<PaperId, PaperPreset> = {
  '3r': {
    id: '3r',
    label: '3R',
    sublabel: '88.9 x 127 mm - 3.5 x 5 in',
    widthMm: 88.9,
    heightMm: 127,
    defaultMarginMm: 3,
  },
  '4r': {
    id: '4r',
    label: '4R',
    sublabel: '101.6 x 152.4 mm - 4 x 6 in',
    widthMm: 101.6,
    heightMm: 152.4,
    defaultMarginMm: 3,
  },
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
  a4: {
    id: 'a4',
    label: 'A4',
    sublabel: '210 x 297 mm',
    widthMm: 210,
    heightMm: 297,
    defaultMarginMm: 5,
  },
  short: {
    id: 'short',
    label: 'Short bond',
    sublabel: '215.9 x 279.4 mm - Letter',
    widthMm: 215.9,
    heightMm: 279.4,
    defaultMarginMm: 5,
  },
  long: {
    id: 'long',
    label: 'Long bond',
    sublabel: '215.9 x 330.2 mm - 8.5 x 13 in',
    widthMm: 215.9,
    heightMm: 330.2,
    defaultMarginMm: 5,
  },
}

export const PAPER_ORDER: SheetPaperId[] = ['4r', 'a4', 'short', 'long']

export const EDIT_PAPER_ORDER: EditPaperId[] = ['3r', '4r', '5r', '8r', 'a4']

/** Default spacing between tiled photos. */
export const DEFAULT_GAP_MM = 2

export interface Swatch {
  id: string
  label: string
  hex: string
}

export const BACKGROUND_SWATCHES: Swatch[] = [
  { id: 'white', label: 'White', hex: '#FFFFFF' },
  { id: 'blue', label: 'Blue', hex: '#1E5BC6' },
  { id: 'lightblue', label: 'Light Blue', hex: '#8EC5FF' },
  { id: 'red', label: 'Red', hex: '#C62828' },
  { id: 'lightgray', label: 'Light Gray', hex: '#E9E9E9' },
]

/** Shipped combos. Every one of these is asserted to fit in layout.test.ts. */
export interface PackageItem {
  presetId: PhotoPresetId
  qty: number
}

export interface PackagePreset {
  id: string
  label: string
  paper: PaperId
  items: PackageItem[]
}

export const PACKAGE_PRESETS: PackagePreset[] = [
  {
    id: '4r-combo',
    label: '4R Combo',
    paper: '4r',
    items: [
      { presetId: '2x2', qty: 2 },
      { presetId: '1x1', qty: 4 },
    ],
  },
  {
    id: 'a4-combo',
    label: 'A4 Combo',
    paper: 'a4',
    items: [
      { presetId: '2x2', qty: 4 },
      { presetId: '1x1', qty: 8 },
      { presetId: 'passport', qty: 4 },
    ],
  },
]
