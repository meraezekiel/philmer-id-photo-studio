/**
 * One store per job — the photo currently on the counter.
 *
 * The full-resolution original and mask stay in Rust; this holds the decoded
 * *preview* bitmaps for the canvas plus every setting the operator chooses.
 * Export re-fetches at full resolution, so nothing here caps output quality
 * (BUILD_PLAN §10).
 */

import { create } from 'zustand'

import type { Bitmap } from '../lib/composite'
import { PHOTO_PRESETS, type PhotoPresetId } from '../lib/presets'
import {
  asAppError,
  type AppErrorShape,
  type Face,
  type LoadedImageInfo,
  type SegModel,
  type SegmentProgress,
} from '../lib/tauri'

export type Step = 'import' | 'adjust' | 'background' | 'sheet' | 'export'

/** Steps reachable in M1. Adjust and Sheet arrive with M2 and M3. */
export const M1_STEPS: Step[] = ['import', 'background', 'export']

export const STEP_LABELS: Record<Step, string> = {
  import: 'Import',
  adjust: 'Adjust',
  background: 'Background',
  sheet: 'Print sheet',
  export: 'Export',
}

export type JobStatus = 'empty' | 'loading' | 'segmenting' | 'ready' | 'error'

export interface JobState {
  step: Step
  status: JobStatus
  error: AppErrorShape | null
  progress: SegmentProgress | null

  info: LoadedImageInfo | null
  /** Downscaled for the canvas; the export re-fetches at full resolution. */
  preview: Bitmap | null
  previewMask: Bitmap | null
  faces: Face[]

  presetId: PhotoPresetId
  background: string
  edgeSoftness: number
  hairDetail: number
  quality: SegModel

  setStep: (step: Step) => void
  setStatus: (status: JobStatus) => void
  setError: (error: unknown) => void
  setProgress: (progress: SegmentProgress | null) => void
  setLoaded: (info: LoadedImageInfo) => void
  setPreview: (preview: Bitmap, mask: Bitmap) => void
  setFaces: (faces: Face[]) => void
  setPreset: (presetId: PhotoPresetId) => void
  setBackground: (hex: string) => void
  setEdgeSoftness: (value: number) => void
  setHairDetail: (value: number) => void
  setQuality: (quality: SegModel) => void
  /** New customer: keep the preset, background and quality; drop the photo. */
  reset: () => void
}

const PHOTO_FIELDS = {
  status: 'empty' as JobStatus,
  error: null,
  progress: null,
  info: null,
  preview: null,
  previewMask: null,
  faces: [] as Face[],
}

export const useJob = create<JobState>((set) => ({
  step: 'import',
  ...PHOTO_FIELDS,

  presetId: '2x2',
  background: PHOTO_PRESETS['2x2'].defaultBackground,
  edgeSoftness: 0,
  hairDetail: 0,
  quality: 'lite',

  setStep: (step) => set({ step }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error: asAppError(error), status: 'error' }),
  setProgress: (progress) => set({ progress }),
  setLoaded: (info) => set({ info, status: 'segmenting', error: null }),
  setPreview: (preview, previewMask) => set({ preview, previewMask, status: 'ready' }),
  setFaces: (faces) => set({ faces }),

  setPreset: (presetId) =>
    set((state) => {
      const preset = PHOTO_PRESETS[presetId]
      // Passport is locked to white, so switching to it must not carry a blue
      // background across and quietly produce a rejected photo.
      return preset.lockBackgroundToWhite
        ? { presetId, background: '#FFFFFF' }
        : { presetId, background: state.background }
    }),

  setBackground: (background) => set({ background }),
  setEdgeSoftness: (edgeSoftness) => set({ edgeSoftness }),
  setHairDetail: (hairDetail) => set({ hairDetail }),
  setQuality: (quality) => set({ quality }),

  reset: () => set({ step: 'import', ...PHOTO_FIELDS }),
}))

/** Is this step reachable given what has been loaded? */
export function stepEnabled(step: Step, status: JobStatus): boolean {
  if (step === 'import') return true
  return status === 'ready'
}
