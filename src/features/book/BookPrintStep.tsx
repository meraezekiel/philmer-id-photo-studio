/**
 * Print & Export: the packed sheets as they will print, problems to fix
 * first, and the four outputs.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ask, open as openDialog, save } from '@tauri-apps/plugin-dialog'
import { create } from 'zustand'

import { Button, Icon, ICONS, Notice, Section } from '../../app/components/ui'
import { sheetCount } from '../../lib/bookSheets'
import { editPaper } from '../../lib/editPaper'
import { useBook } from '../../store/book'
import { useLicense } from '../license/LicenseDialog'
import { PrintDialog, type PrintRequest } from '../sheet/PrintDialog'
import { previewSource, renderSheet } from './bookPaint'
import { bookPlan } from './bookPipeline'
import { bookIssues, Cancelled, exportApprovalPdf, exportJpgs, exportPrintPdf, printBook, type Progress } from './useBookOutput'

const PREVIEW_DPI = 40

/** Which sheets to print (1-based, inclusive); shared by the panel's inputs and the Print button. */
interface PrintRange {
  from: number
  to: number
  setFrom: (value: number, sheets: number) => void
  setTo: (value: number, sheets: number) => void
  reset: (sheets: number) => void
}

const clampSheet = (value: number, sheets: number) => Math.max(1, Math.min(Math.max(1, sheets), Math.round(value) || 1))

export const usePrintRange = create<PrintRange>((set) => ({
  from: 1,
  to: 1,
  setFrom: (value, sheets) => set((s) => ({ from: clampSheet(value, sheets), to: Math.max(s.to, clampSheet(value, sheets)) })),
  setTo: (value, sheets) => set((s) => ({ to: clampSheet(value, sheets), from: Math.min(s.from, clampSheet(value, sheets)) })),
  reset: (sheets) => set({ from: 1, to: Math.max(1, sheets) }),
}))

/** Back to the whole book whenever the sheet count changes. */
function useResetRange(sheets: number) {
  const reset = usePrintRange((s) => s.reset)
  useEffect(() => reset(sheets), [reset, sheets])
}

function SheetPreview({ index }: { index: number }) {
  const book = useBook((s) => s.book)
  const missingList = useBook((s) => s.missing)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    const plan = bookPlan(book)
    if (!plan.ok) return
    void renderSheet(book, plan, index, { dpi: PREVIEW_DPI * (window.devicePixelRatio || 1), source: previewSource(book), preview: true, missing: new Set(missingList) }).then((off) => {
      const canvas = ref.current
      if (!live || !canvas) return
      canvas.width = off.width
      canvas.height = off.height
      canvas.getContext('2d')!.drawImage(off, 0, 0)
    })
    return () => {
      live = false
    }
  }, [book, index, missingList])
  return <canvas ref={ref} className="block w-full bg-white shadow-lg" />
}

export function BookPrintCanvas() {
  const book = useBook((s) => s.book)
  const plan = bookPlan(book)
  if (!plan.ok) {
    return <div className="flex h-full items-center justify-center p-8"><Notice tone="danger">{plan.message}</Notice></div>
  }
  const count = sheetCount(book.pages.length, plan.perSheet)
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto grid max-w-[900px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <SheetPreview index={i} />
            <span className="tabular text-center text-xs text-muted">Sheet {i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function useJob() {
  const [message, setMessage] = useState<{ tone: 'info' | 'ok' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef(false)
  const run = async (task: (p: Progress) => Promise<string>) => {
    setBusy(true)
    cancelRef.current = false
    try {
      const done = await task({ report: (text) => setMessage({ tone: 'info', text }), cancelled: () => cancelRef.current })
      setMessage({ tone: 'ok', text: done })
    } catch (error) {
      setMessage(error instanceof Cancelled ? { tone: 'info', text: 'Stopped.' } : { tone: 'danger', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }
  return { message, busy, run, cancel: () => (cancelRef.current = true), dismiss: () => setMessage(null) }
}

async function confirmProblems(missing: number): Promise<boolean> {
  if (missing === 0) return true
  return ask(`${missing} photo${missing === 1 ? ' is' : 's are'} missing and will print as blank space. Continue anyway?`, { title: 'Missing photos', kind: 'warning', okLabel: 'Continue', cancelLabel: 'Go back' })
}

export function BookPrintPanel() {
  const book = useBook((s) => s.book)
  const missingList = useBook((s) => s.missing)
  const missing = useMemo(() => new Set(missingList), [missingList])
  const { canProduce, open: openLicence } = useLicense()
  const job = useJob()
  const plan = bookPlan(book)
  const issues = useMemo(() => bookIssues(book, missing), [book, missing])
  const title = (book.cover?.title || 'photo-book').replace(/[\\/:*?"<>|]+/g, '').trim() || 'photo-book'
  const disabled = job.busy || !canProduce || !plan.ok || book.pages.length === 0

  const approval = async () => {
    const path = await save({ defaultPath: `${title} - for approval.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!path || !(await confirmProblems(issues.missing))) return
    await job.run(async (p) => {
      await exportApprovalPdf(book, missing, path, p)
      return `Saved ${book.pages.length} pages for approval.`
    })
  }
  const printPdf = async () => {
    const path = await save({ defaultPath: `${title} - print sheets.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!path || !(await confirmProblems(issues.missing))) return
    await job.run(async (p) => {
      await exportPrintPdf(book, missing, path, p)
      return 'Saved the print sheets.'
    })
  }
  const jpgs = async () => {
    const folder = await openDialog({ directory: true, title: 'Choose a folder for the page JPGs' })
    if (typeof folder !== 'string' || !(await confirmProblems(issues.missing))) return
    await job.run(async (p) => `Saved ${await exportJpgs(book, missing, folder, p)} JPGs at 300 DPI.`)
  }

  const paper = editPaper(book.paper, book.customPaper)
  const sheets = plan.ok ? sheetCount(book.pages.length, plan.perSheet) : 0
  useResetRange(sheets)
  const { from, to, setFrom, setTo } = usePrintRange()

  return (
    <>
      {!canProduce && (
        <div className="px-6 pt-5">
          <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />} action={<button type="button" onClick={openLicence} className="whitespace-nowrap text-[13px] font-bold underline">Enter key</button>}>
            The trial has ended. Saving and printing need a licence.
          </Notice>
        </div>
      )}
      <Section title="Summary">
        {plan.ok ? (
          <p className="tabular text-sm">
            {book.pages.length} pages → {sheets} {book.paper === 'custom' ? 'custom' : paper.label} sheet{sheets === 1 ? '' : 's'}
            {plan.borderless ? ' (borderless)' : ''}
          </p>
        ) : (
          <Notice tone="danger">{plan.message}</Notice>
        )}
        {issues.missing > 0 && <Notice tone="danger">{issues.missing} missing photo{issues.missing === 1 ? '' : 's'}.</Notice>}
        {issues.empty > 0 && <Notice tone="warn">{issues.empty} empty frame{issues.empty === 1 ? '' : 's'} will print as blank space.</Notice>}
        {issues.lowRes > 0 && <Notice tone="warn">{issues.lowRes} photo{issues.lowRes === 1 ? '' : 's'} may print soft (under 200 DPI).</Notice>}
      </Section>
      <Section title="Send to the customer">
        <Button onClick={() => void approval()} disabled={disabled}>Export PDF for approval</Button>
        <p className="text-xs text-muted">Pages at 150 DPI, small enough for Messenger.</p>
      </Section>
      <Section title="Print">
        <div className="flex items-center gap-2 text-sm">
          <span>Sheets from</span>
          <input type="number" min={1} max={sheets} value={from} disabled={sheets === 0} onChange={(e) => setFrom(Number(e.target.value), sheets)} className="tabular h-8 w-16 border border-divider px-2" />
          <span>to</span>
          <input type="number" min={1} max={sheets} value={to} disabled={sheets === 0} onChange={(e) => setTo(Number(e.target.value), sheets)} className="tabular h-8 w-16 border border-divider px-2" />
        </div>
        <p className="text-xs text-muted">Use the Print button below. Of {sheets} sheet{sheets === 1 ? '' : 's'}.</p>
      </Section>
      <Section title="Save" last>
        <Button onClick={() => void printPdf()} disabled={disabled}>Export PDF for print</Button>
        <Button onClick={() => void jpgs()} disabled={disabled}>Export page JPGs</Button>
        {job.message && (
          <Notice tone={job.message.tone} action={job.busy ? <button type="button" onClick={job.cancel} className="text-[13px] font-bold underline">Cancel</button> : <button type="button" onClick={job.dismiss}>OK</button>}>
            {job.message.text}
          </Notice>
        )}
      </Section>
    </>
  )
}

export function BookPrintButton() {
  const book = useBook((s) => s.book)
  const missingList = useBook((s) => s.missing)
  const { canProduce, open: openLicence } = useLicense()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; message: string } | null>(null)
  const plan = bookPlan(book)
  const sheets = plan.ok ? sheetCount(book.pages.length, plan.perSheet) : 0
  useResetRange(sheets)
  const { from, to } = usePrintRange()
  const cancelRef = useRef(false)

  const onPrint = async (request: PrintRequest) => {
    const missing = new Set(missingList)
    if (!(await confirmProblems(bookIssues(book, missing).missing))) return
    setBusy(true)
    cancelRef.current = false
    setStatus(null)
    try {
      await printBook(book, missing, { from: from - 1, to: to - 1 }, request, {
        report: (message) => setStatus({ tone: 'ok', message }),
        cancelled: () => cancelRef.current,
      })
      setStatus({ tone: 'ok', message: `Sent sheets ${from}–${to} to the printer.` })
    } catch (error) {
      setStatus({ tone: 'danger', message: error instanceof Cancelled ? 'Stopped before printing.' : error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const paper = editPaper(book.paper, book.customPaper)
  const valid = plan.ok && sheets > 0 && from >= 1 && to <= sheets && from <= to

  return (
    <>
      <button
        type="button"
        onClick={canProduce ? () => { setStatus(null); setOpen(true) } : openLicence}
        disabled={!plan.ok || sheets === 0}
        className="flex h-11 items-center justify-center gap-2 px-5 text-[15px] font-extrabold disabled:opacity-45"
        style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
      >
        <Icon path={ICONS.save} size={18} />
        {canProduce ? 'Print' : 'Licence needed'}
      </button>
      {open && (
        <PrintDialog
          title="Print book"
          summary={`Sheets ${from}–${to} of ${sheets}, ${plan.ok && plan.borderless ? 'borderless, ' : ''}at true size. Copies print the whole range each time.`}
          paperLabel={book.paper === 'custom' ? paper.longLabel : paper.label}
          busy={busy || !valid}
          status={status}
          onPrint={(r) => void onPrint(r)}
          onClose={() => {
            if (busy) cancelRef.current = true
            else setOpen(false)
          }}
        />
      )}
    </>
  )
}
