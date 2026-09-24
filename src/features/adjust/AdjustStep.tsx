/**
 * Step 2 — Adjust (DESIGN_BRIEF §3.2).
 *
 * The photo sits behind an aspect-locked crop window; everything outside it is
 * dimmed by a single enormous box-shadow, which is how the design does it. On
 * top sit the guides that decide whether the photo is acceptable: crown line,
 * eye line, chin *band*, and a centre line. They read green when the head is
 * inside the preset's band and amber when it is not, so the operator can judge
 * the crop without knowing any of the rules.
 *
 * The crown and chin handles are the escape hatch. Auto-align is a heuristic
 * built on a landmark-derived chin estimate, and when it is wrong the operator
 * drags rather than fights it (BUILD_PLAN §10).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { Icon, ICONS, IconButton, Notice, Section, Segmented, Slider } from '../../app/components/ui'
import { drawBitmap } from '../../lib/bitmap'
import { composite } from '../../lib/composite'
import {
  geometry,
  headAt,
  headStatus,
  headStatusMessage,
  type HeadStatus,
} from '../../lib/autoCrop'
import { PHOTO_PRESETS } from '../../lib/presets'
import { useJob } from '../../store/job'

/** Crop window height as a fraction of the canvas, from the design. */
const CROP_FRACTION = 0.66

function guideColour(status: HeadStatus): string {
  if (status === 'ok') return 'var(--ok-line)'
  if (status === 'manual') return 'var(--color-accent)'
  return 'var(--warn-line)'
}

export function AdjustCanvas() {
  const preview = useJob((s) => s.preview)
  const previewMask = useJob((s) => s.previewMask)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const presetId = useJob((s) => s.presetId)
  const zoom = useJob((s) => s.zoom)
  const rotation = useJob((s) => s.rotation)
  const offsetX = useJob((s) => s.offsetX)
  const offsetY = useJob((s) => s.offsetY)
  const faces = useJob((s) => s.faces)
  const setCrownChin = useJob((s) => s.setCrownChin)
  const crownOverride = useJob((s) => s.crownOverride)
  const chinOverride = useJob((s) => s.chinOverride)

  const wrapRef = useRef<HTMLDivElement>(null)
  const cropRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<'crown' | 'chin' | null>(null)

  const preset = PHOTO_PRESETS[presetId]
  const g = useMemo(() => geometry(preset), [preset])
  const z = zoom / 100

  // Manual handles win over the zoom-derived head once dragged.
  const head = useMemo(() => {
    const auto = headAt(g, z)
    return {
      crown: crownOverride ?? auto.crown,
      chin: chinOverride ?? auto.chin,
    }
  }, [g, z, crownOverride, chinOverride])

  const status = headStatus(g, z, { faceFound: faces.length > 0 })
  const colour = guideColour(status)

  // The subject is shown already cut out, so the operator judges the final
  // look while cropping rather than discovering it a step later.
  const result = useMemo(() => {
    if (!preview || !previewMask) return null
    return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail })
  }, [preview, previewMask, background, edgeSoftness, hairDetail])

  useEffect(() => {
    if (result && canvasRef.current) drawBitmap(canvasRef.current, result)
  }, [result])

  // Dragging a handle maps the pointer's position inside the crop window back
  // to a fraction of crop height.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const which = dragRef.current
      const rect = cropRef.current?.getBoundingClientRect()
      if (!which || !rect) return
      const fraction = (event.clientY - rect.top) / rect.height
      setCrownChin(which, Math.min(Math.max(fraction, -0.2), 1.2))
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setCrownChin])

  if (!preview) return null

  const cropStyle: React.CSSProperties = {
    aspectRatio: `${g.aspect}`,
    height: `${CROP_FRACTION * 100}%`,
    // One huge shadow dims everything outside the window.
    boxShadow: '0 0 0 4000px var(--dim)',
    outline: '2px solid #fff',
  }

  const line = (y: number, dashed: boolean): React.CSSProperties => ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: `${y * 100}%`,
    height: 0,
    borderTop: `${dashed ? 1 : 2}px ${dashed ? 'dashed' : 'solid'} ${colour}`,
  })

  const label = (y: number): React.CSSProperties => ({
    position: 'absolute',
    left: '100%',
    marginLeft: 14,
    top: `${y * 100}%`,
    transform: 'translateY(-50%)',
    height: 22,
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    borderLeft: `3px solid ${colour}`,
  })

  const handle = (y: number): React.CSSProperties => ({
    position: 'absolute',
    left: 'calc(100% - 9px)',
    top: `calc(${y * 100}% - 9px)`,
    width: 18,
    height: 18,
    background: '#fff',
    border: `3px solid ${colour}`,
    cursor: 'ns-resize',
    boxShadow: 'var(--shadow-sm)',
  })

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* The photo, transformed underneath the fixed crop window. */}
      <canvas
        ref={canvasRef}
        className="absolute max-w-none"
        style={{
          height: `${CROP_FRACTION * 100 * 1.5}%`,
          transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg) scale(${z})`,
          transformOrigin: 'center',
          boxShadow: 'var(--shadow-lg)',
        }}
      />

      <div ref={cropRef} className="relative" style={cropStyle}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '50%',
            width: 0,
            borderLeft: `1px dashed ${colour}`,
          }}
        />
        <div style={line(g.crown, true)} />
        <div style={line(g.eye, true)} />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${g.chinMin * 100}%`,
            height: `${(g.chinMax - g.chinMin) * 100}%`,
            background: `color-mix(in srgb, ${colour} 16%, transparent)`,
            borderTop: `2px solid ${colour}`,
            borderBottom: `2px solid ${colour}`,
          }}
        />

        <div
          onMouseDown={(e) => {
            e.preventDefault()
            dragRef.current = 'crown'
          }}
          title="Drag to set the crown"
          style={handle(head.crown)}
        />
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            dragRef.current = 'chin'
          }}
          title="Drag to set the chin"
          style={handle(head.chin)}
        />

        <div style={label(g.crown)}>Crown</div>
        <div style={label(g.eye)}>Eyes</div>
        <div style={label((g.chinMin + g.chinMax) / 2)}>Chin range</div>
      </div>

      {/* Status, top-left over the canvas. */}
      <div className="pointer-events-none absolute left-6 top-5 flex flex-col items-start gap-2.5">
        <StatusChip status={status} />
        {faces.length > 1 && (
          <span className="bg-accent px-2.5 py-1 text-xs font-bold text-on-accent">
            {faces.length} faces found — click one
          </span>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: HeadStatus }) {
  const colour = guideColour(status)
  return (
    <span
      className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-bold"
      style={{ background: 'var(--color-bg)', borderLeft: `3px solid ${colour}`, color: 'var(--color-text)' }}
    >
      <span className="h-2 w-2" style={{ background: colour }} />
      {headStatusMessage(status)}
    </span>
  )
}

export function AdjustPanel() {
  const presetId = useJob((s) => s.presetId)
  const zoom = useJob((s) => s.zoom)
  const rotation = useJob((s) => s.rotation)
  const levelEyes = useJob((s) => s.levelEyes)
  const faces = useJob((s) => s.faces)
  const setZoom = useJob((s) => s.setZoom)
  const setRotation = useJob((s) => s.setRotation)
  const setLevelEyes = useJob((s) => s.setLevelEyes)
  const resetAdjust = useJob((s) => s.resetAdjust)
  const runAutoAlign = useJob((s) => s.runAutoAlign)

  const preset = PHOTO_PRESETS[presetId]
  const g = useMemo(() => geometry(preset), [preset])
  const status = headStatus(g, zoom / 100, { faceFound: faces.length > 0 })

  const nudge = useCallback(
    (delta: number) => setZoom(Math.min(180, Math.max(50, zoom + delta))),
    [zoom, setZoom],
  )

  return (
    <>
      {status !== 'ok' && (
        <div className="px-6 pt-5">
          <Notice
            tone={status === 'manual' ? 'info' : 'warn'}
            icon={<Icon path={ICONS.warning} size={20} />}
          >
            {headStatusMessage(status)}
          </Notice>
        </div>
      )}

      <Section title="Alignment">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={runAutoAlign}
            disabled={faces.length === 0}
            className="flex-1 border border-divider px-3 py-2 text-sm font-extrabold transition-colors duration-[var(--duration-fast)] hover:bg-[var(--hover)] disabled:opacity-45"
          >
            Auto-align
          </button>
          <IconButton title="Reset the crop" onClick={resetAdjust}>
            <Icon path={ICONS.rotate} size={16} />
          </IconButton>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={levelEyes}
            onChange={(e) => setLevelEyes(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          Level the eyes
        </label>
      </Section>

      <Section title="Head size">
        <div className="flex items-center gap-2">
          <IconButton title="Zoom out (Ctrl+scroll)" onClick={() => nudge(-5)}>
            <Icon path={ICONS.zoomOut} size={16} />
          </IconButton>
          <div className="flex-1">
            <Slider
              label="Zoom"
              value={zoom}
              min={50}
              max={180}
              step={1}
              defaultValue={100}
              format={(v) => `${v}%`}
              onChange={setZoom}
            />
          </div>
          <IconButton title="Zoom in (Ctrl+scroll)" onClick={() => nudge(5)}>
            <Icon path={ICONS.zoomIn} size={16} />
          </IconButton>
        </div>

        <Slider
          label="Rotate"
          value={rotation}
          min={-15}
          max={15}
          step={0.5}
          defaultValue={0}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`}
          onChange={setRotation}
        />
        <p className="text-xs text-muted">
          Drag the crown and chin handles on the canvas if the automatic guess is off.
        </p>
      </Section>

      {faces.length > 1 && (
        <Section title="Face">
          <Segmented
            options={faces.map((_, i) => ({ value: String(i), label: `Face ${i + 1}` }))}
            value="0"
            onChange={() => undefined}
            columns={Math.min(faces.length, 3)}
          />
          <p className="text-xs text-muted">Pick the customer if more than one person is in frame.</p>
        </Section>
      )}
    </>
  )
}
