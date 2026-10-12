/**
 * Photo Print — Edit: the whole photo, Before | After, with the background
 * choice and the enhance sliders beside it.
 */

import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { CompareView } from '../../app/components/CompareView'
import { Button, Icon, ICONS, Notice, ResetButton, Section, Segmented, Slider } from '../../app/components/ui'
import { autoEnhance } from '../../lib/enhance'
import { BACKGROUND_SWATCHES } from '../../lib/presets'
import { useEdit, type BackgroundMode } from '../../store/edit'
import { chooseBackground, setBackgroundImageFromPath } from './editPipeline'
import { useEditResult } from './useEditResult'

export function EditCanvas() {
  const preview = useEdit((s) => s.preview)
  const mode = useEdit((s) => s.backgroundMode)
  const maskStatus = useEdit((s) => s.maskStatus)
  const progress = useEdit((s) => s.progress)
  const result = useEditResult()
  if (!preview) return null
  const aspect = preview.width / preview.height

  return (
    <div className="relative flex h-full w-full items-center justify-center p-8" style={{ containerType: 'size' }}>
      <CompareView
        before={preview}
        after={result ?? preview}
        checkerboard={mode === 'transparent'}
        // As large as fits either way, at the photo's own shape.
        boxStyle={{ width: `min(92cqw, calc(86cqh * ${aspect}))`, aspectRatio: `${aspect}` }}
      />
      {maskStatus === 'running' && (
        <div className="absolute bottom-5 left-6 flex w-64 flex-col gap-1.5 p-3 text-sm shadow-sm" style={{ background: 'var(--color-bg)' }}>
          <span className="font-bold">Removing the background…</span>
          <div className="relative h-1.5" style={{ background: 'var(--color-surface)' }}>
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${(progress?.fraction ?? 0) * 100}%`, background: 'var(--color-accent)' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const MODES: { value: BackgroundMode; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'transparent', label: 'Transparent' },
  { value: 'color', label: 'Colour' },
  { value: 'image', label: 'Image' },
]

export function EditPanel() {
  return (
    <>
      <BackgroundSection />
      <EnhanceSection />
    </>
  )
}

function BackgroundSection() {
  const mode = useEdit((s) => s.backgroundMode)
  const color = useEdit((s) => s.backgroundColor)
  const setColor = useEdit((s) => s.setBackgroundColor)
  const bgImage = useEdit((s) => s.backgroundImage)
  const clearImage = useEdit((s) => s.clearBackgroundImage)
  const view = useEdit((s) => s.backgroundView)
  const setView = useEdit((s) => s.setBackgroundView)
  const edgeSoftness = useEdit((s) => s.edgeSoftness)
  const setEdgeSoftness = useEdit((s) => s.setEdgeSoftness)
  const hairDetail = useEdit((s) => s.hairDetail)
  const setHairDetail = useEdit((s) => s.setHairDetail)
  const maskError = useEdit((s) => s.maskError)
  const [imageError, setImageError] = useState<string | null>(null)

  const chooseImage = async () => {
    const path = await open({ multiple: false, filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] })
    if (typeof path !== 'string') return
    setImageError(await setBackgroundImageFromPath(path))
  }

  return (
    <>
      <Section title="Background">
        <Segmented
          options={MODES}
          value={mode}
          onChange={(m) => (m === 'image' && !bgImage ? void chooseImage() : chooseBackground(m))}
          columns={2}
        />
        {mode === 'original' && <p className="text-xs text-muted">The photo keeps its own background.</p>}
        {mode === 'transparent' && <p className="text-xs text-muted">Saved as PNG with no background. Prints on white.</p>}

        {mode === 'color' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {BACKGROUND_SWATCHES.map((swatch) => {
                const selected = color.toUpperCase() === swatch.hex.toUpperCase()
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    onClick={() => setColor(swatch.hex)}
                    aria-pressed={selected}
                    className={`flex items-center gap-2 border p-1.5 text-left text-[13px] ${selected ? 'border-accent' : 'border-divider hover:bg-[var(--hover)]'}`}
                  >
                    <span className="h-6 w-6 flex-none border border-divider" style={{ background: swatch.hex }} />
                    {swatch.label}
                  </button>
                )
              })}
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <span className="text-muted">Custom</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="h-8 w-10 cursor-pointer border border-divider bg-surface"
              />
              <span className="tabular text-muted">{color.toUpperCase()}</span>
            </label>
          </>
        )}

        {mode === 'image' && bgImage && (
          <>
            <div className="flex gap-2">
              <Button onClick={() => void chooseImage()}>Change</Button>
              <Button variant="ghost" onClick={clearImage}>Remove</Button>
            </div>
            <Slider label="Zoom" value={Math.round(view.zoom * 100)} min={100} max={300} step={5} defaultValue={100}
              format={(v) => `${v}%`} onChange={(v) => setView({ zoom: v / 100 })} />
            <Slider label="Horizontal" value={Math.round(view.offsetX * 100)} min={-100} max={100} step={1} defaultValue={0}
              format={(v) => `${v}`} onChange={(v) => setView({ offsetX: v / 100 })} />
            <Slider label="Vertical" value={Math.round(view.offsetY * 100)} min={-100} max={100} step={1} defaultValue={0}
              format={(v) => `${v}`} onChange={(v) => setView({ offsetY: v / 100 })} />
          </>
        )}
        {imageError && <Notice tone="warn">{imageError}</Notice>}
        {maskError && (
          <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />}>
            The background could not be removed: {maskError}
          </Notice>
        )}
      </Section>

      {mode !== 'original' && (
        <Section title="Edges">
          <Slider label="Edge softness" value={edgeSoftness} min={-2} max={2} step={1} defaultValue={0}
            format={(v) => (v > 0 ? `+${v} px` : `${v} px`)} onChange={setEdgeSoftness} />
          <Slider label="Hair detail" value={hairDetail} min={-1} max={1} step={0.1} defaultValue={0}
            format={(v) => v.toFixed(1)} onChange={setHairDetail} />
        </Section>
      )}
    </>
  )
}

function EnhanceSection() {
  const enhance = useEdit((s) => s.enhance)
  const setEnhance = useEdit((s) => s.setEnhance)
  const resetEnhance = useEdit((s) => s.resetEnhance)
  const preview = useEdit((s) => s.preview)
  const previewMask = useEdit((s) => s.previewMask)
  const mode = useEdit((s) => s.backgroundMode)
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`)

  const auto = () => {
    if (!preview) return
    // Measure the person when they are being cut out; the whole scene otherwise.
    setEnhance(autoEnhance(preview, mode !== 'original' && previewMask ? previewMask : undefined))
  }

  return (
    <Section title="Enhance" action={<ResetButton onClick={resetEnhance} />} last>
      <Button onClick={auto} block>Auto enhance</Button>
      <Slider label="Brightness" value={enhance.brightness} min={-50} max={50} step={1} defaultValue={0} format={signed}
        onChange={(brightness) => setEnhance({ brightness })} />
      <Slider label="Contrast" value={enhance.contrast} min={-50} max={50} step={1} defaultValue={0} format={signed}
        onChange={(contrast) => setEnhance({ contrast })} />
      <Slider label="Warmth" value={enhance.warmth} min={-50} max={50} step={1} defaultValue={0} format={signed}
        onChange={(warmth) => setEnhance({ warmth })} />
      <Slider label="Saturation" value={enhance.saturation} min={-50} max={50} step={1} defaultValue={0} format={signed}
        onChange={(saturation) => setEnhance({ saturation })} />
      <Slider label="Sharpness" value={enhance.sharpness} min={0} max={50} step={1} defaultValue={0} format={signed}
        onChange={(sharpness) => setEnhance({ sharpness })} />
      <p className="text-xs text-muted">Auto enhance only moves the sliders; you can change or reset them.</p>
    </Section>
  )
}
