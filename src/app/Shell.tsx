/**
 * The window chrome shared by both flows: the header with its numbered step
 * list, and the action bar. Each flow supplies its own steps.
 */

import { LicenseChip, useLicense } from '../features/license/LicenseDialog'
import { useTutorial } from '../features/tutorial/TutorialProvider'
import { APP_NAME, VENDOR } from '../lib/presets'
import type { RuntimeInfo } from '../lib/tauri'
import { AppMark, Icon, ICONS, IconButton } from './components/ui'

export function StepHeader({
  runtime,
  steps,
  activeSteps,
  current,
  ready,
  onSelect,
}: {
  runtime: RuntimeInfo | null
  steps: { key: string; label: string }[]
  activeSteps: string[]
  current: string
  ready: boolean
  onSelect: (key: string) => void
}) {
  const { open: openLicense } = useLicense()
  const { start: startTutorial } = useTutorial()
  const currentIndex = steps.findIndex((s) => s.key === current)

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
        {steps.map(({ key: candidate, label }, i) => {
          const isCurrent = candidate === current
          const isActive = activeSteps.includes(candidate)
          // Only a step that exists and was actually passed through counts as
          // done. Print sheet is not built yet, so it must not claim a tick
          // just because Export comes after it.
          const isDone = isActive && i < currentIndex && ready
          const reachable = isActive && ready

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
                    {label}
                  </span>
                </div>
              ) : isDone ? (
                <button
                  type="button"
                  onClick={() => onSelect(candidate)}
                  title="Go back to this step"
                  className="flex h-9 flex-none items-center gap-2 2xl:h-10 2xl:gap-2.5 pr-2 hover:text-accent-700"
                >
                  <span className="grid h-6 w-6 place-items-center 2xl:h-7 2xl:w-7 border-2 border-current">
                    <Icon path={ICONS.check} size={14} strokeWidth={3} />
                  </span>
                  <span className="whitespace-nowrap text-[13px] 2xl:text-[15px] font-semibold">
                    {label}
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
                  <span className="whitespace-nowrap text-[13px] 2xl:text-[15px]">{label}</span>
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

export function ActionBar({
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
