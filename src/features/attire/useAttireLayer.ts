/**
 * The attire to draw on this job's photo, or null for None. Every preview
 * and every export reads it from here, so they cannot disagree.
 */

import { useMemo } from 'react'

import { faceFrame, neckFrame, neckInImage } from '../../lib/attire'
import type { AttireLayer } from '../../lib/attireDraw'
import { largestFace } from '../../lib/autoCrop'
import { useAttireLibrary } from '../../store/attire'
import { useJob } from '../../store/job'
import { useFramedCrop } from '../../store/useFramedCrop'

export function useAttireLayer(): AttireLayer | null {
  const attireId = useJob((s) => s.attireId)
  const fit = useJob((s) => s.attireFit)
  const faces = useJob((s) => s.faces)
  const cropRect = useFramedCrop()
  const info = useJob((s) => s.info)
  const hideOriginal = useJob((s) => s.attireHideOriginal)
  const background = useJob((s) => s.background)
  const blend = useJob((s) => s.attireBlend)
  const strokes = useJob((s) => s.attireStrokes)
  const templates = useAttireLibrary((s) => s.templates)
  const mask = useJob((s) => s.previewMask)

  return useMemo(() => {
    const template = templates.find((t) => t.id === attireId)
    if (!template || !fit) return null
    const frame = info ? faceFrame(largestFace(faces), cropRect, info) : null
    const neck =
      info && mask ? neckFrame(neckInImage(mask, largestFace(faces), info), cropRect, info) : null
    return { template, fit, frame, neck, hideOriginal, background, blend, strokes }
  }, [templates, attireId, fit, faces, cropRect, info, mask, hideOriginal, background, blend, strokes])
}
