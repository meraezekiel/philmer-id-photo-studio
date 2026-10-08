/**
 * Drawing attire onto a finished photo. Needs a real canvas, so it lives
 * apart from the geometry in `attire.ts`.
 */

import { attireMatrix, clothesMask, neckBand, type AttireFit, type FaceFrame, type TemplateAnchors } from './attire'
import { maskToAlpha, parseHex, toneTables, type Bitmap } from './composite'

export interface AttireLayer {
  template: { bitmap: ImageData; anchors: TemplateAnchors }
  fit: AttireFit
  /** The face in the finished photo; nothing above its chin line is covered. */
  frame: FaceFrame | null
  /** Paint over the old clothes that stick out past the attire. */
  hideOriginal: boolean
  /** The photo's background colour, for that paint. */
  background: string
  /**
   * Fitting the attire into the photo's light: `shadow` 0..100 is the soft
   * shadow where skin meets the clothes; brightness and warmth -50..+50
   * adjust the attire itself. `under` is what fills the collar opening below
   * the neck: the neck carried on (`skin`), the customer's own top (`top`),
   * or `underColour`.
   */
  blend: {
    shadow: number
    brightness: number
    warmth: number
    under: 'skin' | 'top' | 'colour'
    underColour: string
  }
  /**
   * Brush strokes in photo fractions: `person` paints the backdrop over the
   * photo, `attire` cuts the attire away, `paint` paints `colour` on the
   * photo under the attire, `restore` brings back what any of them changed.
   */
  strokes: readonly EraserStroke[]
}

export interface EraserStroke {
  kind: 'person' | 'attire' | 'paint' | 'restore'
  /** Fraction of the photo width. */
  radius: number
  points: readonly { x: number; y: number }[]
  /** For `paint`: a hex colour, or `skin` for the customer's neck colour. */
  colour?: string
}

/** The paint brush's colour that follows the customer's own skin. */
export const SKIN_PAINT = 'skin'

/** Trace one stroke onto a context, with its own soft edge. */
function drawStroke(ctx: OffscreenCanvasRenderingContext2D, stroke: EraserStroke, width: number, height: number) {
  const r = stroke.radius * width
  ctx.filter = `blur(${Math.max(0.5, r * 0.25)}px)`
  const [first, ...rest] = stroke.points
  if (!first) return
  if (rest.length === 0) {
    ctx.beginPath()
    ctx.arc(first.x * width, first.y * height, r, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.lineWidth = r * 2
    ctx.beginPath()
    ctx.moveTo(first.x * width, first.y * height)
    for (const p of rest) ctx.lineTo(p.x * width, p.y * height)
    ctx.stroke()
  }
}

/**
 * The paint brush's strokes as one coloured layer, replayed in order so a
 * restore wipes out paint laid before it. Null when nothing was painted.
 */
function paintLayer(
  strokes: readonly EraserStroke[],
  skin: string,
  width: number,
  height: number,
): OffscreenCanvas | null {
  if (!strokes.some((s) => s.kind === 'paint')) return null
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (stroke.kind !== 'paint' && stroke.kind !== 'restore') continue
    const colour = stroke.kind === 'restore' ? '#000' : !stroke.colour || stroke.colour === SKIN_PAINT ? skin : stroke.colour
    ctx.globalCompositeOperation = stroke.kind === 'restore' ? 'destination-out' : 'source-over'
    ctx.fillStyle = colour
    ctx.strokeStyle = colour
    drawStroke(ctx, stroke, width, height)
  }
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

/**
 * The customer's skin colour for the paint brush: the average of the
 * person's own pixels on the neck, just below the chin; a neutral skin tone
 * when there is no face to read it from.
 */
function neckColour(photo: Bitmap, frame: FaceFrame | null, tracing: Tracing | null): string {
  if (!frame) return '#C8A08A'
  const { width, height, data } = photo
  const band = neckBand(frame)
  const x0 = Math.max(0, Math.round(band.left * width))
  const x1 = Math.min(width - 1, Math.round(band.right * width))
  const y0 = Math.max(0, Math.round((frame.chinY + 0.05 * frame.faceHeight) * height))
  const y1 = Math.min(height - 1, Math.round((frame.chinY + 0.25 * frame.faceHeight) * height))
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x
      if (tracing && (tracing.alpha[i] < 0.9 || tracing.clothes?.[i])) continue
      r += data[i * 4]
      g += data[i * 4 + 1]
      b += data[i * 4 + 2]
      count++
    }
  }
  if (count === 0) return '#C8A08A'
  const hex = (v: number) => Math.round(v / count).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * Where the eraser of one kind has been, as a soft-edged alpha mask; strokes
 * are replayed in order so a restore only undoes what came before it. Null
 * when that kind was never used.
 */
function eraserMask(
  strokes: readonly EraserStroke[],
  kind: 'person' | 'attire',
  width: number,
  height: number,
): OffscreenCanvas | null {
  if (!strokes.some((s) => s.kind === kind)) return null
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  for (const stroke of strokes) {
    if (stroke.kind !== kind && stroke.kind !== 'restore') continue
    ctx.globalCompositeOperation = stroke.kind === 'restore' ? 'destination-out' : 'source-over'
    // A soft edge, so an erased spot has no hard line of its own.
    drawStroke(ctx, stroke, width, height)
  }
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

/** How far the neck is carried on into the collar before fading out, in face heights. */
const NECK_CARRY = 0.2

/** Width of the face kept clear of attire when the head cannot be traced, in face widths. */
const FACE_GUARD = 1.1

const templateCanvases = new WeakMap<ImageData, OffscreenCanvas>()

function templateCanvas(bitmap: ImageData): OffscreenCanvas {
  let canvas = templateCanvases.get(bitmap)
  if (!canvas) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')?.putImageData(bitmap, 0, 0)
    templateCanvases.set(bitmap, canvas)
  }
  return canvas
}

interface Tracing {
  /** Person alpha 0..1 from background removal. */
  alpha: Float32Array
  /** Old clothes, 0/1; null when the skin could not be read. */
  clothes: Uint8Array | null
}

/** Tracing is per photo, not per drag: cache it on the photo bitmap. */
const tracings = new WeakMap<Bitmap, { key: string; tracing: Tracing }>()

function trace(photo: Bitmap, personMask: Bitmap, frame: FaceFrame): Tracing {
  const key = JSON.stringify(frame)
  const hit = tracings.get(photo)
  if (hit && hit.key === key) return hit.tracing
  const alpha = maskToAlpha(personMask)
  const tracing = { alpha, clothes: clothesMask(photo, alpha, frame) }
  tracings.set(photo, { key, tracing })
  return tracing
}

function canvasFrom(data: ImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(data.width, data.height)
  canvas.getContext('2d')?.putImageData(data, 0, 0)
  return canvas
}

/**
 * The photo with the attire drawn over it.
 *
 * `personMask` is the background-removal mask at the photo's size. With it,
 * the head is protected along its real outline and the old clothes are
 * traced from the photo itself; without it (or when the skin cannot be read)
 * both fall back to shapes guessed from the face.
 */
export function withAttire(photo: Bitmap, layer: AttireLayer | null, personMask: Bitmap | null = null): Bitmap {
  if (!layer) return photo
  const { width, height } = photo
  const n = width * height
  const feather = Math.max(2, Math.round(height * 0.012))
  const frame = layer.frame
  const tracing =
    frame && personMask && personMask.width === width && personMask.height === height
      ? trace(photo, personMask, frame)
      : null
  const clothes = tracing?.clothes ?? null

  // --- the attire, with the head cut out of it ---------------------------
  const attire = new OffscreenCanvas(width, height)
  const actx = attire.getContext('2d')
  if (!actx) return photo
  actx.imageSmoothingEnabled = true
  actx.imageSmoothingQuality = 'high'
  actx.setTransform(...attireMatrix(layer.fit, layer.template.anchors, width, height))
  actx.drawImage(templateCanvas(layer.template.bitmap), 0, 0)
  actx.setTransform(1, 0, 0, 1, 0, 0)

  // The attire's own coverage, before the head is cut out of it: needed to
  // find the opening of the collar.
  const coverage = frame && clothes ? actx.getImageData(0, 0, width, height).data : null

  // Skin and hair the operator erased: the head no longer covers the attire
  // there, so whatever the attire has underneath shows, and the backdrop
  // only where it has nothing.
  const personErase = eraserMask(layer.strokes, 'person', width, height)

  let guard: OffscreenCanvas | null = null
  if (frame && tracing && clothes) {
    // The head is the person above the chin that is not old clothing, with
    // background removal's soft edge, so hair keeps its strands. Beside the
    // head the attire stays — exactly where the operator put it.
    const chinPx = frame.chinY * height
    const head = new ImageData(width, height)
    const lastRow = Math.min(height, Math.ceil(chinPx + feather))
    for (let y = 0; y < lastRow; y++) {
      const fade = y <= chinPx ? 1 : 1 - (y - chinPx) / feather
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (clothes[i]) continue
        head.data[i * 4 + 3] = Math.round(255 * tracing.alpha[i] * fade)
      }
    }
    guard = canvasFrom(head)
  } else if (frame) {
    // Untraced: a box the width of the face, everything above the chin.
    const chinPx = frame.chinY * height
    const half = (FACE_GUARD * frame.faceWidth * width) / 2
    guard = new OffscreenCanvas(width, height)
    const gctx = guard.getContext('2d')
    if (gctx) {
      gctx.filter = `blur(${feather / 2}px)`
      gctx.fillStyle = '#000'
      gctx.fillRect(frame.chinX * width - half, -feather, half * 2, chinPx + feather)
    }
  }
  if (guard) {
    if (personErase) {
      const gctx = guard.getContext('2d')
      if (gctx) {
        gctx.filter = 'none'
        gctx.globalCompositeOperation = 'destination-out'
        gctx.drawImage(personErase, 0, 0)
      }
    }
    actx.globalCompositeOperation = 'destination-out'
    actx.drawImage(guard, 0, 0)
    actx.globalCompositeOperation = 'source-over'
  }

  // The operator's eraser on the attire.
  const attireErase = eraserMask(layer.strokes, 'attire', width, height)
  if (attireErase) {
    actx.globalCompositeOperation = 'destination-out'
    actx.drawImage(attireErase, 0, 0)
    actx.globalCompositeOperation = 'source-over'
  }

  // Match the attire to the photo's light.
  const tables = toneTables({ brightness: layer.blend.brightness, warmth: layer.blend.warmth })
  if (tables) {
    const [tr, tg, tb] = tables
    const px = actx.getImageData(0, 0, width, height)
    for (let i = 0; i < px.data.length; i += 4) {
      if (px.data[i + 3] === 0) continue
      px.data[i] = tr[px.data[i]]
      px.data[i + 1] = tg[px.data[i + 1]]
      px.data[i + 2] = tb[px.data[i + 2]]
    }
    actx.putImageData(px, 0, 0)
  }

  // --- the photo, with the old clothes painted out -------------------------
  const out = new OffscreenCanvas(width, height)
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) return photo
  ctx.putImageData(new ImageData(photo.data, width, height), 0, 0)

  // The attire's collar opening. With `under: 'top'`, what the customer
  // wears below the neck shows through it as what they have on under the
  // jacket, so it is not painted out; beside the neck it goes to background
  // like the rest. Otherwise it is painted out and filled further down.
  const keepTop = layer.blend.under === 'top'
  const opening = frame && coverage ? collarOpening(coverage, frame, layer.fit.y, width, height) : null
  const neckBottom =
    opening && frame && tracing && clothes
      ? neckBottomRow(opening, tracing.alpha, clothes, frame, layer.fit.y, width, height)
      : -1

  // A T-shirt's shoulders rarely line up with a suit's, so what sticks out
  // past the suit goes back to background — what operators did by hand in
  // Photoshop.
  if (layer.hideOriginal && clothes) {
    const bg = parseHex(layer.background)
    const paint = new ImageData(width, height)
    for (let i = 0; i < n; i++) {
      if (!clothes[i] || (keepTop && opening && opening[i] && i >= (neckBottom + 1) * width)) continue
      paint.data[i * 4] = bg.r
      paint.data[i * 4 + 1] = bg.g
      paint.data[i * 4 + 2] = bg.b
      paint.data[i * 4 + 3] = 255
    }
    // Blur softens the edge at the neck, but would also fade the paint at
    // the photo's own border; so the paint is extended past the border
    // first, by stretching its outermost rows and columns.
    const blur = Math.max(0.5, feather / 8)
    const pad = Math.ceil(blur * 3) + 1
    const src = canvasFrom(paint)
    const padded = new OffscreenCanvas(width + pad * 2, height + pad * 2)
    const pctx = padded.getContext('2d')
    if (pctx) {
      pctx.imageSmoothingEnabled = false
      pctx.drawImage(src, pad, pad)
      pctx.drawImage(src, 0, 0, 1, height, 0, pad, pad, height)
      pctx.drawImage(src, width - 1, 0, 1, height, width + pad, pad, pad, height)
      pctx.drawImage(padded, 0, pad, width + pad * 2, 1, 0, 0, width + pad * 2, pad)
      pctx.drawImage(padded, 0, height + pad - 1, width + pad * 2, 1, 0, height + pad, width + pad * 2, pad)
      ctx.filter = `blur(${blur}px)`
      ctx.drawImage(padded, -pad, -pad)
      ctx.filter = 'none'
    }
  } else if (layer.hideOriginal && frame) {
    // Untraced: beside the face the paint starts at the chin; nearer the
    // middle it starts at the collar, so the customer's own neck is kept —
    // the slope of a shoulder, blurred so it has no hard line of its own.
    const chinPx = frame.chinY * height
    const collarPx = Math.max(chinPx, layer.fit.y * height)
    const guardLeft = (frame.chinX - (FACE_GUARD * frame.faceWidth) / 2) * width
    const guardRight = (frame.chinX + (FACE_GUARD * frame.faceWidth) / 2) * width
    const band = neckBand(frame)
    const paint = new OffscreenCanvas(width, height)
    const pctx = paint.getContext('2d')
    if (pctx) {
      pctx.fillStyle = layer.background
      const bottom = height + feather
      for (const [edge, guard, neck] of [
        [-feather, guardLeft, band.left * width],
        [width + feather, guardRight, band.right * width],
      ]) {
        pctx.beginPath()
        pctx.moveTo(edge, chinPx)
        pctx.lineTo(guard, chinPx)
        pctx.lineTo(neck, collarPx)
        pctx.lineTo(neck, bottom)
        pctx.lineTo(edge, bottom)
        pctx.closePath()
        pctx.fill()
      }
      ctx.filter = `blur(${feather / 2}px)`
      ctx.drawImage(paint, 0, 0)
      ctx.filter = 'none'
    }
  }

  // Inside the collar opening, wherever the customer's neck does not reach,
  // the old shirt was painted out and the backdrop would show through as a
  // pale gap under the neck. Fill it with the neck's own colour, shaded, as
  // if the neck carries on down into the collar — all the way down for
  // `skin`, or a short way over a solid `underColour`.
  if (layer.hideOriginal && frame && tracing && clothes && opening && neckBottom >= 0) {
    if (layer.blend.under === 'colour') {
      fillOpening(ctx, opening, tracing.alpha, clothes, neckBottom, layer.blend.underColour, width, height)
    }
    const full = layer.blend.under === 'skin'
    carryNeckDown(ctx, opening, tracing.alpha, clothes, frame, layer.fit.y, width, height, full)
  }

  // A real collar shades the skin it touches. A soft shadow of the attire's
  // edge is laid on the customer's own skin and hair — never on the backdrop,
  // where it would read as a cut-out — before the attire goes on top.
  if (layer.blend.shadow > 0 && tracing && clothes) {
    const shadow = new OffscreenCanvas(width, height)
    const sctx = shadow.getContext('2d')
    if (sctx) {
      sctx.filter = `blur(${Math.max(1.5, height * 0.012)}px)`
      sctx.drawImage(attire, 0, Math.max(1, Math.round(height * 0.004)))
      sctx.filter = 'none'
      sctx.globalCompositeOperation = 'source-in'
      sctx.fillStyle = 'rgb(35, 22, 15)'
      sctx.fillRect(0, 0, width, height)
      const own = new ImageData(width, height)
      for (let i = 0; i < n; i++) {
        if (!clothes[i]) own.data[i * 4 + 3] = Math.round(255 * tracing.alpha[i])
      }
      sctx.globalCompositeOperation = 'destination-in'
      sctx.drawImage(canvasFrom(own), 0, 0)
      ctx.globalAlpha = (layer.blend.shadow / 100) * 0.8
      ctx.drawImage(shadow, 0, 0)
      ctx.globalAlpha = 1
    }
  }

  // The operator's eraser on the photo: backdrop over excess skin, hair or
  // leftover clothing. Under the attire, which goes on last and so shows
  // wherever it reaches.
  if (personErase) {
    const pctx = personErase.getContext('2d')
    if (pctx) {
      pctx.globalCompositeOperation = 'source-in'
      pctx.fillStyle = layer.background
      pctx.fillRect(0, 0, width, height)
      ctx.drawImage(personErase, 0, 0)
    }
  }

  // The operator's paint brush: skin or a colour over leftover gaps, under
  // the attire so it never spills onto the clothes.
  if (layer.strokes.some((s) => s.kind === 'paint')) {
    const skin = layer.strokes.some((s) => s.kind === 'paint' && (!s.colour || s.colour === SKIN_PAINT))
      ? neckColour(photo, frame, tracing)
      : '#000'
    const paint = paintLayer(layer.strokes, skin, width, height)
    if (paint) ctx.drawImage(paint, 0, 0)
  }

  ctx.drawImage(attire, 0, 0)
  return ctx.getImageData(0, 0, width, height)
}

/**
 * The attire's collar opening: on each row below the collar's top, the
 * transparent run of the attire around the chin, closed on both sides by
 * clothing. Rows open to one side are past the collar and not included.
 */
function collarOpening(
  coverage: Uint8ClampedArray,
  frame: FaceFrame,
  collarY: number,
  width: number,
  height: number,
): Uint8Array {
  const covered = (i: number) => coverage[i * 4 + 3] >= 128
  const opening = new Uint8Array(width * height)
  const cx = Math.round(frame.chinX * width)
  if (cx < 0 || cx >= width) return opening
  for (let y = Math.max(0, Math.round(collarY * height)); y < height; y++) {
    const row = y * width
    let left = cx
    while (left >= 0 && !covered(row + left)) left--
    let right = cx
    while (right < width && !covered(row + right)) right++
    if (left < 0 || right >= width) continue
    for (let x = left + 1; x < right; x++) opening[row + x] = 1
  }
  return opening
}

/** Fill the collar opening below the neck with a solid colour (a blouse or undershirt). */
function fillOpening(
  ctx: OffscreenCanvasRenderingContext2D,
  opening: Uint8Array,
  alpha: Float32Array,
  clothes: Uint8Array,
  neckBottom: number,
  colour: string,
  width: number,
  height: number,
) {
  const { r, g, b } = parseHex(colour)
  const out = new ImageData(width, height)
  let painted = false
  for (let i = Math.max(0, neckBottom - 2) * width; i < width * height; i++) {
    if (!opening[i] || (!clothes[i] && alpha[i] >= 0.9)) continue
    out.data.set([r, g, b, 255], i * 4)
    painted = true
  }
  if (!painted) return
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')?.putImageData(out, 0, 0)
  ctx.filter = `blur(${Math.max(0.75, height * 0.002)}px)`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'
}

/** The lowest row of the neck on the chin's column, inside the opening; -1 if none. */
function neckBottomRow(
  opening: Uint8Array,
  alpha: Float32Array,
  clothes: Uint8Array,
  frame: FaceFrame,
  collarY: number,
  width: number,
  height: number,
): number {
  const cx = Math.round(frame.chinX * width)
  if (cx < 0 || cx >= width) return -1
  let end = -1
  for (let y = Math.max(0, Math.round(collarY * height)); y < height; y++) {
    const i = y * width + cx
    if (!opening[i]) continue
    if (!clothes[i] && alpha[i] >= 0.9) end = y
    else if (end >= 0) break
  }
  return end
}

/**
 * Carry the neck on a little way down into the collar. Under the neck
 * itself — its width just above where it ends — each column is continued
 * with its own colour, darkening and then fading out, so the join reads as
 * a throat going into the collar rather than a cut-out edge.
 *
 * With `full`, the neck is carried to the bottom of the opening without
 * fading, and the opening's width beyond the neck takes the colour of the
 * nearest neck column, so the whole V reads as skin.
 */
function carryNeckDown(
  ctx: OffscreenCanvasRenderingContext2D,
  opening: Uint8Array,
  alpha: Float32Array,
  clothes: Uint8Array,
  frame: FaceFrame,
  collarY: number,
  width: number,
  height: number,
  full: boolean,
) {
  const own = (i: number) => !clothes[i] && alpha[i] >= 0.9
  const cx = Math.round(frame.chinX * width)
  if (cx < 0 || cx >= width) return
  const top = Math.max(0, Math.round(collarY * height))

  const neckEndAt = (x: number) => {
    let end = -1
    for (let y = top; y < height; y++) {
      const i = y * width + x
      if (!opening[i]) continue
      if (own(i)) end = y
      else if (end >= 0) break
    }
    return end
  }

  const centreEnd = neckEndAt(cx)
  if (centreEnd < 0) return
  const probe = Math.max(top, centreEnd - Math.max(2, Math.round(height * 0.01))) * width
  let neckLeft = cx
  while (neckLeft > 0 && own(probe + neckLeft - 1)) neckLeft--
  let neckRight = cx
  while (neckRight < width - 1 && own(probe + neckRight + 1)) neckRight++

  const photo = ctx.getImageData(0, 0, width, height)
  const out = new ImageData(width, height)
  const fade = Math.max(3, Math.round(height * 0.04))
  // Sample a little above the end: the last pixels are already softened
  // toward the backdrop by the paint's edge.
  const skip = Math.max(2, Math.round(height * 0.006))
  const reach = Math.max(4, Math.round(height * 0.02))
  const depth = Math.max(4, Math.round(NECK_CARRY * frame.faceHeight * height))
  const columns = new Map<number, { r: number; g: number; b: number; start: number; neckEnd: number }>()
  for (let x = neckLeft; x <= neckRight; x++) {
    const neckEnd = neckEndAt(x)
    if (neckEnd < 0) continue
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    for (let y = Math.max(top, neckEnd - reach); y <= neckEnd - skip; y++) {
      const i = y * width + x
      if (!own(i)) continue
      r += photo.data[i * 4]
      g += photo.data[i * 4 + 1]
      b += photo.data[i * 4 + 2]
      count++
    }
    if (count === 0) continue
    // Start over the softened last pixels too, so no pale seam is left.
    const start = Math.max(top, neckEnd - skip + 1)
    columns.set(x, { r: r / count, g: g / count, b: b / count, start, neckEnd })
  }
  if (columns.size === 0) return

  let painted = false
  if (!full) {
    for (const [x, { r, g, b, start, neckEnd }] of columns) {
      for (let y = start; y < Math.min(height, start + depth); y++) {
        const i = y * width + x
        if (!opening[i] || (y > neckEnd && own(i))) break
        const shade = 0.97 - 0.32 * Math.min(1, (y - start) / fade)
        const along = (y - start) / depth
        const opacity = along < 0.6 ? 255 : Math.round(255 * (1 - (along - 0.6) / 0.4))
        out.data.set([r * shade, g * shade, b * shade, opacity], i * 4)
        painted = true
      }
    }
  } else {
    // Every column of the opening takes the nearest neck column's colour,
    // a little deeper in the collar's shade the further it is from the neck.
    const xs = [...columns.keys()].sort((a, b) => a - b)
    const first = xs[0]
    const last = xs[xs.length - 1]
    const halfNeck = Math.max(1, (last - first) / 2)
    let near = columns.get(first)!
    for (let x = 0; x < width; x++) {
      near = columns.get(Math.min(last, Math.max(first, x))) ?? near
      const { r, g, b, start, neckEnd } = near
      const side = x < first ? first - x : x > last ? x - last : 0
      const sideShade = 1 - 0.1 * Math.min(1, side / halfNeck)
      for (let y = start; y < height; y++) {
        const i = y * width + x
        if (!opening[i] || (y > neckEnd && own(i))) continue
        const shade = (0.97 - 0.2 * Math.min(1, (y - start) / fade)) * sideShade
        out.data.set([r * shade, g * shade, b * shade, 255], i * 4)
        painted = true
      }
    }
  }
  if (!painted) return
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')?.putImageData(out, 0, 0)
  ctx.filter = `blur(${Math.max(0.75, height * 0.002)}px)`
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = 'none'
}
