/**
 * Import -> segment -> detect, the sequence that runs automatically on every
 * new photo (BUILD_PLAN §5 "On import").
 *
 * Segmentation is the long pole (~12-15 s on a 4-core laptop), so the preview
 * appears as soon as the photo decodes rather than waiting for the mask. The
 * operator sees the customer's face immediately and the cutout fills in.
 */

import { useCallback, useEffect } from 'react'

import { decodeToBitmap, resampleBitmap } from '../../lib/bitmap'
import {
  detectFaces,
  getImageBytes,
  loadImage,
  onSegmentProgress,
  segment,
  type LoadedImageInfo,
} from '../../lib/tauri'
import { useEdit } from '../../store/edit'
import { useJob } from '../../store/job'

/** Canvas preview cap. The export always re-fetches at full resolution. */
export const PREVIEW_MAX_DIM = 1400

/** The canvas copy of a loaded photo, shared by both flows. */
export async function previewFor(info: LoadedImageInfo): Promise<ImageData> {
  const bytes = await getImageBytes({ id: info.id, maxDim: PREVIEW_MAX_DIM })
  return decodeToBitmap(bytes, 'image/jpeg')
}

export function useSegmentProgressListener(): void {
  const setProgress = useJob((s) => s.setProgress)
  useEffect(() => {
    const unlisten = onSegmentProgress((progress) => {
      setProgress(progress)
      useEdit.getState().setProgress(progress)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setProgress])
}

export function usePhotoPipeline() {
  const store = useJob

  const run = useCallback(
    async (source: { path?: string; bytes?: ArrayBuffer }) => {
      const s = store.getState()
      s.setStatus('loading')
      s.setProgress(null)

      try {
        const info = await loadImage(source)
        s.setLoaded(info)

        // Show the photo right away; the mask takes seconds.
        const preview = await previewFor(info)

        const quality = store.getState().quality
        const [maskBytes, faces] = await Promise.all([
          segment({ id: info.id, model: quality }),
          detectFaces({ id: info.id }).catch(() => []),
        ])

        // The mask comes back at the photo's full size; scale it to the
        // preview so the two line up pixel for pixel on the canvas.
        const fullMask = await decodeToBitmap(maskBytes, 'image/png')
        const previewMask = await resampleBitmap(fullMask, preview.width, preview.height)

        store.getState().setFaces(faces)
        store.getState().setPreview(preview, previewMask)
        store.getState().setProgress(null)
        store.getState().setStep('adjust')
      } catch (error) {
        store.getState().setError(error)
      }
    },
    [store],
  )

  return { run }
}
