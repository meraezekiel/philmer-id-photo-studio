/**
 * The name strip printed inside the bottom of the photo.
 *
 * Philippine passport and ID photos are handed over with the holder's name
 * across the bottom of the print — "SURNAME, FIRST MIDDLE" in bold caps on a
 * white band — so it is on by default for Passport here, against the ICAO
 * assumption in BUILD_PLAN §5.3 that a strip would invalidate the photo. It
 * can be switched off for anyone who needs the plain international format.
 *
 * The band sits *inside* the photo rather than extending it: a 35 x 45 mm
 * photo with a name is still 35 x 45 mm, which is what the cutter and the
 * agency both expect.
 */

export interface NameTag {
  enabled: boolean
  text: string
  /** Type size as a fraction of the photo's height. */
  fontSizeRatio: number
  fontFamily: string
  bold: boolean
  italic: boolean
  uppercase: boolean
  color: string
  background: string
}

export const DEFAULT_NAME_TAG: NameTag = {
  enabled: false,
  text: '',
  fontSizeRatio: 0.062,
  fontFamily: 'Arial',
  bold: true,
  italic: false,
  uppercase: true,
  color: '#000000',
  background: '#FFFFFF',
}

/** Fonts every Windows counter machine has, plus the app's own. */
export const NAME_TAG_FONTS = [
  { id: 'Arial', label: 'Arial' },
  { id: 'Archivo', label: 'Archivo' },
  { id: 'Tahoma', label: 'Tahoma' },
  { id: 'Times New Roman', label: 'Times' },
  { id: 'Courier New', label: 'Courier' },
]

export const NAME_TAG_SIZE_RANGE = { min: 0.03, max: 0.12 }

/** Clear space at each end of the band, as a fraction of the photo's width. */
const SIDE_PADDING_RATIO = 0.05
/** Band height as a multiple of the type size: enough to sit the caps in. */
const BAND_TO_FONT = 1.75

export interface NameTagLayout {
  /** The text as it will be drawn, cased and trimmed. */
  text: string
  fontPx: number
  bandY: number
  bandHeight: number
  /** Vertical centre of the band, for a middle baseline. */
  centreY: number
  maxTextWidth: number
}

/**
 * Where the band and its text go, in pixels of the finished photo.
 *
 * `measure` is passed in rather than measured here so the geometry stays
 * testable without a canvas; without it the type keeps its asked-for size.
 */
export function nameTagLayout(
  width: number,
  height: number,
  tag: NameTag,
  measure?: (text: string, fontPx: number) => number,
): NameTagLayout | null {
  const text = (tag.uppercase ? tag.text.toUpperCase() : tag.text).trim()
  if (!tag.enabled || text === '' || width <= 0 || height <= 0) return null

  const asked = Math.max(1, tag.fontSizeRatio * height)
  const bandHeight = Math.min(height, Math.round(asked * BAND_TO_FONT))
  const maxTextWidth = Math.max(1, width * (1 - SIDE_PADDING_RATIO * 2))

  // A long name shrinks to fit the width instead of running off the photo.
  // The band keeps its height, so a row of prints still looks like a set.
  let fontPx = asked
  if (measure) {
    const drawn = measure(text, asked)
    if (drawn > maxTextWidth) fontPx = Math.max(1, (asked * maxTextWidth) / drawn)
  }

  const bandY = height - bandHeight
  return { text, fontPx, bandY, bandHeight, centreY: bandY + bandHeight / 2, maxTextWidth }
}

/** A CSS font shorthand, for both the canvas and the panel's preview strip. */
export function nameTagFont(tag: NameTag, fontPx: number): string {
  const style = tag.italic ? 'italic ' : ''
  const weight = tag.bold ? '700' : '400'
  return `${style}${weight} ${fontPx}px "${tag.fontFamily}", Arial, sans-serif`
}
