/**
 * Step 4 — Print sheet (DESIGN_BRIEF §3.4).
 *
 * The canvas shows the paper at true proportions with the photos tiled on it,
 * margins faint, cut marks where the blade goes. Everything is drawn from the
 * same placements the PDF uses, so the preview is a promise the export keeps.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon, ICONS, Notice, Section, Segmented } from '../../app/components/ui'
import type { CropRect } from '../../lib/autoCrop'
import { composite, type Bitmap } from '../../lib/composite'
import { cutMarks, PHOTO_BORDER_MM } from '../../lib/layout'
import {
  PACKAGE_PRESETS,
  PAPERS,
  PAPER_ORDER,
  PHOTO_PRESETS,
  PHOTO_PRESET_ORDER,
  type PaperId,
  type PhotoPresetId,
} from '../../lib/presets'
import type { LoadedImageInfo } from '../../lib/tauri'
import { useJob, type PackageRow } from '../../store/job'
import { useSheetLayout } from './useSheetLayout'

export function SheetCanvas() {
  const preview = useJob((s) => s.preview)
  const previewMask = useJob((s) => s.previewMask)
  const info = useJob((s) => s.info)
  const cropRect = useJob((s) => s.cropRect)
  const background = useJob((s) => s.background)
  const edgeSoftness = useJob((s) => s.edgeSoftness)
  const hairDetail = useJob((s) => s.hairDetail)
  const showCutMarks = useJob((s) => s.cutMarks)
  const paper = useJob((s) => s.paper)

  const showBorders = useJob((s) => s.photoBorders)
  const photoOffsets = useJob((s) => s.photoOffsets)
  const nudgePhotos = useJob((s) => s.nudgePhotos)
  const selected = useJob((s) => s.selectedPhotos)
  const setSelectedPhotos = useJob((s) => s.setSelectedPhotos)

  const sheet = useSheetLayout()
  const areaRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  type Drag =
    | { kind: 'marquee'; startX: number; startY: number }
    | {
        kind: 'photos'
        indices: number[]
        startX: number
        startY: number
        bases: Record<number, { xMm: number; yMm: number }>
        /** The group's bounds in mm when the drag began, for clamping. */
        bbox: { left: number; top: number; right: number; bottom: number }
      }
  const dragRef = useRef<Drag | null>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  )
  // The handler closes over state, so the latest box is read from a ref.
  const marqueeRef = useRef(marquee)
  marqueeRef.current = marquee

  useEffect(() => {
    const node = areaRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setArea({ width, height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Esc drops the selection — the way out of a highlight made by accident.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPhotos([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelectedPhotos])

  // The finished photo, cropped, as a data URL so each tile is one <img>.
  const photoUrl = usePhotoUrl({
    preview,
    previewMask,
    info,
    cropRect,
    background,
    edgeSoftness,
    hairDetail,
  })

  // Fit the paper into the available area, leaving room for the chrome.
  const scale = useMemo(() => {
    if (area.width === 0 || area.height === 0) return 0
    return Math.min(
      (area.width - 120) / sheet.paperWidthMm,
      (area.height - 110) / sheet.paperHeightMm,
    )
  }, [area, sheet.paperWidthMm, sheet.paperHeightMm])

  const marks = useMemo(
    () => (showCutMarks ? cutMarks({ placements: sheet.placements, gapMm: sheet.gapMm }) : []),
    [showCutMarks, sheet.placements, sheet.gapMm],
  )

  /**
   * Drag to select, or drag to move.
   *
   * On blank paper a drag draws a selection box and everything it touches
   * becomes selected. On a photo, a drag moves it — and if it is part of a
   * selection, the whole selection travels with it, which is the point: a
   * shop wants to shift the four 1x1s together without touching the 2x2s.
   *
   * Movement converts screen pixels back to millimetres through the preview
   * scale. The selection is clamped as a group, so its shape is preserved and
   * nothing is pushed off the paper and silently lost from the print.
   */
  useEffect(() => {
    if (!dragging) return

    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag || scale <= 0) return

      if (drag.kind === 'marquee') {
        const rect = paperRef.current?.getBoundingClientRect()
        if (!rect) return
        setMarquee({
          x1: drag.startX - rect.left,
          y1: drag.startY - rect.top,
          x2: event.clientX - rect.left,
          y2: event.clientY - rect.top,
        })
        return
      }

      const dxMm = (event.clientX - drag.startX) / scale
      const dyMm = (event.clientY - drag.startY) / scale

      // Clamp the group as a whole so its arrangement is preserved. The bounds
      // are the ones captured at mousedown: measuring the live placements would
      // measure a box that has already moved, and the photos would creep.
      const { left, top, right, bottom } = drag.bbox
      const shiftX = clamp(dxMm, -left, sheet.paperWidthMm - right)
      const shiftY = clamp(dyMm, -top, sheet.paperHeightMm - bottom)

      const deltas: Record<number, { xMm: number; yMm: number }> = {}
      for (const i of drag.indices) {
        const base = drag.bases[i] ?? { xMm: 0, yMm: 0 }
        deltas[i] = { xMm: base.xMm + shiftX, yMm: base.yMm + shiftY }
      }
      nudgePhotos(drag.indices, deltas)
    }

    const onUp = () => {
      const drag = dragRef.current
      if (drag?.kind === 'marquee' && marqueeRef.current) {
        // Anything the box touches is selected; requiring full containment
        // makes small photos near the edge frustrating to catch.
        const box = marqueeRef.current
        const hit = sheet.placements
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => {
            const x1 = p.xMm * scale
            const y1 = p.yMm * scale
            const x2 = x1 + p.widthMm * scale
            const y2 = y1 + p.heightMm * scale
            return (
              x1 < Math.max(box.x1, box.x2) &&
              x2 > Math.min(box.x1, box.x2) &&
              y1 < Math.max(box.y1, box.y2) &&
              y2 > Math.min(box.y1, box.y2)
            )
          })
          .map(({ i }) => i)
        setSelectedPhotos(hit)
      }
      dragRef.current = null
      setMarquee(null)
      setDragging(false)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [
    dragging,
    scale,
    sheet.placements,
    sheet.paperWidthMm,
    sheet.paperHeightMm,
    nudgePhotos,
    setSelectedPhotos,
  ])

  if (!preview) return null

  const paperW = sheet.paperWidthMm * scale
  const paperH = sheet.paperHeightMm * scale

  return (
    <div ref={areaRef} className="relative flex h-full w-full items-center justify-center">
      {scale > 0 && (
        <div
          ref={paperRef}
          className="relative shadow-lg"
          style={{
            width: paperW,
            height: paperH,
            background: '#fff',
            cursor: 'crosshair',
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            // Blank paper starts a selection box, and clears the old selection
            // so a stray click is an obvious "nothing selected".
            setSelectedPhotos([])
            dragRef.current = { kind: 'marquee', startX: e.clientX, startY: e.clientY }
            setMarquee(null)
            setDragging(true)
          }}
        >
          {/* Margins, faint — they explain why the photos stop where they do. */}
          <div
            className="pointer-events-none absolute"
            style={{
              left: sheet.marginMm * scale,
              top: sheet.marginMm * scale,
              right: sheet.marginMm * scale,
              bottom: sheet.marginMm * scale,
              outline: '1px dashed rgba(32,30,29,.22)',
            }}
          />

          {sheet.placements.map((p, i) => (
            <div
              key={i}
              className="absolute cursor-grab overflow-hidden active:cursor-grabbing"
              onMouseDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.stopPropagation()
                // Dragging a highlighted photo takes the whole selection with
                // it. Dragging one outside the selection selects just that one,
                // so a plain single drag behaves as it always did.
                const inSelection = selected.includes(i)
                const indices = inSelection ? selected : [i]
                if (!inSelection) setSelectedPhotos([i])
                const bases: Record<number, { xMm: number; yMm: number }> = {}
                for (const j of indices) bases[j] = photoOffsets[j] ?? { xMm: 0, yMm: 0 }
                const moving = indices
                  .map((j) => sheet.placements[j])
                  .filter((p): p is NonNullable<typeof p> => Boolean(p))
                dragRef.current = {
                  kind: 'photos',
                  indices,
                  startX: e.clientX,
                  startY: e.clientY,
                  bases,
                  bbox: {
                    left: Math.min(...moving.map((p) => p.xMm)),
                    top: Math.min(...moving.map((p) => p.yMm)),
                    right: Math.max(...moving.map((p) => p.xMm + p.widthMm)),
                    bottom: Math.max(...moving.map((p) => p.yMm + p.heightMm)),
                  },
                }
                setDragging(true)
              }}
              style={{
                left: p.xMm * scale,
                top: p.yMm * scale,
                width: p.widthMm * scale,
                height: p.heightMm * scale,
                // The same hairline the PDF strokes, so the preview shows the
                // line the blade will follow. Never thinner than 1 px or it
                // disappears on screen at small preview scales.
                outline: showBorders ? `${Math.max(1, PHOTO_BORDER_MM * scale)}px solid #000` : undefined,
                outlineOffset: -Math.max(1, PHOTO_BORDER_MM * scale) / 2,
              }}
            >
              {photoUrl && (
                <img
                  src={photoUrl}
                  alt=""
                  className="pointer-events-none block"
                  style={
                    p.rotated
                      ? {
                          width: p.heightMm * scale,
                          height: p.widthMm * scale,
                          transformOrigin: 'top left',
                          transform: `rotate(90deg) translateY(-100%)`,
                        }
                      : { width: '100%', height: '100%' }
                  }
                />
              )}

              {/*
                A sibling overlay rather than a box-shadow on the tile: an inset
                shadow paints behind the tile's own children, so the <img> would
                cover it and nothing would look highlighted.
              */}
              {selected.includes(i) && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    outline: '2px solid var(--color-accent)',
                    outlineOffset: -2,
                    background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)',
                  }}
                />
              )}
            </div>
          ))}

          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {marks.map((m, i) => (
              <line
                key={i}
                x1={m.x1Mm * scale}
                y1={m.y1Mm * scale}
                x2={m.x2Mm * scale}
                y2={m.y2Mm * scale}
                stroke="rgba(32,30,29,.5)"
                strokeWidth={1}
              />
            ))}
          </svg>

          {/* The highlighter itself. */}
          {marquee && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: Math.min(marquee.x1, marquee.x2),
                top: Math.min(marquee.y1, marquee.y2),
                width: Math.abs(marquee.x2 - marquee.x1),
                height: Math.abs(marquee.y2 - marquee.y1),
                border: '1px solid var(--color-accent)',
                background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
              }}
            />
          )}
        </div>
      )}

      <div className="pointer-events-none absolute left-6 top-5 flex flex-col items-start gap-2.5">
        <div
          className="tabular flex h-9 items-center px-3 text-sm shadow-sm"
          style={{ background: 'var(--color-bg)' }}
        >
          {PAPERS[paper].label} ·{' '}
          {trim(sheet.paperWidthMm)} × {trim(sheet.paperHeightMm)} mm ·{' '}
          {sheet.count} {sheet.count === 1 ? 'photo' : 'photos'}
        </div>

        {/* How many are highlighted, where the eyes already are. */}
        {selected.length > 0 && (
          <div
            className="tabular flex h-9 items-center px-3 text-sm font-extrabold shadow-sm"
            style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
          >
            {selected.length} selected · drag any of them to move
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The finished photo as an object URL, so every tile on the sheet is one
 * <img> pointing at the same bitmap rather than N canvases.
 */
function usePhotoUrl(args: {
  preview: Bitmap | null
  previewMask: Bitmap | null
  info: LoadedImageInfo | null
  cropRect: CropRect | null
  background: string
  edgeSoftness: number
  hairDetail: number
}): string | null {
  const { preview, previewMask, info, cropRect, background, edgeSoftness, hairDetail } = args
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!preview || !previewMask) {
      setUrl(null)
      return
    }
    let revoked: string | null = null
    let cancelled = false

    void (async () => {
      const { cropRotate, encodeBitmap } = await import('../../lib/bitmap')
      let image = preview
      let mask = previewMask
      if (cropRect && info) {
        const s = preview.width / info.width
        const rect = {
          x: cropRect.x * s,
          y: cropRect.y * s,
          width: cropRect.width * s,
          height: cropRect.height * s,
        }
        image = cropRotate(preview, rect, cropRect.rotationDeg)
        mask = cropRotate(previewMask, rect, cropRect.rotationDeg)
      }
      const out = composite({ image, mask, background, edgeSoftness, hairDetail })
      const bytes = await encodeBitmap(out, 'image/png')
      if (cancelled) return
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
      revoked = blobUrl
      setUrl(blobUrl)
    })()

    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [preview, previewMask, info, cropRect, background, edgeSoftness, hairDetail])

  return url
}

export function SheetPanel() {
  const paper = useJob((s) => s.paper)
  const setPaper = useJob((s) => s.setPaper)
  const mode = useJob((s) => s.sheetMode)
  const setMode = useJob((s) => s.setSheetMode)
  const quantity = useJob((s) => s.quantity)
  const setQuantity = useJob((s) => s.setQuantity)
  const rows = useJob((s) => s.packageRows)
  const setRows = useJob((s) => s.setPackageRows)
  const showCutMarks = useJob((s) => s.cutMarks)
  const setCutMarks = useJob((s) => s.setCutMarks)
  const showBorders = useJob((s) => s.photoBorders)
  const setPhotoBorders = useJob((s) => s.setPhotoBorders)
  const offsetXMm = useJob((s) => s.sheetOffsetXMm)
  const offsetYMm = useJob((s) => s.sheetOffsetYMm)
  const photoOffsets = useJob((s) => s.photoOffsets)
  const resetSheetPositions = useJob((s) => s.resetSheetPositions)
  const selected = useJob((s) => s.selectedPhotos)
  const setSelectedPhotos = useJob((s) => s.setSelectedPhotos)
  const orientation = useJob((s) => s.paperOrientation)
  const setOrientation = useJob((s) => s.setPaperOrientation)

  const sheet = useSheetLayout()
  const moved =
    offsetXMm !== 0 || offsetYMm !== 0 || Object.keys(photoOffsets).length > 0

  const suggestBigger = (): PaperId | null => {
    const order: PaperId[] = ['4r', 'short', 'a4', 'long']
    const i = order.indexOf(paper)
    return i >= 0 && i < order.length - 1 ? order[i + 1] : null
  }

  return (
    <>
      <Section title="Paper">
        <div className="grid grid-cols-2 gap-2">
          {PAPER_ORDER.map((id) => {
            const selected = id === paper
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPaper(id)}
                aria-pressed={selected}
                className={`flex flex-col items-start gap-0.5 border px-2.5 py-2 text-left transition-colors duration-[var(--duration-fast)] ${
                  selected ? 'border-accent' : 'border-divider hover:bg-[var(--hover)]'
                }`}
              >
                <span className="text-[13px] font-bold">{PAPERS[id].label}</span>
                <span className="tabular text-[11px] text-muted">{PAPERS[id].sublabel}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Layout">
        <div className="flex flex-col gap-1.5">
          {(
            [
              ['fill', 'Fill sheet', `${sheet.capacity} photos`],
              ['exact', 'Exact quantity', ''],
              ['package', 'Package', 'mixed sizes'],
            ] as const
          ).map(([value, label, note]) => {
            const selected = mode === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className="flex items-center gap-2.5 py-1 text-left text-sm"
              >
                <span
                  className="grid h-4 w-4 flex-none place-items-center rounded-full border-[1.5px]"
                  style={{
                    borderColor: selected ? 'var(--color-accent)' : 'var(--color-divider)',
                    background: selected ? 'var(--color-accent)' : 'transparent',
                    boxShadow: selected ? 'inset 0 0 0 3px var(--color-bg)' : undefined,
                  }}
                />
                <span className={selected ? 'font-bold' : ''}>{label}</span>
                {note && <span className="tabular ml-auto text-xs text-muted">{note}</span>}
              </button>
            )
          })}
        </div>

        {mode === 'exact' && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted">Copies</span>
            <div className="flex items-center">
              <Stepper label="−" onClick={() => setQuantity(quantity - 1)} />
              <span className="tabular w-12 text-center text-sm font-bold">{quantity}</span>
              <Stepper label="+" onClick={() => setQuantity(quantity + 1)} />
            </div>
          </div>
        )}

        {mode === 'package' && (
          <PackageBuilder rows={rows} onChange={setRows} />
        )}

        {!sheet.fits && (
          <Notice
            tone="warn"
            icon={<Icon path={ICONS.warning} size={18} />}
            action={
              suggestBigger() && (
                <button
                  type="button"
                  onClick={() => setPaper(suggestBigger()!)}
                  className="whitespace-nowrap text-[13px] font-bold underline"
                >
                  Use {PAPERS[suggestBigger()!].label}
                </button>
              )
            }
          >
            {sheet.missing} more {sheet.missing === 1 ? 'photo does' : 'photos do'} not fit on{' '}
            {PAPERS[paper].label}.
          </Notice>
        )}
      </Section>

      <Section title="Options" last>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showBorders}
            onChange={(e) => setPhotoBorders(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          Photo borders
          <span className="ml-auto text-xs text-muted">a line to cut along</span>
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showCutMarks}
            onChange={(e) => setCutMarks(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          Corner marks
        </label>

        {/* Stacked, not inline: three labels plus a label do not fit 360 px. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">Orientation</span>
          <Segmented
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
            value={orientation}
            onChange={setOrientation}
            columns={3}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {selected.length > 0
              ? `${selected.length} of ${sheet.count} selected`
              : 'Drag across the paper to highlight photos, then drag them together.'}
          </span>
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelectedPhotos([])}
              className="whitespace-nowrap text-xs font-bold text-accent hover:underline"
            >
              Clear
            </button>
          ) : (
            sheet.count > 1 && (
              <button
                type="button"
                onClick={() => setSelectedPhotos(sheet.placements.map((_, i) => i))}
                className="whitespace-nowrap text-xs font-bold text-accent hover:underline"
              >
                Select all
              </button>
            )
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {moved ? 'Positions adjusted by hand' : 'Photos start at the top-left of the paper.'}
          </span>
          {moved && (
            <button
              type="button"
              onClick={resetSheetPositions}
              className="whitespace-nowrap text-xs font-bold text-accent hover:underline"
            >
              Reset positions
            </button>
          )}
        </div>

        <p className="tabular text-xs text-muted">
          {sheet.count} {sheet.count === 1 ? 'photo' : 'photos'} ·{' '}
          {trim(sheet.paperWidthMm)} × {trim(sheet.paperHeightMm)} mm ·{' '}
          {sheet.marginMm} mm margin
        </p>

        {/*
          The warning belongs wherever Print is reachable. Getting this wrong
          is the one mistake that silently ruins a sheet: the photos look
          right on screen and come out the wrong size on paper.
        */}
        <Notice tone="warn" icon={<Icon path={ICONS.warning} size={18} />}>
          When printing, choose <strong>Actual size</strong> or <strong>100%</strong> — not “Fit
          to page”.
        </Notice>
      </Section>
    </>
  )
}

function Stepper({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-8 w-8 place-items-center border border-divider text-sm font-bold transition-colors duration-[var(--duration-fast)] hover:bg-[var(--hover)]"
    >
      {label}
    </button>
  )
}

function PackageBuilder({
  rows,
  onChange,
}: {
  rows: PackageRow[]
  onChange: (rows: PackageRow[]) => void
}) {
  const sizes = PHOTO_PRESET_ORDER.filter((id) => id !== 'custom') as Exclude<
    PhotoPresetId,
    'custom'
  >[]

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={row.presetId}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...row, presetId: e.target.value as PackageRow['presetId'] }
              onChange(next)
            }}
            className="min-h-9 flex-1 border border-divider bg-surface px-2 text-sm"
          >
            {sizes.map((id) => (
              <option key={id} value={id}>
                {PHOTO_PRESETS[id].label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">×</span>
          <input
            type="number"
            min={1}
            value={row.qty}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...row, qty: Math.max(1, Number(e.target.value) || 1) }
              onChange(next)
            }}
            className="tabular min-h-9 w-16 border border-divider bg-surface px-2 text-sm"
          />
          <button
            type="button"
            title="Remove row"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="grid h-9 w-9 flex-none place-items-center border border-divider hover:bg-[var(--hover)]"
          >
            <Icon path={ICONS.close} size={14} />
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange([...rows, { presetId: '1x1', qty: 1 }])}
          className="flex-1 border border-divider px-3 py-2 text-[13px] font-bold hover:bg-[var(--hover)]"
        >
          Add size
        </button>
        <select
          value=""
          onChange={(e) => {
            const preset = PACKAGE_PRESETS.find((p) => p.id === e.target.value)
            if (preset) onChange(preset.items.map((i) => ({ ...i })))
          }}
          className="min-h-9 flex-1 border border-divider bg-surface px-2 text-[13px]"
        >
          <option value="">Saved packages…</option>
          {PACKAGE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function trim(value: number, decimals = 1): string {
  return String(Number(value.toFixed(decimals)))
}
