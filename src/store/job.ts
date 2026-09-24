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

/** Steps wired so far. Print sheet arrives with M3. */
export const ACTIVE_STEPS: Step[] = ['import', 'adjust', 'background', 'export']
export const ALL_STEPS: Step[] = ['import', 'adjust', 'background', 'sheet', 'export']

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

  // Adjust (crop and align)
  zoom: number
  rotation: number
  offsetX: number
  offsetY: number
  levelEyes: boolean
  /** Set once the operator drags a handle; overrides the zoom-derived head. */
  crownOverride: number | null
  chinOverride: number | null

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
  setZoom: (zoom: number) => void
  setRotation: (rotation: number) => void
  setPan: (x: number, y: number) => void
  setLevelEyes: (on: boolean) => void
  setCrownChin: (which: 'crown' | 'chin', value: number) => void
  resetAdjust: () => void
  runAutoAlign: () => void
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
  zoom: 100,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  levelEyes: true,
  crownOverride: null,
  chinOverride: null,
  background: PHOTO_PRESETS['2x2'].defaultBackground,
  edgeSoftness: 0,
  hairDetail: 0,
  quality: 'lite',

  setStep: (step) => set({ step }),
  setStatus: (status) => set({ status }),
  setError: (error) =>
    set(error === null ? { error: null } : { error: asAppError(error), status: 'error' }),
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

  setZoom: (zoom) => set({ zoom }),
  setRotation: (rotation) => set({ rotation }),
  setPan: (offsetX, offsetY) => set({ offsetX, offsetY }),
  setLevelEyes: (levelEyes) => set({ levelEyes }),

  setCrownChin: (which, value) =>
    set(which === 'crown' ? { crownOverride: value } : { chinOverride: value }),

  /** Back to the preset's own alignment, discarding any hand adjustment. */
  resetAdjust: () =>
    set({
      zoom: 100,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      crownOverride: null,
      chinOverride: null,
    }),

  /**
   * Re-run automatic alignment. Dropping the manual overrides is the point:
   * the operator presses this precisely when their own adjustment went wrong.
   */
  runAutoAlign: () =>
    set((state) => ({
      zoom: 100,
      offsetX: 0,
      offsetY: 0,
      crownOverride: null,
      chinOverride: null,
      rotation: state.levelEyes ? state.rotation : 0,
    })),

  setBackground: (background) => set({ background }),
  setEdgeSoftness: (edgeSoftness) => set({ edgeSoftness }),
  setHairDetail: (hairDetail) => set({ hairDetail }),
  setQuality: (quality) => set({ quality }),

  reset: () =>
    set({
      step: 'import',
      ...PHOTO_FIELDS,
      zoom: 100,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      crownOverride: null,
      chinOverride: null,
    }),
}))

/** Is this step reachable given what has been loaded? */
export function stepEnabled(step: Step, status: JobStatus): boolean {
  if (step === 'import') return true
  return status === 'ready'
}
