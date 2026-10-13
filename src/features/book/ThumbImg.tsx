import { useEffect, useState } from 'react'

import { thumbSrc } from './bookPaint'

export function ThumbImg({ id, className, style }: { id: string; className?: string; style?: React.CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSrc(null)
    thumbSrc(id).then((s) => live && setSrc(s)).catch(() => {})
    return () => {
      live = false
    }
  }, [id])
  if (!src) return <div className={className} style={{ ...style, background: 'var(--color-neutral-200)' }} />
  return <img src={src} alt="" draggable={false} className={className} style={{ ...style, objectFit: 'cover' }} />
}
