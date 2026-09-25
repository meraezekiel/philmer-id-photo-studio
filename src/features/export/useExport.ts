/**
 * Everything that turns the job into a file — BUILD_PLAN §8.
 *
 * All four outputs (single photo, sheet PDF, sheet image, print) build the
 * finished photo the same way: crop the full-resolution original and mask to
 * what Adjust framed, resample to the preset's exact pixel size, then
 * composite. Sharing that step is what keeps a printed sheet identical to the
 * single photo saved beside it.
 */

import { useCallback, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import { tempDir, join } from '@tauri-apps/api/path'

import { cropRotate, decodeToBitmap, encodeBitmap, resampleBitmap } from '../../lib/bitmap'
import { composite, type Bitmap } from '../../lib/composite'
import { defaultFileName, outputSizePx, setJpegDpi, setPngDpi } from '../../lib/dpi'
import { buildSheetPdf, renderSheetBitmap, type SheetSpec } from '../../lib/sheetPdf'
import { PHOTO_PRESETS, PRINT_DPI } from '../../lib/presets'
import { getImageBytes, printSheet, saveFile, segment } from '../../lib/tauri'
import { useJob } from '../../store/job'
import { useSheetLayout } from '../sheet/useSheetLayout'

export type ExportPhase =
  | { phase: 'idle' }
  | { phase: 'working'; message: string }
  | { phase: 'done'; message: string; path: string }
  | { phase: 'failed'; message: string }

export function useExport() {
  const info = useJob((s) => s.info)
  const presetId = useJob((s) => s.presetId)
  const cropRect = useJob((s) => s.cropRect)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const quality = useJob((s) => s.quality)
  const showCutMarks = useJob((s) => s.cutMarks)
  const showBorders = useJob((s) => s.photoBorders)
  const sheet = useSheetLayout()

  const [state, setState] = useState<ExportPhase>({ phase: 'idle' })
  const preset = PHOTO_PRESETS[presetId]
  const outputPx = outputSizePx(preset.widthMm, preset.heightMm)

  /** The finished photo at exactly the preset's print pixels. */
  const buildPhoto = useCallback(
    async (report: (message: string) => void): Promise<Bitmap> => {
      if (!info) throw new Error('no photo is loaded')

      report('Fetching the full-resolution photo…')
      const [imageBytes, maskBytes] = await Promise.all([
        getImageBytes({ id: info.id, maxDim: 0, format: 'png' }),
        segment({ id: info.id, model: quality }),
      ])

      report('Decoding…')
      const [fullImage, fullMask] = await Promise.all([
        decodeToBitmap(imageBytes, 'image/png'),
        decodeToBitmap(maskBytes, 'image/png'),
      ])

      report('Cropping…')
      const croppedImage = cropRect ? cropRotate(fullImage, cropRect, cropRect.rotationDeg) : fullImage
      const croppedMask = cropRect ? cropRotate(fullMask, cropRect, cropRect.rotationDeg) : fullMask

      report('Resampling to 300 DPI…')
      const [image, mask] = await Promise.all([
        resampleBitmap(croppedImage, outputPx.width, outputPx.height),
        resampleBitmap(croppedMask, outputPx.width, outputPx.height),
      ])

      report('Replacing the background…')
      return composite({ image, mask, background, edgeSoftness, hairDetail })
    },
    [info, quality, cropRect, outputPx.width, outputPx.height, background, edgeSoftness, hairDetail],
  )

  const sheetSpec = useCallback(
    (): SheetSpec => ({
      paperWidthMm: sheet.paperWidthMm,
      paperHeightMm: sheet.paperHeightMm,
      marginMm: sheet.marginMm,
      gapMm: sheet.gapMm,
      // The visible ones: a photo the operator deleted from the sheet must
      // not reappear in the PDF, the JPEG or the print.
      placements: sheet.visible,
      showCutMarks,
      showBorders,
    }),
    [sheet, showCutMarks, showBorders],
  )

  const run = useCallback(
    async (task: (report: (m: string) => void) => Promise<{ message: string; path: string } | null>) => {
      try {
        const report = (message: string) => setState({ phase: 'working', message })
        const result = await task(report)
        if (result) setState({ phase: 'done', ...result })
        else setState({ phase: 'idle' })
      } catch (error) {
        setState({
          phase: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [],
  )

  /** A single photo, JPG or PNG, at the preset's exact size and 300 DPI. */
  const savePhoto = useCallback(
    (format: 'jpeg' | 'png') =>
      run(async (report) => {
        const extension = format === 'jpeg' ? 'jpg' : 'png'
        const path = await save({
          defaultPath: defaultFileName(preset.label, extension),
          filters: [{ name: format === 'jpeg' ? 'JPEG' : 'PNG', extensions: [extension] }],
        })
        if (!path) return null

        const photo = await buildPhoto(report)
        report('Encoding…')
        const encoded = await encodeBitmap(
          photo,
          format === 'jpeg' ? 'image/jpeg' : 'image/png',
          0.95,
        )
        // Pixels alone do not make a 300 DPI print; the file has to say so.
        const stamped =
          format === 'jpeg' ? setJpegDpi(encoded, PRINT_DPI) : setPngDpi(encoded, PRINT_DPI)
        await saveFile({ path, bytes: stamped.buffer as ArrayBuffer })
        return { message: `Saved ${outputPx.width} × ${outputPx.height} px at 300 DPI`, path }
      }),
    [run, preset.label, buildPhoto, outputPx.width, outputPx.height],
  )

  const saveSheetPdf = useCallback(
    () =>
      run(async (report) => {
        const path = await save({
          defaultPath: defaultFileName(`${preset.label}sheet`, 'pdf'),
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        if (!path) return null

        const photo = await buildPhoto(report)
        report('Laying out the sheet…')
        const png = await encodeBitmap(photo, 'image/png')
        const pdf = await buildSheetPdf(sheetSpec(), png)
        await saveFile({ path, bytes: pdf.buffer as ArrayBuffer })
        return { message: `Saved a ${sheet.count}-photo sheet`, path }
      }),
    [run, preset.label, buildPhoto, sheetSpec, sheet.count],
  )

  const saveSheetImage = useCallback(
    (format: 'jpeg' | 'png') =>
      run(async (report) => {
        const extension = format === 'jpeg' ? 'jpg' : 'png'
        const path = await save({
          defaultPath: defaultFileName(`${preset.label}sheet`, extension),
          filters: [{ name: format === 'jpeg' ? 'JPEG' : 'PNG', extensions: [extension] }],
        })
        if (!path) return null

        const photo = await buildPhoto(report)
        report('Rendering the sheet at 300 DPI…')
        const sheetBitmap = await renderSheetBitmap(sheetSpec(), photo)
        const encoded = await encodeBitmap(
          sheetBitmap,
          format === 'jpeg' ? 'image/jpeg' : 'image/png',
          0.95,
        )
        const stamped =
          format === 'jpeg' ? setJpegDpi(encoded, PRINT_DPI) : setPngDpi(encoded, PRINT_DPI)
        await saveFile({ path, bytes: stamped.buffer as ArrayBuffer })
        return { message: `Saved a ${sheet.count}-photo sheet at 300 DPI`, path }
      }),
    [run, preset.label, buildPhoto, sheetSpec, sheet.count],
  )

  /**
   * Print by writing the PDF to temp and handing it to the system viewer.
   *
   * `window.print()` is not used on purpose: WebView2's scaling is unreliable
   * for physical sizing, and a 2x2 that prints at 48 mm is worthless.
   */
  const print = useCallback(
    () =>
      run(async (report) => {
        const photo = await buildPhoto(report)
        report('Laying out the sheet…')
        const png = await encodeBitmap(photo, 'image/png')
        const pdf = await buildSheetPdf(sheetSpec(), png)

        const dir = await tempDir()
        const path = await join(dir, defaultFileName(`${preset.label}sheet`, 'pdf'))
        await saveFile({ path, bytes: pdf.buffer as ArrayBuffer })

        report('Opening the PDF viewer…')
        await openPath(path)
        return { message: 'Opened in your PDF viewer', path }
      }),
    [run, buildPhoto, sheetSpec, preset.label],
  )

  /**
   * Print straight to the printer, with no viewer in between.
   *
   * The sheet is rasterised at 300 DPI and handed to Rust, which draws it onto
   * the printer's device context at a size derived from the device's own DPI.
   * Nothing along that path is free to scale it to fit.
   */
  const printDirect = useCallback(
    async (request: { copies: number; printer?: string }) => {
      const photo = await buildPhoto(() => {})
      const spec = sheetSpec()
      const sheetBitmap = await renderSheetBitmap(spec, photo)
      const png = await encodeBitmap(sheetBitmap, 'image/png')
      await printSheet({
        printer: request.printer,
        png: png.buffer as ArrayBuffer,
        widthMm: spec.paperWidthMm,
        heightMm: spec.paperHeightMm,
        copies: request.copies,
        jobName: `ID photos ${preset.label}`,
      })
    },
    [buildPhoto, sheetSpec, preset.label],
  )

  return {
    state,
    printDirect,
    dismiss: () => setState({ phase: 'idle' }),
    outputPx,
    sheet,
    savePhoto,
    saveSheetPdf,
    saveSheetImage,
    print,
  }
}
