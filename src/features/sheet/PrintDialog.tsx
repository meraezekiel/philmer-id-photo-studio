/**
 * The print dialog — printer, copies, and the driver's own properties.
 *
 * Printing goes straight to the printer from Rust. Handing the sheet to the
 * system PDF handler meant a browser opened, and then *it* decided the
 * physical size; "Fit to page" silently shrinks a 2x2 to something a passport
 * office will reject. Here the app computes the size from the printer's DPI.
 *
 * "Printer settings" opens the driver's real dialog, which is where paper size
 * and quality belong — the operator already knows that dialog, and reproducing
 * an Epson's paper list would be a worse version of it.
 */

import { useCallback, useEffect, useState } from 'react'

import { Button, Icon, ICONS, Notice } from '../../app/components/ui'
import { listPrinters, printerProperties, type PrinterInfo } from '../../lib/tauri'

export interface PrintRequest {
  copies: number
  printer?: string
}

export function PrintDialog({
  paperLabel,
  photoCount,
  busy,
  status,
  onPrint,
  onClose,
}: {
  paperLabel: string
  photoCount: number
  busy: boolean
  status: { tone: 'ok' | 'danger'; message: string } | null
  onPrint: (request: PrintRequest) => void
  onClose: () => void
}) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [printer, setPrinter] = useState<string>('')
  const [copies, setCopies] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    listPrinters()
      .then((found) => {
        setPrinters(found)
        setPrinter(found.find((p) => p.isDefault)?.name ?? found[0]?.name ?? '')
      })
      .catch((e) => setLoadError(String(e)))
  }, [])

  // Esc closes, unless a job is mid-flight.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const openProperties = useCallback(() => {
    if (printer) void printerProperties(printer).catch((e) => setLoadError(String(e)))
  }, [printer])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'color-mix(in srgb, var(--color-neutral-900) 50%, transparent)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="flex w-[min(440px,100%)] flex-col gap-3 p-4 shadow-lg"
        style={{ background: 'var(--color-surface)' }}
        role="dialog"
        aria-modal="true"
      >
        <h4 className="font-heading text-xl font-extrabold">Print sheet</h4>
        <p className="text-sm text-muted">
          {photoCount} {photoCount === 1 ? 'photo' : 'photos'} on {paperLabel}, at true size.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Printer</span>
          <select
            value={printer}
            onChange={(e) => setPrinter(e.target.value)}
            disabled={busy || printers.length === 0}
            className="min-h-9 border border-divider bg-bg px-2 text-sm"
          >
            {printers.length === 0 && <option value="">No printer found</option>}
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end justify-between gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Copies</span>
            <input
              type="number"
              min={1}
              max={99}
              value={copies}
              disabled={busy}
              onChange={(e) => setCopies(Math.min(99, Math.max(1, Number(e.target.value) || 1)))}
              className="tabular min-h-9 w-24 border border-divider bg-bg px-2 text-sm"
            />
          </label>

          <Button onClick={openProperties} disabled={busy || !printer}>
            Printer settings…
          </Button>
        </div>

        <Notice tone="warn" icon={<Icon path={ICONS.warning} size={18} />}>
          Set the paper size in <strong>Printer settings</strong> to match {paperLabel}. The app
          prints at true size and does not scale to fit.
        </Notice>

        {loadError && <Notice tone="danger">{loadError}</Notice>}
        {status && <Notice tone={status.tone}>{status.message}</Notice>}

        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Close
          </Button>
          <button
            type="button"
            onClick={() => onPrint({ copies, printer: printer || undefined })}
            disabled={busy || !printer || photoCount === 0}
            className="h-11 px-6 text-[15px] font-extrabold transition-colors duration-[var(--duration-fast)] disabled:opacity-45"
            style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
          >
            {busy ? 'Printing…' : 'Print'}
          </button>
        </div>
      </div>
    </div>
  )
}
