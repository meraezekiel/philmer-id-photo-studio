/**
 * Step 3 — Background (DESIGN_BRIEF §3.3).
 *
 * Swatches, edge controls, and a hold-to-compare against the original. The
 * compare matters more than it looks: it is how the operator confirms the
 * cutout is honest before anything is printed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Notice, Section, Slider, Swatch } from '../../app/components/ui'
import { drawBitmap } from '../../lib/bitmap'
import { composite } from '../../lib/composite'
import { BACKGROUND_SWATCHES, PHOTO_PRESETS } from '../../lib/presets'
import { useJob } from '../../store/job'

export function BackgroundCanvas() {
  const preview = useJob((s) => s.preview)
  const previewMask = useJob((s) => s.previewMask)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [comparing, setComparing] = useState(false)
  const [zoomed, setZoomed] = useState(false)

  const result = useMemo(() => {
    if (!preview || !previewMask) return null
    return composite({
      image: preview,
      mask: previewMask,
      background,
      edgeSoftness,
      hairDetail,
    })
  }, [preview, previewMask, background, edgeSoftness, hairDetail])

  useEffect(() => {
    const shown = comparing ? preview : result
    if (shown && canvasRef.current) drawBitmap(canvasRef.current, shown)
  }, [result, preview, comparing])

  // Hold "\" to compare, per DESIGN_BRIEF §6.
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === '\\' && setComparing(true)
    const up = (e: KeyboardEvent) => e.key === '\\' && setComparing(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  if (!preview) return null

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6">
      <div
        className={`relative overflow-auto shadow-lg ${
          zoomed ? 'max-h-full max-w-full' : ''
        }`}
      >
        <canvas
          ref={canvasRef}
          className={zoomed ? 'block' : 'block max-h-[70vh] w-auto object-contain'}
          style={zoomed ? { imageRendering: 'pixelated' } : undefined}
        />
        {comparing && (
          <span className="absolute left-2 top-2 px-2 py-1 text-xs font-bold" style={{ background: "var(--color-accent)", color: "var(--on-accent)" }}>
            Original
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs" style={{ color: "#fff" }}>
        <button
          type="button"
          onMouseDown={() => setComparing(true)}
          onMouseUp={() => setComparing(false)}
          onMouseLeave={() => setComparing(false)}
          className="bg-[var(--hover)] px-2.5 py-1 hover:bg-[var(--hover)]"
        >
          Hold to compare (\)
        </button>
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          className="bg-[var(--hover)] px-2.5 py-1 hover:bg-[var(--hover)]"
        >
          {zoomed ? 'Fit' : 'Zoom to 100%'}
        </button>
        <span>Inspect the hair edges before printing.</span>
      </div>
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
  const notWhite = background.toUpperCase() !== '#FFFFFF'

  const onCustom = useCallback(
    (hex: string) => {
      if (!locked) setBackground(hex.toUpperCase())
    },
    [locked, setBackground],
  )

  return (
    <>
      <Section title="Background">
        <div className="grid grid-cols-5 gap-2">
          {BACKGROUND_SWATCHES.map((swatch) => (
            <Swatch
              key={swatch.id}
              hex={swatch.hex}
              label={swatch.label}
              selected={background.toUpperCase() === swatch.hex.toUpperCase()}
              onSelect={() => setBackground(swatch.hex)}
              disabled={locked && swatch.hex.toUpperCase() !== '#FFFFFF'}
            />
          ))}
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted">Custom</span>
          <input
            type="color"
            value={background}
            disabled={locked}
            onChange={(e) => onCustom(e.target.value)}
            className="h-8 w-10 cursor-pointer border border-divider bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          />
          <input
            type="text"
            value={background.toUpperCase()}
            disabled={locked}
            onChange={(e) => {
              const v = e.target.value
              if (/^#[0-9a-f]{6}$/i.test(v)) onCustom(v)
            }}
            className="tabular w-24 border border-divider bg-surface px-2 py-1 text-sm disabled:opacity-40"
          />
        </label>

        {locked && (
          <p className="mt-2 text-xs text-muted">
            Passport photos are locked to white. {preset.note}
          </p>
        )}
        {!locked && presetId === 'passport' && notWhite && (
          <div className="mt-2">
            <Notice tone="warn">Passports usually require a white background.</Notice>
          </div>
        )}
      </Section>

      <Section title="Edges">
        <div className="space-y-3">
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
        </div>
        <p className="mt-2 text-xs text-muted">
          Raise hair detail to keep flyaway strands; lower it if the edge looks noisy.
        </p>
      </Section>
    </>
  )
}
