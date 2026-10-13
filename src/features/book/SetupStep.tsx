/**
 * Setup: every book-wide choice, with the print sheet drawn to scale so the
 * operator sees how many pages land on each sheet before building.
 */

import { useState } from 'react'
import { ask, open as openDialog } from '@tauri-apps/plugin-dialog'

import { Button, Icon, ICONS, Notice, Section, Segmented, Slider, Swatch, TextInput } from '../../app/components/ui'
import { setCover } from '../../lib/bookModel'
import { BOOK_PAPER_CHOICES, BOOK_SIZE_ORDER, BOOK_SIZES, isSquare, type BookOrientation, type BookSizeId } from '../../lib/bookSizes'
import { clampStyle, DEFAULT_COVER, EDGE_TO_EDGE, PAGE_COUNT_OPTIONS, WHITE_BORDER, type BookStyle } from '../../lib/bookTypes'
import { editPaper, type EditPaperChoice, type LengthUnit } from '../../lib/editPaper'
import { useBook } from '../../store/book'
import { LengthField } from '../edit/PrintExportStep'
import { bookPlan, loadBookPhotos } from './bookPipeline'

const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp']
export const PAGE_COLOURS = [
  { hex: '#FFFFFF', label: 'White' },
  { hex: '#F4EFE6', label: 'Cream' },
  { hex: '#F3E1DD', label: 'Blush' },
  { hex: '#111111', label: 'Black' },
]

export async function pickMorePhotos(): Promise<void> {
  const selected = await openDialog({ multiple: true, filters: [{ name: 'Photos', extensions: EXTENSIONS }] })
  if (Array.isArray(selected)) await loadBookPhotos(selected)
  else if (typeof selected === 'string') await loadBookPhotos([selected])
}

export function SetupCanvas() {
  const book = useBook((s) => s.book)
  const plan = bookPlan(book)
  if (!plan.ok) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />}>{plan.message}</Notice>
      </div>
    )
  }
  const paper = editPaper(book.paper, book.customPaper)
  const { widthMm: W, heightMm: H } = plan.paper
  const b = plan.bleedMm
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8" style={{ containerType: 'size' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="shadow-lg" style={{ height: '78cqh', maxWidth: '88cqw', background: '#FFFFFF' }}>
        {plan.slots.map((slot, i) => (
          <g key={i}>
            {b > 0 && (
              <rect x={slot.trim.x - b} y={slot.trim.y - b} width={slot.trim.w + 2 * b} height={slot.trim.h + 2 * b} fill="none" stroke="#E57373" strokeWidth={0.4} strokeDasharray="1.5 1" />
            )}
            <rect x={slot.trim.x} y={slot.trim.y} width={slot.trim.w} height={slot.trim.h} fill={book.style.color} stroke="#9E9E9E" strokeWidth={0.4} />
            <text x={slot.trim.x + slot.trim.w / 2} y={slot.trim.y + slot.trim.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(slot.trim.w, slot.trim.h) / 5} fill="#BDBDBD" fontWeight={800}>
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
      <p className="tabular text-[15px] font-bold">
        {plan.perSheet} page{plan.perSheet === 1 ? '' : 's'} per {book.paper === 'custom' ? 'sheet' : `${paper.label} sheet`}
        {plan.borderless ? ', needs borderless printing' : ''}
      </p>
    </div>
  )
}

export function SetupPanel() {
  const book = useBook((s) => s.book)
  const update = useBook((s) => s.update)
  const updateCoalesced = useBook((s) => s.updateCoalesced)
  const fillError = useBook((s) => s.fillError)
  const loadErrors = useBook((s) => s.loadErrors)
  const notice = useBook((s) => s.notice)
  const dismiss = useBook((s) => s.dismissLoadErrors)
  const [unit, setUnit] = useState<LengthUnit>('in')
  const [showAllErrors, setShowAllErrors] = useState(false)

  const setStyle = (key: string, patch: Partial<BookStyle>) => updateCoalesced(key, (b) => ({ ...b, style: clampStyle({ ...b.style, ...patch }) }))
  const built = book.pages.length > 0

  const build = async () => {
    if (built) {
      const yes = await ask('Rebuilding replaces every page, including your changes. Rebuild the pages?', {
        title: 'Rebuild pages',
        kind: 'warning',
        okLabel: 'Rebuild',
        cancelLabel: 'Keep my pages',
      })
      if (!yes) return
    }
    useBook.getState().buildPages()
  }

  const shownErrors = showAllErrors ? loadErrors : loadErrors.slice(0, 5)

  return (
    <>
      <Section title="Photos">
        <p className="tabular text-sm">{book.photos.length} photo{book.photos.length === 1 ? '' : 's'} in the book</p>
        <Button onClick={() => void pickMorePhotos()}>Add photos…</Button>
        {notice && <Notice tone="info">{notice}</Notice>}
        {loadErrors.length > 0 && (
          <Notice tone="warn" action={<button type="button" onClick={dismiss} className="text-[13px] font-bold underline">OK</button>}>
            <span className="block font-bold">{loadErrors.length} file{loadErrors.length === 1 ? '' : 's'} could not be used</span>
            {shownErrors.map((e) => (
              <span key={e} className="block text-[13px]">{e}</span>
            ))}
            {loadErrors.length > 5 && !showAllErrors && (
              <button type="button" onClick={() => setShowAllErrors(true)} className="text-[13px] underline">
                and {loadErrors.length - 5} more
              </button>
            )}
          </Notice>
        )}
      </Section>

      <Section title="Book size">
        <Segmented<BookSizeId>
          options={BOOK_SIZE_ORDER.map((id) => ({ value: id, label: BOOK_SIZES[id].label }))}
          value={book.size}
          onChange={(size) => update((b) => ({ ...b, size }))}
          columns={5}
        />
        <p className="tabular text-xs text-muted">{BOOK_SIZES[book.size].sublabel}</p>
        <Segmented<BookOrientation>
          options={[
            { value: 'portrait', label: 'Portrait', disabled: isSquare(book.size) },
            { value: 'landscape', label: 'Landscape', disabled: isSquare(book.size) },
          ]}
          value={book.orientation}
          onChange={(orientation) => update((b) => ({ ...b, orientation }))}
          columns={2}
        />
      </Section>

      <Section title="Print paper">
        <Segmented<EditPaperChoice>
          options={BOOK_PAPER_CHOICES.map((id) => ({ value: id, label: editPaper(id, book.customPaper).label }))}
          value={book.paper}
          onChange={(paper) => update((b) => ({ ...b, paper }))}
          columns={3}
        />
        {book.paper === 'custom' && (
          <div className="flex items-end gap-2">
            <LengthField label="Width" mm={book.customPaper.widthMm} unit={unit} onChange={(widthMm) => updateCoalesced('paper-w', (b) => ({ ...b, customPaper: { ...b.customPaper, widthMm } }))} />
            <span className="pb-2 text-muted">×</span>
            <LengthField label="Height" mm={book.customPaper.heightMm} unit={unit} onChange={(heightMm) => updateCoalesced('paper-h', (b) => ({ ...b, customPaper: { ...b.customPaper, heightMm } }))} />
            <Segmented<LengthUnit> options={[{ value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }]} value={unit} onChange={setUnit} columns={2} />
          </div>
        )}
        <p className="tabular text-xs text-muted">{editPaper(book.paper, book.customPaper).sublabel}</p>
      </Section>

      <Section title="Page style">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => update((b) => ({ ...b, style: { ...WHITE_BORDER, color: b.style.color } }))}>White border</Button>
          <Button onClick={() => update((b) => ({ ...b, style: { ...EDGE_TO_EDGE, color: b.style.color } }))}>Edge to edge</Button>
        </div>
        <Slider label="Margin" value={book.style.marginMm} min={0} max={20} step={0.5} defaultValue={WHITE_BORDER.marginMm} format={(v) => `${v} mm`} onChange={(marginMm) => setStyle('margin', { marginMm })} />
        <Slider label="Gap" value={book.style.gapMm} min={0} max={10} step={0.5} defaultValue={WHITE_BORDER.gapMm} format={(v) => `${v} mm`} onChange={(gapMm) => setStyle('gap', { gapMm })} />
        <div className="grid grid-cols-4 gap-2">
          {PAGE_COLOURS.map((c) => (
            <Swatch key={c.hex} hex={c.hex} label={c.label} selected={book.style.color === c.hex} onSelect={() => update((b) => ({ ...b, style: { ...b.style, color: c.hex } }))} />
          ))}
        </div>
        {book.style.marginMm === 0 && <p className="text-xs text-muted">Edge to edge: photos run 2 mm past the cut line so a slightly off cut shows no white.</p>}
      </Section>

      <Section title="Pages">
        <Segmented<string>
          options={[{ value: 'auto', label: 'Auto' }, ...PAGE_COUNT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))]}
          value={String(book.pageCount)}
          onChange={(v) => update((b) => ({ ...b, pageCount: v === 'auto' ? 'auto' : Number(v) }))}
          columns={5}
        />
        <p className="text-xs text-muted">Inside pages. The cover is extra.</p>
      </Section>

      <Section title="Cover">
        <Segmented<'on' | 'off'>
          options={[{ value: 'on', label: 'Cover page' }, { value: 'off', label: 'No cover' }]}
          value={book.cover ? 'on' : 'off'}
          onChange={(v) => update((b) => setCover(b, v === 'on' ? (b.cover ?? DEFAULT_COVER) : null))}
          columns={2}
        />
        {book.cover && (
          <>
            <TextInput value={book.cover.title} placeholder="Title, e.g. Juan & Maria" onChange={(title) => updateCoalesced('cover-title', (b) => (b.cover ? setCover(b, { ...b.cover, title }) : b))} />
            <TextInput value={book.cover.subtitle} placeholder="Subtitle, e.g. 12 October 2026" onChange={(subtitle) => updateCoalesced('cover-subtitle', (b) => (b.cover ? setCover(b, { ...b.cover, subtitle }) : b))} />
          </>
        )}
      </Section>

      <Section title={built ? 'Rebuild' : 'Build'} last>
        {fillError && <Notice tone="danger" icon={<Icon path={ICONS.warning} size={18} />}>{fillError}</Notice>}
        <Button variant="primary" block onClick={() => void build()} disabled={book.photos.length === 0}>
          {built ? 'Rebuild pages' : 'Build pages'}
        </Button>
      </Section>
    </>
  )
}
