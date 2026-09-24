/**
 * Step 5 — Export (DESIGN_BRIEF §3.5).
 *
 * M1 scope: a single photo, JPG or PNG, composited from the **full-resolution**
 * original and mask rather than from the canvas preview, with 300 DPI written
 * into the file. Sheet and print arrive with M3.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'

import { Banner, Button, Field, FieldList, Panel } from '../../app/components/ui'
import { decodeToBitmap, drawBitmap, encodeBitmap } from '../../lib/bitmap'
import { composite } from '../../lib/composite'
import { defaultFileName, setJpegDpi, setPngDpi } from '../../lib/dpi'
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
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const result = useMemo(() => {
    if (!preview || !previewMask) return null
    return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail })
  }, [preview, previewMask, background, edgeSoftness, hairDetail])

  useEffect(() => {
    if (result && canvasRef.current) drawBitmap(canvasRef.current, result)
  }, [result])

  return (
    <div className="flex h-full items-center justify-center p-6">
      <canvas
        ref={canvasRef}
        className="max-h-[70vh] w-auto rounded-md object-contain shadow-lg"
      />
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
  const reset = useJob((s) => s.reset)

  const [state, setState] = useState<ExportState>({ phase: 'idle' })
  const preset = PHOTO_PRESETS[presetId]

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
        const [image, mask] = await Promise.all([
          decodeToBitmap(imageBytes, 'image/png'),
          decodeToBitmap(maskBytes, 'image/png'),
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

        await saveFile({ path, bytes: Array.from(stamped) })
        setState({ phase: 'done', path })
      } catch (error) {
        setState({
          phase: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [info, preset.label, background, edgeSoftness, hairDetail, quality],
  )

  const busy = state.phase === 'working'

  return (
    <>
      <Panel title="This photo">
        <FieldList>
          <Field label="Size">
            <span className="tabular">
              {info ? `${info.width} x ${info.height}` : '—'}
            </span>
          </Field>
          <Field label="Background">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm border border-border-strong"
                style={{ backgroundColor: background }}
              />
              <span className="tabular">{background.toUpperCase()}</span>
            </span>
          </Field>
          <Field label="Resolution">
            <span className="tabular">{PRINT_DPI} DPI</span>
          </Field>
        </FieldList>
        <p className="mt-2 text-xs text-text-subtle">
          Exported at the photo's own resolution — no downscale. Cropping to{' '}
          {preset.label} arrives with the Adjust step.
        </p>
      </Panel>

      <Panel title="Save">
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" onClick={() => exportSingle('jpeg')} disabled={busy}>
            Save as JPG
          </Button>
          <Button onClick={() => exportSingle('png')} disabled={busy}>
            Save as PNG
          </Button>
        </div>

        {state.phase === 'working' && (
          <p className="mt-3 text-sm text-text-muted">{state.message}</p>
        )}
        {state.phase === 'done' && (
          <div className="mt-3">
            <Banner tone="success">Saved to {state.path}</Banner>
          </div>
        )}
        {state.phase === 'failed' && (
          <div className="mt-3">
            <Banner tone="danger">{state.message}</Banner>
          </div>
        )}
      </Panel>

      <Panel title="Next customer">
        <Button size="lg" onClick={reset} disabled={busy}>
          New photo
        </Button>
        <p className="mt-2 text-xs text-text-subtle">
          Keeps the size, background and quality settings.
        </p>
      </Panel>
    </>
  )
}
