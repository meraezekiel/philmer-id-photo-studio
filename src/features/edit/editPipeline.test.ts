import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/tauri', async (original) => ({
  ...(await original<typeof import('../../lib/tauri')>()),
  releaseImage: vi.fn(() => Promise.resolve()),
  segment: vi.fn(),
}))
vi.mock('../../lib/bitmap', async (original) => ({
  ...(await original<typeof import('../../lib/bitmap')>()),
  decodeToBitmap: vi.fn(async () => ({ width: 30, height: 40, data: new Uint8ClampedArray(30 * 40 * 4) })),
  resampleBitmap: vi.fn(async (_b: unknown, width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  })),
}))

import { segment } from '../../lib/tauri'
import { createBitmap } from '../../lib/pixels'
import { useEdit } from '../../store/edit'
import { chooseBackground, ensureMask, sourceNameOf } from './editPipeline'

const info = { id: 'p1', width: 300, height: 400, megapixels: 0.12, exifOrientation: 1 }

describe('Photo Print pipeline', () => {
  beforeEach(() => {
    useEdit.getState().reset()
    vi.mocked(segment).mockReset()
    useEdit.getState().setLoaded(info, null, createBitmap(30, 40))
  })

  it('does not remove the background for Original', () => {
    chooseBackground('original')
    expect(segment).not.toHaveBeenCalled()
  })

  it('removes the background once, when a cutout mode is chosen', async () => {
    vi.mocked(segment).mockResolvedValue(new ArrayBuffer(8))
    chooseBackground('transparent')
    await vi.waitFor(() => expect(useEdit.getState().maskStatus).toBe('ready'))
    chooseBackground('color')
    expect(segment).toHaveBeenCalledTimes(1)
    expect(useEdit.getState().previewMask?.width).toBe(30)
  })

  it('reports a failed removal and goes back to Original', async () => {
    vi.mocked(segment).mockRejectedValue({ kind: 'modelMissing', message: 'model missing' })
    chooseBackground('color')
    await vi.waitFor(() => expect(useEdit.getState().maskStatus).toBe('error'))
    expect(useEdit.getState().backgroundMode).toBe('original')
    expect(useEdit.getState().maskError).toBe('model missing')
  })

  it('names the photo after its file', () => {
    expect(sourceNameOf('C:\\Users\\shop\\IMG_0042.JPG')).toBe('IMG_0042')
    expect(sourceNameOf(undefined)).toBeNull()
  })

  it('does nothing without a photo', async () => {
    useEdit.getState().reset()
    await ensureMask()
    expect(segment).not.toHaveBeenCalled()
  })
})
