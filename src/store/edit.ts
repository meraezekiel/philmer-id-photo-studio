/**
 * The Photo Print job: one whole photo, optionally enhanced or re-backed,
 * saved at full size or printed one per sheet. Separate from `useJob` so the
 * ID wizard is not disturbed.
 */

import { create } from 'zustand'

import type { Bitmap } from '../lib/composite'
import { NEUTRAL_ENHANCE, type EnhanceSettings } from '../lib/enhance'
import { DEFAULT_VIEW, type BackgroundView, type PaperFit, type PaperOrientation } from '../lib/fitToPaper'
import type { EditPaperId } from '../lib/presets'
import {
  asAppError,
  releaseImage,
  type AppErrorShape,
  type LoadedImageInfo,
  type SegModel,
  type SegmentProgress,
} from '../lib/tauri'

export type EditStep = 'import' | 'edit' | 'print'
export const EDIT_STEPS: EditStep[] = ['import', 'edit', 'print']
export const EDIT_STEP_LABELS: Record<EditStep, string> = {
  import: 'Import',
  edit: 'Edit',
  print: 'Print & Export',
}

export type BackgroundMode = 'original' | 'transparent' | 'color' | 'image'

/** Whether this background needs the subject cut out. */
export function needsMask(mode: BackgroundMode): boolean {
  return mode !== 'original'
}

export interface EditState {
  step: EditStep
  status: 'empty' | 'loading' | 'ready' | 'error'
  /** Why the photo could not be opened; shown on the Import screen. */
  error: AppErrorShape | null
  progress: SegmentProgress | null

  info: LoadedImageInfo | null
  /** File name without extension, for the save name; null when pasted. */
  sourceName: string | null
  preview: Bitmap | null
  previewMask: Bitmap | null
  maskStatus: 'none' | 'running' | 'ready' | 'error'
  /** Why background removal failed; shown in the Edit panel. */
  maskError: string | null

  backgroundMode: BackgroundMode
  backgroundColor: string
  /** The operator's background picture at preview size. */
  backgroundImage: Bitmap | null
  /** Its id in the Rust image store, re-read at full size on export. */
  backgroundImageId: string | null
  backgroundView: BackgroundView
  edgeSoftness: number
  hairDetail: number
  quality: SegModel
  enhance: Required<EnhanceSettings>

  paper: EditPaperId
  paperFit: PaperFit
  orientation: PaperOrientation

  setStep: (step: EditStep) => void
  startLoading: () => void
  setLoaded: (info: LoadedImageInfo, sourceName: string | null, preview: Bitmap) => void
  setError: (error: unknown) => void
  setProgress: (progress: SegmentProgress | null) => void
  setBackgroundMode: (mode: BackgroundMode) => void
  setBackgroundColor: (hex: string) => void
  setBackgroundImage: (image: Bitmap, id: string) => void
  clearBackgroundImage: () => void
  setBackgroundView: (patch: Partial<BackgroundView>) => void
  setEdgeSoftness: (value: number) => void
  setHairDetail: (value: number) => void
  setEnhance: (patch: EnhanceSettings) => void
  resetEnhance: () => void
  setPaper: (paper: EditPaperId) => void
  setPaperFit: (fit: PaperFit) => void
  setOrientation: (orientation: PaperOrientation) => void
  maskStarted: () => void
  maskReady: (imageId: string, previewMask: Bitmap) => void
  maskFailed: (message: string) => void
  /** New customer: keep background mode, colour, quality and paper; drop the photo. */
  reset: () => void
}

const PHOTO_FIELDS = {
  status: 'empty' as const,
  error: null,
  progress: null,
  info: null,
  sourceName: null,
  preview: null,
  previewMask: null,
  maskStatus: 'none' as const,
  maskError: null,
}

export const useEdit = create<EditState>((set, get) => ({
  step: 'import',
  ...PHOTO_FIELDS,
  backgroundMode: 'original',
  backgroundColor: '#FFFFFF',
  backgroundImage: null,
  backgroundImageId: null,
  backgroundView: DEFAULT_VIEW,
  edgeSoftness: 0,
  hairDetail: 0,
  quality: 'lite',
  enhance: NEUTRAL_ENHANCE,
  paper: '4r',
  paperFit: 'fit',
  orientation: 'auto',

  setStep: (step) => set({ step }),
  startLoading: () => set({ ...PHOTO_FIELDS, status: 'loading' }),
  setLoaded: (info, sourceName, preview) =>
    set({ ...PHOTO_FIELDS, status: 'ready', info, sourceName, preview, step: 'edit' }),
  setError: (error) =>
    set(error === null ? { error: null } : { error: asAppError(error), status: 'error' }),
  setProgress: (progress) => {
    if (progress && progress.id !== get().info?.id) return
    set({ progress })
  },
  setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
  setBackgroundColor: (backgroundColor) => set({ backgroundColor }),
  setBackgroundImage: (backgroundImage, backgroundImageId) => {
    const previous = get().backgroundImageId
    if (previous && previous !== backgroundImageId) void releaseImage(previous)
    set({ backgroundImage, backgroundImageId, backgroundView: DEFAULT_VIEW, backgroundMode: 'image' })
  },
  clearBackgroundImage: () => {
    const id = get().backgroundImageId
    if (id) void releaseImage(id)
    set({
      backgroundImage: null,
      backgroundImageId: null,
      backgroundView: DEFAULT_VIEW,
      backgroundMode: get().backgroundMode === 'image' ? 'color' : get().backgroundMode,
    })
  },
  setBackgroundView: (patch) => set((s) => ({ backgroundView: { ...s.backgroundView, ...patch } })),
  setEdgeSoftness: (edgeSoftness) => set({ edgeSoftness }),
  setHairDetail: (hairDetail) => set({ hairDetail }),
  setEnhance: (patch) => set((s) => ({ enhance: { ...s.enhance, ...patch } })),
  resetEnhance: () => set({ enhance: NEUTRAL_ENHANCE }),
  setPaper: (paper) => set({ paper }),
  setPaperFit: (paperFit) => set({ paperFit }),
  setOrientation: (orientation) => set({ orientation }),
  maskStarted: () => set({ maskStatus: 'running', maskError: null, progress: null }),
  maskReady: (imageId, previewMask) => {
    // The operator may have moved on to the next customer meanwhile.
    if (get().info?.id !== imageId) return
    set({ previewMask, maskStatus: 'ready', progress: null })
  },
  maskFailed: (maskError) =>
    set({ maskStatus: 'error', maskError, backgroundMode: 'original', progress: null }),

  reset: () => {
    const { info, backgroundImageId, backgroundMode } = get()
    // Hand the native side its buffers back, as useJob.reset does.
    if (info) void releaseImage(info.id)
    if (backgroundImageId) void releaseImage(backgroundImageId)
    set({
      step: 'import',
      ...PHOTO_FIELDS,
      backgroundImage: null,
      backgroundImageId: null,
      backgroundView: DEFAULT_VIEW,
      backgroundMode: backgroundMode === 'image' ? 'original' : backgroundMode,
      enhance: NEUTRAL_ENHANCE,
    })
  },
}))
