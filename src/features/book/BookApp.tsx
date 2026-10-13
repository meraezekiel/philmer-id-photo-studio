/**
 * Photo Book's window: the same shell as the other modes over its own steps.
 * Print & Export is the last step.
 */

import { useCallback, useEffect } from 'react'
import { ask } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { ActionBar, StepHeader } from '../../app/Shell'
import { bookAutosaveClear, bookClear, onBookProgress, type RuntimeInfo } from '../../lib/tauri'
import { BOOK_STEP_LABELS, BOOK_STEPS, useBook, type BookStep } from '../../store/book'
import { ImportStep } from '../import/ImportStep'
import { BookFileSection } from './BookFileSection'
import { clearThumbCache } from './bookPaint'
import { saveBookWithFeedback, useBookAutosave } from './bookProject'
import { PageStrip } from './PageStrip'
import { PageView } from './PageView'
import { PagesPanel } from './PagesPanel'
import { BookPrintButton, BookPrintCanvas, BookPrintPanel, usePrintRange } from './BookPrintStep'
import { bookPlan } from './bookPipeline'
import { SetupCanvas, SetupPanel } from './SetupStep'
import { DragLayer, useDrag } from './useBookDrag'

/** True when there is nothing unsaved, or the operator agrees to lose it. */
export async function confirmDiscard(): Promise<boolean> {
  if (!useBook.getState().dirty) return true
  return ask('This book has changes that are not saved. Start a new one anyway?', {
    title: 'Unsaved book',
    kind: 'warning',
    okLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
  })
}

/** Loading photos, or an export or print running: the steps stay put. */
function locked(): boolean {
  return useBook.getState().status === 'loading' || usePrintRange.getState().busy
}

export async function newCustomer(): Promise<void> {
  if (locked()) return
  if (!(await confirmDiscard())) return
  await bookClear().catch(() => {})
  clearThumbCache()
  void bookAutosaveClear().catch(() => {})
  usePrintRange.getState().setMessage(null)
  useBook.getState().reset()
}

function canEnter(step: BookStep): boolean {
  const { book } = useBook.getState()
  if (step === 'setup') return book.photos.length > 0
  if (step === 'pages' || step === 'print') return book.pages.length > 0
  return false
}

export function BookApp({ runtime }: { runtime: RuntimeInfo | null }) {
  const step = useBook((s) => s.step)
  const status = useBook((s) => s.status)
  const pageCount = useBook((s) => s.book.pages.length)
  const setStep = useBook((s) => s.setStep)
  const busy = usePrintRange((s) => s.busy)
  useBookAutosave()

  const index = BOOK_STEPS.indexOf(step)
  const nextStep = BOOK_STEPS[index + 1]
  const previousStep = index > 1 ? BOOK_STEPS[index - 1] : undefined

  const goNext = useCallback(() => {
    if (locked()) return
    if (step === 'setup' && pageCount === 0) {
      // A sheet plan that cannot work is already explained on Setup.
      if (bookPlan(useBook.getState().book).ok) useBook.getState().buildPages()
      return
    }
    if (nextStep && canEnter(nextStep)) setStep(nextStep)
  }, [step, pageCount, nextStep, setStep])
  const goBack = useCallback(() => {
    if (locked()) return
    if (previousStep) setStep(previousStep)
  }, [previousStep, setStep])

  useEffect(() => {
    const unlisten = onBookProgress((p) => useBook.getState().setProgress(p))
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        const s = useBook.getState()
        if (s.status !== 'loading' && s.book.photos.length > 0) void saveBookWithFeedback(event.shiftKey)
        return
      }
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!event.ctrlKey && !event.metaKey) return
      if (locked()) return
      const key = event.key.toLowerCase()
      if (event.key === 'ArrowRight') goNext()
      else if (event.key === 'ArrowLeft') goBack()
      else if (key === 'n') void newCustomer()
      else if (key === 'p' && canEnter('print')) setStep('print')
      else if ((key === 'z' || key === 'y') && useDrag.getState().item) return
      else if (key === 'z' && !event.shiftKey) useBook.getState().undo()
      else if (key === 'y' || (key === 'z' && event.shiftKey)) useBook.getState().redo()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goBack, setStep])

  // The window does not close by itself while there is unsaved work.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (!useBook.getState().dirty) return
      event.preventDefault()
      const close = await ask('This book has changes that are not saved. Close anyway?', {
        title: 'Unsaved book',
        kind: 'warning',
        okLabel: 'Close anyway',
        cancelLabel: 'Keep editing',
      })
      if (close) await getCurrentWindow().destroy()
    })
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [])

  const showChrome = step !== 'import'
  const nextLabel = step === 'setup' && pageCount === 0 ? 'Build pages' : nextStep ? `Next: ${BOOK_STEP_LABELS[nextStep]}` : 'New book'

  return (
    <div data-app="" className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: 'var(--color-neutral-300)' }}>
      <StepHeader
        runtime={runtime}
        steps={BOOK_STEPS.map((key) => ({ key, label: BOOK_STEP_LABELS[key] }))}
        activeSteps={BOOK_STEPS}
        current={step}
        ready={status === 'ready'}
        onSelect={(key) => !locked() && canEnter(key as BookStep) && setStep(key as BookStep)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ background: 'var(--canvas)' }}>
          {step === 'import' && <ImportStep />}
          {step === 'setup' && <SetupCanvas />}
          {step === 'pages' && (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1"><PageView /></div>
              <PageStrip />
            </div>
          )}
          {step === 'print' && <BookPrintCanvas />}
        </div>
        {showChrome && (
          <aside className="flex w-[var(--panel-width)] flex-none flex-col overflow-y-auto border-l-2 border-divider" style={{ background: 'var(--panel)' }}>
            {step === 'setup' && <SetupPanel />}
            {(step === 'pages' || step === 'print') && <BookFileSection />}
            {step === 'pages' && <PagesPanel />}
            {step === 'print' && <BookPrintPanel />}
          </aside>
        )}
      </div>
      {showChrome && (
        <ActionBar
          onBack={goBack}
          onNext={goNext}
          canGoBack={Boolean(previousStep) && !busy}
          nextLabel={nextLabel}
          onNewPhoto={() => void newCustomer()}
          isLast={!nextStep}
          primaryAction={step === 'print' ? <BookPrintButton /> : undefined}
        />
      )}
      <DragLayer />
    </div>
  )
}
