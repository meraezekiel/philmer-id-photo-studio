/**
 * The finished photo at preview size: enhanced, and on its new background
 * once the mask is ready. While the mask is computing, a cutout mode shows the
 * enhanced original, so the operator is never looking at a blank canvas.
 */

import { useEffect, useRef, useState } from 'react'

import { coverFit } from '../../lib/bitmap'
import { composite, type Bitmap, type CompositeBackground } from '../../lib/composite'
import { applyEnhance } from '../../lib/enhance'
import { useEdit } from '../../store/edit'

export function useEditResult(): Bitmap | null {
  const preview = useEdit((s) => s.preview)
  const previewMask = useEdit((s) => s.previewMask)
  const mode = useEdit((s) => s.backgroundMode)
  const color = useEdit((s) => s.backgroundColor)
  const bgImage = useEdit((s) => s.backgroundImage)
  const view = useEdit((s) => s.backgroundView)
  const edgeSoftness = useEdit((s) => s.edgeSoftness)
  const hairDetail = useEdit((s) => s.hairDetail)
  const enhance = useEdit((s) => s.enhance)

  // The background picture, cut to the photo's shape (needs a canvas, so async).
  const [placed, setPlaced] = useState<Bitmap | null>(null)
  useEffect(() => {
    if (mode !== 'image' || !bgImage || !preview) {
      setPlaced(null)
      return
    }
    let live = true
    void coverFit(bgImage, preview.width, preview.height, view).then((b) => live && setPlaced(b))
    return () => {
      live = false
    }
  }, [mode, bgImage, preview, view])

  // Compositing a full preview takes longer than a drag event, so dragging a
  // colour or slider would queue one composite per event. Instead, keep the
  // latest settings and composite them once the previous result is shown.
  const [result, setResult] = useState<Bitmap | null>(null)
  const latest = useRef<() => Bitmap | null>(() => null)
  const pending = useRef(false)
  latest.current = () => {
    if (!preview) return null
    if (mode === 'original' || !previewMask) return applyEnhance(preview, enhance)
    const background: CompositeBackground =
      mode === 'transparent' ? 'transparent' : mode === 'image' && placed ? placed : color
    return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail, ...enhance })
  }
  useEffect(() => {
    if (!preview) {
      setResult(null)
      return
    }
    if (pending.current) return
    pending.current = true
    setTimeout(() => {
      pending.current = false
      setResult(latest.current())
    }, 0)
  }, [preview, previewMask, mode, color, placed, edgeSoftness, hairDetail, enhance])

  return preview ? result : null
}
