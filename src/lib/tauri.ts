/**
 * Typed wrappers for the Rust commands in BUILD_PLAN §4.
 *
 * Every call goes through here so the IPC contract lives in one file: if a
 * Rust signature changes, exactly one place stops type-checking.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface LoadedImageInfo {
  id: string
  width: number
  height: number
  megapixels: number
  exifOrientation: number
}

export interface Point {
  x: number
  y: number
}

export interface Landmarks {
  rightEye: Point
  leftEye: Point
  nose: Point
  mouthRight: Point
  mouthLeft: Point
}

export interface Face {
  /** `[x, y, w, h]` in original-image pixels. */
  box: [number, number, number, number]
  score: number
  landmarks: Landmarks
}

export interface ModelStatus {
  id: 'lite' | 'hd'
  label: string
  installed: boolean
  bundled: boolean
  sizeBytes: number
  path: string | null
}

export interface RuntimeInfo {
  ortLoaded: boolean
  intraThreads: number
  resourcesDir: string
  userModelsDir: string
  models: ModelStatus[]
}

export interface SegmentProgress {
  id: string
  stage: 'preparing' | 'running' | 'upscaling'
  label: string
  fraction: number
}

/** The tagged shape `AppError` serialises to. */
export interface AppErrorShape {
  kind:
    | 'io'
    | 'unsupportedFormat'
    | 'decode'
    | 'unknownImage'
    | 'modelMissing'
    | 'checksumMismatch'
    | 'checksumUnpinned'
    | 'runtime'
    | 'inference'
    | 'other'
  message: string
}

export function asAppError(error: unknown): AppErrorShape {
  if (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    'message' in error &&
    typeof (error as AppErrorShape).message === 'string'
  ) {
    return error as AppErrorShape
  }
  return { kind: 'other', message: String(error) }
}

export type SegModel = 'lite' | 'hd'

export function loadImage(args: { path?: string; bytes?: ArrayBuffer }): Promise<LoadedImageInfo> {
  return invoke('load_image', { args })
}

export function getImageBytes(args: {
  id: string
  /** Longest edge; `0` returns the untouched original. */
  maxDim?: number
  format?: 'jpeg' | 'png'
}): Promise<ArrayBuffer> {
  return invoke('get_image_bytes', { args })
}

/** Returns the full-resolution alpha mask as PNG bytes. */
export function segment(args: {
  id: string
  model?: SegModel
  force?: boolean
}): Promise<ArrayBuffer> {
  return invoke('segment', { args })
}

export function detectFaces(args: { id: string }): Promise<Face[]> {
  return invoke('detect_faces', { args })
}

export function modelStatus(): Promise<ModelStatus[]> {
  return invoke('model_status')
}

export function importModel(args: { path: string }): Promise<ModelStatus> {
  return invoke('import_model', { args })
}

export function saveFile(args: { path: string; bytes: ArrayBuffer }): Promise<string> {
  return invoke('save_file', { args })
}

export function releaseImage(id?: string): Promise<void> {
  return invoke('release_image', { id: id ?? null })
}

export interface PrinterInfo {
  name: string
  isDefault: boolean
}

export function listPrinters(): Promise<PrinterInfo[]> {
  return invoke('list_printers')
}

/**
 * Opens the driver's own properties sheet: paper size, quality, borderless.
 *
 * Resolves true when the operator accepted the dialog, in which case those
 * settings are kept and applied to every later print.
 */
export function printerProperties(printer: string): Promise<boolean> {
  return invoke('printer_properties', { printer })
}

export function printerHasCustomSettings(printer: string): Promise<boolean> {
  return invoke('printer_has_custom_settings', { printer })
}

export function resetPrinterSettings(printer: string): Promise<void> {
  return invoke('reset_printer_settings', { printer })
}

/**
 * Print the sheet directly.
 *
 * The physical size is computed from the printer's own reported DPI, so no
 * viewer gets a say in whether to scale it down to fit.
 */
export function printSheet(job: {
  printer?: string
  png: ArrayBuffer
  widthMm: number
  heightMm: number
  copies?: number
  jobName?: string
}): Promise<void> {
  return invoke('print_sheet', { job })
}

export function runtimeInfo(): Promise<RuntimeInfo> {
  return invoke('runtime_info')
}

export function onSegmentProgress(
  handler: (progress: SegmentProgress) => void,
): Promise<UnlistenFn> {
  return listen<SegmentProgress>('segment://progress', (event) => handler(event.payload))
}

/** Turn returned bytes into something an `<img>` can show. */
export function bytesToObjectUrl(bytes: ArrayBuffer, mime: string): string {
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

export interface LicenseStatus {
  /** `licensed`, `trial` or `expired`. */
  state: 'licensed' | 'trial' | 'expired'
  /** `A1B2-C3D4-E5F6-7890`, read out to the vendor to get a key. */
  machineId: string
  /** Whole days left in a trial; `-1` when licensed. */
  daysLeft: number
  trialDays: number
  customer: number
  /** Only set for a licence sold with a term rather than permanently. */
  expiresInDays: number | null
  /** Why a trial ended, when the reason is not simply time. */
  note: string | null
}

export function licenseStatus(): Promise<LicenseStatus> {
  return invoke('license_status')
}

/** Check a key and keep it if it is good for this machine. */
export function activateLicense(key: string): Promise<LicenseStatus> {
  return invoke('activate_license', { key })
}

// --- attire templates ----------------------------------------------------

export interface AttireEntry {
  id: string
  name: string
  group: 'men' | 'women' | 'other'
  file: string
  addedAt: string
}

export function listAttire(): Promise<AttireEntry[]> {
  return invoke('list_attire')
}

export function importAttire(args: {
  path: string
  name: string
  group: AttireEntry['group']
}): Promise<AttireEntry> {
  return invoke('import_attire', { args })
}

export function removeAttire(id: string): Promise<void> {
  return invoke('remove_attire', { id })
}

export function readAttire(id: string): Promise<ArrayBuffer> {
  return invoke('read_attire', { id })
}

// --- photo book -----------------------------------------------------------

export interface BookPhotoInfo {
  id: string
  path: string
  name: string
  width: number
  height: number
  takenAt: string | null
  face: { x: number; y: number; w: number; h: number } | null
  /** Why the file could not be read; the other fields are then empty. */
  error: string | null
}

export interface BookProgress {
  done: number
  total: number
}

export function bookAddPhotos(photos: { id: string; path: string }[]): Promise<BookPhotoInfo[]> {
  return invoke('book_add_photos', { photos })
}

export function bookThumb(id: string): Promise<ArrayBuffer> {
  return invoke('book_thumb', { id })
}

/** RGBA pixels, exactly `width` x `height`. */
export function bookRenderPhoto(args: {
  path: string
  crop: { x: number; y: number; w: number; h: number }
  width: number
  height: number
}): Promise<ArrayBuffer> {
  return invoke('book_render_photo', { args })
}

export function bookClear(): Promise<void> {
  return invoke('book_clear')
}

export function bookExpandPaths(paths: string[]): Promise<{ files: string[]; skipped: string[] }> {
  return invoke('book_expand_paths', { paths })
}

/** Keys are lower-cased file names. */
export function bookFindInFolder(folder: string, names: string[]): Promise<Record<string, string>> {
  return invoke('book_find_in_folder', { folder, names })
}

export function bookReadProject(path: string): Promise<string> {
  return invoke('book_read_project', { path })
}

export function bookWriteProject(path: string, text: string): Promise<void> {
  return invoke('book_write_project', { path, text })
}

export function bookAutosaveWrite(text: string): Promise<void> {
  return invoke('book_autosave_write', { text })
}

export function bookAutosaveRead(): Promise<{ text: string; savedAtMs: number } | null> {
  return invoke('book_autosave_read')
}

export function bookAutosaveClear(): Promise<void> {
  return invoke('book_autosave_clear')
}

export function bookStageSheet(index: number, bytes: ArrayBuffer): Promise<string> {
  return invoke('book_stage_sheet', { args: { index, bytes } })
}

export function bookClearStaged(): Promise<void> {
  return invoke('book_clear_staged')
}

export function onBookProgress(handler: (progress: BookProgress) => void): Promise<UnlistenFn> {
  return listen<BookProgress>('book://progress', (event) => handler(event.payload))
}
