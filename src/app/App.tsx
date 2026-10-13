/**
 * The single window, laid out exactly as the design in `design/`:
 * a 64 px header carrying the brand and the numbered step flow, the photo
 * canvas, a 360 px properties panel, and a 76 px action bar.
 *
 * Adjust (M2) is wired. Print sheet (M3) shows in the stepper but is not yet
 * reachable — the flow keeps its final shape from the first run rather than
 * growing steps under the operator later.
 */

import { useCallback, useEffect, useState } from 'react'

import { AdjustCanvas } from '../features/adjust/AdjustCanvas'
import { AdjustPanel } from '../features/adjust/AdjustStep'
import { AttireCanvas, AttirePanel } from '../features/attire/AttireStep'
import { BackgroundCanvas, BackgroundPanel } from '../features/background/BackgroundStep'
import { BookApp } from '../features/book/BookApp'
import { ExportCanvas, ExportPanel } from '../features/export/ExportStep'
import { ImportStep } from '../features/import/ImportStep'
import { EditApp } from '../features/edit/EditApp'
import { SheetPrintButton } from '../features/sheet/SheetPrintButton'
import { SheetCanvas, SheetPanel } from '../features/sheet/SheetStep'
import { useSegmentProgressListener } from '../features/import/usePhotoPipeline'
import { PHOTO_PRESETS, PHOTO_PRESET_ORDER } from '../lib/presets'
import { runtimeInfo, type RuntimeInfo } from '../lib/tauri'
import {
  ACTIVE_STEPS,
  ALL_STEPS,
  STEP_LABELS,
  useJob,
  type Step,
} from '../store/job'
import { useMode } from '../store/mode'
import { Section, Segmented } from './components/ui'
import { ActionBar, StepHeader } from './Shell'

export function App() {
  const mode = useMode((s) => s.mode)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  useSegmentProgressListener()

  useEffect(() => {
    runtimeInfo()
      .then(setRuntime)
      .catch(() => setRuntime(null))
  }, [])

  // Ctrl+P must never reach the webview in either flow (BUILD_PLAN §8):
  // WebView2 would print the app's own interface. Each flow adds its own
  // meaning on top of this.
  useEffect(() => {
    const block = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') event.preventDefault()
    }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
  }, [])

  if (mode === 'edit') return <EditApp runtime={runtime} />
  if (mode === 'book') return <BookApp runtime={runtime} />
  return <IdApp runtime={runtime} />
}

function IdApp({ runtime }: { runtime: RuntimeInfo | null }) {
  const step = useJob((s) => s.step)
  const status = useJob((s) => s.status)
  const setStep = useJob((s) => s.setStep)
  const reset = useJob((s) => s.reset)

  const index = ACTIVE_STEPS.indexOf(step)
  const nextStep = ACTIVE_STEPS[index + 1]
  const previousStep = ACTIVE_STEPS[index - 1]

  const goNext = useCallback(() => {
    if (nextStep) setStep(nextStep)
  }, [nextStep, setStep])
  const goBack = useCallback(() => {
    if (previousStep) setStep(previousStep)
  }, [previousStep, setStep])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goBack()
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        reset()
      } else if (event.key.toLowerCase() === 'p') {
        /*
         * Ctrl+P must never reach the webview. WebView2 answers it with its
         * own browser print dialog, which prints *the app's interface* — and
         * at whatever scale it likes, which is the exact failure BUILD_PLAN §8
         * calls out. Printing here always means the sheet PDF.
         */
        event.preventDefault()
        event.stopPropagation()
        if (step !== 'sheet' && step !== 'export' && ACTIVE_STEPS.includes('sheet')) {
          setStep('sheet')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goBack, reset, step, setStep])

  const showChrome = step !== 'import'

  return (
    <div
      data-app=""
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: 'var(--color-neutral-300)' }}
    >
      <StepHeader
        runtime={runtime}
        steps={ALL_STEPS.map((key) => ({ key, label: STEP_LABELS[key] }))}
        activeSteps={ACTIVE_STEPS}
        current={step}
        ready={status === 'ready'}
        onSelect={(key) => setStep(key as Step)}
      />

      <div className="flex min-h-0 flex-1">
        <div
          // Gives the walkthrough one anchor per step: adjust-canvas,
          // background-canvas, sheet-canvas.
          data-tour={`${step}-canvas`}
          className="relative min-w-0 flex-1 overflow-hidden"
          style={{ background: 'var(--canvas)' }}
        >
          {step === 'import' && <ImportStep />}
          {step === 'adjust' && <AdjustCanvas />}
          {step === 'background' && <BackgroundCanvas />}
          {step === 'attire' && <AttireCanvas />}
          {step === 'sheet' && <SheetCanvas />}
          {step === 'export' && <ExportCanvas />}
        </div>

        {showChrome && (
          <aside
            className="flex w-[var(--panel-width)] flex-none flex-col overflow-y-auto border-l-2 border-divider"
            style={{ background: 'var(--panel)' }}
          >
            {step !== 'sheet' && <SizeSection />}
            {step === 'adjust' && <AdjustPanel />}
            {step === 'background' && <BackgroundPanel />}
            {step === 'attire' && <AttirePanel />}
            {step === 'sheet' && <SheetPanel />}
            {step === 'export' && <ExportPanel />}
          </aside>
        )}
      </div>

      {showChrome && (
        <ActionBar
          onBack={goBack}
          onNext={goNext}
          canGoBack={Boolean(previousStep)}
          nextLabel={nextStep ? `Next: ${STEP_LABELS[nextStep]}` : 'New photo'}
          onNewPhoto={reset}
          isLast={!nextStep}
          primaryAction={step === 'sheet' ? <SheetPrintButton /> : undefined}
        />
      )}
    </div>
  )
}

function SizeSection() {
  const presetId = useJob((s) => s.presetId)
  const setPreset = useJob((s) => s.setPreset)
  const preset = PHOTO_PRESETS[presetId]

  return (
    <Section title="Size preset" tour="size-preset">
      <Segmented
        options={PHOTO_PRESET_ORDER.map((id) => ({
          value: id,
          label: PHOTO_PRESETS[id].label,
        }))}
        value={presetId}
        onChange={setPreset}
        columns={4}
      />
      <p className="tabular text-xs text-muted">{preset.sublabel}</p>
      {preset.note && <p className="text-xs text-muted">{preset.note}</p>}
    </Section>
  )
}

