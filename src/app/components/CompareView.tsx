/**
 * Before | After: the original left of a draggable divider, the finished
 * photo right of it. The divider drags rather than toggling so the operator
 * can park it on the hairline and study the edge; holding "\" shows the
 * original outright (DESIGN_BRIEF §6).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { drawBitmap } from '../../lib/bitmap'
import type { Bitmap } from '../../lib/composite'
import { Icon } from './ui'

export function CompareView({
  before,
  after,
  boxStyle,
  checkerboard = false,
  inspecting = false,
}: {
  before: Bitmap
  after: Bitmap
  /** Size and aspect of the box; the caller knows its own layout. */
  boxStyle: React.CSSProperties
  /** Show transparency in `after` against a checkerboard. */
  checkerboard?: boolean
  inspecting?: boolean
}) {
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const [split, setSplit] = useState(50)

  useEffect(() => {
    if (beforeRef.current) drawBitmap(beforeRef.current, before)
  }, [before])
  useEffect(() => {
    if (afterRef.current) drawBitmap(afterRef.current, after)
  }, [after])

  const moveSplit = useCallback((clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) moveSplit(e.clientX)
    }
    const onUp = () => {
      draggingRef.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [moveSplit])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === '\\') setSplit(100)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === '\\') setSplit(50)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  return (
    <div
      ref={boxRef}
      className="relative select-none shadow-lg"
      style={{ ...boxStyle, cursor: 'ew-resize', overflow: 'hidden' }}
      onMouseDown={(e) => {
        draggingRef.current = true
        moveSplit(e.clientX)
      }}
    >
      <canvas
        ref={afterRef}
        className="absolute inset-0 h-full w-full"
        style={{
          objectFit: 'cover',
          imageRendering: inspecting ? 'pixelated' : 'auto',
          background: checkerboard ? 'repeating-conic-gradient(#d9d9d9 0 25%, #ffffff 0 50%) 0 0 / 16px 16px' : undefined,
        }}
      />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
        <canvas
          ref={beforeRef}
          className="h-full w-full"
          style={{ objectFit: 'cover', imageRendering: inspecting ? 'pixelated' : 'auto' }}
        />
      </div>

      <div
        className="absolute bottom-0 top-0"
        style={{
          left: `${split}%`,
          width: 2,
          marginLeft: -1,
          background: '#fff',
          boxShadow: '0 0 0 1px rgba(0,0,0,.15)',
        }}
      >
        <div
          className="absolute grid place-items-center bg-white shadow"
          style={{ left: -17, top: '50%', marginTop: -18, width: 36, height: 36, color: '#201e1d' }}
        >
          <Icon path={['m9 18-6-6 6-6', 'm15 6 6 6-6 6']} size={18} />
        </div>
      </div>

      <span
        className="pointer-events-none absolute left-3 top-3 px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white"
        style={{ background: 'rgba(32,30,29,.8)' }}
      >
        Before
      </span>
      <span
        className="pointer-events-none absolute right-3 top-3 px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white"
        style={{ background: 'rgba(32,30,29,.8)' }}
      >
        After
      </span>
    </div>
  )
}
