/**
 * Crop geometry and automatic alignment — BUILD_PLAN §5 "Auto-align".
 *
 * Pure functions on plain numbers: no canvas, no React. The Adjust step draws
 * whatever this returns, and the export composites from the same rectangle, so
 * the preview and the print cannot disagree.
 *
 * The model follows the design in `design/`: a preset is described by a **crown
 * line** and a **chin band** measured as fractions of photo height, and the eye
 * line sits at a fixed proportion between them. That is the shape the overlay
 * draws and the shape the operator drags a handle against, so keeping it as the
 * stored form avoids converting back and forth on every frame.
 */

import type { Face } from './tauri'
import { PHOTO_PRESETS, type PhotoPreset, type PhotoPresetId } from './presets'

/**
 * Where the eye line falls between crown and mid-chin. Anatomically the eyes
 * sit slightly above the halfway point of the head.
 */
export const EYE_RATIO = 0.47

/**
 * Chin estimate from the mouth and eyes (BUILD_PLAN §5). Heuristic and
 * deliberately tunable — the manual chin handle exists because this will
 * sometimes be wrong.
 */
export const CHIN_FACTOR = 0.85

/** Roll correction is clamped; beyond this the photo itself is the problem. */
export const MAX_ROLL_DEGREES = 15

export interface Geometry {
  crown: number
  chinMin: number
  chinMax: number
  /** Middle of the chin band — the nominal chin. */
  chinMid: number
  eye: number
  /** width / height. */
  aspect: number
}

export function geometry(preset: PhotoPreset): Geometry {
  const chinMid = (preset.chinMin + preset.chinMax) / 2
  return {
    crown: preset.crownRatio,
    chinMin: preset.chinMin,
    chinMax: preset.chinMax,
    chinMid,
    eye: preset.crownRatio + EYE_RATIO * (chinMid - preset.crownRatio),
    aspect: preset.widthMm / preset.heightMm,
  }
}

export function geometryFor(presetId: PhotoPresetId, custom?: { widthMm: number; heightMm: number }) {
  const preset = PHOTO_PRESETS[presetId]
  const g = geometry(preset)
  return custom ? { ...g, aspect: custom.widthMm / custom.heightMm } : g
}

/**
 * Crown and chin positions at a given zoom, scaled about the eye line.
 *
 * Zooming keeps the eyes put and grows the head around them, which is what the
 * operator expects when nudging head size: the face does not wander up the
 * frame as it grows.
 */
export function headAt(g: Geometry, zoom: number): { crown: number; chin: number } {
  return {
    crown: g.eye - (g.eye - g.crown) * zoom,
    chin: g.eye + (g.chinMid - g.eye) * zoom,
  }
}

export type HeadStatus = 'ok' | 'small' | 'large' | 'manual'

/** Traffic light for the guide overlay. */
export function headStatus(
  g: Geometry,
  zoom: number,
  options: { faceFound?: boolean } = {},
): HeadStatus {
  if (options.faceFound === false) return 'manual'
  const { crown, chin } = headAt(g, zoom)
  if (chin < g.chinMin) return 'small'
  // A crown pushed off the top edge means the head is too big even if the
  // chin still lands inside the band.
  if (chin > g.chinMax || crown < 0.02) return 'large'
  return 'ok'
}

export function headStatusMessage(status: HeadStatus): string {
  switch (status) {
    case 'ok':
      return 'Head size OK'
    case 'small':
      return 'Head too small, zoom in'
    case 'large':
      return 'Head too large, zoom out'
    case 'manual':
      return 'No face detected — set the crown and chin by hand'
  }
}

// --- automatic alignment ------------------------------------------------

export interface Point {
  x: number
  y: number
}

/** A crop rectangle in original-image pixels, plus the roll to level the eyes. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
  /** Degrees; positive rotates the image clockwise to level the eye line. */
  rotationDeg: number
}

export interface AutoCropInput {
  face: Face
  /**
   * Top-most foreground row within the face's horizontal span, in image
   * pixels. This is the real crown *including hair*, which a face box does not
   * contain. Omitted when there is no mask yet.
   */
  crownY?: number
  imageWidth: number
  imageHeight: number
}

export function eyeMidpoint(face: Face): Point {
  const { rightEye, leftEye } = face.landmarks
  return { x: (rightEye.x + leftEye.x) / 2, y: (rightEye.y + leftEye.y) / 2 }
}

export function mouthMidpoint(face: Face): Point {
  const { mouthRight, mouthLeft } = face.landmarks
  return { x: (mouthRight.x + mouthLeft.x) / 2, y: (mouthRight.y + mouthLeft.y) / 2 }
}

/**
 * Roll angle of the eye line, in degrees, clamped to +/-15.
 *
 * Returned as the rotation needed to *level* the eyes, i.e. the negative of the
 * measured tilt.
 */
export function rollDegrees(face: Face): number {
  const { rightEye, leftEye } = face.landmarks
  const angle = (Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180) / Math.PI
  return clamp(-angle, -MAX_ROLL_DEGREES, MAX_ROLL_DEGREES)
}

/**
 * Chin position estimated from the eye and mouth midpoints.
 *
 * The chin sits roughly `CHIN_FACTOR` of another eye-to-mouth span below the
 * mouth. Crude, but it only has to be close: the operator can drag the chin
 * handle, and the guides show immediately when it is wrong.
 */
export function estimateChinY(face: Face): number {
  const eye = eyeMidpoint(face)
  const mouth = mouthMidpoint(face)
  return mouth.y + CHIN_FACTOR * (mouth.y - eye.y)
}

/**
 * Estimate the crown (top of the hair) when no mask is available.
 *
 * Falls back to the face box, which stops at the hairline, so it is pushed up
 * by a fraction of the eye-to-chin distance to approximate the skull and hair.
 */
export function estimateCrownY(face: Face): number {
  const eye = eyeMidpoint(face)
  const chin = estimateChinY(face)
  return eye.y - (chin - eye.y) * (EYE_RATIO / (1 - EYE_RATIO))
}

/**
 * Place the crop so the head lands where the preset wants it.
 *
 * Given the crown and chin in image pixels, the crop height follows from the
 * preset's head fraction, and the crop is positioned so the crown sits at the
 * preset's crown line and the eyes are centred horizontally.
 *
 * The rectangle may extend past the image edge. That is allowed and expected —
 * the background is being replaced anyway, so padding there is invisible
 * (BUILD_PLAN §5).
 */
export function autoCrop(input: AutoCropInput, g: Geometry): CropRect {
  const { face } = input
  const eye = eyeMidpoint(face)
  const chinY = estimateChinY(face)
  const crownY = input.crownY ?? estimateCrownY(face)

  const headHeight = Math.max(1, chinY - crownY)
  // The nominal head occupies (chinMid - crown) of the crop's height.
  const headFraction = g.chinMid - g.crown
  const cropHeight = headHeight / headFraction
  const cropWidth = cropHeight * g.aspect

  return {
    x: eye.x - cropWidth / 2,
    y: crownY - g.crown * cropHeight,
    width: cropWidth,
    height: cropHeight,
    rotationDeg: rollDegrees(face),
  }
}

/** Largest face by area — the subject when several people are in frame. */
export function largestFace(faces: Face[]): Face | null {
  if (faces.length === 0) return null
  return faces.reduce((best, f) =>
    f.box[2] * f.box[3] > best.box[2] * best.box[3] ? f : best,
  )
}

/**
 * Where the crown and chin actually land inside a given crop, as fractions of
 * crop height. This is what decides the guide colour once the operator has
 * moved things by hand.
 */
export function measureHead(
  crop: CropRect,
  crownY: number,
  chinY: number,
): { crown: number; chin: number } {
  return {
    crown: (crownY - crop.y) / crop.height,
    chin: (chinY - crop.y) / crop.height,
  }
}

/** Centre-preserving zoom, used by the zoom slider. */
export function zoomCrop(crop: CropRect, factor: number): CropRect {
  const cx = crop.x + crop.width / 2
  const cy = crop.y + crop.height / 2
  const width = crop.width / factor
  const height = crop.height / factor
  return { ...crop, x: cx - width / 2, y: cy - height / 2, width, height }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Derived head-height band, for anything that still thinks in head fractions. */
export function headRatioRange(preset: PhotoPreset): [number, number] {
  return [preset.chinMin - preset.crownRatio, preset.chinMax - preset.crownRatio]
}

export function nominalHeadRatio(preset: PhotoPreset): number {
  const [lo, hi] = headRatioRange(preset)
  return (lo + hi) / 2
}
