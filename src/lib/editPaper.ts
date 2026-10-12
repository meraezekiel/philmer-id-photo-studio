/**
 * Photo Print's paper: one of the presets, or a size the operator types in
 * for stock the presets do not cover. Stored in millimetres; shown in
 * millimetres or inches.
 */

import { EDIT_PAPER_ORDER, MM_PER_INCH, PAPERS, type EditPaperId } from './presets'

export type EditPaperChoice = EditPaperId | 'custom'
export type LengthUnit = 'mm' | 'in'

export interface CustomPaper {
  widthMm: number
  heightMm: number
}

/** Smaller than a wallet photo or larger than A3+ is a typing mistake. */
export const CUSTOM_PAPER_MIN_MM = 25
export const CUSTOM_PAPER_MAX_MM = 500

export const EDIT_PAPER_CHOICES: EditPaperChoice[] = [...EDIT_PAPER_ORDER, 'custom']

export interface EditPaper {
  label: string
  sublabel: string
  /** For sentences such as "match <longLabel>" in the print dialog. */
  longLabel: string
  widthMm: number
  heightMm: number
}

/** A length in the unit, rounded for display: 0.1 mm or 0.01 in. */
export function formatLength(mm: number, unit: LengthUnit): string {
  const value = unit === 'mm' ? Math.round(mm * 10) / 10 : Math.round((mm / MM_PER_INCH) * 100) / 100
  return String(value)
}

/** "127 x 177.8 mm - 5 x 7 in", the same form as the presets. */
export function sizeSublabel(widthMm: number, heightMm: number): string {
  const mm = `${formatLength(widthMm, 'mm')} x ${formatLength(heightMm, 'mm')} mm`
  const inch = `${formatLength(widthMm, 'in')} x ${formatLength(heightMm, 'in')} in`
  return `${mm} - ${inch}`
}

/** A typed length in millimetres, or null when it is not a usable paper side. */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  const mm = unit === 'in' ? value * MM_PER_INCH : value
  return mm >= CUSTOM_PAPER_MIN_MM && mm <= CUSTOM_PAPER_MAX_MM ? mm : null
}

export function editPaper(choice: EditPaperChoice, custom: CustomPaper): EditPaper {
  if (choice === 'custom') {
    const sublabel = sizeSublabel(custom.widthMm, custom.heightMm)
    return { label: 'Custom', sublabel, longLabel: `custom paper, ${sublabel}`, ...custom }
  }
  const p = PAPERS[choice]
  return { label: p.label, sublabel: p.sublabel, longLabel: p.label, widthMm: p.widthMm, heightMm: p.heightMm }
}
