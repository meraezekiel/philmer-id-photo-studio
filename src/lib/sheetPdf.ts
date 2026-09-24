/**
 * Print sheet output — BUILD_PLAN §8.
 *
 * The whole point of this file is that a 2x2 comes out of the printer measuring
 * 50.8 mm. That means the page is declared in exact millimetres (converted to
 * PDF points), each photo is placed at its exact millimetre position, and the
 * embedded image is a 300 DPI bitmap scaled to that box — never the other way
 * round.
 *
 * `window.print()` is deliberately not used: WebView2's scaling is unreliable
 * for physical sizing, so the sheet is written as a PDF and opened in the
 * system viewer, where "Actual size" is a real setting.
 */

import { PDFDocument, rgb } from 'pdf-lib'

import type { Bitmap } from './composite'
import { mmToPoints, mmToPx } from './dpi'
import { CUT_MARK_WIDTH_MM, cutMarks, type Placement } from './layout'
import { PRINT_DPI } from './presets'

export interface SheetSpec {
  paperWidthMm: number
  paperHeightMm: number
  marginMm: number
  gapMm: number
  placements: Placement[]
  showCutMarks: boolean
}

/** Cut marks are a faint grey so they guide the blade without printing boldly. */
const CUT_MARK_GREY = 0.62

/**
 * Build the sheet PDF.
 *
 * `photoPng` must already be the finished photo at print resolution; every
 * placement draws the same bitmap, so the encode happens once no matter how
 * many copies are tiled.
 */
export async function buildSheetPdf(
  spec: SheetSpec,
  photoPng: Uint8Array,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('ID photo sheet')
  doc.setProducer('Philmer ID Photo Studio')
  doc.setCreator('Philmer ID Photo Studio')

  const pageWidth = mmToPoints(spec.paperWidthMm)
  const pageHeight = mmToPoints(spec.paperHeightMm)
  const page = doc.addPage([pageWidth, pageHeight])

  const image = await doc.embedPng(photoPng)

  for (const placement of spec.placements) {
    const w = mmToPoints(placement.widthMm)
    const h = mmToPoints(placement.heightMm)
    const x = mmToPoints(placement.xMm)
    // PDF's origin is bottom-left; the layout works top-left.
    const y = pageHeight - mmToPoints(placement.yMm) - h

    if (placement.rotated) {
      // A rotated cell is the photo turned 90 degrees inside its box. Rotating
      // about the bottom-left corner means the box has to be re-anchored.
      page.drawImage(image, {
        x: x + w,
        y,
        width: h,
        height: w,
        rotate: { type: 'degrees', angle: 90 } as never,
      })
    } else {
      page.drawImage(image, { x, y, width: w, height: h })
    }
  }

  if (spec.showCutMarks) {
    const grey = rgb(CUT_MARK_GREY, CUT_MARK_GREY, CUT_MARK_GREY)
    const thickness = mmToPoints(CUT_MARK_WIDTH_MM)
    for (const mark of cutMarks({ placements: spec.placements, gapMm: spec.gapMm })) {
      page.drawLine({
        start: { x: mmToPoints(mark.x1Mm), y: pageHeight - mmToPoints(mark.y1Mm) },
        end: { x: mmToPoints(mark.x2Mm), y: pageHeight - mmToPoints(mark.y2Mm) },
        thickness,
        color: grey,
      })
    }
  }

  return doc.save()
}

/**
 * Rasterise the sheet at 300 DPI, for shops that would rather hand the printer
 * a JPEG than a PDF.
 */
export function sheetPixelSize(spec: SheetSpec): { width: number; height: number } {
  return {
    width: mmToPx(spec.paperWidthMm, PRINT_DPI),
    height: mmToPx(spec.paperHeightMm, PRINT_DPI),
  }
}

/**
 * Draw the sheet into a bitmap at print resolution.
 *
 * Kept separate from the PDF path so both are driven by the same placements —
 * the preview, the PDF and the JPEG can never disagree about where a photo sits.
 */
export async function renderSheetBitmap(
  spec: SheetSpec,
  photo: Bitmap,
): Promise<ImageData> {
  const { width, height } = sheetPixelSize(spec)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('could not get a 2D context')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const source = new OffscreenCanvas(photo.width, photo.height)
  const sourceCtx = source.getContext('2d')
  if (!sourceCtx) throw new Error('could not get a 2D context')
  sourceCtx.putImageData(new ImageData(photo.data, photo.width, photo.height), 0, 0)

  const toPx = (mm: number) => (mm / 25.4) * PRINT_DPI

  for (const placement of spec.placements) {
    const x = toPx(placement.xMm)
    const y = toPx(placement.yMm)
    const w = toPx(placement.widthMm)
    const h = toPx(placement.heightMm)
    if (placement.rotated) {
      ctx.save()
      ctx.translate(x + w, y)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(source, 0, 0, h, w)
      ctx.restore()
    } else {
      ctx.drawImage(source, x, y, w, h)
    }
  }

  if (spec.showCutMarks) {
    ctx.strokeStyle = `rgb(${Math.round(CUT_MARK_GREY * 255)}, ${Math.round(
      CUT_MARK_GREY * 255,
    )}, ${Math.round(CUT_MARK_GREY * 255)})`
    ctx.lineWidth = Math.max(1, toPx(CUT_MARK_WIDTH_MM))
    ctx.beginPath()
    for (const mark of cutMarks({ placements: spec.placements, gapMm: spec.gapMm })) {
      ctx.moveTo(toPx(mark.x1Mm), toPx(mark.y1Mm))
      ctx.lineTo(toPx(mark.x2Mm), toPx(mark.y2Mm))
    }
    ctx.stroke()
  }

  return ctx.getImageData(0, 0, width, height)
}
