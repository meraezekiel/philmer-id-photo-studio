/**
 * Attire: dress the customer in a shirt and tie or a suit.
 *
 * The operator picks a template; it snaps under the chin from face
 * detection. Drag it to move, scroll to resize, and the sliders fine-tune.
 * None is the default, so a customer already in formal wear costs one click.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { Button, Icon, ICONS, Notice, ResetButton, Section, Segmented, Slider, Swatch, TextInput } from '../../app/components/ui'

/** Colours for under an open jacket or blouse: undershirts and camisoles. */
const UNDER_SWATCHES = [
  { hex: '#FFFFFF', label: 'White' },
  { hex: '#F1EBE0', label: 'Cream' },
  { hex: '#1C1C1E', label: 'Black' },
  { hex: '#7A7F87', label: 'Grey' },
]
import { attireBottomFraction } from '../../lib/attire'
import { SKIN_PAINT, withAttire } from '../../lib/attireDraw'
import { cropRotate, drawBitmap } from '../../lib/bitmap'
import { composite, type Bitmap } from '../../lib/composite'
import { PHOTO_PRESETS } from '../../lib/presets'
import { asAppError, type AttireEntry } from '../../lib/tauri'
import { useAttireLibrary, type AttireGroup, type AttireTemplate } from '../../store/attire'
import { DEFAULT_BLEND, useJob } from '../../store/job'
import { useFramedCrop } from '../../store/useFramedCrop'
import { useAttireLayer } from './useAttireLayer'

/** Load the library once, from whichever attire view mounts first. */
function useLibraryLoaded() {
  const status = useAttireLibrary((s) => s.status)
  const load = useAttireLibrary((s) => s.load)
  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])
}

export function AttireCanvas() {
  useLibraryLoaded()
  const preview = useJob((s) => s.preview)
  const previewMask = useJob((s) => s.previewMask)
  const info = useJob((s) => s.info)
  const cropRect = useFramedCrop()
  const presetId = useJob((s) => s.presetId)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const tone = useJob((s) => s.tone)
  const fit = useJob((s) => s.attireFit)
  const setAttireFit = useJob((s) => s.setAttireFit)
  const headShift = useJob((s) => s.headShift)
  const setHeadShift = useJob((s) => s.setHeadShift)
  const tool = useJob((s) => s.attireTool)
  const brushKind = useJob((s) => s.brushKind)
  const brushSize = useJob((s) => s.brushSize)
  const paintColour = useJob((s) => s.paintColour)
  const layer = useAttireLayer()
  const brushing = (tool === 'brush' || tool === 'paint') && fit !== null
  const painter = tool === 'paint'

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const painting = useRef(false)
  /** Pointer position over the canvas, in fractions, for the brush outline. */
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  /** What a drag moves: the person (default) or, with Shift, the attire. */
  const dragRef = useRef<{ x: number; y: number; what: 'head' | 'attire'; baseX: number; baseY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  // Scrolling to resize the person also wants the light preview; it counts
  // as "in progress" until the wheel has been still for a moment.
  const [wheeling, setWheeling] = useState(false)
  const wheelTimer = useRef<number | undefined>(undefined)

  const preset = PHOTO_PRESETS[presetId]

  // Moving the person re-crops and re-composites on every pointer move, so
  // while a drag is in progress the preview works from a smaller copy and
  // skips the fringe clean-up; letting go renders at full quality again.
  const light = useMemo(
    () => (preview && previewMask ? { image: halfSize(preview), mask: halfSize(previewMask) } : null),
    [preview, previewMask],
  )
  const fast = (dragging && dragRef.current?.what === 'head') || wheeling

  // The finished photo without attire.
  const base = useMemo(() => {
    const src = fast && light ? light : preview && previewMask ? { image: preview, mask: previewMask } : null
    if (!src) return null
    let { image, mask } = src
    if (cropRect && info) {
      const s = image.width / info.width
      const rect = { x: cropRect.x * s, y: cropRect.y * s, width: cropRect.width * s, height: cropRect.height * s }
      image = cropRotate(image, rect, cropRect.rotationDeg)
      mask = cropRotate(mask, rect, cropRect.rotationDeg)
    }
    const photo = composite({ image, mask, background, edgeSoftness, hairDetail, ...tone, skipDecontamination: fast })
    return { photo, mask }
  }, [fast, light, preview, previewMask, info, cropRect, background, edgeSoftness, hairDetail, tone])

  const result = useMemo(() => (base ? withAttire(base.photo, layer, base.mask) : null), [base, layer])

  useEffect(() => {
    if (result && canvasRef.current) drawBitmap(canvasRef.current, result)
  }, [result])

  // Dragging puts the person into the attire, the way a head is placed into
  // a suit template by hand; Shift+drag moves the attire instead.
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    if (brushing) {
      const point = at(e)
      // Alt+click with the paint brush picks its colour from the photo.
      if (painter && e.altKey) {
        if (result) useJob.getState().setPaintColour(pixelHex(result, point))
        return
      }
      painting.current = true
      useJob
        .getState()
        .beginStroke(
          painter
            ? { kind: 'paint', colour: paintColour, radius: brushSize / 200, points: [point] }
            : { kind: brushKind, radius: brushSize / 200, points: [point] },
        )
      return
    }
    const moveAttire = e.shiftKey && fit !== null
    dragRef.current = moveAttire
      ? { x: e.clientX, y: e.clientY, what: 'attire', baseX: fit.x, baseY: fit.y }
      : { x: e.clientX, y: e.clientY, what: 'head', baseX: headShift.x, baseY: headShift.y }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (brushing) {
      const point = at(e)
      setHover(point)
      if (painting.current) useJob.getState().extendStroke(point)
      return
    }
    const start = dragRef.current
    if (!start) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = start.baseX + (e.clientX - start.x) / rect.width
    const y = start.baseY + (e.clientY - start.y) / rect.height
    if (start.what === 'attire') setAttireFit({ x, y })
    else setHeadShift(x, y)
  }
  const endDrag = () => {
    painting.current = false
    dragRef.current = null
    setDragging(false)
  }

  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Scroll resizes the person; Shift+scroll resizes the attire.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const job = useJob.getState()
      const factor = Math.exp(-(e.deltaY || e.deltaX) * 0.001)
      // With the brush, scrolling sizes the brush.
      if (job.attireTool !== 'move' && job.attireFit) {
        job.setBrushSize(Math.round(job.brushSize * factor * 10) / 10)
        return
      }
      if (e.shiftKey) {
        if (job.attireFit) job.setAttireFit({ scale: Math.min(3, Math.max(0.2, job.attireFit.scale * factor)) })
        return
      }
      setWheeling(true)
      job.setHeadScale(job.headScale * factor)
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => setWheeling(false), 250)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [result])

  if (!preview) return null

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="relative" style={{ height: '78%', aspectRatio: `${preset.widthMm / preset.heightMm}` }}>
        <canvas
          ref={canvasRef}
          className="h-full w-full shadow-lg"
          style={{ cursor: brushing ? 'none' : dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHover(null)}
        />
        {brushing && hover && (
          <div
            className="pointer-events-none absolute rounded-full border-2"
            style={{
              left: `${hover.x * 100}%`,
              top: `${hover.y * 100}%`,
              width: `${brushSize}%`,
              aspectRatio: '1',
              transform: 'translate(-50%, -50%)',
              borderColor: painter ? 'var(--color-accent)' : brushKind === 'restore' ? 'var(--ok-line)' : 'var(--color-accent)',
              background: painter && paintColour !== SKIN_PAINT ? `${paintColour}66` : undefined,
              boxShadow: '0 0 0 1px rgba(255,255,255,.8)',
            }}
          />
        )}
        {dragging && layer?.frame && (
          <div
            className="pointer-events-none absolute left-0 right-0 border-t-2 border-dashed"
            style={{ top: `${layer.frame.chinY * 100}%`, borderColor: 'var(--ok-line)' }}
          />
        )}
      </div>
      <div className="tabular flex h-9 items-center px-3 text-sm shadow-sm" style={{ background: 'var(--color-bg)' }}>
        {brushing && painter
          ? 'Paint over gaps · Alt+click picks a colour · scroll to size the brush'
          : brushing
          ? 'Paint to erase · scroll to size the brush'
          : fit
            ? 'Drag or scroll: move or resize the person · hold Shift for the attire'
            : 'Choose attire on the right, or leave it on None'}
      </div>
    </div>
  )
}

/** The colour of a bitmap at a point given in fractions, as `#RRGGBB`. */
function pixelHex(bmp: Bitmap, point: { x: number; y: number }): string {
  const x = Math.min(bmp.width - 1, Math.max(0, Math.round(point.x * bmp.width)))
  const y = Math.min(bmp.height - 1, Math.max(0, Math.round(point.y * bmp.height)))
  const i = (y * bmp.width + x) * 4
  const hex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hex(bmp.data[i])}${hex(bmp.data[i + 1])}${hex(bmp.data[i + 2])}`.toUpperCase()
}

/** A half-size copy, for previews that must keep up with the pointer. */
function halfSize(bmp: Bitmap): ImageData {
  const src = new OffscreenCanvas(bmp.width, bmp.height)
  src.getContext('2d')?.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0)
  const w = Math.max(1, Math.round(bmp.width / 2))
  const h = Math.max(1, Math.round(bmp.height / 2))
  const out = new OffscreenCanvas(w, h)
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('could not get a 2D context')
  ctx.drawImage(src, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

const GROUP_LABELS: Record<AttireGroup, string> = {
  men: 'Men',
  women: 'Women',
  other: 'Other',
  placeholder: 'Placeholder',
}
const GROUP_ORDER: AttireGroup[] = ['men', 'women', 'other', 'placeholder']

export function AttirePanel() {
  useLibraryLoaded()
  const templates = useAttireLibrary((s) => s.templates)
  const libraryError = useAttireLibrary((s) => s.error)
  const remove = useAttireLibrary((s) => s.remove)
  const attireId = useJob((s) => s.attireId)
  const setAttire = useJob((s) => s.setAttire)
  const fit = useJob((s) => s.attireFit)
  const setAttireFit = useJob((s) => s.setAttireFit)
  const resetAttireFit = useJob((s) => s.resetAttireFit)
  const hideOriginal = useJob((s) => s.attireHideOriginal)
  const headShift = useJob((s) => s.headShift)
  const headScale = useJob((s) => s.headScale)
  const setHeadScale = useJob((s) => s.setHeadScale)
  const resetHead = useJob((s) => s.resetHead)
  const blend = useJob((s) => s.attireBlend)
  const setBlend = useJob((s) => s.setAttireBlend)
  const setHideOriginal = useJob((s) => s.setAttireHideOriginal)
  const presetId = useJob((s) => s.presetId)
  const layer = useAttireLayer()

  const [confirming, setConfirming] = useState<AttireTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  const removeTemplate = async (t: AttireTemplate) => {
    setConfirming(null)
    try {
      if (attireId === t.id) setAttire(null)
      await remove(t.id)
    } catch (e) {
      setError(asAppError(e).message)
    }
  }

  // Width/height ratio only matters for the bottom-edge check.
  const preset = PHOTO_PRESETS[presetId]
  const stopsShort =
    layer !== null &&
    attireBottomFraction(layer.fit, layer.template.anchors, preset.widthMm, preset.heightMm) < 0.995

  return (
    <>
      <Section title="Attire" tour="attire-picker">
        <div className="grid grid-cols-3 gap-2">
          <Tile selected={attireId === null} onClick={() => setAttire(null)} label="None">
            <span className="text-sm text-muted">As is</span>
          </Tile>
        </div>
        {GROUP_ORDER.map((group) => {
          const inGroup = templates.filter((t) => t.group === group)
          if (inGroup.length === 0) return null
          return (
            <div key={group} className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{GROUP_LABELS[group]}</span>
              <div className="grid grid-cols-3 gap-2">
                {inGroup.map((t) => (
                  <Tile
                    key={t.id}
                    selected={attireId === t.id}
                    onClick={() => setAttire(t.id)}
                    label={t.name}
                    onRemove={t.source === 'user' ? () => setConfirming(t) : undefined}
                  >
                    <img src={t.url} alt="" className="h-full w-full object-contain" draggable={false} />
                  </Tile>
                ))}
              </div>
            </div>
          )
        })}
        {confirming && (
          <Notice
            tone="warn"
            action={
              <div className="flex gap-2">
                <Button onClick={() => void removeTemplate(confirming)}>Remove</Button>
                <Button variant="ghost" onClick={() => setConfirming(null)}>
                  Keep
                </Button>
              </div>
            }
          >
            Remove “{confirming.name}” from this computer?
          </Notice>
        )}
        {(error || libraryError) && <Notice tone="danger">{error ?? libraryError}</Notice>}
        <AddTemplate onError={setError} />
      </Section>

      {fit && (
        <Section title="Fit">
          <Slider
            label="Person size"
            value={Math.round(headScale * 100)}
            min={50}
            max={200}
            step={1}
            defaultValue={100}
            format={(v) => `${v}%`}
            onChange={(v) => setHeadScale(v / 100)}
          />
          <Slider
            label="Attire size"
            value={Math.round(fit.scale * 100)}
            min={20}
            max={300}
            step={1}
            format={(v) => `${v}%`}
            onChange={(v) => setAttireFit({ scale: v / 100 })}
          />
          <Slider
            label="Rotate"
            value={fit.rotation}
            min={-15}
            max={15}
            step={0.5}
            defaultValue={0}
            format={(v) => `${v.toFixed(1)}°`}
            onChange={(rotation) => setAttireFit({ rotation })}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideOriginal}
              onChange={(e) => setHideOriginal(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Hide old clothes
            <span className="ml-auto text-xs text-muted">outside the attire</span>
          </label>
          <Button block onClick={resetAttireFit}>
            <Icon path={ICONS.rotate} size={16} />
            Re-fit under the chin
          </Button>
          {(headShift.x !== 0 || headShift.y !== 0 || headScale !== 1) && (
            <Button block onClick={resetHead}>
              <Icon path={ICONS.undo} size={16} />
              Put the person back
            </Button>
          )}
          {stopsShort && (
            <Notice tone="warn">The attire stops above the bottom edge — make it larger or move it down.</Notice>
          )}
        </Section>
      )}

      {fit && <TouchUp />}

      {fit && (
        <Section title="Blend" action={<ResetButton onClick={() => setBlend(DEFAULT_BLEND)} />} last>
          <Slider
            label="Shadow at the collar"
            value={blend.shadow}
            min={0}
            max={100}
            step={1}
            defaultValue={DEFAULT_BLEND.shadow}
            onChange={(shadow) => setBlend({ shadow })}
          />
          <Slider
            label="Attire brightness"
            value={blend.brightness}
            min={-50}
            max={50}
            step={1}
            defaultValue={0}
            onChange={(brightness) => setBlend({ brightness })}
          />
          <Slider
            label="Attire warmth"
            value={blend.warmth}
            min={-50}
            max={50}
            step={1}
            defaultValue={0}
            onChange={(warmth) => setBlend({ warmth })}
          />
          <p className="text-xs text-muted">Match the attire to the photo's light: warmer for indoor lighting, darker for a dim photo.</p>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-muted">Inside the collar</span>
            <Segmented
              options={[
                { value: 'skin', label: 'Skin' },
                { value: 'top', label: 'Own top' },
                { value: 'colour', label: 'Colour' },
              ]}
              value={blend.under}
              onChange={(under) => setBlend({ under })}
              columns={3}
            />
            {blend.under === 'colour' && (
              <div className="grid grid-cols-5 items-center gap-2">
                {UNDER_SWATCHES.map((s) => (
                  <Swatch
                    key={s.hex}
                    hex={s.hex}
                    label={s.label}
                    selected={blend.underColour.toUpperCase() === s.hex}
                    onSelect={() => setBlend({ underColour: s.hex })}
                  />
                ))}
                <input
                  type="color"
                  value={blend.underColour}
                  onChange={(e) => setBlend({ underColour: e.target.value.toUpperCase() })}
                  title="Custom colour"
                  aria-label="Custom colour"
                  className="h-12 w-full cursor-pointer border border-divider bg-surface"
                />
              </div>
            )}
            <p className="text-xs text-muted">
              Skin carries the neck down into the V. Own top keeps what the customer wears.
            </p>
          </div>
        </Section>
      )}
    </>
  )
}

/** Touch up: Move, Eraser or Paint, what the brush does, its size, undo and clear. */
function TouchUp() {
  const tool = useJob((s) => s.attireTool)
  const setTool = useJob((s) => s.setAttireTool)
  const kind = useJob((s) => s.brushKind)
  const setKind = useJob((s) => s.setBrushKind)
  const size = useJob((s) => s.brushSize)
  const setSize = useJob((s) => s.setBrushSize)
  const colour = useJob((s) => s.paintColour)
  const setColour = useJob((s) => s.setPaintColour)
  const strokes = useJob((s) => s.attireStrokes)
  const undo = useJob((s) => s.undoStroke)
  const clear = useJob((s) => s.clearStrokes)

  return (
    <Section title="Touch up">
      <Segmented
        options={[
          { value: 'move', label: 'Move' },
          { value: 'brush', label: 'Eraser' },
          { value: 'paint', label: 'Paint' },
        ]}
        value={tool}
        onChange={setTool}
        columns={3}
      />
      {tool === 'paint' && (
        <>
          <div className="grid grid-cols-6 items-center gap-2">
            <button
              type="button"
              onClick={() => setColour(SKIN_PAINT)}
              title="Skin: the customer's own neck colour"
              aria-label="Skin"
              aria-pressed={colour === SKIN_PAINT}
              className={`flex h-12 w-full items-center justify-center text-[11px] font-semibold ${
                colour === SKIN_PAINT
                  ? 'outline outline-2 outline-offset-2 outline-accent'
                  : 'outline outline-1 outline-offset-0 outline-[var(--color-divider)] hover:outline-2'
              }`}
              style={{ background: 'linear-gradient(135deg, #E8C4A8, #B07E5E)' }}
            >
              Skin
            </button>
            {UNDER_SWATCHES.map((s) => (
              <Swatch
                key={s.hex}
                hex={s.hex}
                label={s.label}
                selected={colour.toUpperCase() === s.hex}
                onSelect={() => setColour(s.hex)}
              />
            ))}
            <input
              type="color"
              value={colour === SKIN_PAINT ? '#C8A08A' : colour}
              onChange={(e) => setColour(e.target.value.toUpperCase())}
              title="Custom colour"
              aria-label="Custom colour"
              className="h-12 w-full cursor-pointer border border-divider bg-surface"
            />
          </div>
          <p className="text-xs text-muted">
            Paints over gaps under the attire, never on it. Skin uses the customer's neck colour; Alt+click the photo
            to pick any colour from it. Eraser → Restore wipes paint off.
          </p>
          <Slider
            label="Brush size"
            value={size}
            min={1}
            max={20}
            step={0.5}
            defaultValue={5}
            format={(v) => `${v}%`}
            onChange={setSize}
          />
        </>
      )}
      {tool === 'brush' && (
        <>
          <Segmented
            options={[
              { value: 'person', label: 'Skin & hair' },
              { value: 'attire', label: 'Attire' },
              { value: 'restore', label: 'Restore' },
            ]}
            value={kind}
            onChange={setKind}
            columns={3}
          />
          <p className="text-xs text-muted">
            {kind === 'person'
              ? 'Paints the background over excess skin, hair or leftover clothing.'
              : kind === 'attire'
                ? 'Cuts the attire away where it covers too much.'
                : 'Brings back anything erased or painted where you brush.'}
          </p>
          <Slider
            label="Brush size"
            value={size}
            min={1}
            max={20}
            step={0.5}
            defaultValue={5}
            format={(v) => `${v}%`}
            onChange={setSize}
          />
        </>
      )}
      {strokes.length > 0 && (
        <div className="flex gap-2">
          <Button onClick={undo}>
            <Icon path={ICONS.undo} size={16} />
            Undo
          </Button>
          <Button variant="ghost" onClick={clear}>
            Clear all
          </Button>
        </div>
      )}
    </Section>
  )
}

function Tile({
  selected,
  onClick,
  label,
  onRemove,
  children,
}: {
  selected: boolean
  onClick: () => void
  label: string
  onRemove?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        title={label}
        className="flex w-full flex-col items-stretch gap-1 border-2 p-1 text-left transition-colors duration-[var(--duration-fast)] hover:bg-[var(--hover)]"
        style={{ borderColor: selected ? 'var(--color-accent)' : 'var(--color-divider, #ddd)' }}
      >
        <span className="grid aspect-square place-items-center overflow-hidden" style={{ background: '#e9e8e6' }}>
          {children}
        </span>
        <span className="truncate text-xs font-semibold">{label}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove from this computer"
          className="absolute right-1 top-1 grid h-6 w-6 place-items-center bg-white/90 shadow hover:text-accent"
        >
          <Icon path={ICONS.close} size={14} />
        </button>
      )}
    </div>
  )
}

function AddTemplate({ onError }: { onError: (message: string | null) => void }) {
  const add = useAttireLibrary((s) => s.add)
  const [pending, setPending] = useState<{ path: string; name: string; group: AttireEntry['group'] } | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = useCallback(async () => {
    onError(null)
    const path = await open({ multiple: false, filters: [{ name: 'PNG with transparency', extensions: ['png'] }] })
    if (typeof path !== 'string') return
    const stem = path.split(/[\\/]/).pop()?.replace(/\.png$/i, '') ?? 'Template'
    setPending({ path, name: stem.replace(/[_-]+/g, ' ').slice(0, 40).trim(), group: 'men' })
  }, [onError])

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await add(pending.path, pending.name, pending.group)
      setPending(null)
    } catch (e) {
      onError(asAppError(e).message)
    } finally {
      setBusy(false)
    }
  }

  if (!pending) {
    return (
      <Button block onClick={() => void pick()}>
        <Icon path={ICONS.upload} size={16} />
        Add template…
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 border border-divider p-3">
      <span className="text-sm font-bold">New template</span>
      <TextInput value={pending.name} onChange={(name) => setPending({ ...pending, name })} placeholder="Name" />
      <Segmented
        options={[
          { value: 'men', label: 'Men' },
          { value: 'women', label: 'Women' },
          { value: 'other', label: 'Other' },
        ]}
        value={pending.group}
        onChange={(group) => setPending({ ...pending, group })}
        columns={3}
      />
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
