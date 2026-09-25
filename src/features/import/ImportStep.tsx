/**
 * Step 1 — Import (DESIGN_BRIEF §3.1, styled to the design in `design/`).
 *
 * The empty state is the app's front door, so the design makes it loud: a
 * 460 px dashed panel with a 40 px/800 heading, bottom-left aligned. The
 * processing state replaces it with the photo under a slow scan sweep and a
 * stage checklist, because the wait is 12-15 s and needs to read as work.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'

import { Icon, ICONS, Notice } from '../../app/components/ui'
import { drawBitmap, imageFromClipboard } from '../../lib/bitmap'
import { useJob } from '../../store/job'
import { usePhotoPipeline } from './usePhotoPipeline'

const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp']
const FORMAT_TAGS = ['JPG', 'PNG', 'WebP', 'BMP']

const STAGES = [
  { key: 'preparing', label: 'Preparing the photo' },
  { key: 'running', label: 'Removing the background' },
  { key: 'upscaling', label: 'Refining the edges' },
] as const

export function ImportStep() {
  const status = useJob((s) => s.status)
  const error = useJob((s) => s.error)
  const setError = useJob((s) => s.setError)
  const { run } = usePhotoPipeline()

  const [dragging, setDragging] = useState(false)
  const busy = status === 'loading' || status === 'segmenting'
  const busyRef = useRef(busy)
  busyRef.current = busy

  const pick = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Photos', extensions: EXTENSIONS }],
    })
    if (typeof selected === 'string') void run({ path: selected })
  }, [run])

  const fromFile = useCallback(
    async (file: File) => {
      // Straight through as bytes: Array.from would turn a multi-megabyte
      // buffer into a JS number array and then JSON over the IPC bridge.
      void run({ bytes: await file.arrayBuffer() })
    },
    [run],
  )

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (busy) return
      const file = imageFromClipboard(event)
      if (file) {
        event.preventDefault()
        void fromFile(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [busy, fromFile])

  /**
   * File drops come from Tauri, not from the DOM.
   *
   * `dragDropEnabled` in tauri.conf.json makes the native shell intercept the
   * drop before the webview sees it, so an HTML `onDrop` never fires. The
   * native event is the better source anyway: it hands over real file paths,
   * so the photo is read by Rust instead of being pushed through the webview
   * as bytes.
   */
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload
        if (payload.type === 'enter' || payload.type === 'over') {
          if (!busyRef.current) setDragging(true)
          return
        }
        if (payload.type === 'leave') {
          setDragging(false)
          return
        }
        setDragging(false)
        if (busyRef.current) return

        const path = payload.paths[0]
        if (!path) return
        const extension = path.split('.').pop()?.toLowerCase() ?? ''
        if (!EXTENSIONS.includes(extension)) {
          setError({
            kind: 'unsupportedFormat',
            message: `${path.split(/[\\/]/).pop()} — only JPG, PNG, WebP and BMP can be opened.`,
          })
          return
        }
        void run({ path })
      })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [run, setError])

  if (busy) return <Processing />

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-auto p-6"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="flex w-full max-w-[1040px] flex-col gap-4">
        {error && (
          <Notice
            tone="warn"
            icon={<Icon path={ICONS.warning} size={20} />}
            action={
              <button
                type="button"
                onClick={() => setError(null)}
                title="Dismiss"
                className="grid h-8 w-8 place-items-center"
              >
                <Icon path={ICONS.close} size={16} />
              </button>
            }
          >
            {error.message}
          </Notice>
        )}

        <button
          type="button"
          onClick={pick}
          className="flex w-full cursor-pointer flex-col items-start justify-end gap-3 border-2 border-dashed text-left transition-colors duration-[var(--duration-fast)]"
          style={{
            height: 'clamp(240px, 52vh, 460px)',
            padding: 'clamp(20px, 3vw, 48px)',
            borderColor: dragging ? 'var(--color-accent)' : 'var(--color-divider)',
            background: dragging
              ? 'color-mix(in srgb, var(--color-accent) 5%, var(--color-surface))'
              : 'var(--color-surface)',
          }}
        >
          <Icon path={ICONS.upload} size={40} strokeWidth={1.6} />
          <span
            className="font-heading font-extrabold leading-[1.1] tracking-[-0.015em]"
            style={{ fontSize: 'var(--display-size)' }}
          >
            Drop a photo here, or click to browse
          </span>
          <span className="text-muted" style={{ fontSize: 'clamp(13px, 1.2vw, 17px)' }}>You can also paste an image with Ctrl+V</span>
          <span className="mt-2 flex gap-2">
            {FORMAT_TAGS.map((tag) => (
              <span key={tag} className="border border-divider px-2.5 py-1 text-[13px] font-semibold">
                {tag}
              </span>
            ))}
          </span>
        </button>
      </div>
    </div>
  )
}

function Processing() {
  const preview = useJob((s) => s.preview)
  const progress = useJob((s) => s.progress)
  const reset = useJob((s) => s.reset)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (preview && canvasRef.current) drawBitmap(canvasRef.current, preview)
  }, [preview])

  const fraction = progress?.fraction ?? 0
  const activeIndex = STAGES.findIndex((s) => s.key === progress?.stage)

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-8 p-10"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="relative overflow-hidden shadow-lg" style={{ maxHeight: '46vh' }}>
        {preview ? (
          <canvas ref={canvasRef} className="block w-auto object-contain" style={{ maxHeight: '46vh' }} />
        ) : (
          <div className="h-64 w-48" style={{ background: 'var(--color-surface)' }} />
        )}
        {/* A slow sweep, not a spinner: it reads as this photo being worked on. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            animation: 'scan 2.2s ease-in-out infinite',
            background:
              'linear-gradient(to bottom, transparent, rgba(255,255,255,.28), transparent)',
          }}
        />
      </div>

      <div className="flex w-full max-w-[520px] flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          {STAGES.map((stage, i) => {
            const done = activeIndex > i
            const active = activeIndex === i
            return (
              <div key={stage.key} className="flex items-center gap-2.5 text-[15px]">
                {done ? (
                  <>
                    <span
                      className="grid h-[22px] w-[22px] place-items-center"
                      style={{ background: 'var(--ok-line)', color: '#fff' }}
                    >
                      <Icon path={ICONS.check} size={14} strokeWidth={3} />
                    </span>
                    <span className="text-muted">{stage.label}</span>
                  </>
                ) : active ? (
                  <>
                    <span className="h-[22px] w-[22px] border-2" style={{ borderColor: 'var(--color-accent)' }} />
                    <span className="font-bold">{stage.label}</span>
                  </>
                ) : (
                  <>
                    <span className="h-[22px] w-[22px] border border-divider" />
                    <span className="text-muted">{stage.label}</span>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="relative h-1.5" style={{ background: 'var(--color-surface)' }}>
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-[var(--duration-step)]"
            style={{ width: `${fraction * 100}%`, background: 'var(--color-accent)' }}
          />
        </div>

        <div className="flex items-center justify-between text-sm text-muted">
          <span className="tabular">{Math.round(fraction * 100)}% · Standard model</span>
          <button
            type="button"
            onClick={reset}
            className="h-10 border border-divider px-3.5 text-sm font-bold transition-colors duration-[var(--duration-fast)] hover:bg-[var(--hover)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
