import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/tauri', async (original) => ({
  ...(await original<typeof import('../lib/tauri')>()),
  releaseImage: vi.fn(() => Promise.resolve()),
}))

import { DEFAULT_FIT } from '../lib/attire'
import type { Face } from '../lib/tauri'
import { faceFrame } from '../lib/attire'
import { framedCrop, useJob } from './job'

const face: Face = {
  box: [400, 200, 200, 250],
  score: 0.9,
  landmarks: {
    rightEye: { x: 460, y: 300 },
    leftEye: { x: 540, y: 300 },
    nose: { x: 500, y: 350 },
    mouthRight: { x: 470, y: 400 },
    mouthLeft: { x: 530, y: 400 },
  },
}

const info = { id: 'a', width: 1000, height: 1000, megapixels: 1, exifOrientation: 1 }

describe('attire in the job', () => {
  beforeEach(() => {
    useJob.getState().reset()
  })

  it('starts on None', () => {
    expect(useJob.getState().attireId).toBeNull()
    expect(useJob.getState().attireFit).toBeNull()
  })

  it('uses the centred default when no face was found', () => {
    useJob.getState().setLoaded(info)
    useJob.getState().setAttire('t1')
    expect(useJob.getState().attireFit).toEqual(DEFAULT_FIT)
  })

  it('follows a re-crop until the operator moves it, then stays put', () => {
    const job = useJob.getState()
    job.setLoaded(info)
    job.setFaces([face])
    job.setAttire('t1')
    const before = useJob.getState().attireFit!

    useJob.getState().setCropRect({ x: 300, y: 100, width: 400, height: 500, rotationDeg: 0 })
    const refit = useJob.getState().attireFit!
    expect(refit.scale).not.toBeCloseTo(before.scale)

    useJob.getState().setAttireFit({ y: 0.9 })
    useJob.getState().setCropRect({ x: 200, y: 0, width: 600, height: 750, rotationDeg: 0 })
    expect(useJob.getState().attireFit).toEqual({ ...refit, y: 0.9 })

    useJob.getState().resetAttireFit()
    expect(useJob.getState().attireTouched).toBe(false)
    expect(useJob.getState().attireFit!.y).not.toBe(0.9)
  })

  it('keeps the attire where it is when the person is moved into it', () => {
    const job = useJob.getState()
    job.setLoaded(info)
    job.setFaces([face])
    job.setCropRect({ x: 300, y: 100, width: 400, height: 500, rotationDeg: 0 })
    job.setAttire('t1')
    const placed = useJob.getState().attireFit
    useJob.getState().setHeadShift(0, 0.08)
    // Back in Adjust the move becomes part of the crop.
    useJob.getState().setCropRect({ x: 300, y: 60, width: 400, height: 500, rotationDeg: 0 })
    expect(useJob.getState().attireFit).toEqual(placed)
  })

  it('grows the person around the face, keeping the attire placed', () => {
    const job = useJob.getState()
    job.setLoaded(info)
    job.setFaces([face])
    job.setCropRect({ x: 300, y: 100, width: 400, height: 500, rotationDeg: 0 })
    job.setAttire('t1')
    const before = faceFrame(face, framedCrop(useJob.getState()), info)!
    useJob.getState().setHeadScale(1.2)
    const after = faceFrame(face, framedCrop(useJob.getState()), info)!
    expect(after.faceWidth).toBeCloseTo(before.faceWidth * 1.2)
    expect(after.chinX).toBeCloseTo(before.chinX)
    expect(useJob.getState().attireTouched).toBe(true)

    useJob.getState().resetHead()
    expect(framedCrop(useJob.getState())).toEqual(useJob.getState().cropRect)
  })

  it('records eraser strokes, undoes them, and drops them for a new template', () => {
    const job = useJob.getState()
    job.setLoaded(info)
    job.setAttire('t1')
    job.beginStroke({ kind: 'person', radius: 0.02, points: [{ x: 0.1, y: 0.8 }] })
    useJob.getState().extendStroke({ x: 0.15, y: 0.82 })
    useJob.getState().beginStroke({ kind: 'attire', radius: 0.03, points: [{ x: 0.5, y: 0.6 }] })
    expect(useJob.getState().attireStrokes).toHaveLength(2)
    expect(useJob.getState().attireStrokes[0].points).toHaveLength(2)

    useJob.getState().undoStroke()
    expect(useJob.getState().attireStrokes.map((s) => s.kind)).toEqual(['person'])

    useJob.getState().setAttire('t2')
    expect(useJob.getState().attireStrokes).toEqual([])

    useJob.getState().beginStroke({ kind: 'restore', radius: 0.02, points: [{ x: 0.2, y: 0.2 }] })
    useJob.getState().clearStrokes()
    expect(useJob.getState().attireStrokes).toEqual([])
  })

  it('goes back to None for the next customer', () => {
    useJob.getState().setLoaded(info)
    useJob.getState().setAttire('t1')
    useJob.getState().setAttireFit({ x: 0.2 })
    useJob.getState().beginStroke({ kind: 'person', radius: 0.02, points: [{ x: 0.1, y: 0.8 }] })
    useJob.getState().reset()
    const s = useJob.getState()
    expect([s.attireId, s.attireFit, s.attireTouched]).toEqual([null, null, false])
    expect(s.headShift).toEqual({ x: 0, y: 0 })
    expect(s.headScale).toBe(1)
    expect(s.attireStrokes).toEqual([])
  })
})
