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
import { ExportCanvas, ExportPanel } from '../features/export/ExportStep'
import { ImportStep } from '../features/import/ImportStep'
import { LicenseChip, useLicense } from '../features/license/LicenseDialog'
import { SheetPrintButton } from '../features/sheet/SheetPrintButton'
import { useTutorial } from '../features/tutorial/TutorialProvider'
import { SheetCanvas, SheetPanel } from '../features/sheet/SheetStep'
import { useSegmentProgressListener } from '../features/import/usePhotoPipeline'
import { APP_NAME, PHOTO_PRESETS, PHOTO_PRESET_ORDER, VENDOR } from '../lib/presets'
import { runtimeInfo, type RuntimeInfo } from '../lib/tauri'
import {
  ACTIVE_STEPS,
  ALL_STEPS,
  STEP_LABELS,
  useJob,
} from '../store/job'
import { AppMark, Icon, ICONS, IconButton, Section, Segmented } from './components/ui'

export function App() {
  const step = useJob((s) => s.step)
  const setStep = useJob((s) => s.setStep)
  const reset = useJob((s) => s.reset)

  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  useSegmentProgressListener()

  useEffect(() => {
    runtimeInfo()
      .then(setRuntime)
      .catch(() => setRuntime(null))
  }, [])

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
      <Header runtime={runtime} />

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

function Header({ runtime }: { runtime: RuntimeInfo | null }) {
  const { open: openLicense } = useLicense()
  const { start: startTutorial } = useTutorial()
  const step = useJob((s) => s.step)
  const status = useJob((s) => s.status)
  const setStep = useJob((s) => s.setStep)

  const currentIndex = ALL_STEPS.indexOf(step)

  return (
    <header
      className="flex h-[var(--topbar-height)] flex-none items-center gap-3 border-b-2 border-divider pl-4 pr-3 2xl:gap-5 2xl:pl-5 2xl:pr-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="flex min-w-0 flex-none items-center gap-2.5">
        <AppMark size={28} />
        <div className="flex flex-col leading-[1.1]">
          <span className="truncate font-heading text-[15px] font-extrabold">{APP_NAME}</span>
          <span className="text-xs text-muted">{VENDOR}</span>
        </div>
      </div>

      <div className="h-8 w-0.5 flex-none bg-divider" />

      <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto 2xl:gap-3" aria-label="Steps">
        {ALL_STEPS.map((candidate, i) => {
          const isCurrent = candidate === step
          const isActive = ACTIVE_STEPS.includes(candidate)
          // Only a step that exists and was actually passed through counts as
          // done. Print sheet is not built yet, so it must not claim a tick
          // just because Export comes after it.
          const isDone = isActive && i < currentIndex && status === 'ready'
          const reachable = isActive && status === 'ready'

          return (
            <div key={candidate} className="flex flex-none items-center gap-1.5 2xl:gap-3">
              {i > 0 && <div className="h-0.5 w-3 flex-none bg-divider 2xl:w-7" />}
              {isCurrent ? (
                <div className="flex h-9 flex-none items-center gap-2 2xl:h-10 2xl:gap-2.5">
                  <span
                    className="tabular grid h-6 w-6 place-items-center 2xl:h-7 2xl:w-7 text-sm font-extrabold"
                    style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
                  >
                    {i + 1}
                  </span>
                  <span className="whitespace-nowrap text-[13px] 2xl:text-[15px] font-extrabold">
                    {STEP_LABELS[candidate]}
                  </span>
                </div>
              ) : isDone ? (
                <button
                  type="button"
                  onClick={() => setStep(candidate)}
                  title="Go back to this step"
                  className="flex h-9 flex-none items-center gap-2 2xl:h-10 2xl:gap-2.5 pr-2 hover:text-accent-700"
                >
                  <span className="grid h-6 w-6 place-items-center 2xl:h-7 2xl:w-7 border-2 border-current">
                    <Icon path={ICONS.check} size={14} strokeWidth={3} />
                  </span>
                  <span className="whitespace-nowrap text-[13px] 2xl:text-[15px] font-semibold">
                    {STEP_LABELS[candidate]}
                  </span>
                </button>
              ) : (
                <div
                  className="flex h-9 flex-none items-center gap-2 2xl:h-10 2xl:gap-2.5 text-muted"
                  title={reachable ? undefined : 'Not available yet'}
                >
                  <span className="tabular grid h-6 w-6 place-items-center 2xl:h-7 2xl:w-7 border border-divider text-sm">
                    {i + 1}
                  </span>
                  <span className="whitespace-nowrap text-[13px] 2xl:text-[15px]">{STEP_LABELS[candidate]}</span>
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="ml-auto flex flex-none items-center gap-3">
        <span className="flex flex-none items-center gap-2 text-[13px] text-muted">
          <span
            className="h-2 w-2"
            style={{ background: runtime?.ortLoaded ? 'var(--ok-line)' : 'var(--danger)' }}
            aria-hidden
          />
          <span className="hidden 2xl:inline">{runtime?.ortLoaded ? 'Offline & ready' : 'Runtime unavailable'}</span>
        </span>
        <LicenseChip />
        <IconButton title="Show me how to use this" onClick={startTutorial}>
          <Icon path={ICONS.help} size={18} />
        </IconButton>
        <IconButton title="Licence and settings" onClick={openLicense}>
          <Icon path={ICONS.settings} size={18} />
        </IconButton>
      </div>
    </header>
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

function ActionBar({
  onBack,
  onNext,
  canGoBack,
  nextLabel,
  onNewPhoto,
  isLast,
  primaryAction,
}: {
  onBack: () => void
  onNext: () => void
  canGoBack: boolean
  nextLabel: string
  onNewPhoto: () => void
  isLast: boolean
  /** Rendered as the step's own primary action, ahead of Next. */
  primaryAction?: React.ReactNode
}) {
  return (
    <footer
      className="flex h-[var(--actionbar-height)] flex-none items-center justify-between gap-4 border-t-2 border-divider px-5"
      style={{ background: 'var(--color-bg)' }}
    >
      <button
        type="button"
        data-tour="new-photo"
        onClick={onNewPhoto}
        className="px-1 text-sm font-extrabold text-accent hover:underline"
      >
        New photo
      </button>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          className="flex h-11 items-center gap-2 border border-divider px-4 text-sm font-extrabold transition-colors duration-[var(--duration-fast)] hover:bg-[var(--hover)] disabled:opacity-45"
        >
          <Icon path={ICONS.back} size={16} />
          Back
        </button>
        {/*
          When a step supplies its own primary action, that action takes the
          accent and Next steps down to an outline. On the sheet step the job
          is finished by printing; going on to Export is a choice, not the
          next thing to do.
        */}
        {primaryAction ? (
          <>
            <button
              type="button"
              onClick={isLast ? onNewPhoto : onNext}
              className="h-11 border border-divider px-4 text-sm font-extrabold transition-colors duration-[var(--duration-fast)] hover:bg-[var(--hover)]"
            >
              {nextLabel}
            </button>
            {primaryAction}
          </>
        ) : (
          <button
            type="button"
            onClick={isLast ? onNewPhoto : onNext}
            className="h-11 px-6 text-[15px] font-extrabold transition-colors duration-[var(--duration-fast)]"
            style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
          >
            {nextLabel}
          </button>
        )}
      </div>
    </footer>
  )
}
