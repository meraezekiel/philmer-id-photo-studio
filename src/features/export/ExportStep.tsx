/**
 * Step 5 — Export (DESIGN_BRIEF §3.5).
 *
 * A single photo, JPG or PNG, cut to the framed crop and resampled to the
 * preset's exact pixel size, composited from the **full-resolution** original
 * and mask rather than from the canvas preview, with 300 DPI written into the
 * file. Sheet and print arrive with M3.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'

import { Button, Field, FieldList, Notice, Section } from '../../app/components/ui'
import { cropRotate, decodeToBitmap, drawBitmap, encodeBitmap, resampleBitmap } from '../../lib/bitmap'
import { composite } from '../../lib/composite'
import { defaultFileName, outputSizePx, setJpegDpi, setPngDpi } from '../../lib/dpi'
import { PHOTO_PRESETS, PRINT_DPI } from '../../lib/presets'
import { getImageBytes, saveFile, segment } from '../../lib/tauri'
import { useJob } from '../../store/job'

type ExportState =
  | { phase: 'idle' }
  | { phase: 'working'; message: string }
  | { phase: 'done'; path: string }
  | { phase: 'failed'; message: string }

export function ExportCanvas() {
  const preview = useJob((s) => s.preview)
  const previewMask = useJob((s) => s.previewMask)
  const info = useJob((s) => s.info)
  const cropRect = useJob((s) => s.cropRect)
  const presetId = useJob((s) => s.presetId)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const preset = PHOTO_PRESETS[presetId]

  /**
   * Preview the *cropped* result, so this screen shows the photo that will
   * actually be written rather than the whole frame.
   */
  const result = useMemo(() => {
    if (!preview || !previewMask) return null
    if (!cropRect || !info) {
      return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail })
    }
    // The crop is in original pixels; scale it into the preview's space.
    const s = preview.width / info.width
    const rect = {
      x: cropRect.x * s,
      y: cropRect.y * s,
      width: cropRect.width * s,
      height: cropRect.height * s,
    }
    return composite({
      image: cropRotate(preview, rect, cropRect.rotationDeg),
      mask: cropRotate(previewMask, rect, cropRect.rotationDeg),
      background,
      edgeSoftness,
      hairDetail,
    })
  }, [preview, previewMask, info, cropRect, background, edgeSoftness, hairDetail])

  useEffect(() => {
    if (result && canvasRef.current) drawBitmap(canvasRef.current, result)
  }, [result])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <canvas
        ref={canvasRef}
        className="w-auto object-contain shadow-lg"
        style={{ maxHeight: '70%', aspectRatio: `${preset.widthMm / preset.heightMm}` }}
      />
      <div
        className="tabular flex h-9 items-center px-3 text-sm shadow-sm"
        style={{ background: 'var(--color-bg)' }}
      >
        {preset.sublabel}
      </div>
    </div>
  )
}

export function ExportPanel() {
  const info = useJob((s) => s.info)
  const presetId = useJob((s) => s.presetId)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const quality = useJob((s) => s.quality)
  const cropRect = useJob((s) => s.cropRect)
  const reset = useJob((s) => s.reset)

  const [state, setState] = useState<ExportState>({ phase: 'idle' })
  const preset = PHOTO_PRESETS[presetId]
  const outputPx = outputSizePx(preset.widthMm, preset.heightMm)

  const exportSingle = useCallback(
    async (format: 'jpeg' | 'png') => {
      if (!info) return
      const extension = format === 'jpeg' ? 'jpg' : 'png'

      try {
        const path = await save({
          defaultPath: defaultFileName(preset.label, extension),
          filters: [{ name: format === 'jpeg' ? 'JPEG' : 'PNG', extensions: [extension] }],
        })
        if (!path) return

        // Composite from the originals, not from the canvas preview. This is
        // the M1 acceptance criterion: the export must not be a downscale.
        setState({ phase: 'working', message: 'Fetching the full-resolution photo…' })
        const [imageBytes, maskBytes] = await Promise.all([
          getImageBytes({ id: info.id, maxDim: 0, format: 'png' }),
          segment({ id: info.id, model: quality }),
        ])

        setState({ phase: 'working', message: 'Decoding…' })
        const [fullImage, fullMask] = await Promise.all([
          decodeToBitmap(imageBytes, 'image/png'),
          decodeToBitmap(maskBytes, 'image/png'),
        ])

        // Cut out exactly what the Adjust step framed. Without a crop (no face
        // found and nothing adjusted) fall back to the whole photo.
        setState({ phase: 'working', message: 'Cropping…' })
        const croppedImage = cropRect
          ? cropRotate(fullImage, cropRect, cropRect.rotationDeg)
          : fullImage
        const croppedMask = cropRect
          ? cropRotate(fullMask, cropRect, cropRect.rotationDeg)
          : fullMask

        // Resample to the preset's exact pixel size *before* compositing, so
        // decontamination runs at output scale and the two planes stay aligned.
        setState({ phase: 'working', message: 'Resampling to 300 DPI…' })
        const [image, mask] = await Promise.all([
          resampleBitmap(croppedImage, outputPx.width, outputPx.height),
          resampleBitmap(croppedMask, outputPx.width, outputPx.height),
        ])

        setState({ phase: 'working', message: 'Replacing the background…' })
        const out = composite({ image, mask, background, edgeSoftness, hairDetail })

        setState({ phase: 'working', message: 'Encoding…' })
        const encoded = await encodeBitmap(
          out,
          format === 'jpeg' ? 'image/jpeg' : 'image/png',
          0.95,
        )

        // Pixel count alone does not make a 300 DPI print; the file has to say
        // so or viewers assume 72 and shrink it (BUILD_PLAN §8).
        const stamped =
          format === 'jpeg' ? setJpegDpi(encoded, PRINT_DPI) : setPngDpi(encoded, PRINT_DPI)

        await saveFile({ path, bytes: stamped.buffer as ArrayBuffer })
        setState({ phase: 'done', path })
      } catch (error) {
        setState({
          phase: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [info, preset.label, outputPx.width, outputPx.height, cropRect, background, edgeSoftness, hairDetail, quality],
  )

  const busy = state.phase === 'working'

  return (
    <>
      <Section title="This photo">
        <FieldList>
          <Field label="Output">
            <span className="tabular">
              {outputPx.width} x {outputPx.height} px
            </span>
          </Field>
          <Field label="Print size">
            <span className="tabular">{preset.sublabel}</span>
          </Field>
          <Field label="Background">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 border border-divider"
                style={{ backgroundColor: background }}
              />
              <span className="tabular">{background.toUpperCase()}</span>
            </span>
          </Field>
          <Field label="Resolution">
            <span className="tabular">{PRINT_DPI} DPI</span>
          </Field>
        </FieldList>
        <p className="text-xs text-muted">
          {cropRect
            ? 'Cut from the full-resolution original, exactly as framed in Adjust.'
            : 'No crop set — the whole photo will be used. Go back to Adjust to frame it.'}
        </p>
      </Section>

      <Section title="Save">
        <div className="flex flex-col gap-2">
          <Button variant="primary" onClick={() => exportSingle('jpeg')} disabled={busy}>
            Save as JPG
          </Button>
          <Button onClick={() => exportSingle('png')} disabled={busy}>
            Save as PNG
          </Button>
        </div>

        {state.phase === 'working' && (
          <p className="text-sm text-muted">{state.message}</p>
        )}
        {state.phase === 'done' && (
          <div>
            <Notice tone="ok">Saved to {state.path}</Notice>
          </div>
        )}
        {state.phase === 'failed' && (
          <div>
            <Notice tone="danger">{state.message}</Notice>
          </div>
        )}
      </Section>

      <Section title="Next customer">
        <Button onClick={reset} disabled={busy}>
          New photo
        </Button>
        <p className="text-xs text-muted">Keeps the size, background and quality settings.</p>
      </Section>
    </>
  )
}
