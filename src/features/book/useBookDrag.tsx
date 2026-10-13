/**
 * Dragging inside the book: photos between frames, from the tray, back to
 * the tray, and pages along the strip. Drop targets carry `data-drop`.
 */

import { create } from 'zustand'

import { clearFrame, movePage, placePhoto, swapFrames } from '../../lib/bookModel'
import { useBook } from '../../store/book'
import { ThumbImg } from './ThumbImg'

export type DragItem =
  | { kind: 'frame'; page: number; frame: number; photoId: string }
  | { kind: 'tray'; photoId: string }
  | { kind: 'page'; index: number }

export type DropTarget = { kind: 'frame'; page: number; frame: number } | { kind: 'tray' } | { kind: 'page'; index: number }

interface DragState {
  item: DragItem | null
  x: number
  y: number
}

export const useDrag = create<DragState>(() => ({ item: null, x: 0, y: 0 }))

export function dropTargetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')
  const parts = el?.dataset.drop?.split(':') ?? []
  if (parts[0] === 'frame' && parts.length === 3) return { kind: 'frame', page: Number(parts[1]), frame: Number(parts[2]) }
  if (parts[0] === 'page' && parts.length === 2) return { kind: 'page', index: Number(parts[1]) }
  if (parts[0] === 'tray') return { kind: 'tray' }
  return null
}

export function applyDrop(item: DragItem, target: DropTarget | null): void {
  if (!target) return
  const { update, selectPage } = useBook.getState()
  if (item.kind === 'frame' && target.kind === 'frame') update((b) => swapFrames(b, item, target))
  else if (item.kind === 'frame' && target.kind === 'tray') update((b) => clearFrame(b, item))
  else if (item.kind === 'tray' && target.kind === 'frame') update((b) => placePhoto(b, target, item.photoId))
  else if (item.kind === 'page' && target.kind === 'page') {
    update((b) => movePage(b, item.index, target.index))
    selectPage(target.index)
  }
}

/** Follow the pointer until release, then drop. Call from a pointer event. */
export function startDrag(item: DragItem, start: { clientX: number; clientY: number }): void {
  useDrag.setState({ item, x: start.clientX, y: start.clientY })
  const move = (e: PointerEvent) => useDrag.setState({ x: e.clientX, y: e.clientY })
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    useDrag.setState({ item: null })
    applyDrop(item, dropTargetAt(e.clientX, e.clientY))
  }
  const cancel = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    useDrag.setState({ item: null })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
}

/** Movement smaller than this is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4

export function DragLayer() {
  const item = useDrag((s) => s.item)
  const x = useDrag((s) => s.x)
  const y = useDrag((s) => s.y)
  if (!item) return null
  const style: React.CSSProperties = { position: 'fixed', left: x - 32, top: y - 32, width: 64, height: 64, pointerEvents: 'none', zIndex: 60, opacity: 0.85 }
  if (item.kind === 'page') {
    return <div style={{ ...style, background: 'var(--color-surface)', border: '2px solid var(--color-accent)' }} />
  }
  return <ThumbImg id={item.photoId} className="shadow-lg" style={style} />
}
