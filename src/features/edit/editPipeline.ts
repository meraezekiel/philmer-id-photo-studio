/**
 * Photo Print's side of loading: decode for the canvas straight away, and
 * remove the background only once the operator asks for a cutout. A print
 * that keeps its original background never waits for the model.
 */

import { decodeToBitmap, resampleBitmap } from '../../lib/bitmap'
import { asAppError, getImageBytes, loadImage, segment } from '../../lib/tauri'
import { needsMask, useEdit, type BackgroundMode } from '../../store/edit'
import { PREVIEW_MAX_DIM, previewFor } from '../import/usePhotoPipeline'

/** `C:\shop\IMG_0042.JPG` → `IMG_0042`. */
export function sourceNameOf(path?: string): string | null {
  if (!path) return null
  const file = path.split(/[\\/]/).pop() ?? ''
  return file.replace(/\.[^.]+$/, '') || null
}

export async function loadEditPhoto(source: { path?: string; bytes?: ArrayBuffer }): Promise<void> {
  useEdit.getState().startLoading()
  try {
    const info = await loadImage(source)
    const preview = await previewFor(info)
    useEdit.getState().setLoaded(info, sourceNameOf(source.path), preview)
    // The last customer's cutout mode carries over; start its mask now.
    if (needsMask(useEdit.getState().backgroundMode)) void ensureMask()
  } catch (error) {
    useEdit.getState().setError(error)
  }
}

/** Compute the preview mask once per photo. Rust caches the full mask. */
export async function ensureMask(): Promise<void> {
  const s = useEdit.getState()
  if (!s.info || !s.preview) return
  if (s.maskStatus === 'running' || s.maskStatus === 'ready') return
  const id = s.info.id
  s.maskStarted()
  try {
    const bytes = await segment({ id, model: s.quality })
    const full = await decodeToBitmap(bytes, 'image/png')
    const current = useEdit.getState()
    if (current.info?.id !== id || !current.preview) return
    const mask = await resampleBitmap(full, current.preview.width, current.preview.height)
    useEdit.getState().maskReady(id, mask)
  } catch (error) {
    if (useEdit.getState().info?.id === id) useEdit.getState().maskFailed(asAppError(error).message)
  }
}

export function chooseBackground(mode: BackgroundMode): void {
  useEdit.getState().setBackgroundMode(mode)
  if (needsMask(mode)) void ensureMask()
}

/**
 * Load the operator's background picture through Rust (EXIF orientation is
 * handled there), keep it by id for the full-size export, and decode a
 * preview-sized copy for the canvas. Resolves to an error message, or null.
 */
export async function setBackgroundImageFromPath(path: string): Promise<string | null> {
  try {
    const info = await loadImage({ path })
    const bytes = await getImageBytes({ id: info.id, maxDim: PREVIEW_MAX_DIM })
    const image = await decodeToBitmap(bytes, 'image/jpeg')
    useEdit.getState().setBackgroundImage(image, info.id)
    if (needsMask('image')) void ensureMask()
    return null
  } catch (error) {
    return `That picture could not be opened: ${asAppError(error).message}`
  }
}
