/**
 * Step 1 — Import (DESIGN_BRIEF §3.1).
 *
 * Drop, browse or paste. After a photo arrives this becomes the processing
 * state: the photo under a slow scan shimmer, so the wait reads as the app
 * working rather than the app hanging.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { Banner, Button, ProgressBar } from '../../app/components/ui'
import { drawBitmap, imageFromClipboard } from '../../lib/bitmap'
import { useJob } from '../../store/job'
import { usePhotoPipeline } from './usePhotoPipeline'

const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp']

export function ImportStep() {
  const status = useJob((s) => s.status)
  const error = useJob((s) => s.error)
  const progress = useJob((s) => s.progress)
  const setError = useJob((s) => s.setError)
  const { run } = usePhotoPipeline()

  const [dragging, setDragging] = useState(false)
  const busy = status === 'loading' || status === 'segmenting'

  const pick = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Photos', extensions: EXTENSIONS }],
    })
    if (typeof selected === 'string') void run({ path: selected })
  }, [run])

  const fromFile = useCallback(
    async (file: File) => {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
      void run({ bytes })
    },
    [run],
  )

  // Ctrl+V anywhere on the step.
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

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragging(false)
      if (busy) return
      const file = event.dataTransfer.files?.[0]
      if (!file) return
      if (!file.type.startsWith('image/')) {
        setError({ kind: 'unsupportedFormat', message: `${file.name} is not an image.` })
        return
      }
      void fromFile(file)
    },
    [busy, fromFile, setError],
  )

  if (busy) return <Processing label={progress?.label} fraction={progress?.fraction ?? 0} />

  return (
    <div className="flex h-full w-full max-w-3xl flex-col justify-center gap-4 p-6">
      {error && (
        <Banner tone="danger" action={<Button variant="ghost" onClick={pick}>Try another</Button>}>
          {error.message}
        </Banner>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-10 text-center transition-colors duration-[var(--duration-fast)] ${
          dragging ? 'border-accent bg-accent/15' : 'border-white/35 bg-white/5'
        }`}
      >
        <PhotoGlyph />
        <div>
          <p className="text-lg font-medium text-white">Drop a photo here</p>
          <p className="mt-1 text-sm text-white/75">or click Browse, or press Ctrl+V to paste</p>
        </div>
        <Button variant="primary" size="lg" onClick={pick}>
          Browse…
        </Button>
        <p className="text-xs text-white/60">JPG, PNG, WebP, BMP</p>
      </div>
    </div>
  )
}

function Processing({ label, fraction }: { label?: string; fraction: number }) {
  const preview = useJob((s) => s.preview)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (preview && canvasRef.current) drawBitmap(canvasRef.current, preview)
  }, [preview])

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 p-6">
      <div className="relative max-h-[60vh] overflow-hidden rounded-md shadow-lg">
        {preview ? (
          <canvas ref={canvasRef} className="max-h-[60vh] w-auto object-contain" />
        ) : (
          <div className="h-64 w-48 animate-pulse bg-white/15" />
        )}
        {/* A slow sweep, not a spinner: it reads as the photo being worked on. */}
        <div className="pointer-events-none absolute inset-0 animate-[shimmer_2.2s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-white/25 to-transparent" />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-1.5 flex justify-between text-sm text-white">
          <span>{label ?? 'Preparing the photo'}…</span>
          <span className="tabular text-white/75">{Math.round(fraction * 100)}%</span>
        </div>
        <ProgressBar fraction={fraction} />
        <p className="mt-2 text-center text-xs text-white/60">
          Removing the background at full resolution. This takes a few seconds.
        </p>
      </div>
    </div>
  )
}

function PhotoGlyph() {
  return (
    <svg width="56" height="56" viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect
        x="5"
        y="9"
        width="38"
        height="30"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
        className="text-white/60"
      />
      <circle cx="17" cy="20" r="4" className="fill-white/60" />
      <path
        d="M8 34l10-9 7 6 6-5 9 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-white/60"
      />
    </svg>
  )
}
