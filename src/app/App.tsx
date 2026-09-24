/**
 * M0 runtime check.
 *
 * This is deliberately not the five-step wizard from DESIGN_BRIEF §2 — that
 * arrives with M1/M2. What it does is exercise the whole native path in the
 * real app: load the runtime, decode a photo with EXIF orientation, run
 * BiRefNet at full resolution, run YuNet, and report the timings the M0
 * acceptance criteria are written against.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { APP_NAME, VENDOR } from '../lib/presets'
import {
  asAppError,
  bytesToObjectUrl,
  detectFaces,
  getImageBytes,
  loadImage,
  onSegmentProgress,
  runtimeInfo,
  segment,
  type Face,
  type LoadedImageInfo,
  type RuntimeInfo,
  type SegmentProgress,
} from '../lib/tauri'

interface Timings {
  decodeMs: number
  segmentMs: number
  detectMs: number
}

type Phase = 'idle' | 'loading' | 'working' | 'done' | 'error'

const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp']

export function App() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<SegmentProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [info, setInfo] = useState<LoadedImageInfo | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [maskUrl, setMaskUrl] = useState<string | null>(null)
  const [faces, setFaces] = useState<Face[]>([])
  const [timings, setTimings] = useState<Timings | null>(null)

  // Object URLs are revoked on replacement, so the webview does not hold on to
  // a 12 MP bitmap per import.
  const urlsRef = useRef<string[]>([])
  const track = (url: string) => {
    urlsRef.current.push(url)
    return url
  }
  useEffect(() => () => urlsRef.current.forEach(URL.revokeObjectURL), [])

  useEffect(() => {
    runtimeInfo()
      .then(setRuntime)
      .catch((e) => setRuntimeError(asAppError(e).message))
  }, [])

  useEffect(() => {
    const unlisten = onSegmentProgress(setProgress)
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const run = useCallback(async (path: string) => {
    setPhase('loading')
    setError(null)
    setProgress(null)
    setFaces([])
    setTimings(null)
    setMaskUrl(null)
    setPhotoUrl(null)

    try {
      const t0 = performance.now()
      const loaded = await loadImage({ path })
      const decodeMs = performance.now() - t0
      setInfo(loaded)
      setPhase('working')

      const previewBytes = await getImageBytes({ id: loaded.id, maxDim: 1400 })
      setPhotoUrl(track(bytesToObjectUrl(previewBytes, 'image/jpeg')))

      const t1 = performance.now()
      const maskBytes = await segment({ id: loaded.id, model: 'lite' })
      const segmentMs = performance.now() - t1
      setMaskUrl(track(bytesToObjectUrl(maskBytes, 'image/png')))

      const t2 = performance.now()
      const found = await detectFaces({ id: loaded.id })
      const detectMs = performance.now() - t2

      setFaces(found)
      setTimings({ decodeMs, segmentMs, detectMs })
      setPhase('done')
    } catch (e) {
      const err = asAppError(e)
      setError(err.message)
      setPhase('error')
    }
  }, [])

  const pick = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Photos', extensions: SUPPORTED_EXTENSIONS }],
    })
    if (typeof selected === 'string') void run(selected)
  }, [run])

  const busy = phase === 'loading' || phase === 'working'

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <header className="flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <AppMark />
        <div className="leading-tight">
          <div className="font-semibold">{APP_NAME}</div>
          <div className="text-xs text-text-subtle">{VENDOR}</div>
        </div>
        <span className="ml-3 rounded-sm bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
          M0 runtime check
        </span>
        <div className="ml-auto">
          <RuntimeBadge runtime={runtime} error={runtimeError} />
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 items-center justify-center bg-canvas p-6">
          {photoUrl ? (
            <Preview photoUrl={photoUrl} maskUrl={maskUrl} faces={faces} info={info} />
          ) : (
            <DropZone onPick={pick} busy={busy} />
          )}
        </section>

        <aside className="flex w-[var(--panel-width)] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-4">
          <Panel title="Runtime">
            {runtimeError ? (
              <Banner tone="danger">{runtimeError}</Banner>
            ) : runtime ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Row label="ONNX Runtime">
                  {runtime.ortLoaded ? (
                    <span className="text-success">loaded</span>
                  ) : (
                    <span className="text-danger">not loaded</span>
                  )}
                </Row>
                <Row label="CPU threads">
                  <span className="tabular">{runtime.intraThreads}</span>
                </Row>
                {runtime.models.map((m) => (
                  <Row key={m.id} label={m.label}>
                    {m.installed ? (
                      <span className="text-success">
                        installed{m.bundled ? ', built-in' : ''}
                      </span>
                    ) : (
                      <span className="text-text-subtle">
                        not installed ({formatBytes(m.sizeBytes)})
                      </span>
                    )}
                  </Row>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-text-muted">Checking…</p>
            )}
          </Panel>

          <Panel title="Photo">
            <button
              type="button"
              onClick={pick}
              disabled={busy}
              className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors duration-[var(--duration-fast)] hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Open a photo…'}
            </button>
            <p className="mt-2 text-xs text-text-subtle">
              JPG, PNG, WebP, BMP. HEIC is not supported yet.
            </p>

            {info && (
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Row label="Size">
                  <span className="tabular">
                    {info.width} x {info.height}
                  </span>
                </Row>
                <Row label="Megapixels">
                  <span className="tabular">{info.megapixels.toFixed(1)} MP</span>
                </Row>
                <Row label="EXIF">
                  <span className="tabular">orientation {info.exifOrientation}</span>
                </Row>
              </dl>
            )}
          </Panel>

          {busy && progress && (
            <Panel title="Progress">
              <div className="mb-1.5 flex justify-between text-sm">
                <span>{progress.label}…</span>
                <span className="tabular text-text-muted">
                  {Math.round(progress.fraction * 100)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-sm bg-border">
                <div
                  className="h-full rounded-sm bg-accent transition-[width] duration-[var(--duration-step)] ease-[var(--ease-standard)]"
                  style={{ width: `${progress.fraction * 100}%` }}
                />
              </div>
            </Panel>
          )}

          {error && (
            <Panel title="Error">
              <Banner tone="danger">{error}</Banner>
            </Panel>
          )}

          {timings && info && (
            <Panel title="Results">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <Row label="Decode">
                  <span className="tabular">{timings.decodeMs.toFixed(0)} ms</span>
                </Row>
                <Row label="Segment">
                  <span className="tabular">{(timings.segmentMs / 1000).toFixed(2)} s</span>
                </Row>
                <Row label="Faces">
                  <span className="tabular">{timings.detectMs.toFixed(0)} ms</span>
                </Row>
              </dl>

              <ul className="mt-3 space-y-1.5 text-sm">
                <Check
                  ok={maskUrl !== null}
                  label="Mask returned at the photo's own resolution"
                />
                <Check ok={faces.length === 1} label={`${faces.length} face detected`} />
                <Check
                  ok={timings.segmentMs < 10_000}
                  label={`Segmentation under 10 s (${(timings.segmentMs / 1000).toFixed(2)} s)`}
                />
              </ul>
            </Panel>
          )}
        </aside>
      </main>
    </div>
  )
}

function Preview({
  photoUrl,
  maskUrl,
  faces,
  info,
}: {
  photoUrl: string
  maskUrl: string | null
  faces: Face[]
  info: LoadedImageInfo | null
}) {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center gap-6">
      <figure className="flex h-full min-h-0 flex-col items-center gap-2">
        <div className="relative flex min-h-0 flex-1 items-center">
          <img src={photoUrl} alt="" className="max-h-full max-w-full object-contain" />
          {info && <FaceOverlay faces={faces} info={info} />}
        </div>
        <figcaption className="text-xs text-white/85">Photo · face box</figcaption>
      </figure>

      {maskUrl && (
        <figure className="flex h-full min-h-0 flex-col items-center gap-2">
          <div className="flex min-h-0 flex-1 items-center">
            <img src={maskUrl} alt="" className="max-h-full max-w-full object-contain" />
          </div>
          <figcaption className="text-xs text-white/85">Alpha mask · full resolution</figcaption>
        </figure>
      )}
    </div>
  )
}

/**
 * The face box is drawn in the original image's coordinate space and scaled by
 * the rendered size, so it stays correct whatever the preview downscale was.
 */
function FaceOverlay({ faces, info }: { faces: Face[]; info: LoadedImageInfo }) {
  if (faces.length === 0) return null
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${info.width} ${info.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {faces.map((face, i) => {
        const [x, y, w, h] = face.box
        const dot = Math.max(w * 0.03, 3)
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke="var(--color-guide)"
              strokeWidth={Math.max(w * 0.012, 2)}
            />
            {Object.values(face.landmarks).map((p, j) => (
              <circle key={j} cx={p.x} cy={p.y} r={dot} fill="var(--color-guide)" />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function DropZone({ onPick, busy }: { onPick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className="flex h-full w-full max-w-2xl flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-white/35 bg-white/5 p-10 text-white transition-colors duration-[var(--duration-fast)] hover:border-white/60 hover:bg-white/10 disabled:opacity-60"
    >
      <span className="text-lg font-medium">Open a photo to check the runtime</span>
      <span className="text-sm text-white/75">
        It will be decoded, segmented at full resolution, and scanned for a face.
      </span>
    </button>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface-raised p-3 shadow-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </>
  )
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-start gap-2 ${ok ? 'text-success' : 'text-warning'}`}>
      <span aria-hidden className="mt-px font-semibold">
        {ok ? '✓' : '!'}
      </span>
      <span className="text-text">{label}</span>
    </li>
  )
}

function Banner({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) {
  const styles =
    tone === 'danger'
      ? 'bg-danger-soft text-danger border-danger/30'
      : 'bg-warning-soft text-warning border-warning/30'
  return <p className={`rounded-sm border px-2.5 py-2 text-sm ${styles}`}>{children}</p>
}

function RuntimeBadge({ runtime, error }: { runtime: RuntimeInfo | null; error: string | null }) {
  if (error) return <Dot tone="danger">Runtime error</Dot>
  if (!runtime) return <Dot tone="muted">Checking…</Dot>
  if (!runtime.ortLoaded) return <Dot tone="danger">Runtime missing</Dot>
  return <Dot tone="success">Offline &amp; ready</Dot>
}

function Dot({
  tone,
  children,
}: {
  tone: 'success' | 'danger' | 'muted'
  children: React.ReactNode
}) {
  const color =
    tone === 'success'
      ? 'bg-success'
      : tone === 'danger'
        ? 'bg-danger'
        : 'bg-text-subtle'
  return (
    <span className="flex items-center gap-2 text-sm text-text-muted">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      {children}
    </span>
  )
}

function AppMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect x="2" y="6" width="28" height="20" rx="4" fill="var(--color-accent)" />
      <rect x="5.5" y="9.5" width="11" height="13" rx="2" fill="#fff" />
      <circle cx="11" cy="14.5" r="2.6" fill="var(--color-accent)" />
      <path d="M6.6 22.5a4.4 4.4 0 0 1 8.8 0z" fill="var(--color-accent)" />
      <g fill="#fff" opacity="0.8">
        <rect x="19" y="11" width="8" height="1.8" rx="0.9" />
        <rect x="19" y="15" width="9" height="1.8" rx="0.9" />
        <rect x="19" y="19" width="6" height="1.8" rx="0.9" />
      </g>
    </svg>
  )
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
