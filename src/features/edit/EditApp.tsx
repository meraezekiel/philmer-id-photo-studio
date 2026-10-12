/**
 * Photo Print's window: the same shell as the ID wizard — header, canvas,
 * panel, action bar — over its own three steps.
 */

import { useCallback, useEffect } from 'react'

import { ActionBar, StepHeader } from '../../app/Shell'
import type { RuntimeInfo } from '../../lib/tauri'
import { EDIT_STEP_LABELS, EDIT_STEPS, useEdit, type EditStep } from '../../store/edit'
import { ImportStep } from '../import/ImportStep'
import { EditCanvas, EditPanel } from './EditStep'
import { EditPrintButton, PrintCanvas, PrintPanel } from './PrintExportStep'

export function EditApp({ runtime }: { runtime: RuntimeInfo | null }) {
  const step = useEdit((s) => s.step)
  const status = useEdit((s) => s.status)
  const setStep = useEdit((s) => s.setStep)
  const reset = useEdit((s) => s.reset)

  const index = EDIT_STEPS.indexOf(step)
  const nextStep = EDIT_STEPS[index + 1]
  const previousStep = index > 1 ? EDIT_STEPS[index - 1] : undefined

  const goNext = useCallback(() => nextStep && setStep(nextStep), [nextStep, setStep])
  const goBack = useCallback(() => previousStep && setStep(previousStep), [previousStep, setStep])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key.toLowerCase()
      if (event.key === 'ArrowRight') goNext()
      else if (event.key === 'ArrowLeft') goBack()
      else if (key === 'n') reset()
      else if (key === 'p' && status === 'ready') setStep('print')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goBack, reset, status, setStep])

  const showChrome = step !== 'import'

  return (
    <div data-app="" className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: 'var(--color-neutral-300)' }}>
      <StepHeader
        runtime={runtime}
        steps={EDIT_STEPS.map((key) => ({ key, label: EDIT_STEP_LABELS[key] }))}
        activeSteps={EDIT_STEPS}
        current={step}
        ready={status === 'ready'}
        onSelect={(key) => key !== 'import' && setStep(key as EditStep)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ background: 'var(--canvas)' }}>
          {step === 'import' && <ImportStep />}
          {step === 'edit' && <EditCanvas />}
          {step === 'print' && <PrintCanvas />}
        </div>
        {showChrome && (
          <aside
            className="flex w-[var(--panel-width)] flex-none flex-col overflow-y-auto border-l-2 border-divider"
            style={{ background: 'var(--panel)' }}
          >
            {step === 'edit' && <EditPanel />}
            {step === 'print' && <PrintPanel />}
          </aside>
        )}
      </div>
      {showChrome && (
        <ActionBar
          onBack={goBack}
          onNext={goNext}
          canGoBack={Boolean(previousStep)}
          nextLabel={nextStep ? `Next: ${EDIT_STEP_LABELS[nextStep]}` : 'New photo'}
          onNewPhoto={reset}
          isLast={!nextStep}
          primaryAction={step === 'print' ? <EditPrintButton /> : undefined}
        />
      )}
    </div>
  )
}
