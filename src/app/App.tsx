/**
 * The single window: top bar with the step flow, photo canvas, properties
 * panel, action bar (DESIGN_BRIEF §2 layout skeleton).
 *
 * M1 wires Import -> Background -> Export. Adjust (M2) and Print sheet (M3)
 * appear in the stepper as disabled, so the shape of the flow is visible from
 * the first run rather than changing under the operator later.
 */

import { useCallback, useEffect } from 'react'

import { BackgroundCanvas, BackgroundPanel } from '../features/background/BackgroundStep'
import { ExportCanvas, ExportPanel } from '../features/export/ExportStep'
import { ImportStep } from '../features/import/ImportStep'
import { useSegmentProgressListener } from '../features/import/usePhotoPipeline'
import { APP_NAME, PHOTO_PRESETS, PHOTO_PRESET_ORDER, VENDOR } from '../lib/presets'
import { runtimeInfo, type RuntimeInfo } from '../lib/tauri'
import { M1_STEPS, STEP_LABELS, stepEnabled, useJob, type Step } from '../store/job'
import { AppMark, Button, Panel } from './components/ui'
import { useState } from 'react'

/** Every step in the final flow, including the ones M2/M3 will fill in. */
const ALL_STEPS: Step[] = ['import', 'adjust', 'background', 'sheet', 'export']

export function App() {
  const step = useJob((s) => s.step)
  const status = useJob((s) => s.status)
  const setStep = useJob((s) => s.setStep)
  const reset = useJob((s) => s.reset)

  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  useSegmentProgressListener()

  useEffect(() => {
    runtimeInfo().then(setRuntime).catch(() => setRuntime(null))
  }, [])

  const index = M1_STEPS.indexOf(step)
  const goNext = useCallback(() => {
    const next = M1_STEPS[index + 1]
    if (next) setStep(next)
  }, [index, setStep])
  const goBack = useCallback(() => {
    const previous = M1_STEPS[index - 1]
    if (previous) setStep(previous)
  }, [index, setStep])

  // DESIGN_BRIEF §6 keyboard map, the parts M1 can honour.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goBack()
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goBack, reset])

  const nextStep = M1_STEPS[index + 1]

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <TopBar runtime={runtime} />

      <main className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 items-center justify-center bg-canvas">
          {step === 'import' && <ImportStep />}
          {step === 'background' && <BackgroundCanvas />}
          {step === 'export' && <ExportCanvas />}
        </section>

        {step !== 'import' && (
          <aside className="flex w-[var(--panel-width)] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-surface p-3">
            <SizePanel />
            {step === 'background' && <BackgroundPanel />}
            {step === 'export' && <ExportPanel />}
          </aside>
        )}
      </main>

      {step !== 'import' && (
        <footer className="flex h-[var(--actionbar-height)] shrink-0 items-center justify-between border-t border-border bg-surface px-4">
          <Button variant="ghost" onClick={reset}>
            New photo
          </Button>
          <div className="flex items-center gap-2">
            <Button onClick={goBack} disabled={index <= 0}>
              Back
            </Button>
            <Button variant="primary" onClick={goNext} disabled={!nextStep}>
              {nextStep ? `Next: ${STEP_LABELS[nextStep]}` : 'Done'}
            </Button>
          </div>
        </footer>
      )}

      {status === 'error' && step !== 'import' && <ErrorBar />}
    </div>
  )
}

function TopBar({ runtime }: { runtime: RuntimeInfo | null }) {
  const step = useJob((s) => s.step)
  const status = useJob((s) => s.status)
  const setStep = useJob((s) => s.setStep)

  return (
    <header className="flex h-[var(--topbar-height)] shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2.5">
        <AppMark />
        <div className="leading-tight">
          <div className="text-sm font-semibold">{APP_NAME}</div>
          <div className="text-xs text-text-subtle">{VENDOR}</div>
        </div>
      </div>

      <nav className="ml-4 flex items-center gap-1" aria-label="Steps">
        {ALL_STEPS.map((candidate, i) => {
          const planned = !M1_STEPS.includes(candidate)
          const enabled = !planned && stepEnabled(candidate, status)
          const active = candidate === step
          return (
            <div key={candidate} className="flex items-center">
              {i > 0 && <span className="mx-1 h-px w-4 bg-border" aria-hidden />}
              <button
                type="button"
                disabled={!enabled}
                onClick={() => setStep(candidate)}
                title={planned ? 'Coming in a later milestone' : undefined}
                className={`rounded-sm px-2.5 py-1 text-sm transition-colors duration-[var(--duration-fast)] ${
                  active
                    ? 'bg-accent-soft font-medium text-accent'
                    : enabled
                      ? 'text-text-muted hover:bg-accent-soft hover:text-text'
                      : 'cursor-not-allowed text-text-subtle/60'
                }`}
              >
                <span className="tabular mr-1.5 text-xs">{i + 1}</span>
                {STEP_LABELS[candidate]}
              </button>
            </div>
          )
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2 text-sm text-text-muted">
        <span
          className={`h-2 w-2 rounded-full ${runtime?.ortLoaded ? 'bg-success' : 'bg-danger'}`}
          aria-hidden
        />
        {runtime?.ortLoaded ? 'Offline & ready' : 'Runtime unavailable'}
      </div>
    </header>
  )
}

function SizePanel() {
  const presetId = useJob((s) => s.presetId)
  const setPreset = useJob((s) => s.setPreset)

  return (
    <Panel title="Size">
      <div className="grid grid-cols-4 gap-1 rounded-sm bg-bg p-1">
        {PHOTO_PRESET_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setPreset(id)}
            className={`rounded-sm px-2 py-1.5 text-sm transition-colors duration-[var(--duration-fast)] ${
              presetId === id
                ? 'bg-surface font-medium text-accent shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {PHOTO_PRESETS[id].label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-text-subtle">{PHOTO_PRESETS[presetId].sublabel}</p>
    </Panel>
  )
}

function ErrorBar() {
  const error = useJob((s) => s.error)
  const reset = useJob((s) => s.reset)
  if (!error) return null
  return (
    <div className="border-t border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">
      <span>{error.message}</span>
      <button type="button" onClick={reset} className="ml-3 underline">
        Start over
      </button>
    </div>
  )
}
