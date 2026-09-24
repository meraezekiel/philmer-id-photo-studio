/**
 * Step 2 — Adjust, right-hand panel (DESIGN_BRIEF §3.2).
 *
 * The canvas half lives in AdjustCanvas.tsx.
 */

import { useCallback, useMemo } from 'react'

import { Icon, ICONS, IconButton, Notice, Section, Segmented, Slider } from '../../app/components/ui'
import { geometry, headStatus, headStatusMessage } from '../../lib/autoCrop'
import { PHOTO_PRESETS } from '../../lib/presets'
import { useJob } from '../../store/job'

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
