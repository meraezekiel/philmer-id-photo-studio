import { useEffect, useRef } from 'react'

import { Icon, ICONS } from '../../app/components/ui'
import { addPage, deletePage, duplicatePage, pageMmOf } from '../../lib/bookModel'
import type { Book, BookPage } from '../../lib/bookTypes'
import { useBook } from '../../store/book'
import { pageLabel, previewSource, renderPage } from './bookPaint'
import { DRAG_THRESHOLD_PX, startDrag } from './useBookDrag'

const THUMB_HEIGHT = 88

function PageThumb({ book, page, index, selected }: { book: Book; page: BookPage; index: number; selected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const missingList = useBook((s) => s.missing)
  // This page's own photos (id, enhance, missing): other photos' edits do not repaint it.
  const photosKey = page.frames
    .map((f) => {
      const photo = book.photos.find((p) => p.id === f.photoId)
      return photo ? `${photo.id}:${JSON.stringify(photo.enhance)}:${missingList.includes(photo.id)}` : ''
    })
    .join('|')
  useEffect(() => {
    let live = true
    const dpi = THUMB_HEIGHT / (pageMmOf(book).heightMm / 25.4)
    void renderPage(book, index, { dpi: dpi * (window.devicePixelRatio || 1), source: previewSource(book), preview: true, missing: new Set(missingList) }).then((off) => {
      const canvas = canvasRef.current
      if (!live || !canvas) return
      canvas.width = off.width
      canvas.height = off.height
      canvas.getContext('2d')!.drawImage(off, 0, 0)
    }).catch((e) => console.warn('Page thumbnail failed', e))
    return () => {
      live = false
    }
    // Re-render when this page, the book's look or its photos' enhance change.
  }, [page, photosKey, book.size, book.orientation, book.style, book.cover, index])

  return (
    <canvas
      ref={canvasRef}
      className="block bg-white"
      style={{ height: THUMB_HEIGHT, outline: selected ? '2px solid var(--color-accent)' : '1px solid var(--color-divider)' }}
    />
  )
}

export function PageStrip() {
  const book = useBook((s) => s.book)
  const selected = useBook((s) => s.selectedPage)
  const selectPage = useBook((s) => s.selectPage)
  const update = useBook((s) => s.update)
  const isCover = book.pages[selected]?.layoutId === 'cover'

  const onPointerDown = (event: React.PointerEvent, index: number) => {
    selectPage(index)
    if (book.pages[index]?.layoutId === 'cover' || event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
      cleanup()
      startDrag({ kind: 'page', index }, e)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  const add = () => {
    const result = addPage(useBook.getState().book, selected)
    update(() => result.book)
    selectPage(result.index)
  }

  return (
    <div className="flex h-[132px] flex-none items-center gap-3 border-t-2 border-divider px-4" style={{ background: 'var(--panel)' }}>
      <div className="flex min-w-0 flex-1 items-end gap-3 overflow-x-auto py-2">
        {book.pages.map((page, i) => (
          <div key={page.id} data-drop={`page:${i}`} onPointerDown={(e) => onPointerDown(e, i)} className="flex flex-none cursor-pointer flex-col items-center gap-1" style={{ touchAction: 'none' }}>
            <PageThumb book={book} page={page} index={i} selected={i === selected} />
            <span className="tabular text-[11px] text-muted">{pageLabel(book, i)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-none flex-col gap-1.5">
        <button type="button" onClick={add} className="h-8 border border-divider px-3 text-[13px] font-bold hover:bg-[var(--hover)]">+ Page</button>
        <button type="button" onClick={() => update((b) => duplicatePage(b, selected))} disabled={isCover} className="h-8 border border-divider px-3 text-[13px] font-bold hover:bg-[var(--hover)] disabled:opacity-45">Duplicate</button>
        <button type="button" onClick={() => update((b) => deletePage(b, selected))} disabled={isCover} className="flex h-8 items-center justify-center gap-1 border border-divider px-3 text-[13px] font-bold hover:bg-[var(--hover)] disabled:opacity-45">
          <Icon path={ICONS.close} size={14} /> Delete
        </button>
      </div>
    </div>
  )
}
