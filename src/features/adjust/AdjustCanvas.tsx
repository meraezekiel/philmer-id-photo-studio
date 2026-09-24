/**
 * The Adjust canvas: the photo positioned *behind* a fixed crop window.
 *
 * The crop window never moves — it is the preset's aspect, centred, at a fixed
 * fraction of the canvas. What moves is the photo underneath it, placed so the
 * subject's crown and chin land on the preset's guides. That is what makes the
 * guides meaningful: they are a fixed target, and the photo is aligned to them.
 *
 * Auto-align solves for that placement from the face landmarks and the mask's
 * true crown; zoom and pan then nudge it.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { drawBitmap } from '../../lib/bitmap'
import { composite, findCrownY } from '../../lib/composite'
import {
  estimateChinY,
  estimateCrownY,
  eyeMidpoint,
  geometry,

  headStatusMessage,
  largestFace,
  rollDegrees,
  type Geometry,
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

interface Placement {
  /** Scale applied to the preview bitmap. */
  scale: number
  /** Top-left of the scaled photo, relative to the crop window's top-left. */
  left: number
  top: number
  rotation: number
  /** Where the crown and chin land, as fractions of crop height. */
  crown: number
  chin: number
}

export function AdjustCanvas() {
  const preview = useJob((s) => s.preview)
  const previewMask = useJob((s) => s.previewMask)
  const info = useJob((s) => s.info)
  const faces = useJob((s) => s.faces)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const presetId = useJob((s) => s.presetId)
  const zoom = useJob((s) => s.zoom)
  const rotation = useJob((s) => s.rotation)
  const levelEyes = useJob((s) => s.levelEyes)
  const offsetX = useJob((s) => s.offsetX)
  const offsetY = useJob((s) => s.offsetY)
  const setPan = useJob((s) => s.setPan)
  const crownOverride = useJob((s) => s.crownOverride)
  const chinOverride = useJob((s) => s.chinOverride)
  const setCrownChin = useJob((s) => s.setCrownChin)

  const areaRef = useRef<HTMLDivElement>(null)
  const cropRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ kind: 'crown' | 'chin' | 'pan'; startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const [area, setArea] = useState({ width: 0, height: 0 })

  const preset = PHOTO_PRESETS[presetId]
  const g = useMemo(() => geometry(preset), [preset])

  // Track the available canvas area so the crop window can be sized from it.
  useLayoutEffect(() => {
    const node = areaRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setArea({ width, height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const cropSize = useMemo(() => {
    const height = Math.max(0, area.height * CROP_FRACTION)
    return { width: height * g.aspect, height }
  }, [area.height, g.aspect])

  // The subject is shown already cut out, so the crop is judged against the
  // final look rather than against the original backdrop.
  const result = useMemo(() => {
    if (!preview || !previewMask) return null
    return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail })
  }, [preview, previewMask, background, edgeSoftness, hairDetail])

  /**
   * Landmarks in *preview* pixels. Detection runs on the original, so
   * everything scales by the preview ratio.
   */
  const anatomy = useMemo(() => {
    const face = largestFace(faces)
    if (!face || !preview || !info) return null
    const s = preview.width / info.width
    const eye = eyeMidpoint(face)
    const chinY = estimateChinY(face) * s
    const boxLeft = face.box[0] * s
    const boxRight = (face.box[0] + face.box[2]) * s

    // Prefer the mask's true crown (hair included) over the landmark estimate.
    const masked = previewMask ? findCrownY(previewMask, boxLeft, boxRight) : null
    const crownY = masked ?? estimateCrownY(face) * s

    return {
      eyeX: eye.x * s,
      crownY,
      chinY,
      roll: rollDegrees(face),
    }
  }, [faces, preview, previewMask, info])

  const placement = useMemo<Placement | null>(
    () => computePlacement({ anatomy, preview, g, cropSize, zoom, rotation, levelEyes, offsetX, offsetY }),
    [anatomy, preview, g, cropSize, zoom, rotation, levelEyes, offsetX, offsetY],
  )

  useEffect(() => {
    if (result && canvasRef.current) drawBitmap(canvasRef.current, result)
  }, [result, placement])

  const head = {
    crown: crownOverride ?? placement?.crown ?? g.crown,
    chin: chinOverride ?? placement?.chin ?? g.chinMid,
  }

  const status: HeadStatus =
    faces.length === 0
      ? 'manual'
      : head.chin < g.chinMin
        ? 'small'
        : head.chin > g.chinMax || head.crown < 0.02
          ? 'large'
          : 'ok'
  const colour = guideColour(status)

  // Handle drags and panning.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.kind === 'pan') {
        setPan(drag.baseX + (event.clientX - drag.startX), drag.baseY + (event.clientY - drag.startY))
        return
      }
      const rect = cropRef.current?.getBoundingClientRect()
      if (!rect || rect.height === 0) return
      const fraction = (event.clientY - rect.top) / rect.height
      setCrownChin(drag.kind, Math.min(Math.max(fraction, -0.3), 1.3))
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
  }, [setCrownChin, setPan])

  if (!preview) return null

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
    zIndex: 3,
  })

  const cropLeft = (area.width - cropSize.width) / 2
  const cropTop = (area.height - cropSize.height) / 2

  return (
    <div ref={areaRef} className="relative h-full w-full overflow-hidden">
      {/*
        The photo is a *sibling* behind the crop window, not a child of it.
        The window dims its surroundings with one enormous box-shadow, and a
        box-shadow paints behind the element's own children — so a canvas
        nested inside would sit on top of the dimming instead of under it.
      */}
      <canvas
        ref={canvasRef}
        className="absolute max-w-none cursor-grab"
        style={{
          left: cropLeft + (placement?.left ?? 0),
          top: cropTop + (placement?.top ?? 0),
          width: preview.width * (placement?.scale ?? 1),
          height: preview.height * (placement?.scale ?? 1),
          transform: `rotate(${placement?.rotation ?? 0}deg)`,
          transformOrigin: 'center',
          visibility: placement ? 'visible' : 'hidden',
        }}
      />

      <div
        ref={cropRef}
        className="absolute"
        style={{
          left: cropLeft,
          top: cropTop,
          width: cropSize.width,
          height: cropSize.height,
          boxShadow: '0 0 0 4000px var(--dim)',
          outline: '2px solid #fff',
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          dragRef.current = {
            kind: 'pan',
            startX: e.clientX,
            startY: e.clientY,
            baseX: offsetX,
            baseY: offsetY,
          }
        }}
      >

        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '50%',
            width: 0,
            borderLeft: `1px dashed ${colour}`,
            zIndex: 2,
          }}
        />
        <div style={{ ...line(g.crown, true), zIndex: 2 }} />
        <div style={{ ...line(g.eye, true), zIndex: 2 }} />
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
            zIndex: 2,
          }}
        />

        <div
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            dragRef.current = { kind: 'crown', startX: 0, startY: 0, baseX: 0, baseY: 0 }
          }}
          title="Drag to set the crown"
          style={handle(head.crown)}
        />
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            dragRef.current = { kind: 'chin', startX: 0, startY: 0, baseX: 0, baseY: 0 }
          }}
          title="Drag to set the chin"
          style={handle(head.chin)}
        />

        <div style={{ ...label(g.crown), zIndex: 3 }}>Crown</div>
        <div style={{ ...label(g.eye), zIndex: 3 }}>Eyes</div>
        <div style={{ ...label((g.chinMin + g.chinMax) / 2), zIndex: 3 }}>Chin range</div>
      </div>

      <div className="pointer-events-none absolute left-6 top-5 flex flex-col items-start gap-2.5">
        <span
          className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-bold"
          style={{
            background: 'var(--color-bg)',
            borderLeft: `3px solid ${colour}`,
            color: 'var(--color-text)',
          }}
        >
          <span className="h-2 w-2" style={{ background: colour }} />
          {headStatusMessage(status)}
        </span>
        {faces.length > 1 && (
          <span className="bg-accent px-2.5 py-1 text-xs font-bold text-on-accent">
            {faces.length} faces found
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Solve for where to put the photo so the subject's crown sits on the preset's
 * crown line and the head fills the preset's share of the frame.
 *
 * Without a detected face there is nothing to solve for, so the photo is simply
 * fitted to the window and the operator uses the handles.
 */
function computePlacement({
  anatomy,
  preview,
  g,
  cropSize,
  zoom,
  rotation,
  levelEyes,
  offsetX,
  offsetY,
}: {
  anatomy: { eyeX: number; crownY: number; chinY: number; roll: number } | null
  preview: { width: number; height: number } | null
  g: Geometry
  cropSize: { width: number; height: number }
  zoom: number
  rotation: number
  levelEyes: boolean
  offsetX: number
  offsetY: number
}): Placement | null {
  if (!preview || cropSize.height <= 0) return null
  const zoomFactor = zoom / 100
  const roll = (levelEyes ? (anatomy?.roll ?? 0) : 0) + rotation

  if (!anatomy) {
    // Fit the whole photo, centred.
    const scale =
      Math.min(cropSize.width / preview.width, cropSize.height / preview.height) * zoomFactor
    return {
      scale,
      left: (cropSize.width - preview.width * scale) / 2 + offsetX,
      top: (cropSize.height - preview.height * scale) / 2 + offsetY,
      rotation: roll,
      crown: g.crown,
      chin: g.chinMid,
    }
  }

  // The nominal head occupies (chinMid - crown) of the crop height, so the
  // scale follows directly from the measured head height.
  const headPx = Math.max(1, anatomy.chinY - anatomy.crownY)
  const scale = ((g.chinMid - g.crown) * cropSize.height) / headPx * zoomFactor

  // Put the crown on the crown line and the eyes on the centre line.
  const left = cropSize.width / 2 - anatomy.eyeX * scale + offsetX
  const top = g.crown * cropSize.height - anatomy.crownY * scale + offsetY

  return {
    scale,
    left,
    top,
    rotation: roll,
    crown: (anatomy.crownY * scale + top) / cropSize.height,
    chin: (anatomy.chinY * scale + top) / cropSize.height,
  }
}
