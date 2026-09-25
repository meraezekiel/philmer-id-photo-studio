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

/** Opens the driver's own properties sheet: paper size, quality, borderless. */
export function printerProperties(printer: string): Promise<void> {
  return invoke('printer_properties', { printer })
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
