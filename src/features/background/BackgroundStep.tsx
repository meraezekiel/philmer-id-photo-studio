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

import { Icon, ICONS, Notice, ResetButton, Section, Slider } from '../../app/components/ui'
import { drawBitmap, nameTagMeasurer } from '../../lib/bitmap'
import { composite } from '../../lib/composite'
import {
  DEFAULT_NAME_TAG,
  NAME_TAG_FONTS,
  NAME_TAG_SIZE_RANGE,
  nameTagFont,
  nameTagLayout,
} from '../../lib/nameTag'
import { BACKGROUND_SWATCHES, MM_PER_INCH, PHOTO_PRESETS } from '../../lib/presets'
import { useJob } from '../../store/job'

export function BackgroundCanvas() {
  const preview = useJob((s) => s.preview)
  const previewMask = useJob((s) => s.previewMask)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const tone = useJob((s) => s.tone)
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
    return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail, ...tone })
  }, [preview, previewMask, background, edgeSoftness, hairDetail, tone])

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
      <Section title="Background" tour="background-swatches">
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

      <ToneSection />

      <NameSection />

      {preset.note && (
        <div className="px-6 pb-5">
          <Notice tone="info">{preset.note}</Notice>
        </div>
      )}
    </>
  )
}

/**
 * Brightness, contrast and warmth of the person. Shop lighting leaves many
 * walk-in photos dark or yellow; this fixes them without a second program.
 * The background is never touched, so white stays white.
 */
function ToneSection() {
  const tone = useJob((s) => s.tone)
  const setTone = useJob((s) => s.setTone)
  const resetTone = useJob((s) => s.resetTone)
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`)

  return (
    <Section title="Light & colour" action={<ResetButton onClick={resetTone} />}>
      <Slider
        label="Brightness"
        value={tone.brightness}
        min={-50}
        max={50}
        step={1}
        defaultValue={0}
        format={signed}
        onChange={(brightness) => setTone({ brightness })}
      />
      <Slider
        label="Contrast"
        value={tone.contrast}
        min={-50}
        max={50}
        step={1}
        defaultValue={0}
        format={signed}
        onChange={(contrast) => setTone({ contrast })}
      />
      <Slider
        label="Warmth"
        value={tone.warmth}
        min={-50}
        max={50}
        step={1}
        defaultValue={0}
        format={signed}
        onChange={(warmth) => setTone({ warmth })}
      />
      <p className="text-xs text-muted">
        Lower warmth to take the yellow out of indoor light.
      </p>
    </Section>
  )
}

/**
 * The name printed across the bottom of the photo.
 *
 * On by default for Passport, because that is how a passport photo is handed
 * over at a Philippine counter, and off with one click for anyone who wants
 * the plain international format. The strip below the field is drawn with the
 * same font, colours and proportions as the print, so what the operator tunes
 * here is what comes out of the printer.
 */
function NameSection() {
  const tag = useJob((s) => s.nameTag)
  const setNameTag = useJob((s) => s.setNameTag)
  const presetId = useJob((s) => s.presetId)
  const preset = PHOTO_PRESETS[presetId]

  // The strip is a scale model of the photo's bottom edge, so it has to be
  // laid out at the width it is actually drawn at — and measured with the
  // same canvas the printer's copy uses, or a long name would be clipped here
  // and shrunk there.
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(300)
  useEffect(() => {
    const node = boxRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const previewTag = {
    ...tag,
    text: tag.text.trim() === '' ? 'SURNAME, FIRST M.' : tag.text,
    enabled: true,
  }
  const layout = nameTagLayout(
    boxWidth,
    boxWidth * (preset.heightMm / preset.widthMm),
    previewTag,
    nameTagMeasurer(previewTag),
  )

  return (
    <Section title="Name on the photo" tour="name-section">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={tag.enabled}
          disabled={!preset.allowNameTag}
          onChange={(e) => setNameTag({ enabled: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        Print the name on the photo
        {preset.nameTagByDefault && <span className="ml-auto text-xs text-muted">usual here</span>}
      </label>

      <input
        type="text"
        value={tag.text}
        disabled={!tag.enabled}
        placeholder="SURNAME, FIRST MIDDLE"
        onChange={(e) => setNameTag({ text: e.target.value })}
        className="min-h-9 w-full border border-divider bg-bg px-2 text-sm disabled:opacity-45"
      />

      {/* The band, at the photo's own proportions. */}
      <div
        ref={boxRef}
        className="flex items-end overflow-hidden border border-divider"
        style={{
          height: Math.round((layout?.bandHeight ?? 24) + 16),
          background: 'var(--color-neutral-200, #e9e9e9)',
          opacity: tag.enabled ? 1 : 0.45,
        }}
      >
        <div
          className="flex w-full items-center justify-center overflow-hidden whitespace-nowrap"
          style={{
            height: layout?.bandHeight ?? 24,
            background: tag.background,
            color: tag.color,
            font: layout ? nameTagFont(tag, layout.fontPx) : undefined,
          }}
        >
          {layout?.text}
        </div>
      </div>

      <Slider
        label="Font size"
        value={tag.fontSizeRatio}
        min={NAME_TAG_SIZE_RANGE.min}
        max={NAME_TAG_SIZE_RANGE.max}
        step={0.002}
        defaultValue={DEFAULT_NAME_TAG.fontSizeRatio}
        format={(v) => `${Math.round(v * 1000) / 10}%`}
        disabled={!tag.enabled}
        onChange={(v) => setNameTag({ fontSizeRatio: v })}
      />

      <div className="flex items-center gap-2">
        <select
          value={tag.fontFamily}
          disabled={!tag.enabled}
          onChange={(e) => setNameTag({ fontFamily: e.target.value })}
          className="min-h-9 flex-1 border border-divider bg-bg px-2 text-sm disabled:opacity-45"
        >
          {NAME_TAG_FONTS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </select>
        <StyleToggle
          label="B"
          bold
          on={tag.bold}
          disabled={!tag.enabled}
          onClick={() => setNameTag({ bold: !tag.bold })}
        />
        <StyleToggle
          label="I"
          italic
          on={tag.italic}
          disabled={!tag.enabled}
          onClick={() => setNameTag({ italic: !tag.italic })}
        />
        <StyleToggle
          label="AA"
          on={tag.uppercase}
          disabled={!tag.enabled}
          onClick={() => setNameTag({ uppercase: !tag.uppercase })}
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">Text</span>
          <input
            type="color"
            value={tag.color}
            disabled={!tag.enabled}
            onChange={(e) => setNameTag({ color: e.target.value.toUpperCase() })}
            className="h-8 w-10 cursor-pointer border border-divider bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          />
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">Band</span>
          <input
            type="color"
            value={tag.background}
            disabled={!tag.enabled}
            onChange={(e) => setNameTag({ background: e.target.value.toUpperCase() })}
            className="h-8 w-10 cursor-pointer border border-divider bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          />
        </label>
        {(tag.color !== DEFAULT_NAME_TAG.color ||
          tag.background !== DEFAULT_NAME_TAG.background) && (
          <button
            type="button"
            onClick={() =>
              setNameTag({
                color: DEFAULT_NAME_TAG.color,
                background: DEFAULT_NAME_TAG.background,
              })
            }
            className="ml-auto whitespace-nowrap text-xs font-bold text-accent hover:underline"
          >
            Black on white
          </button>
        )}
      </div>

      <p className="text-xs text-muted">
        The band sits inside the photo, so the print is still{' '}
        {trim(preset.widthMm)} × {trim(preset.heightMm)} mm. A long name shrinks to fit.
      </p>
    </Section>
  )
}

function StyleToggle({
  label,
  on,
  bold,
  italic,
  disabled,
  onClick,
}: {
  label: string
  on: boolean
  bold?: boolean
  italic?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`grid h-9 w-9 flex-none place-items-center border text-sm transition-colors duration-[var(--duration-fast)] disabled:opacity-45 ${
        on ? 'border-accent text-accent' : 'border-divider hover:bg-[var(--hover)]'
      }`}
      style={{ fontWeight: bold ? 800 : 600, fontStyle: italic ? 'italic' : undefined }}
    >
      {label}
    </button>
  )
}

function trim(value: number, decimals = 1): string {
  return String(Number(value.toFixed(decimals)))
}
