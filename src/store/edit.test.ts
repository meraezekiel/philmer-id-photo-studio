import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/tauri', async (original) => ({
  ...(await original<typeof import('../lib/tauri')>()),
  releaseImage: vi.fn(() => Promise.resolve()),
}))

import { releaseImage } from '../lib/tauri'
import { createBitmap } from '../lib/pixels'
import { useEdit } from './edit'

const info = { id: 'p1', width: 300, height: 400, megapixels: 0.12, exifOrientation: 1 }
const preview = createBitmap(30, 40)

describe('the Photo Print store', () => {
  beforeEach(() => {
    useEdit.getState().reset()
    vi.mocked(releaseImage).mockClear()
  })

  it('starts on Original, Fit, 4R', () => {
    const s = useEdit.getState()
    expect(s.backgroundMode).toBe('original')
    expect(s.paperFit).toBe('fit')
    expect(s.paper).toBe('4r')
    expect(s.step).toBe('import')
  })

  it('goes to the Edit step once the photo is loaded', () => {
    useEdit.getState().setLoaded(info, 'IMG_1', preview)
    const s = useEdit.getState()
    expect(s.step).toBe('edit')
    expect(s.status).toBe('ready')
    expect(s.sourceName).toBe('IMG_1')
  })

  it('ignores a mask that arrives for the previous photo', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().maskStarted()
    useEdit.getState().setLoaded({ ...info, id: 'p2' }, null, preview)
    useEdit.getState().maskReady('p1', createBitmap(30, 40))
    expect(useEdit.getState().previewMask).toBeNull()
    expect(useEdit.getState().maskStatus).toBe('none')
  })

  it('falls back to Original when background removal fails', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().setBackgroundMode('transparent')
    useEdit.getState().maskStarted()
    useEdit.getState().maskFailed('model missing')
    const s = useEdit.getState()
    expect(s.backgroundMode).toBe('original')
    expect(s.maskStatus).toBe('error')
    expect(s.maskError).toBe('model missing')
    expect(s.status).toBe('ready') // enhance still works
  })

  it('only takes segmentation progress for its own photo', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().setProgress({ id: 'other', stage: 'running', label: '', fraction: 0.5 })
    expect(useEdit.getState().progress).toBeNull()
    useEdit.getState().setProgress({ id: 'p1', stage: 'running', label: '', fraction: 0.5 })
    expect(useEdit.getState().progress?.fraction).toBe(0.5)
  })

  it('keeps colour and paper for the next customer but drops the photo and enhance', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().setBackgroundMode('color')
    useEdit.getState().setBackgroundColor('#1E5BC6')
    useEdit.getState().setPaper('5r')
    useEdit.getState().setEnhance({ brightness: 20 })
    useEdit.getState().reset()
    const s = useEdit.getState()
    expect(s.backgroundMode).toBe('color')
    expect(s.backgroundColor).toBe('#1E5BC6')
    expect(s.paper).toBe('5r')
    expect(s.enhance.brightness).toBe(0)
    expect(s.info).toBeNull()
    expect(releaseImage).toHaveBeenCalledWith('p1')
  })

  it('turns an image background back to Original on reset, and releases the picture', () => {
    useEdit.getState().setLoaded(info, null, preview)
    useEdit.getState().setBackgroundImage(createBitmap(10, 10), 'bg1')
    useEdit.getState().reset()
    expect(useEdit.getState().backgroundMode).toBe('original')
    expect(useEdit.getState().backgroundImage).toBeNull()
    expect(releaseImage).toHaveBeenCalledWith('bg1')
  })
})
