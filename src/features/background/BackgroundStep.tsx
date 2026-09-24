/**
 * Step 3 — Background (DESIGN_BRIEF §3.3, styled to the design in `design/`).
 *
 * The canvas is a split comparison: the original left of a draggable divider,
 * the finished photo right of it, labelled BEFORE and AFTER. That is how the
 * operator confirms the cutout is honest before anything is printed — and it
 * is why the divider drags rather than toggling: you can park it on the
 * hairline and study the edge.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Icon, ICONS, Notice, Section, Slider } from '../../app/components/ui'
import { drawBitmap } from '../../lib/bitmap'
import { composite } from '../../lib/composite'
import { BACKGROUND_SWATCHES, MM_PER_INCH, PHOTO_PRESETS } from '../../lib/presets'
import { useJob } from '../../store/job'

export function BackgroundCanvas() {
  const preview = useJob((s) => s.preview)
  const previewMask = useJob((s) => s.previewMask)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const presetId = useJob((s) => s.presetId)

  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const [split, setSplit] = useState(50)
  const [inspecting, setInspecting] = useState(false)

  const preset = PHOTO_PRESETS[presetId]
  const sizeText =
    `${trim(preset.widthMm)} × ${trim(preset.heightMm)} mm · ` +
    `${trim(preset.widthMm / MM_PER_INCH, 2)} × ${trim(preset.heightMm / MM_PER_INCH, 2)} in`

  const result = useMemo(() => {
    if (!preview || !previewMask) return null
    return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail })
  }, [preview, previewMask, background, edgeSoftness, hairDetail])

  useEffect(() => {
    if (preview && beforeRef.current) drawBitmap(beforeRef.current, preview)
  }, [preview])
  useEffect(() => {
    if (result && afterRef.current) drawBitmap(afterRef.current, result)
  }, [result])

  const moveSplit = useCallback((clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) moveSplit(e.clientX)
    }
    const onUp = () => {
      draggingRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [moveSplit])

  // Hold "\" to see the original outright (DESIGN_BRIEF §6).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === '\\') setSplit(100)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === '\\') setSplit(50)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  if (!preview) return null

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-8">
      <div
        ref={boxRef}
        className="relative select-none shadow-lg"
        style={{
          height: '78%',
          aspectRatio: `${preset.widthMm / preset.heightMm}`,
          cursor: 'ew-resize',
          overflow: 'hidden',
        }}
        onMouseDown={(e) => {
          draggingRef.current = true
          moveSplit(e.clientX)
        }}
      >
        <canvas
          ref={afterRef}
          className="absolute inset-0 h-full w-full"
          style={{ objectFit: 'cover', imageRendering: inspecting ? 'pixelated' : 'auto' }}
        />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
          <canvas
            ref={beforeRef}
            className="h-full w-full"
            style={{ objectFit: 'cover', imageRendering: inspecting ? 'pixelated' : 'auto' }}
          />
        </div>

        <div
          className="absolute bottom-0 top-0"
          style={{
            left: `${split}%`,
            width: 2,
            marginLeft: -1,
            background: '#fff',
            boxShadow: '0 0 0 1px rgba(0,0,0,.15)',
          }}
        >
          <div
            className="absolute grid place-items-center bg-white shadow"
            style={{ left: -17, top: '50%', marginTop: -18, width: 36, height: 36, color: '#201e1d' }}
          >
            <Icon path={['m9 18-6-6 6-6', 'm15 6 6 6-6 6']} size={18} />
          </div>
        </div>

        <span
          className="pointer-events-none absolute left-3 top-3 px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white"
          style={{ background: 'rgba(32,30,29,.8)' }}
        >
          Before
        </span>
        <span
          className="pointer-events-none absolute right-3 top-3 px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white"
          style={{ background: 'rgba(32,30,29,.8)' }}
        >
          After
        </span>
      </div>

      <div className="pointer-events-none absolute left-6 top-5 flex flex-col items-start gap-2.5">
        <div
          className="tabular flex h-9 items-center px-3 text-sm shadow-sm"
          style={{ background: 'var(--color-bg)' }}
        >
          {sizeText}
        </div>
        {inspecting && (
          <div
            className="flex h-9 items-center gap-2 px-3 text-sm font-bold"
            style={{ background: 'var(--color-text)', color: 'var(--color-bg)' }}
          >
            Inspecting edges at 100%
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setInspecting((v) => !v)}
        className="absolute bottom-5 left-6 h-9 px-3 text-sm font-bold shadow-sm"
        style={{ background: 'var(--color-bg)' }}
      >
        {inspecting ? 'Smooth' : 'Inspect edges'}
      </button>
    </div>
  )
}

export function BackgroundPanel() {
  const presetId = useJob((s) => s.presetId)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const setBackground = useJob((s) => s.setBackground)
  const setEdgeSoftness = useJob((s) => s.setEdgeSoftness)
  const setHairDetail = useJob((s) => s.setHairDetail)

  const preset = PHOTO_PRESETS[presetId]
  const locked = preset.lockBackgroundToWhite === true
  const isCustom = !BACKGROUND_SWATCHES.some(
    (s) => s.hex.toUpperCase() === background.toUpperCase(),
  )

  return (
    <>
      <Section title="Background">
        <div className="grid grid-cols-2 gap-2">
          {BACKGROUND_SWATCHES.map((swatch) => {
            const selected = background.toUpperCase() === swatch.hex.toUpperCase()
            const disabled = locked && swatch.hex.toUpperCase() !== '#FFFFFF'
            return (
              <button
                key={swatch.id}
                type="button"
                disabled={disabled}
                onClick={() => setBackground(swatch.hex)}
                aria-pressed={selected}
                className={`flex items-center gap-2 border p-1.5 text-left text-[13px] transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-40 ${
                  selected ? 'border-accent' : 'border-divider hover:bg-[var(--hover)]'
                }`}
              >
                <span
                  className="h-6 w-6 flex-none border border-divider"
                  style={{ background: swatch.hex }}
                />
                <span className="flex min-w-0 items-center gap-1 truncate">
                  {selected && (
                    <span className="flex-none text-accent">
                      <Icon path={ICONS.check} size={12} strokeWidth={3.5} />
                    </span>
                  )}
                  {swatch.label}
                </span>
              </button>
            )
          })}
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">Custom</span>
          <input
            type="color"
            value={background}
            disabled={locked}
            onChange={(e) => setBackground(e.target.value.toUpperCase())}
            className="h-8 w-10 cursor-pointer border border-divider bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className={`tabular ${isCustom ? 'font-bold' : 'text-muted'}`}>
            {background.toUpperCase()}
          </span>
        </label>

        {locked && <p className="text-xs text-muted">Passport photos are locked to white.</p>}
      </Section>

      <Section title="Edges">
        <Slider
          label="Edge softness"
          value={edgeSoftness}
          min={-2}
          max={2}
          step={1}
          defaultValue={0}
          format={(v) => (v > 0 ? `+${v} px` : `${v} px`)}
          onChange={setEdgeSoftness}
        />
        <Slider
          label="Hair detail"
          value={hairDetail}
          min={-1}
          max={1}
          step={0.1}
          defaultValue={0}
          format={(v) => v.toFixed(1)}
          onChange={setHairDetail}
        />
        <p className="text-xs text-muted">
          Raise hair detail to keep flyaway strands; lower it if the edge looks noisy.
        </p>
      </Section>

      {preset.note && (
        <div className="px-6 pb-5">
          <Notice tone="info">{preset.note}</Notice>
        </div>
      )}
    </>
  )
}

function trim(value: number, decimals = 1): string {
  return String(Number(value.toFixed(decimals)))
}
