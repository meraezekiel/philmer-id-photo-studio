/**
 * Photo Print — Print & Export: the paper drawn to scale with the photo on
 * it, as it will print; save the full-size file or print.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, Icon, ICONS, Notice, Section, Segmented } from '../../app/components/ui'
import { drawBitmap } from '../../lib/bitmap'
import type { PaperFit, PaperOrientation } from '../../lib/fitToPaper'
import {
  CUSTOM_PAPER_MAX_MM,
  CUSTOM_PAPER_MIN_MM,
  EDIT_PAPER_CHOICES,
  editPaper,
  formatLength,
  parseLength,
  type EditPaperChoice,
  type LengthUnit,
} from '../../lib/editPaper'
import { useEdit } from '../../store/edit'
import { useLicense } from '../license/LicenseDialog'
import { PrintDialog, type PrintRequest } from '../sheet/PrintDialog'
import { useEditExport } from './useEditExport'
import { useEditResult } from './useEditResult'

export function PrintCanvas() {
  const result = useEditResult()
  const { placement } = useEditExport()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (result && canvasRef.current) drawBitmap(canvasRef.current, result)
  }, [result])
  if (!placement || !result) return null
  const { paper, rect } = placement
  const pct = (v: number, of: number) => `${(v / of) * 100}%`

  return (
    <div className="flex h-full w-full items-center justify-center p-8" style={{ containerType: 'size' }}>
      <div
        className="relative overflow-hidden bg-white shadow-lg"
        style={{
          width: `min(88cqw, calc(86cqh * ${paper.width / paper.height}))`,
          aspectRatio: `${paper.width / paper.height}`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute"
          style={{
            left: pct(rect.x, paper.width),
            top: pct(rect.y, paper.height),
            width: pct(rect.width, paper.width),
            height: pct(rect.height, paper.height),
          }}
        />
      </div>
    </div>
  )
}

export function PrintPanel() {
  const paper = useEdit((s) => s.paper)
  const setPaper = useEdit((s) => s.setPaper)
  const customPaper = useEdit((s) => s.customPaper)
  const paperFit = useEdit((s) => s.paperFit)
  const setPaperFit = useEdit((s) => s.setPaperFit)
  const orientation = useEdit((s) => s.orientation)
  const setOrientation = useEdit((s) => s.setOrientation)
  const mode = useEdit((s) => s.backgroundMode)
  const info = useEdit((s) => s.info)
  const { state, dismiss, save } = useEditExport()
  const { canProduce, open: openLicence } = useLicense()
  const busy = state.phase === 'working' || !canProduce

  return (
    <>
      {!canProduce && (
        <div className="px-6 pt-5">
          <Notice
            tone="danger"
            icon={<Icon path={ICONS.warning} size={18} />}
            action={<button type="button" onClick={openLicence} className="whitespace-nowrap text-[13px] font-bold underline">Enter key</button>}
          >
            The trial has ended. Saving and printing need a licence.
          </Notice>
        </div>
      )}

      <Section title="Paper">
        <Segmented<EditPaperChoice>
          options={EDIT_PAPER_CHOICES.map((id) => ({ value: id, label: editPaper(id, customPaper).label }))}
          value={paper}
          onChange={setPaper}
          columns={3}
        />
        {paper === 'custom' && <CustomPaperFields />}
        <p className="tabular text-xs text-muted">{editPaper(paper, customPaper).sublabel}</p>
        <Segmented<PaperFit>
          options={[{ value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }]}
          value={paperFit}
          onChange={setPaperFit}
          columns={2}
        />
        <p className="text-xs text-muted">
          {paperFit === 'fit' ? 'The whole photo, with a white border on the short side.' : 'Edge to edge; the overflow is cropped from the centre.'}
        </p>
        <Segmented<PaperOrientation>
          options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]}
          value={orientation}
          onChange={setOrientation}
          columns={3}
        />
      </Section>

      <Section title="Save the file" last>
        {info && <p className="tabular text-xs text-muted">Full size, {info.width} × {info.height} px, 300 DPI.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void save('png')} disabled={busy}>Save PNG</Button>
          <Button onClick={() => void save('jpeg')} disabled={busy || mode === 'transparent'}>Save JPG</Button>
        </div>
        {mode === 'transparent' && <p className="text-xs text-muted">JPG cannot keep transparency; save as PNG.</p>}
        {state.phase === 'working' && <Notice tone="info">{state.message}</Notice>}
        {state.phase === 'done' && <Notice tone="ok" action={<button type="button" onClick={dismiss}>OK</button>}>{state.message}</Notice>}
        {state.phase === 'failed' && <Notice tone="danger" action={<button type="button" onClick={dismiss}>OK</button>}>{state.message}</Notice>}
      </Section>
    </>
  )
}

/** Width and height of the Custom paper, typed in mm or inches. */
function CustomPaperFields() {
  const custom = useEdit((s) => s.customPaper)
  const setCustom = useEdit((s) => s.setCustomPaper)
  const unit = useEdit((s) => s.paperUnit)
  const setUnit = useEdit((s) => s.setPaperUnit)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <LengthField label="Width" mm={custom.widthMm} unit={unit} onChange={(widthMm) => setCustom({ widthMm })} />
        <span className="pb-2 text-muted">×</span>
        <LengthField label="Height" mm={custom.heightMm} unit={unit} onChange={(heightMm) => setCustom({ heightMm })} />
        <Segmented<LengthUnit>
          options={[{ value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }]}
          value={unit}
          onChange={setUnit}
          columns={2}
        />
      </div>
    </div>
  )
}

function LengthField({ label, mm, unit, onChange }: { label: string; mm: number; unit: LengthUnit; onChange: (mm: number) => void }) {
  const [text, setText] = useState(() => formatLength(mm, unit))
  const typing = useRef(false)
  // Follow the stored size and the unit, except while the operator is typing.
  useEffect(() => {
    if (!typing.current) setText(formatLength(mm, unit))
  }, [mm, unit])
  const invalid = parseLength(text, unit) === null
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-invalid={invalid}
        title={invalid ? `Between ${formatLength(CUSTOM_PAPER_MIN_MM, unit)} and ${formatLength(CUSTOM_PAPER_MAX_MM, unit)} ${unit}` : undefined}
        onFocus={() => (typing.current = true)}
        onBlur={() => {
          typing.current = false
          setText(formatLength(mm, unit))
        }}
        onChange={(e) => {
          setText(e.target.value)
          const value = parseLength(e.target.value, unit)
          if (value !== null) onChange(value)
        }}
        className={`tabular min-h-9 w-full border bg-surface px-2 text-sm outline-none focus-visible:border-accent ${invalid ? 'border-[var(--danger)]' : 'border-divider'}`}
        style={{ caretColor: 'var(--color-accent)' }}
      />
    </label>
  )
}

export function EditPrintButton() {
  const { printDirect } = useEditExport()
  const paper = useEdit((s) => s.paper)
  const customPaper = useEdit((s) => s.customPaper)
  const sheet = editPaper(paper, customPaper)
  const { canProduce, open: openLicence } = useLicense()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; message: string } | null>(null)

  const onPrint = useCallback(
    async (request: PrintRequest) => {
      setBusy(true)
      setStatus(null)
      try {
        await printDirect(request)
        setStatus({ tone: 'ok', message: `Sent ${request.copies} ${request.copies === 1 ? 'copy' : 'copies'} to the printer.` })
      } catch (error) {
        setStatus({ tone: 'danger', message: error instanceof Error ? error.message : String(error) })
      } finally {
        setBusy(false)
      }
    },
    [printDirect],
  )

  // Ctrl+P on this step opens the dialog (App already keeps it from WebView2).
  const openRef = useRef(() => setOpen(true))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        if (canProduce) openRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canProduce])

  return (
    <>
      <button
        type="button"
        onClick={canProduce ? () => { setStatus(null); setOpen(true) } : openLicence}
        className="flex h-11 items-center justify-center gap-2 px-5 text-[15px] font-extrabold"
        style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
      >
        <Icon path={ICONS.save} size={18} />
        {canProduce ? 'Print' : 'Licence needed'}
      </button>
      {open && (
        <PrintDialog
          title="Print photo"
          summary={`One photo on ${paper === 'custom' ? sheet.longLabel : sheet.label}, at true size.`}
          paperLabel={sheet.longLabel}
          busy={busy}
          status={status}
          onPrint={onPrint}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
