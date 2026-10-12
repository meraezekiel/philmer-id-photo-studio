/**
 * Formal attire: where a clothing template sits on the finished photo.
 *
 * Everything here is pure geometry so it can be tested in Node; the drawing
 * lives in `attireDraw.ts`. A fit is stored as fractions of the finished
 * photo, never pixels, so the same fit puts the collar in the same place on
 * the canvas preview and on the 300 DPI export.
 */

import { estimateChinY, mouthMidpoint, type CropRect } from './autoCrop'
import { maskToAlpha, type Bitmap } from './composite'
import type { Face } from './tauri'

/** Measured once per template, in template pixels. */
export interface TemplateAnchors {
  /**
   * Top of the collar on the centre line. Every garment's collar sits just
   * under the chin, whether it is a V-neck suit or a high blouse, so this is
   * the point that is placed.
   */
  collar: { x: number; y: number }
  /** Widest opaque run in the top 60 % of the clothing. */
  shoulderWidth: number
  /**
   * The gap between the collar tips that the neck goes into. A closed, high
   * collar has none to measure, so it is guessed from the shoulders.
   */
  neckWidth: number
  /** One past the last opaque row. */
  bottom: number
  width: number
  height: number
}

/**
 * Where the attire sits: collar point as fractions of the photo's width and
 * height, template shoulder width as a fraction of the photo width, and
 * rotation in degrees (clockwise).
 */
export interface AttireFit {
  x: number
  y: number
  scale: number
  rotation: number
}

/** The face, mapped into the finished photo, as fractions of its size. */
export interface FaceFrame {
  chinX: number
  chinY: number
  faceWidth: number
  faceHeight: number
}

/** How far below the chin the top of the collar sits, in face heights. */
export const COLLAR_DROP = 0.06

/** Shoulder width in face widths (YuNet's box, which stops short of the ears). */
export const SHOULDER_PER_FACE = 3

/** Width of the neck kept when hiding old clothes, in face widths. */
export const NECK_BAND = 0.6

/** How much wider than the neck the collar opening is, so it wraps around it. */
export const NECK_FIT = 1.15

/** A closed collar's neck opening, guessed as a share of its shoulders. */
export const NECK_PER_SHOULDER = 0.32

/** No face found: centred, low, and nearly the photo's width. */
export const DEFAULT_FIT: AttireFit = { x: 0.5, y: 0.65, scale: 0.9, rotation: 0 }

const OPAQUE = 128

export function measureTemplate(template: Bitmap): TemplateAnchors {
  const { width, height, data } = template
  const opaque = (x: number, y: number) => data[(y * width + x) * 4 + 3] >= OPAQUE

  let top = -1
  let bottomRow = -1
  let minX = width
  let maxX = -1
  const runs: number[] = new Array(height).fill(0)

  for (let y = 0; y < height; y++) {
    let left = -1
    let right = -1
    for (let x = 0; x < width; x++) {
      if (opaque(x, y)) {
        if (left < 0) left = x
        right = x
      }
    }
    if (left < 0) continue
    if (top < 0) top = y
    bottomRow = y
    runs[y] = right - left + 1
    minX = Math.min(minX, left)
    maxX = Math.max(maxX, right)
  }

  if (top < 0) throw new Error('This image has no clothing in it — every pixel is transparent.')

  const cx = Math.round((minX + maxX) / 2)
  const shoulderRows = Math.max(1, Math.floor(0.6 * (bottomRow - top + 1)))
  let shoulderWidth = 0
  for (let y = top; y < top + shoulderRows; y++) shoulderWidth = Math.max(shoulderWidth, runs[y])

  // The first row near the top where the centre is see-through and closed in
  // by clothing on both sides: the collar tips around the neck.
  let neckWidth = NECK_PER_SHOULDER * shoulderWidth
  const collarRows = Math.max(1, Math.floor(0.25 * (bottomRow - top + 1)))
  for (let y = top; y < top + collarRows; y++) {
    if (opaque(cx, y)) continue
    let left = cx
    while (left >= 0 && !opaque(left, y)) left--
    let right = cx
    while (right < width && !opaque(right, y)) right++
    if (left >= 0 && right < width) {
      neckWidth = right - left - 1
      break
    }
  }

  return { collar: { x: cx, y: top }, shoulderWidth, neckWidth, bottom: bottomRow + 1, width, height }
}

/**
 * Map the face into the finished photo.
 *
 * `cropRect` is in original-image pixels; the finished photo is that rect
 * rotated about its centre by `rotationDeg`, exactly as `cropRotate` draws it.
 */
export function faceFrame(
  face: Face | null,
  cropRect: CropRect | null,
  image: { width: number; height: number },
): FaceFrame | null {
  if (!face) return null
  const chin = { x: mouthMidpoint(face).x, y: estimateChinY(face) }

  if (!cropRect) {
    return {
      chinX: chin.x / image.width,
      chinY: chin.y / image.height,
      faceWidth: face.box[2] / image.width,
      faceHeight: face.box[3] / image.height,
    }
  }

  const at = intoCrop(chin, cropRect)
  return {
    chinX: at.x,
    chinY: at.y,
    faceWidth: face.box[2] / cropRect.width,
    faceHeight: face.box[3] / cropRect.height,
  }
}

/** An image pixel as fractions of the finished photo that `cropRect` makes. */
function intoCrop(p: { x: number; y: number }, cropRect: CropRect): { x: number; y: number } {
  const theta = (cropRect.rotationDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const dx = p.x - (cropRect.x + cropRect.width / 2)
  const dy = p.y - (cropRect.y + cropRect.height / 2)
  return {
    x: (dx * cos - dy * sin + cropRect.width / 2) / cropRect.width,
    y: (dx * sin + dy * cos + cropRect.height / 2) / cropRect.height,
  }
}

const necks = new WeakMap<Bitmap, { face: Face; neck: Neck | null }>()

/**
 * The neck in original-image pixels, measured on the job's mask (which may
 * be a smaller preview of the image). Cached per mask and face.
 */
export function neckInImage(mask: Bitmap, face: Face | null, image: { width: number; height: number }): Neck | null {
  if (!face) return null
  const hit = necks.get(mask)
  if (hit && hit.face === face) return hit.neck
  const k = mask.width / image.width
  const chin = { x: mouthMidpoint(face).x * k, y: estimateChinY(face) * k }
  const found = measureNeck(maskToAlpha(mask), mask.width, mask.height, chin, face.box[2] * k, face.box[3] * k)
  const neck = found && { x: found.x / k, top: found.top / k, base: found.base / k, width: found.width / k }
  necks.set(mask, { face, neck })
  return neck
}

/** The neck as fractions of the finished photo, as `faceFrame` maps the face. */
export function neckFrame(
  neck: Neck | null,
  cropRect: CropRect | null,
  image: { width: number; height: number },
): Neck | null {
  if (!neck) return null
  if (!cropRect) {
    return {
      x: neck.x / image.width,
      top: neck.top / image.height,
      base: neck.base / image.height,
      width: neck.width / image.width,
    }
  }
  return {
    x: intoCrop({ x: neck.x, y: (neck.top + neck.base) / 2 }, cropRect).x,
    top: intoCrop({ x: neck.x, y: neck.top }, cropRect).y,
    base: intoCrop({ x: neck.x, y: neck.base }, cropRect).y,
    width: neck.width / cropRect.width,
  }
}

/**
 * Snap the attire under the face. Rotation stays 0: with Level the eyes on,
 * the crop is already level, and a tilted head on square shoulders is how
 * people actually stand.
 */
export function autoFit(
  frame: FaceFrame | null,
  neck: Neck | null = null,
  anchors: TemplateAnchors | null = null,
): AttireFit {
  if (!frame) return { ...DEFAULT_FIT }
  // Measured: the collar opening wraps the customer's real neck, and the
  // collar starts where the neck meets the shoulders.
  if (neck && anchors && anchors.neckWidth > 0) {
    return {
      x: neck.x,
      y: neck.base,
      scale: (neck.width * NECK_FIT * anchors.shoulderWidth) / anchors.neckWidth,
      rotation: 0,
    }
  }
  return {
    x: frame.chinX,
    y: frame.chinY + COLLAR_DROP * frame.faceHeight,
    scale: SHOULDER_PER_FACE * frame.faceWidth,
    rotation: 0,
  }
}

/**
 * The strip below the chin that keeps the customer's own neck when the old
 * clothes are hidden, as fractions of the photo width.
 */
export function neckBand(frame: FaceFrame): { left: number; right: number } {
  const half = (NECK_BAND * frame.faceWidth) / 2
  return { left: frame.chinX - half, right: frame.chinX + half }
}

/**
 * The customer's neck, read from the shape of background removal's mask:
 * `top` is its narrowest row, `base` where it widens into the shoulders,
 * `x` its middle and `width` its narrowest width. In whatever units the
 * caller works in — pixels from `measureNeck`, photo fractions in a layer.
 */
export interface Neck {
  x: number
  top: number
  base: number
  width: number
}

/** The shoulders begin where the silhouette is this many necks wide. */
const SHOULDER_FLARE = 1.6

/**
 * Measure the neck from the silhouette alone, never from colour, so shadows,
 * white beards and grey tops cannot fool it. On each row from a little above
 * the chin, the run of person pixels under the face is followed down; the
 * narrowest one is the neck. Null when nothing narrows (hair down to the
 * shoulders, a hood) or the chin is not on the person.
 */
export function measureNeck(
  alpha: Float32Array,
  width: number,
  height: number,
  chin: { x: number; y: number },
  faceWidth: number,
  faceHeight: number,
): Neck | null {
  const person = (x: number, y: number) => alpha[y * width + x] >= 0.5
  const first = Math.max(0, Math.round(chin.y - 0.35 * faceHeight))
  const lastNeck = Math.min(height - 1, Math.round(chin.y + 0.5 * faceHeight))
  const last = Math.min(height - 1, Math.round(chin.y + 0.8 * faceHeight))

  const runs: { y: number; left: number; right: number }[] = []
  let c = Math.round(chin.x)
  for (let y = first; y <= last; y++) {
    if (c < 0 || c >= width || !person(c, y)) break
    let left = c
    while (left > 0 && person(left - 1, y)) left--
    let right = c
    while (right < width - 1 && person(right + 1, y)) right++
    runs.push({ y, left, right })
    c = Math.round((left + right) / 2)
  }
  if (runs.length === 0) return null

  let narrow = runs[0]
  for (const run of runs) {
    if (run.y > lastNeck) break
    if (run.right - run.left < narrow.right - narrow.left) narrow = run
  }
  const neckWidth = narrow.right - narrow.left + 1
  if (neckWidth >= 0.9 * faceWidth) return null

  let base = runs[runs.length - 1].y + 1
  for (const run of runs) {
    if (run.y > narrow.y && run.right - run.left + 1 > SHOULDER_FLARE * neckWidth) {
      base = run.y
      break
    }
  }
  return { x: (narrow.left + narrow.right) / 2, top: narrow.y, base, width: neckWidth }
}

/**
 * Everything of the person that is not their head and neck, as 0/1: what the
 * attire replaces. Above the neck's narrowest row nothing is taken, however
 * wide (ears, hair); below it nothing wider than the neck is head, so only
 * the neck's own column is kept — shoulders and straps that rise beside it
 * go — and below `cutY`, under the attire, nothing of the person is kept.
 */
export function bodyMask(alpha: Float32Array, width: number, height: number, neck: Neck, cutY: number): Uint8Array {
  const body = new Uint8Array(width * height)
  const from = Math.max(0, Math.ceil(neck.top))
  const half = 0.52 * neck.width
  for (let y = from; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (alpha[i] < 0.5) continue
      if (y >= cutY || Math.abs(x - neck.x) > half) body[i] = 1
    }
  }
  // A few pixels more, into background removal's soft edge, so the old
  // shoulders' outline does not stay behind as a faint line. Never into the
  // head and neck that are kept.
  let grown = body
  for (let pass = 0; pass < 4; pass++) {
    const next = grown.slice()
    for (let y = from; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (grown[i] || alpha[i] >= 0.5) continue
        if ((x > 0 && grown[i - 1]) || (x < width - 1 && grown[i + 1]) || (y > from && grown[i - width]) || (y < height - 1 && grown[i + width])) {
          next[i] = 1
        }
      }
    }
    grown = next
  }
  return grown
}

/** Canvas `setTransform` arguments that draw the template where `fit` says. */
export function attireMatrix(
  fit: AttireFit,
  anchors: TemplateAnchors,
  width: number,
  height: number,
): [number, number, number, number, number, number] {
  const s = (fit.scale * width) / anchors.shoulderWidth
  const theta = (fit.rotation * Math.PI) / 180
  const a = s * Math.cos(theta)
  const b = s * Math.sin(theta)
  const c = -b
  const d = a
  const { x: nx, y: ny } = anchors.collar
  return [a, b, c, d, fit.x * width - (a * nx + c * ny), fit.y * height - (b * nx + d * ny)]
}

/**
 * The lowest point of the template's bottom edge, as a fraction of the photo
 * height. Below 1 means the clothing stops short of the bottom of the photo.
 */
export function attireBottomFraction(
  fit: AttireFit,
  anchors: TemplateAnchors,
  width: number,
  height: number,
): number {
  const m = attireMatrix(fit, anchors, width, height)
  const y = (x: number) => m[1] * x + m[3] * anchors.bottom + m[5]
  return Math.max(y(0), y(anchors.width)) / height
}



// --- tracing the neck ------------------------------------------------------

/**
 * How close in chroma (YCbCr) a pixel must be to the cheeks to count as skin.
 * Generous on purpose: the shadow under the jaw drifts ~15 from the cheeks,
 * while shirts — even dark or beige-ish ones — sit well past 30.
 */
export const SKIN_TOLERANCE = 30

/** Cr − Cb below this is grey, white or blue, never skin (skin sits near 40). */
const MIN_SKIN_WARMTH = 20

/**
 * Neighbouring pixels further apart than this (RGB distance) are an edge the
 * clothes flood does not cross — typically shirt against hair or skin.
 */
const EDGE_STEP = 40

function chroma(r: number, g: number, b: number): [number, number, number] {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ]
}

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}

/**
 * The customer's old clothes, as a 0/1 mask the size of the photo, so they
 * can be painted out before the attire goes on.
 *
 * Skin colour is sampled from the cheeks. Clothes are then flooded upward
 * from the bottom of the photo through person pixels that are not skin and
 * have no sharp edge between them — so the flood stops at the neck and jaw,
 * but follows a collar that rises beside the jaw. It is not allowed above
 * the ears, so hair on top of the head is never reached.
 *
 * Returns null when the cheeks do not look like skin (a mask, heavy makeup,
 * a bad face detection); the caller then falls back to a geometric guess.
 */
export function clothesMask(photo: Bitmap, alpha: Float32Array, frame: FaceFrame): Uint8Array | null {
  const { width: w, height: h, data } = photo
  const at = (x: number) => Math.round(x)

  // Cheeks and nose: between the eyes and the mouth.
  const cbs: number[] = []
  const crs: number[] = []
  const x0 = Math.max(0, at((frame.chinX - 0.3 * frame.faceWidth) * w))
  const x1 = Math.min(w - 1, at((frame.chinX + 0.3 * frame.faceWidth) * w))
  const y0 = Math.max(0, at((frame.chinY - 0.55 * frame.faceHeight) * h))
  const y1 = Math.min(h - 1, at((frame.chinY - 0.3 * frame.faceHeight) * h))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      if (alpha[i] < 0.5) continue
      const [, cb, cr] = chroma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
      cbs.push(cb)
      crs.push(cr)
    }
  }
  if (cbs.length < 9) return null
  const cbRef = median(cbs)
  const crRef = median(crs)
  // The classic skin box in CbCr: anything outside it is not a face.
  if (cbRef < 77 || cbRef > 127 || crRef < 133 || crRef > 173) return null

  const isSkin = (i: number) => {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const [y, cb, cr] = chroma(r, g, b)
    // Chroma means nothing in near-black pixels.
    if (y < 40) return false
    // Skin always leans red over blue; greys and whites do not, however close
    // they sit to a pale face in plain distance.
    if (cr - cb < MIN_SKIN_WARMTH) return false
    return (cb - cbRef) ** 2 + (cr - crRef) ** 2 < SKIN_TOLERANCE ** 2
  }
  const step = (i: number, j: number) => {
    const dr = data[i * 4] - data[j * 4]
    const dg = data[i * 4 + 1] - data[j * 4 + 1]
    const db = data[i * 4 + 2] - data[j * 4 + 2]
    return dr * dr + dg * dg + db * db
  }

  const limitY = Math.max(0, at((frame.chinY - 0.35 * frame.faceHeight) * h))
  const jawY = Math.min(h, at((frame.chinY + 0.15 * frame.faceHeight) * h))
  // A collar rises beside the jaw, never inside the face or across the neck.
  // Side light leaves one side of the face and neck in grey shadow that fails
  // the skin test, and a white beard fails it too; without this guard the
  // flood climbs that side from the shirt and paints the jaw out.
  // The column is the face's width, down to the jaw: a thick neck is as wide
  // as the jaw above it.
  const faceLeft = (frame.chinX - frame.faceWidth / 2) * w
  const faceRight = (frame.chinX + frame.faceWidth / 2) * w
  const guarded = (i: number) => {
    const x = i % w
    return i < jawY * w && x >= faceLeft && x <= faceRight
  }
  const clothes = new Uint8Array(w * h)
  const stack: number[] = []
  // Seeds: clothes run off the bottom of the photo, and off its sides below
  // the chin.
  const seed = (i: number) => {
    if (!clothes[i] && alpha[i] >= 0.5 && !isSkin(i) && !guarded(i)) {
      clothes[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) seed((h - 1) * w + x)
  for (let y = Math.min(h - 1, at(frame.chinY * h)); y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % w
    const y = (i - x) / w
    const visit = (j: number) => {
      if (clothes[j] || alpha[j] < 0.5 || step(i, j) > EDGE_STEP * EDGE_STEP || isSkin(j) || guarded(j)) return
      clothes[j] = 1
      stack.push(j)
    }
    if (x > 0) visit(i - 1)
    if (x < w - 1) visit(i + 1)
    if (y > limitY) visit(i - w)
    if (y < h - 1) visit(i + w)
  }
  // The customer's own skin is the skin joined to the face: seeded on the
  // centre line from the cheeks down past the chin, so a beard line still
  // reaches the neck below it.
  const own = new Uint8Array(w * h)
  const cx = Math.min(w - 1, Math.max(0, at(frame.chinX * w)))
  for (let y = y0; y <= Math.min(h - 1, at((frame.chinY + 0.3 * frame.faceHeight) * h)); y++) {
    const i = y * w + cx
    if (alpha[i] >= 0.5 && isSkin(i) && !own[i]) {
      own[i] = 1
      stack.push(i)
    }
  }
  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % w
    const visit = (j: number) => {
      if (own[j] || alpha[j] < 0.5 || !isSkin(j)) return
      own[j] = 1
      stack.push(j)
    }
    if (x > 0) visit(i - 1)
    if (x < w - 1) visit(i + 1)
    if (i >= w) visit(i - w)
    if (i < w * (h - 1)) visit(i + w)
  }

  // Badges, logos and stripes have edges too sharp for the flood to cross,
  // and some are skin-coloured. Well below the jaw only clothes are left, so
  // anything there that is part of the person but not their own skin is
  // clothing too.
  for (let i = jawY * w; i < w * h; i++) {
    if (!clothes[i] && alpha[i] >= 0.5 && !own[i]) clothes[i] = 1
  }
  if (clothes.every((v) => v === 0)) return clothes

  // A few pixels more, into the soft edge, so the old shirt's outline does
  // not stay behind as a faint ring. Growth stops at their skin, so the neck keeps
  // its edge; outward it only paints background over background.
  let grown = clothes
  for (let pass = 0; pass < 4; pass++) {
    const next = grown.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (grown[i] || own[i] || guarded(i)) continue
        if ((x > 0 && grown[i - 1]) || (x < w - 1 && grown[i + 1]) || (y > 0 && grown[i - w]) || (y < h - 1 && grown[i + w])) {
          next[i] = 1
        }
      }
    }
    grown = next
  }
  return grown
}

/**
 * Move the person within the finished photo by (dx, dy) fractions of its
 * size — by moving the crop window the opposite way, along the crop's own
 * rotated axes.
 */
export function shiftCrop(crop: CropRect, dx: number, dy: number): CropRect {
  const theta = (crop.rotationDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const u = dx * crop.width
  const v = dy * crop.height
  return {
    ...crop,
    x: crop.x - (u * cos + v * sin),
    y: crop.y - (-u * sin + v * cos),
  }
}

/**
 * Make the person `k` times larger in the finished photo, keeping the point
 * (px, py) — fractions of the photo — where it is: a smaller crop window
 * around that point.
 */
export function scaleCrop(crop: CropRect, k: number, px: number, py: number): CropRect {
  const theta = (crop.rotationDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const back = (u: number, v: number) => ({ x: u * cos + v * sin, y: -u * sin + v * cos })

  const fixed = back((px - 0.5) * crop.width, (py - 0.5) * crop.height)
  const qx = crop.x + crop.width / 2 + fixed.x
  const qy = crop.y + crop.height / 2 + fixed.y

  const width = crop.width / k
  const height = crop.height / k
  const offset = back((px - 0.5) * width, (py - 0.5) * height)
  return { ...crop, x: qx - offset.x - width / 2, y: qy - offset.y - height / 2, width, height }
}
