/**
 * One store per job — the photo currently on the counter.
 *
 * The full-resolution original and mask stay in Rust; this holds the decoded
 * *preview* bitmaps for the canvas plus every setting the operator chooses.
 * Export re-fetches at full resolution, so nothing here caps output quality
 * (BUILD_PLAN §10).
 */

import { create } from 'zustand'

import type { CropRect } from '../lib/autoCrop'
import { reduceRequest, type PaperOrientation } from '../lib/layout'
import { DEFAULT_NAME_TAG, type NameTag } from '../lib/nameTag'
import type { Bitmap } from '../lib/composite'
import { PHOTO_PRESETS, type PaperId, type PhotoPresetId } from '../lib/presets'
import {
  asAppError,
  releaseImage,
  type AppErrorShape,
  type Face,
  type LoadedImageInfo,
  type SegModel,
  type SegmentProgress,
} from '../lib/tauri'

export type Step = 'import' | 'adjust' | 'background' | 'sheet' | 'export'

/** Every step, all wired. */
export const ACTIVE_STEPS: Step[] = ['import', 'adjust', 'background', 'sheet', 'export']
export const ALL_STEPS: Step[] = ['import', 'adjust', 'background', 'sheet', 'export']

export const STEP_LABELS: Record<Step, string> = {
  import: 'Import',
  adjust: 'Adjust',
  background: 'Background',
  sheet: 'Print sheet',
  export: 'Export',
}

export type SheetMode = 'fill' | 'exact' | 'package'

export interface PackageRow {
  presetId: Exclude<PhotoPresetId, 'custom'>
  qty: number
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
  /**
   * The region of the ORIGINAL photo the crop window is showing, in original
   * pixels. Export composites from this, so what the operator framed is what
   * gets printed.
   */
  cropRect: CropRect | null

  // Print sheet
  paper: PaperId
  sheetMode: SheetMode
  quantity: number
  packageRows: PackageRow[]
  cutMarks: boolean
  /** A thin black rule on each photo so the blade has a line to follow. */
  photoBorders: boolean
  paperOrientation: PaperOrientation
  /** Drag offset of the whole block from its top-left anchor, in mm. */
  sheetOffsetXMm: number
  sheetOffsetYMm: number
  /**
   * Per-photo nudges, keyed by placement index, in mm. Dragging one photo
   * moves only that photo; the block offset still moves everything.
   */
  photoOffsets: Record<number, { xMm: number; yMm: number }>
  /**
   * Placement indices currently selected on the sheet. Dragging any one of
   * them moves the whole selection.
   */
  selectedPhotos: number[]

  background: string
  edgeSoftness: number
  hairDetail: number
  quality: SegModel
  /** The name printed inside the bottom of the photo, and how it looks. */
  nameTag: NameTag

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
  setCropRect: (rect: CropRect | null) => void
  resetAdjust: () => void
  runAutoAlign: () => void
  setPaper: (paper: PaperId) => void
  setSheetMode: (mode: SheetMode) => void
  setQuantity: (qty: number) => void
  setPackageRows: (rows: PackageRow[]) => void
  setCutMarks: (on: boolean) => void
  setPhotoBorders: (on: boolean) => void
  setSheetOffset: (xMm: number, yMm: number) => void
  setPhotoOffset: (index: number, xMm: number, yMm: number) => void
  nudgePhotos: (indices: number[], deltas: Record<number, { xMm: number; yMm: number }>) => void
  setSelectedPhotos: (indices: number[]) => void
  /**
   * Delete on the sheet: `itemIndices` are the package rows the deleted
   * photos came from, `remaining` how many photos are left on the paper.
   */
  removePhotos: (itemIndices: number[], remaining: number) => void
  resetSheetPositions: () => void
  setPaperOrientation: (o: PaperOrientation) => void
  setBackground: (hex: string) => void
  setEdgeSoftness: (value: number) => void
  setHairDetail: (value: number) => void
  setQuality: (quality: SegModel) => void
  setNameTag: (patch: Partial<NameTag>) => void
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
  cropRect: null,
  paper: '4r',
  sheetMode: 'fill',
  quantity: 4,
  packageRows: [
    { presetId: '2x2', qty: 2 },
    { presetId: '1x1', qty: 4 },
  ],
  cutMarks: true,
  photoBorders: true,
  paperOrientation: 'auto',
  sheetOffsetXMm: 0,
  sheetOffsetYMm: 0,
  photoOffsets: {},
  selectedPhotos: [],
  background: PHOTO_PRESETS['2x2'].defaultBackground,
  edgeSoftness: 0,
  hairDetail: 0,
  quality: 'lite',
  nameTag: {
    ...DEFAULT_NAME_TAG,
    enabled: PHOTO_PRESETS['2x2'].nameTagByDefault === true,
  },

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
      // The size decides how the photo is normally handed over: Passport
      // carries the name across the bottom here, a 2x2 for a school ID
      // usually does not. The typed name is kept either way, so switching
      // sizes to compare does not make the operator type it again.
      const nameTag = { ...state.nameTag, enabled: preset.nameTagByDefault === true }
      // Passport is locked to white, so switching to it must not carry a blue
      // background across and quietly produce a rejected photo.
      return preset.lockBackgroundToWhite
        ? { presetId, background: '#FFFFFF', nameTag }
        : { presetId, background: state.background, nameTag }
    }),

  setZoom: (zoom) => set({ zoom }),
  setRotation: (rotation) => set({ rotation }),
  setPan: (offsetX, offsetY) => set({ offsetX, offsetY }),
  setLevelEyes: (levelEyes) => set({ levelEyes }),

  setCrownChin: (which, value) =>
    set(which === 'crown' ? { crownOverride: value } : { chinOverride: value }),

  setCropRect: (cropRect) => set({ cropRect }),

  /** Back to the preset's own alignment, discarding any hand adjustment. */
  resetAdjust: () =>
    set({
      zoom: 100,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      crownOverride: null,
      chinOverride: null,
      cropRect: null,
      sheetOffsetXMm: 0,
      sheetOffsetYMm: 0,
      photoOffsets: {},
      selectedPhotos: [],
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

  // A drag was made against one paper and layout; carrying it to another
  // would move the block somewhere the operator never put it.
  setPaper: (paper) => set({ paper, sheetOffsetXMm: 0, sheetOffsetYMm: 0, photoOffsets: {}, selectedPhotos: [] }),
  setSheetMode: (sheetMode) => set({ sheetMode, sheetOffsetXMm: 0, sheetOffsetYMm: 0, photoOffsets: {}, selectedPhotos: [] }),
  // Changing the count renumbers the tiles, so a kept selection would
  // highlight whichever photos happen to land on those indices.
  setQuantity: (quantity) =>
    set({ quantity: Math.max(1, Math.round(quantity)), selectedPhotos: [] }),
  setPackageRows: (packageRows) => set({ packageRows, selectedPhotos: [] }),
  setCutMarks: (cutMarks) => set({ cutMarks }),
  setPhotoBorders: (photoBorders) => set({ photoBorders }),
  setSheetOffset: (sheetOffsetXMm, sheetOffsetYMm) => set({ sheetOffsetXMm, sheetOffsetYMm }),

  setPhotoOffset: (index, xMm, yMm) =>
    set((state) => ({ photoOffsets: { ...state.photoOffsets, [index]: { xMm, yMm } } })),

  /** Move several photos in one update, so a multi-drag is a single render. */
  nudgePhotos: (indices, deltas) =>
    set((state) => {
      const photoOffsets = { ...state.photoOffsets }
      for (const i of indices) {
        const d = deltas[i]
        if (d) photoOffsets[i] = d
      }
      return { photoOffsets }
    }),

  setSelectedPhotos: (selectedPhotos) => set({ selectedPhotos }),

  /**
   * Deleting photos off the sheet is an edit to the order.
   *
   * A package asks for so many of each size, and that request is the single
   * source of truth for the sheet. So a delete lowers it: the quantity box
   * follows the paper instead of contradicting it, and raising the quantity
   * afterwards adds one photo rather than bringing every deleted photo back.
   *
   * "Fill sheet" has no quantity to lower, so deleting from a full sheet is
   * what "Exact quantity" means — the mode moves with it.
   */
  removePhotos: (itemIndices, remaining) =>
    set((state) =>
      state.sheetMode === 'package'
        ? { packageRows: reduceRequest(state.packageRows, itemIndices), selectedPhotos: [] }
        : { sheetMode: 'exact', quantity: Math.max(0, remaining), selectedPhotos: [] },
    ),

  // Positions only: photos taken off the sheet come back through Restore, so
  // neither button quietly undoes the other's work.
  resetSheetPositions: () =>
    set({ sheetOffsetXMm: 0, sheetOffsetYMm: 0, photoOffsets: {}, selectedPhotos: [] }),
  setPaperOrientation: (paperOrientation) =>
    set({ paperOrientation, sheetOffsetXMm: 0, sheetOffsetYMm: 0, photoOffsets: {}, selectedPhotos: [] }),
  setBackground: (background) => set({ background }),
  setEdgeSoftness: (edgeSoftness) => set({ edgeSoftness }),
  setHairDetail: (hairDetail) => set({ hairDetail }),
  setQuality: (quality) => set({ quality }),

  setNameTag: (patch) => set((state) => ({ nameTag: { ...state.nameTag, ...patch } })),

  reset: () => {
    // Hand the native side back its buffers. Without this the full-resolution
    // original and its cached mask stay in the Rust store for the life of the
    // process, so a counter serving customers back to back accumulates every
    // photo it has ever opened.
    void releaseImage()
    set({
      step: 'import',
      ...PHOTO_FIELDS,
      zoom: 100,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      crownOverride: null,
      chinOverride: null,
      cropRect: null,
      sheetOffsetXMm: 0,
      sheetOffsetYMm: 0,
      photoOffsets: {},
      selectedPhotos: [],
    })
  },
}))

/** Is this step reachable given what has been loaded? */
export function stepEnabled(step: Step, status: JobStatus): boolean {
  if (step === 'import') return true
  return status === 'ready'
}
