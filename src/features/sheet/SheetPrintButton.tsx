/**
 * Print, on the sheet step itself.
 *
 * The shop's job ends at paper, so this is the primary action here and Export
 * becomes optional. It opens the print dialog rather than printing blind: a
 * shop has more than one printer and the paper has to match.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { Icon, ICONS } from '../../app/components/ui'
import { useExport } from '../export/useExport'
import { PrintDialog, type PrintRequest } from './PrintDialog'
import { useSheetLayout } from './useSheetLayout'
import { PAPERS } from '../../lib/presets'
import { useJob } from '../../store/job'

export function SheetPrintButton({ block = false }: { block?: boolean } = {}) {
  const { printDirect } = useExport()
  const sheet = useSheetLayout()
  const paper = useJob((s) => s.paper)

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; message: string } | null>(null)

  const openDialog = useCallback(() => {
    setStatus(null)
    setOpen(true)
  }, [])

  const onPrint = useCallback(
    async (request: PrintRequest) => {
      setBusy(true)
      setStatus(null)
      try {
        await printDirect(request)
        setStatus({
          tone: 'ok',
          message: `Sent ${request.copies} ${request.copies === 1 ? 'copy' : 'copies'} to the printer.`,
        })
      } catch (error) {
        setStatus({
          tone: 'danger',
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setBusy(false)
      }
    },
    [printDirect],
  )

  // Ctrl+P on this step opens the same dialog; App blocks the webview's own
  // print handler so it can never reach WebView2.
  const openRef = useRef(openDialog)
  openRef.current = openDialog
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        openRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={sheet.count === 0}
        title="Print this sheet at true size (Ctrl+P)"
        className={`flex h-11 items-center justify-center gap-2 px-5 text-[15px] font-extrabold transition-colors duration-[var(--duration-fast)] disabled:opacity-45 ${block ? 'w-full' : ''}`}
        style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
      >
        <Icon path={ICONS.save} size={18} />
        Print sheet
      </button>

      {open && (
        <PrintDialog
          paperLabel={PAPERS[paper].label}
          photoCount={sheet.count}
          busy={busy}
          status={status}
          onPrint={onPrint}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
