/**
 * Step 5 — Export and print (DESIGN_BRIEF §3.5).
 *
 * Print is the primary action: the shop's job ends at paper, not at a file.
 * Everything else is a save, and every output is built from the same cropped,
 * exactly-sized photo so a sheet and a single save cannot disagree.
 */

import { useEffect, useMemo, useRef } from 'react'

import { Button, Field, FieldList, Icon, ICONS, Notice, Section } from '../../app/components/ui'
import { cropRotate, drawBitmap } from '../../lib/bitmap'
import { composite } from '../../lib/composite'
import { PAPERS, PHOTO_PRESETS, PRINT_DPI } from '../../lib/presets'
import { useJob } from '../../store/job'
import { SheetPrintButton } from '../sheet/SheetPrintButton'
import { useExport } from './useExport'

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

  const result = useMemo(() => {
    if (!preview || !previewMask) return null
    if (!cropRect || !info) {
      return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail })
    }
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
  const presetId = useJob((s) => s.presetId)
  const paper = useJob((s) => s.paper)
  const background = useJob((s) => s.background)
  const cropRect = useJob((s) => s.cropRect)
  const reset = useJob((s) => s.reset)

  const preset = PHOTO_PRESETS[presetId]
  const { state, dismiss, outputPx, sheet, savePhoto, saveSheetPdf, saveSheetImage } =
    useExport()

  const busy = state.phase === 'working'

  return (
    <>
      <Section title="Summary">
        <FieldList>
          <Field label="Photo">
            <span className="tabular">
              {preset.label} · {outputPx.width} x {outputPx.height} px
            </span>
          </Field>
          <Field label="Sheet">
            <span className="tabular">
              {PAPERS[paper].label} · {sheet.count} {sheet.count === 1 ? 'copy' : 'copies'}
            </span>
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
        {!cropRect && (
          <p className="text-xs text-muted">
            No crop set — the whole photo will be used. Go back to Adjust to frame it.
          </p>
        )}
      </Section>

      <Section title="Print">
        <SheetPrintButton block />
        <p className="text-xs text-muted">
          Prints straight to the printer at true size — no PDF viewer in between.
        </p>
      </Section>

      <Section title="Save">
        <div className="flex flex-col gap-2">
          <Button onClick={saveSheetPdf} disabled={busy} block>
            Sheet as PDF
          </Button>
          <Button onClick={() => saveSheetImage('jpeg')} disabled={busy} block>
            Sheet as JPG
          </Button>
          <div className="my-1 h-px bg-divider" />
          <Button onClick={() => savePhoto('jpeg')} disabled={busy} block>
            Single photo as JPG
          </Button>
          <Button onClick={() => savePhoto('png')} disabled={busy} block>
            Single photo as PNG
          </Button>
        </div>

        {state.phase === 'working' && <p className="text-sm text-muted">{state.message}</p>}
        {state.phase === 'done' && (
          <Notice
            tone="ok"
            action={
              <button type="button" onClick={dismiss} title="Dismiss" className="grid h-7 w-7 place-items-center">
                <Icon path={ICONS.close} size={14} />
              </button>
            }
          >
            {state.message}
            <br />
            <span className="text-xs opacity-80">{state.path}</span>
          </Notice>
        )}
        {state.phase === 'failed' && <Notice tone="danger">{state.message}</Notice>}
      </Section>

      <Section title="Next customer" last>
        <Button onClick={reset} disabled={busy} block>
          New photo
        </Button>
        <p className="text-xs text-muted">Keeps the size, paper, background and quality.</p>
      </Section>
    </>
  )
}
