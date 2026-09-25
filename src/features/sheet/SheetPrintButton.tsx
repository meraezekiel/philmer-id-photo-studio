/**
 * Print, on the sheet step itself.
 *
 * The shop's job ends at paper. Once the sheet looks right there is no reason
 * to walk through Export first, so this is the primary action here and Export
 * becomes optional — somewhere to go if you also want a file.
 *
 * Self-contained on purpose: the button carries its own progress and result
 * text, so the action bar needs no shared state with the panel.
 */

import { useEffect, useRef } from 'react'

import { Icon, ICONS } from '../../app/components/ui'
import { useExport } from '../export/useExport'

export function SheetPrintButton() {
  const { state, print, sheet } = useExport()
  const busy = state.phase === 'working'

  // Ctrl+P on this step prints the sheet. App blocks the webview's own
  // handler; this supplies the behaviour the operator expects instead.
  const printRef = useRef(print)
  printRef.current = print
  const canPrint = !busy && sheet.count > 0
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        if (canPrint) void printRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canPrint])

  return (
    <div className="flex items-center gap-3">
      {state.phase === 'working' && (
        <span className="text-[13px] text-muted">{state.message}</span>
      )}
      {state.phase === 'done' && (
        <span className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: 'var(--ok)' }}>
          <Icon path={ICONS.check} size={14} strokeWidth={3} />
          {state.message}
        </span>
      )}
      {state.phase === 'failed' && (
        <span className="max-w-[280px] truncate text-[13px] font-bold" style={{ color: 'var(--danger)' }}>
          {state.message}
        </span>
      )}

      <button
        type="button"
        onClick={print}
        disabled={busy || sheet.count === 0}
        title="Opens the sheet in your PDF viewer — choose Actual size, not Fit to page"
        className="flex h-11 items-center gap-2 px-5 text-[15px] font-extrabold transition-colors duration-[var(--duration-fast)] disabled:opacity-45"
        style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
      >
        <Icon path={ICONS.save} size={18} />
        {busy ? 'Preparing…' : 'Print sheet'}
      </button>
    </div>
  )
}
