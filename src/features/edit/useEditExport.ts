/**
 * Photo Print's outputs. Save keeps the full original resolution; print works
 * from a copy fetched at the size it will print, so a 24 MP photo is never
 * composited just to fill a 4R.
 */

import { useCallback, useMemo, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'

import { coverFit, decodeToBitmap, encodeBitmap, renderOnPaper, resampleBitmap } from '../../lib/bitmap'
import { composite, compositeInStrips, type Bitmap, type CompositeBackground } from '../../lib/composite'
import { editedFileName, setJpegDpi, setPngDpi } from '../../lib/dpi'
import { applyEnhance, applyEnhanceInStrips } from '../../lib/enhance'
import { placeOnPaper } from '../../lib/fitToPaper'
import { PAPERS, PRINT_DPI } from '../../lib/presets'
import { getImageBytes, printSheet, saveFile, segment } from '../../lib/tauri'
import { needsMask, useEdit } from '../../store/edit'
import type { ExportPhase } from '../export/useExport'
import type { PrintRequest } from '../sheet/PrintDialog'

export function useEditExport() {
  const preview = useEdit((s) => s.preview)
  const paper = useEdit((s) => s.paper)
  const paperFit = useEdit((s) => s.paperFit)
  const orientation = useEdit((s) => s.orientation)
  const [state, setState] = useState<ExportPhase>({ phase: 'idle' })

  // Placement from the preview's shape; the preview is the oriented photo.
  const placement = useMemo(
    () => (preview ? placeOnPaper(preview, PAPERS[paper], paperFit, orientation) : null),
    [preview, paper, paperFit, orientation],
  )

  /** The finished photo, from a copy at most `maxDim` on its long edge (0 = original). */
  const build = useCallback(async (maxDim: number, report: (m: string) => void): Promise<Bitmap> => {
    const s = useEdit.getState()
    if (!s.info) throw new Error('no photo is loaded')
    report('Fetching the photo…')
    const image = await decodeToBitmap(
      await getImageBytes({ id: s.info.id, maxDim, format: 'png' }),
      'image/png',
    )
    if (!needsMask(s.backgroundMode)) {
      report('Enhancing…')
      return maxDim === 0 ? applyEnhanceInStrips(image, s.enhance) : applyEnhance(image, s.enhance)
    }
    report('Fetching the cutout…')
    const fullMask = await decodeToBitmap(await segment({ id: s.info.id, model: s.quality }), 'image/png')
    const mask = await resampleBitmap(fullMask, image.width, image.height)
    let background: CompositeBackground = s.backgroundMode === 'transparent' ? 'transparent' : s.backgroundColor
    if (s.backgroundMode === 'image' && s.backgroundImageId) {
      report('Placing the background picture…')
      const bg = await decodeToBitmap(
        await getImageBytes({ id: s.backgroundImageId, maxDim: 0, format: 'png' }),
        'image/png',
      )
      background = await coverFit(bg, image.width, image.height, s.backgroundView)
    }
    report('Replacing the background…')
    const options = { image, mask, background, edgeSoftness: s.edgeSoftness, hairDetail: s.hairDetail, ...s.enhance }
    return maxDim === 0 ? compositeInStrips(options) : composite(options)
  }, [])

  const save_ = useCallback(
    async (format: 'jpeg' | 'png') => {
      const ext = format === 'jpeg' ? 'jpg' : 'png'
      try {
        const path = await save({
          defaultPath: editedFileName(useEdit.getState().sourceName, ext),
          filters: [{ name: format === 'jpeg' ? 'JPEG' : 'PNG', extensions: [ext] }],
        })
        if (!path) return
        const report = (message: string) => setState({ phase: 'working', message })
        const photo = await build(0, report)
        report('Encoding…')
        const encoded = await encodeBitmap(photo, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.95)
        const stamped = format === 'jpeg' ? setJpegDpi(encoded, PRINT_DPI) : setPngDpi(encoded, PRINT_DPI)
        await saveFile({ path, bytes: stamped.buffer as ArrayBuffer })
        setState({ phase: 'done', message: `Saved ${photo.width} × ${photo.height} px at 300 DPI`, path })
      } catch (error) {
        setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
    [build],
  )

  const printDirect = useCallback(
    async (request: PrintRequest) => {
      if (!placement) throw new Error('no photo is loaded')
      const { rect, paper: paperPx } = placement
      const photo = await build(Math.max(rect.width, rect.height), () => {})
      const sized = await resampleBitmap(photo, rect.width, rect.height)
      const sheet = await renderOnPaper(sized, placement)
      const png = await encodeBitmap(sheet, 'image/png')
      const p = PAPERS[useEdit.getState().paper]
      const short = Math.min(p.widthMm, p.heightMm)
      const long = Math.max(p.widthMm, p.heightMm)
      await printSheet({
        printer: request.printer,
        png: png.buffer as ArrayBuffer,
        widthMm: paperPx.width > paperPx.height ? long : short,
        heightMm: paperPx.width > paperPx.height ? short : long,
        copies: request.copies,
        jobName: `Photo print ${p.label}`,
      })
    },
    [build, placement],
  )

  return { state, dismiss: () => setState({ phase: 'idle' }), save: save_, printDirect, placement }
}
