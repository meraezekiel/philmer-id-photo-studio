/**
 * The selected page, large. Drag inside a frame to move the photo; drag out
 * of it to swap with another frame or send it back to the tray; scroll to
 * zoom. Every drag or scroll burst is one undo step.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon, ICONS } from '../../app/components/ui'
import { panCrop, zoomCrop } from '../../lib/bookCrop'
import { pageDraw, pageText, type DrawFrame } from '../../lib/bookDraw'
import { photoAspect, setCrop } from '../../lib/bookModel'
import { useBook } from '../../store/book'
import { ensureFonts, measureText, paintPage, previewSource } from './bookPaint'
import { DRAG_THRESHOLD_PX, startDrag } from './useBookDrag'

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

export function PageView() {
  const book = useBook((s) => s.book)
  const index = useBook((s) => s.selectedPage)
  const missingList = useBook((s) => s.missing)
  const selected = useBook((s) => s.selectedFrame)
  const [ref, size] = useElementSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderToken = useRef(0)
  const wheelTimer = useRef<number | null>(null)
  const [fontsReady, setFontsReady] = useState(false)

  useEffect(() => {
    void ensureFonts().then(() => setFontsReady(true))
  }, [])

  const page = book.pages[index]
  const missing = useMemo(() => new Set(missingList), [missingList])
  const draw = useMemo(() => (page ? pageDraw(book, page, { missing }) : null), [book, page, missing])
  const scale = draw ? Math.max(0, Math.min((size.width - 48) / draw.page.widthMm, (size.height - 48) / draw.page.heightMm)) : 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!draw || !canvas || scale <= 0) return
    const token = ++renderToken.current
    const dpr = window.devicePixelRatio || 1
    const off = new OffscreenCanvas(Math.max(1, Math.round(draw.page.widthMm * scale * dpr)), Math.max(1, Math.round(draw.page.heightMm * scale * dpr)))
    void paintPage(off.getContext('2d')!, draw, pageText(book, index, measureText), {
      pxPerMm: scale * dpr,
      originPx: { x: 0, y: 0 },
      source: previewSource(book),
      preview: true,
    }).then(() => {
      // A newer render started meanwhile; drop this one.
      if (token !== renderToken.current) return
      canvas.width = off.width
      canvas.height = off.height
      canvas.getContext('2d')!.drawImage(off, 0, 0)
    })
  }, [draw, scale, book, index, fontsReady])

  if (!page || !draw) {
    return <div ref={ref} className="flex h-full items-center justify-center text-muted">No pages yet.</div>
  }

  const aspects = (f: DrawFrame) => {
    const photo = book.photos.find((p) => p.id === f.photoId)
    return photo ? { photo: photoAspect(photo), frame: f.rect.w / f.rect.h } : null
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>, f: DrawFrame) => {
    const store = useBook.getState()
    store.selectFrame({ page: index, frame: f.index })
    if (!f.photoId || event.button !== 0) return
    const a = aspects(f)
    if (!a) return
    const el = event.currentTarget
    const box = el.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const startCrop = store.book.pages[index].frames[f.index].crop
    const ref = { page: index, frame: f.index }
    let moved = false
    store.beginGesture()
    el.setPointerCapture(event.pointerId)

    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
      moved = true
      const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom
      if (outside) {
        // Leaving the frame turns the pan into a move: undo the pan, carry the photo.
        finish()
        useBook.getState().update((b) => setCrop(b, ref, startCrop))
        useBook.getState().endGesture()
        startDrag({ kind: 'frame', page: index, frame: f.index, photoId: f.photoId! }, e)
        return
      }
      const crop = panCrop(startCrop, a.photo, a.frame, (e.clientX - startX) / box.width, (e.clientY - startY) / box.height)
      useBook.getState().update((b) => setCrop(b, ref, crop))
    }
    const up = () => {
      finish()
      useBook.getState().endGesture()
    }
    const finish = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>, f: DrawFrame) => {
    const a = aspects(f)
    if (!a) return
    const store = useBook.getState()
    if (wheelTimer.current === null) store.beginGesture()
    else window.clearTimeout(wheelTimer.current)
    wheelTimer.current = window.setTimeout(() => {
      wheelTimer.current = null
      useBook.getState().endGesture()
    }, 400)
    const current = store.book.pages[index].frames[f.index].crop
    const crop = zoomCrop(current, a.photo, a.frame, Math.pow(1.1, -event.deltaY / 100))
    store.update((b) => setCrop(b, { page: index, frame: f.index }, crop))
  }

  return (
    <div ref={ref} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div className="relative shadow-lg" style={{ width: draw.page.widthMm * scale, height: draw.page.heightMm * scale }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {draw.frames.map((f) => {
          const isSelected = selected?.page === index && selected.frame === f.index
          return (
            <div
              key={f.index}
              data-drop={`frame:${index}:${f.index}`}
              onPointerDown={(e) => onPointerDown(e, f)}
              onWheel={(e) => onWheel(e, f)}
              className="absolute"
              style={{
                left: f.rect.x * scale,
                top: f.rect.y * scale,
                width: f.rect.w * scale,
                height: f.rect.h * scale,
                cursor: f.photoId ? 'grab' : 'default',
                outline: isSelected ? '2px solid var(--color-accent)' : undefined,
                touchAction: 'none',
              }}
            >
              {f.missing && (
                <span className="absolute left-1 top-1 bg-[var(--danger)] px-1.5 py-0.5 text-[11px] font-bold text-white">Missing</span>
              )}
              {!f.missing && f.lowRes && (
                <span className="absolute left-1 top-1 flex items-center gap-1 bg-[var(--warn-line)] px-1.5 py-0.5 text-[11px] font-bold text-white" title={`${Math.round(f.dpi ?? 0)} DPI at print size`}>
                  <Icon path={ICONS.warning} size={12} /> Low resolution
                </span>
              )}
              {!f.photoId && (
                <span className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">Drop a photo here</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
