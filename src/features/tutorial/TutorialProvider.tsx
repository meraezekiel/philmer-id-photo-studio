/**
 * The first-run walkthrough.
 *
 * It follows the operator rather than driving them: the tips for a step are
 * shown while they are on that step, and when they move on, the tour moves
 * with them. Nothing is blocked — the scrim does not take clicks — because a
 * tutorial that traps someone is worse than no tutorial at a counter with a
 * customer waiting.
 *
 * Every sentence lives in `script.ts`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { Button } from '../../app/components/ui'
import { useJob } from '../../store/job'
import { FINISHED, TOUR, WELCOME, type Tip } from './script'

/** Per-machine, and only ever "have they seen it". */
const SEEN_KEY = 'philmer.tutorial.seen'

function hasSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    // Private mode, blocked storage: better to show it than to crash.
    return false
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* nothing to do; the tour simply runs again next time */
  }
}

interface TutorialValue {
  running: boolean
  start: () => void
  stop: () => void
}

const TutorialContext = createContext<TutorialValue>({
  running: false,
  start: () => undefined,
  stop: () => undefined,
})

export function useTutorial() {
  return useContext(TutorialContext)
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const step = useJob((s) => s.step)
  const [phase, setPhase] = useState<'idle' | 'welcome' | 'running'>(() =>
    hasSeen() ? 'idle' : 'welcome',
  )
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)

  const tips = useMemo(() => TOUR.filter((tip) => tip.step === step), [step])

  // Moving to another step of the flow restarts the tips at that step's
  // first one — the operator's own progress is what drives the tour.
  useEffect(() => {
    setIndex(0)
    setDone(false)
  }, [step])

  const stop = useCallback(() => {
    setPhase('idle')
    markSeen()
  }, [])

  const start = useCallback(() => {
    setIndex(0)
    setDone(false)
    setPhase('running')
    // Seen the moment it starts, not when it ends. Someone who breaks off
    // half way to serve a customer has still met it, and meeting the welcome
    // screen twice feels like the app forgot them.
    markSeen()
  }, [])

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 < tips.length) return i + 1
      setDone(true)
      return i
    })
  }, [tips.length])

  const back = useCallback(() => {
    setDone(false)
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  // Escape leaves the tour, the way it leaves every other overlay here.
  useEffect(() => {
    if (phase === 'idle') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, stop])

  const tip = phase === 'running' ? tips[index] : undefined

  return (
    <TutorialContext.Provider value={{ running: phase === 'running', start, stop }}>
      {children}

      {phase === 'welcome' && (
        <Welcome onStart={start} onSkip={stop} />
      )}

      {tip && (
        <Coachmark
          tip={tip}
          position={index + 1}
          total={tips.length}
          atEnd={done || index === tips.length - 1}
          finished={done && isLastStepOfTour(tip)}
          onNext={next}
          onBack={index > 0 ? back : undefined}
          onSkip={stop}
        />
      )}
    </TutorialContext.Provider>
  )
}

function isLastStepOfTour(tip: Tip): boolean {
  return tip.id === TOUR[TOUR.length - 1]?.id
}

function Welcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      style={{ background: 'color-mix(in srgb, var(--color-neutral-900) 55%, transparent)' }}
    >
      <div
        className="flex w-[min(460px,100%)] flex-col gap-4 p-6 shadow-lg"
        style={{ background: 'var(--color-surface)' }}
        role="dialog"
        aria-modal="true"
      >
        <h3 className="font-heading text-2xl font-extrabold leading-tight">{WELCOME.title}</h3>
        <p className="text-sm text-muted">{WELCOME.body}</p>
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={onSkip}>{WELCOME.skip}</Button>
          <button
            type="button"
            onClick={onStart}
            className="h-11 px-6 text-[15px] font-extrabold"
            style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
          >
            {WELCOME.start}
          </button>
        </div>
      </div>
    </div>
  )
}

interface Box {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Follow an element's position on screen.
 *
 * Polling rather than observing: the anchors live inside panels that scroll,
 * canvases that resize and steps that swap, and a quarter-second poll is both
 * cheaper to reason about and harder to get wrong than five observers.
 */
function useAnchor(name: string): Box | null {
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    if (!name) {
      setBox(null)
      return
    }
    const measure = () => {
      const node = document.querySelector(`[data-tour="${name}"]`)
      if (!node) {
        setBox(null)
        return
      }
      const rect = node.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setBox(null)
        return
      }
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }
    measure()
    const timer = window.setInterval(measure, 250)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
    }
  }, [name])

  return box
}

const PAD = 6
const CARD_WIDTH = 330
const GAP = 14
/** Below the header, so a tip never covers the step numbers. */
const TOP_SAFE = 76

function Coachmark({
  tip,
  position,
  total,
  atEnd,
  finished,
  onNext,
  onBack,
  onSkip,
}: {
  tip: Tip
  position: number
  total: number
  atEnd: boolean
  finished: boolean
  onNext: () => void
  onBack?: () => void
  onSkip: () => void
}) {
  const box = useAnchor(tip.anchor)
  const view = { width: window.innerWidth, height: window.innerHeight }

  // Put the card wherever there is room: beside the highlight if it fits,
  // otherwise above or below it, and in the middle when there is no anchor.
  const card = placeCard(box, view)

  return (
    <div className="pointer-events-none fixed inset-0 z-[55]">
      {box && (
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <path
            d={`M0 0H${view.width}V${view.height}H0Z M${box.left - PAD} ${box.top - PAD} H${
              box.left + box.width + PAD
            } V${box.top + box.height + PAD} H${box.left - PAD} Z`}
            fillRule="evenodd"
            fill="rgba(24,22,21,.55)"
          />
          <rect
            x={box.left - PAD}
            y={box.top - PAD}
            width={box.width + PAD * 2}
            height={box.height + PAD * 2}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
          />
        </svg>
      )}
      {!box && <div className="absolute inset-0" style={{ background: 'rgba(24,22,21,.55)' }} />}

      <div
        className="pointer-events-auto absolute flex flex-col gap-2.5 p-4 shadow-lg"
        style={{
          width: CARD_WIDTH,
          top: card.top,
          left: card.left,
          background: 'var(--color-surface)',
        }}
        role="dialog"
        aria-live="polite"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h5 className="font-heading text-[17px] font-extrabold leading-tight">{tip.title}</h5>
          <span className="tabular flex-none text-xs text-muted">
            {position}/{total}
          </span>
        </div>
        <p className="text-[13px] leading-snug text-muted">{tip.body}</p>

        {finished && <p className="text-[13px] font-bold">{FINISHED.body}</p>}

        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-bold text-muted hover:underline"
          >
            {finished ? 'Close' : 'Skip the tour'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {onBack && !finished && (
              <button
                type="button"
                onClick={onBack}
                className="h-9 border border-divider px-3 text-[13px] font-bold hover:bg-[var(--hover)]"
              >
                Back
              </button>
            )}
            {!finished &&
              (atEnd && tip.waitFor ? (
                <span className="text-[13px] font-bold text-accent">{tip.waitFor}</span>
              ) : (
                <button
                  type="button"
                  onClick={onNext}
                  className="h-9 px-4 text-[13px] font-extrabold"
                  style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
                >
                  Next
                </button>
              ))}
            {finished && (
              <button
                type="button"
                onClick={onSkip}
                className="h-9 px-4 text-[13px] font-extrabold"
                style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Keeps the card on screen and off the thing it is pointing at. */
function placeCard(box: Box | null, view: { width: number; height: number }): Box {
  const height = 190
  if (!box) {
    return {
      top: view.height / 2 - height / 2,
      left: view.width / 2 - CARD_WIDTH / 2,
      width: CARD_WIDTH,
      height,
    }
  }

  const leftRoom = box.left - GAP - CARD_WIDTH > 8
  const rightRoom = box.left + box.width + GAP + CARD_WIDTH < view.width - 8
  const left = rightRoom
    ? box.left + box.width + GAP
    : leftRoom
      ? box.left - GAP - CARD_WIDTH
      : clamp(box.left + box.width / 2 - CARD_WIDTH / 2, 8, view.width - CARD_WIDTH - 8)

  // Beside the anchor when there is room either side; otherwise below it, or
  // above when the anchor is near the bottom of the window.
  const beside = rightRoom || leftRoom
  const top = beside
    ? clamp(box.top + box.height / 2 - height / 2, TOP_SAFE, view.height - height - 8)
    : box.top + box.height + GAP + height < view.height - 8
      ? box.top + box.height + GAP
      : Math.max(TOP_SAFE, box.top - GAP - height)

  return { top, left, width: CARD_WIDTH, height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
