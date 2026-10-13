/**
 * Pages panel: the selected page's layout (or the cover's text), the
 * selected photo's crop and enhance, whole-book enhance, and the tray of
 * photos not yet on a page.
 */

import { useState } from 'react'
import { ask } from '@tauri-apps/plugin-dialog'

import { Button, Notice, Section, Segmented, Slider, Swatch, TextInput } from '../../app/components/ui'
import { CENTRED, MAX_ZOOM } from '../../lib/bookCrop'
import { FONT_LABELS, pageDraw } from '../../lib/bookDraw'
import { BOOK_LAYOUTS, type BookLayout } from '../../lib/bookLayouts'
import { clearFrame, setCover, setCrop, setEnhanceAll, setPageLayout, setPhotoEnhance, unusedPhotos } from '../../lib/bookModel'
import type { BookCover, BookFont, CoverPosition } from '../../lib/bookTypes'
import { autoEnhance, NEUTRAL_ENHANCE, type EnhanceSettings } from '../../lib/enhance'
import { useBook } from '../../store/book'
import { thumbPixels } from './bookPaint'
import { pickMorePhotos } from './SetupStep'
import { ThumbImg } from './ThumbImg'
import { DRAG_THRESHOLD_PX, startDrag } from './useBookDrag'

function LayoutIcon({ layout, active, onPick }: { layout: BookLayout; active: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} title={layout.label} aria-pressed={active} className="p-1" style={{ outline: active ? '2px solid var(--color-accent)' : '1px solid var(--color-divider)' }}>
      <svg viewBox="0 0 40 50" className="block h-[50px] w-[40px]">
        <rect width="40" height="50" fill="var(--color-surface)" />
        {layout.frames.map((f, i) => (
          <rect key={i} x={2 + f.x * 36 + 0.5} y={2 + f.y * 46 + 0.5} width={f.w * 36 - 1} height={f.h * 46 - 1} fill="var(--color-neutral-400)" rx={f.fit ? 0 : 0} />
        ))}
      </svg>
    </button>
  )
}

function CoverSection({ cover }: { cover: BookCover }) {
  const updateCoalesced = useBook((s) => s.updateCoalesced)
  const update = useBook((s) => s.update)
  const set = (key: string, patch: Partial<BookCover>) => updateCoalesced(key, (b) => (b.cover ? setCover(b, { ...b.cover, ...patch }) : b))
  return (
    <Section title="Cover">
      <TextInput value={cover.title} placeholder="Title" onChange={(title) => set('cover-title', { title })} />
      <TextInput value={cover.subtitle} placeholder="Subtitle" onChange={(subtitle) => set('cover-subtitle', { subtitle })} />
      <Segmented<BookFont> options={(['playfair', 'greatvibes', 'archivo'] as const).map((f) => ({ value: f, label: FONT_LABELS[f] }))} value={cover.font} onChange={(font) => set('cover-font', { font })} columns={3} />
      <Segmented<CoverPosition> options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} value={cover.position} onChange={(position) => set('cover-position', { position })} columns={3} />
      <div className="grid grid-cols-4 gap-2">
        {[{ hex: '#FFFFFF', label: 'White' }, { hex: '#111111', label: 'Black' }, { hex: '#C9A227', label: 'Gold' }, { hex: '#F4EFE6', label: 'Ivory' }].map((c) => (
          <Swatch key={c.hex} hex={c.hex} label={c.label} selected={cover.textColor === c.hex} onSelect={() => set('cover-color', { textColor: c.hex })} />
        ))}
      </div>
      <Button onClick={() => update((b) => setCover(b, null))}>Remove the cover</Button>
    </Section>
  )
}

const SLIDERS: { key: keyof EnhanceSettings; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -50, max: 50 },
  { key: 'contrast', label: 'Contrast', min: -50, max: 50 },
  { key: 'warmth', label: 'Warmth', min: -50, max: 50 },
  { key: 'saturation', label: 'Saturation', min: -50, max: 50 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 50 },
]

function PhotoSection() {
  const book = useBook((s) => s.book)
  const selected = useBook((s) => s.selectedFrame)
  const update = useBook((s) => s.update)
  const updateCoalesced = useBook((s) => s.updateCoalesced)
  const [busy, setBusy] = useState(false)
  const page = selected ? book.pages[selected.page] : undefined
  const frame = selected && page ? page.frames[selected.frame] : undefined
  const photo = frame?.photoId ? book.photos.find((p) => p.id === frame.photoId) : undefined
  if (!selected || !page || !frame || !photo) {
    return (
      <Section title="Photo">
        <p className="text-sm text-muted">Click a photo on the page to adjust it. Drag inside it to move it, scroll to zoom, drag it out to swap or remove it.</p>
      </Section>
    )
  }
  const draw = pageDraw(book, page).frames[selected.frame]
  const auto = async () => {
    setBusy(true)
    try {
      const tone = autoEnhance(await thumbPixels(photo.id))
      update((b) => setPhotoEnhance(b, photo.id, tone))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Photo">
      <p className="truncate text-sm font-bold" title={photo.path}>{photo.name}</p>
      {draw?.dpi && Number.isFinite(draw.dpi) && (
        <p className={`tabular text-xs ${draw.lowRes ? 'font-bold text-[var(--warn)]' : 'text-muted'}`}>
          {Math.round(draw.dpi)} DPI at print size{draw.lowRes ? ': may print soft' : ''}
        </p>
      )}
      <Slider label="Zoom" value={frame.crop.zoom} min={1} max={MAX_ZOOM} step={0.05} defaultValue={1} format={(v) => `${v.toFixed(2)}x`} onChange={(zoom) => updateCoalesced(`zoom-${selected.page}-${selected.frame}`, (b) => setCrop(b, selected, { ...frame.crop, zoom }))} />
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => update((b) => setCrop(b, selected, CENTRED))}>Re-centre</Button>
        <Button onClick={() => update((b) => clearFrame(b, selected))}>Remove from page</Button>
      </div>
      <Button onClick={() => void auto()} disabled={busy}>{busy ? 'Enhancing…' : 'Auto enhance'}</Button>
      {SLIDERS.map((s) => (
        <Slider key={s.key} label={s.label} value={photo.enhance[s.key]} min={s.min} max={s.max} onChange={(v) => updateCoalesced(`enhance-${photo.id}-${s.key}`, (b) => setPhotoEnhance(b, photo.id, { [s.key]: v }))} />
      ))}
    </Section>
  )
}

function BookEnhanceSection() {
  const update = useBook((s) => s.update)
  const [progress, setProgress] = useState<string | null>(null)
  const enhanceAll = async () => {
    const { photos } = useBook.getState().book
    const byId: Record<string, Required<EnhanceSettings>> = {}
    for (const [i, photo] of photos.entries()) {
      setProgress(`Enhancing ${i + 1} / ${photos.length}`)
      try {
        byId[photo.id] = { ...photo.enhance, ...autoEnhance(await thumbPixels(photo.id)) }
      } catch {
        // A missing photo keeps its settings.
      }
    }
    update((b) => setEnhanceAll(b, byId))
    setProgress(null)
  }
  const resetAll = () => update((b) => setEnhanceAll(b, Object.fromEntries(b.photos.map((p) => [p.id, NEUTRAL_ENHANCE]))))
  return (
    <Section title="Whole book">
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => void enhanceAll()} disabled={progress !== null}>Auto enhance all</Button>
        <Button onClick={resetAll} disabled={progress !== null}>Reset all</Button>
      </div>
      {progress && <Notice tone="info">{progress}</Notice>}
    </Section>
  )
}

function TraySection() {
  const book = useBook((s) => s.book)
  const tray = unusedPhotos(book)
  const onPointerDown = (event: React.PointerEvent, photoId: string) => {
    if (event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
      cleanup()
      startDrag({ kind: 'tray', photoId }, e)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
  }
  return (
    <Section title={`Not on a page (${tray.length})`} last>
      <div data-drop="tray" className="grid min-h-[96px] grid-cols-3 gap-2 border border-dashed border-divider p-2">
        {tray.length === 0 && <p className="col-span-3 self-center text-center text-xs text-muted">Every photo is on a page. Drag one here to take it off.</p>}
        {tray.map((p) => (
          <div key={p.id} onPointerDown={(e) => onPointerDown(e, p.id)} title={p.name} className="cursor-grab" style={{ touchAction: 'none' }}>
            <ThumbImg id={p.id} className="block aspect-square w-full" />
          </div>
        ))}
      </div>
      <Button onClick={() => void pickMorePhotos()}>Add photos…</Button>
    </Section>
  )
}

export function PagesPanel() {
  const book = useBook((s) => s.book)
  const index = useBook((s) => s.selectedPage)
  const update = useBook((s) => s.update)
  const missing = useBook((s) => s.missing)
  const page = book.pages[index]
  if (!page) return null
  const isCover = page.layoutId === 'cover'

  const rebuild = async () => {
    const yes = await ask('Rebuilding replaces every page, including your changes. Rebuild the pages?', { title: 'Rebuild pages', kind: 'warning', okLabel: 'Rebuild', cancelLabel: 'Keep my pages' })
    if (yes) useBook.getState().buildPages()
  }

  return (
    <>
      {missing.length > 0 && (
        <div className="px-6 pt-5">
          <Notice tone="danger">{missing.length} photo{missing.length === 1 ? ' is' : 's are'} missing. Use “Locate photos” in the Book file section.</Notice>
        </div>
      )}
      {isCover && book.cover ? (
        <CoverSection cover={book.cover} />
      ) : (
        <Section title="Layout">
          {[1, 2, 3, 4, 5, 6].map((count) => (
            <div key={count} className="flex flex-wrap gap-2">
              {BOOK_LAYOUTS.filter((l) => l.count === count && !l.cover).map((l) => (
                <LayoutIcon key={l.id} layout={l} active={l.id === page.layoutId} onPick={() => update((b) => setPageLayout(b, index, l.id))} />
              ))}
            </div>
          ))}
        </Section>
      )}
      <PhotoSection />
      <BookEnhanceSection />
      <Section title="Pages">
        <Button onClick={() => void rebuild()}>Rebuild all pages…</Button>
      </Section>
      <TraySection />
    </>
  )
}
