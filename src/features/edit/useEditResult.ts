/**
 * The finished photo at preview size: enhanced, and on its new background
 * once the mask is ready. While the mask is computing, a cutout mode shows the
 * enhanced original, so the operator is never looking at a blank canvas.
 */

import { useEffect, useMemo, useState } from 'react'

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

  return useMemo(() => {
    if (!preview) return null
    if (mode === 'original' || !previewMask) return applyEnhance(preview, enhance)
    const background: CompositeBackground =
      mode === 'transparent' ? 'transparent' : mode === 'image' && placed ? placed : color
    return composite({ image: preview, mask: previewMask, background, edgeSoftness, hairDetail, ...enhance })
  }, [preview, previewMask, mode, color, placed, edgeSoftness, hairDetail, enhance])
}
