/**
 * Everything that leaves the app: the approval PDF, the print PDF, JPGs and
 * printing. Sheets and pages are rendered one at a time and handed on at
 * once, so memory stays flat however long the book is.
 */

import { PDFDocument } from 'pdf-lib'

import { pageDraw } from '../../lib/bookDraw'
import { sheetCount } from '../../lib/bookSheets'
import type { Book } from '../../lib/bookTypes'
import { mmToPoints, setJpegDpi } from '../../lib/dpi'
import { PRINT_DPI } from '../../lib/presets'
import { bookClearStaged, bookStageSheet, printSheets, saveFile } from '../../lib/tauri'
import { canvasBytes, pageLabel, printSource, renderPage, renderSheet } from './bookPaint'
import { bookPlan } from './bookPipeline'

export const APPROVAL_DPI = 150

export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
  }
}

export interface Progress {
  report: (message: string) => void
  cancelled: () => boolean
}

function check(p: Progress) {
  if (p.cancelled()) throw new Cancelled()
}

export function pageFileName(book: Book, index: number): string {
  const label = pageLabel(book, index)
  if (label === 'Cover') return 'cover.jpg'
  const inside = book.pages.length - (book.pages[0]?.layoutId === 'cover' ? 1 : 0)
  return `page-${label.padStart(Math.max(2, String(inside).length), '0')}.jpg`
}

export function bookIssues(book: Book, missing: ReadonlySet<string>): { empty: number; lowRes: number; missing: number } {
  let empty = 0
  let lowRes = 0
  let gone = 0
  for (const page of book.pages) {
    for (const f of pageDraw(book, page, { missing }).frames) {
      if (!f.photoId) empty++
      else if (f.missing) gone++
      else if (f.lowRes) lowRes++
    }
  }
  return { empty, lowRes, missing: gone }
}

export async function exportApprovalPdf(book: Book, missing: ReadonlySet<string>, path: string, p: Progress): Promise<void> {
  const doc = await PDFDocument.create()
  doc.setTitle(book.cover?.title || 'Photo book')
  doc.setProducer('Philmer ID Photo Studio')
  for (let i = 0; i < book.pages.length; i++) {
    check(p)
    p.report(`Page ${i + 1} / ${book.pages.length}`)
    const canvas = await renderPage(book, i, { dpi: APPROVAL_DPI, source: printSource(book), preview: false, missing })
    const image = await doc.embedJpg(await canvasBytes(canvas, 'image/jpeg', 0.85))
    const w = mmToPoints((canvas.width / APPROVAL_DPI) * 25.4)
    const h = mmToPoints((canvas.height / APPROVAL_DPI) * 25.4)
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h })
  }
  const bytes = await doc.save()
  await saveFile({ path, bytes: bytes.buffer as ArrayBuffer })
}

export async function exportPrintPdf(book: Book, missing: ReadonlySet<string>, path: string, p: Progress): Promise<void> {
  const plan = bookPlan(book)
  if (!plan.ok) throw new Error(plan.message)
  const doc = await PDFDocument.create()
  doc.setTitle(`${book.cover?.title || 'Photo book'} (print sheets)`)
  doc.setProducer('Philmer ID Photo Studio')
  const count = sheetCount(book.pages.length, plan.perSheet)
  for (let s = 0; s < count; s++) {
    check(p)
    p.report(`Sheet ${s + 1} / ${count}`)
    const canvas = await renderSheet(book, plan, s, { dpi: PRINT_DPI, source: printSource(book), preview: false, missing })
    const image = await doc.embedJpg(await canvasBytes(canvas, 'image/jpeg', 0.92))
    const w = mmToPoints(plan.paper.widthMm)
    const h = mmToPoints(plan.paper.heightMm)
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h })
  }
  const bytes = await doc.save()
  await saveFile({ path, bytes: bytes.buffer as ArrayBuffer })
}

export async function exportJpgs(book: Book, missing: ReadonlySet<string>, folder: string, p: Progress, onSaved?: (count: number) => void): Promise<number> {
  const sep = folder.includes('\\') ? '\\' : '/'
  for (let i = 0; i < book.pages.length; i++) {
    check(p)
    p.report(`Page ${i + 1} / ${book.pages.length}`)
    const canvas = await renderPage(book, i, { dpi: PRINT_DPI, source: printSource(book), preview: false, missing })
    const bytes = setJpegDpi(await canvasBytes(canvas, 'image/jpeg', 0.95), PRINT_DPI)
    await saveFile({ path: `${folder.replace(/[\\/]$/, '')}${sep}${pageFileName(book, i)}`, bytes: bytes.buffer as ArrayBuffer })
    onSaved?.(i + 1)
  }
  return book.pages.length
}

/** Sheets `from`..`to` (0-based, inclusive), as one print job. */
export async function printBook(
  book: Book,
  missing: ReadonlySet<string>,
  range: { from: number; to: number },
  request: { printer?: string; copies: number },
  p: Progress,
): Promise<void> {
  const plan = bookPlan(book)
  if (!plan.ok) throw new Error(plan.message)
  const count = sheetCount(book.pages.length, plan.perSheet)
  const from = Math.max(0, Math.min(range.from, count - 1))
  const to = Math.max(from, Math.min(range.to, count - 1))
  await bookClearStaged()
  try {
    const paths: string[] = []
    for (let s = from; s <= to; s++) {
      check(p)
      p.report(`Preparing sheet ${s + 1} / ${to + 1}`)
      const canvas = await renderSheet(book, plan, s, { dpi: PRINT_DPI, source: printSource(book), preview: false, missing })
      const bytes = await canvasBytes(canvas, 'image/jpeg', 0.95)
      paths.push(await bookStageSheet(s, bytes.buffer as ArrayBuffer))
    }
    check(p)
    p.report('Sending to the printer…')
    await printSheets({
      printer: request.printer,
      paths,
      widthMm: plan.paper.widthMm,
      heightMm: plan.paper.heightMm,
      copies: request.copies,
      jobName: `Photo book ${book.cover?.title || ''}`.trim(),
    })
  } finally {
    await bookClearStaged().catch(() => {})
  }
}
