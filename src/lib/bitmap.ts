/**
 * Browser-side pixel plumbing: bytes in, pixels out, bytes back.
 *
 * Kept separate from `composite.ts` so that the compositing maths stays pure
 * and testable in Node. Everything here needs a real canvas.
 */

import type { Bitmap } from './composite'
import { coverSourceRect, type BackgroundView, type PaperPlacement } from './fitToPaper'
import { nameTagFont, nameTagLayout, type NameTag } from './nameTag'

/** Decode encoded image bytes into raw RGBA pixels. */
export async function decodeToBitmap(bytes: ArrayBuffer, mime: string): Promise<ImageData> {
  const blob = new Blob([bytes], { type: mime })
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('could not get a 2D context')
    ctx.drawImage(bitmap, 0, 0)
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  } finally {
    // An ImageBitmap holds GPU memory until closed; at 12 MP that matters.
    bitmap.close()
  }
}

/** Encode raw pixels. `quality` applies to JPEG only. */
export async function encodeBitmap(
  bmp: Bitmap,
  type: 'image/jpeg' | 'image/png',
  quality = 0.95,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not get a 2D context')
  ctx.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0)
  const blob = await canvas.convertToBlob({ type, quality })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Draw a bitmap into a canvas element, sizing the canvas to match. */
export function drawBitmap(canvas: HTMLCanvasElement, bmp: Bitmap): void {
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0)
}

/**
 * Downscale with repeated halving before the final step.
 *
 * A single large `drawImage` downscale in Canvas2D point-samples badly and
 * turns fine hair into aliased speckle. Halving until within 2x keeps the
 * detail that the whole full-resolution pipeline exists to preserve.
 */
export async function resampleBitmap(
  bmp: Bitmap,
  width: number,
  height: number,
): Promise<ImageData> {
  if (bmp.width === width && bmp.height === height) {
    return new ImageData(Uint8ClampedArray.from(bmp.data), bmp.width, bmp.height)
  }

  let canvas = new OffscreenCanvas(bmp.width, bmp.height)
  let ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not get a 2D context')
  ctx.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0)

  let currentW = bmp.width
  let currentH = bmp.height
  while (currentW > width * 2 && currentH > height * 2) {
    const nextW = Math.max(width, Math.floor(currentW / 2))
    const nextH = Math.max(height, Math.floor(currentH / 2))
    const next = new OffscreenCanvas(nextW, nextH)
    const nextCtx = next.getContext('2d')
    if (!nextCtx) throw new Error('could not get a 2D context')
    nextCtx.imageSmoothingEnabled = true
    nextCtx.imageSmoothingQuality = 'high'
    nextCtx.drawImage(canvas, 0, 0, nextW, nextH)
    canvas = next
    ctx = nextCtx
    currentW = nextW
    currentH = nextH
  }

  const out = new OffscreenCanvas(width, height)
  const outCtx = out.getContext('2d', { willReadFrequently: true })
  if (!outCtx) throw new Error('could not get a 2D context')
  outCtx.imageSmoothingEnabled = true
  outCtx.imageSmoothingQuality = 'high'
  outCtx.drawImage(canvas, 0, 0, width, height)
  return outCtx.getImageData(0, 0, width, height)
}

/**
 * Cut `rect` out of `bmp`, rotating about the rectangle's centre.
 *
 * Rotation and cropping happen in one draw so the subject is never resampled
 * twice. Anything outside the source is left transparent — the crop is allowed
 * to run past the photo's edge (BUILD_PLAN §5), and for the image that gap is
 * filled by the new background anyway, while for the mask transparent is
 * exactly right: nothing there is foreground.
 */
export function cropRotate(
  bmp: Bitmap,
  rect: { x: number; y: number; width: number; height: number },
  rotationDeg = 0,
): ImageData {
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))

  const source = new OffscreenCanvas(bmp.width, bmp.height)
  const sourceCtx = source.getContext('2d')
  if (!sourceCtx) throw new Error('could not get a 2D context')
  sourceCtx.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0)

  const out = new OffscreenCanvas(width, height)
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('could not get a 2D context')

  ctx.save()
  // Work from the centre of the crop so the rotation pivots where the operator
  // sees it pivot, rather than around a corner.
  ctx.translate(width / 2, height / 2)
  ctx.rotate((rotationDeg * Math.PI) / 180)
  ctx.translate(-(rect.x + rect.width / 2), -(rect.y + rect.height / 2))
  ctx.drawImage(source, 0, 0)
  ctx.restore()

  return ctx.getImageData(0, 0, width, height)
}

/** Clipboard image, for the Ctrl+V import path (DESIGN_BRIEF §3.1). */
export function imageFromClipboard(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items
  if (!items) return null
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}

/**
 * Burn the name strip into the bottom of a finished photo.
 *
 * Inside the photo, never appended to it: the print keeps the preset's exact
 * millimetres. Returns the bitmap untouched when there is no name to print.
 */
export function withNameTag(bmp: Bitmap, tag: NameTag): Bitmap {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return bmp

  const layout = nameTagLayout(bmp.width, bmp.height, tag, (text, px) => {
    ctx.font = nameTagFont(tag, px)
    return ctx.measureText(text).width
  })
  if (!layout) return bmp

  ctx.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0)
  ctx.fillStyle = tag.background
  ctx.fillRect(0, layout.bandY, bmp.width, layout.bandHeight)
  ctx.fillStyle = tag.color
  ctx.font = nameTagFont(tag, layout.fontPx)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(layout.text, bmp.width / 2, layout.centreY, layout.maxTextWidth)
  return ctx.getImageData(0, 0, bmp.width, bmp.height)
}

/**
 * A text measurer for the name strip, so a preview can shrink a long name
 * exactly as `withNameTag` will when it prints it.
 */
export function nameTagMeasurer(tag: NameTag): (text: string, fontPx: number) => number {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')
  return (text, fontPx) => {
    if (!ctx) return text.length * fontPx * 0.5
    ctx.font = nameTagFont(tag, fontPx)
    return ctx.measureText(text).width
  }
}

/**
 * A background picture cut to exactly `width` x `height`: the part chosen by
 * `view`, scaled to cover, so it can go straight behind the subject.
 */
export async function coverFit(
  bg: Bitmap,
  width: number,
  height: number,
  view: BackgroundView,
): Promise<ImageData> {
  const r = coverSourceRect(bg, { width, height }, view)
  const cut = cropRotate(bg, r, 0)
  return resampleBitmap(cut, width, height)
}

/**
 * The photo on white paper at print pixels. `photo` is already at
 * `placement.rect` size; in Fill mode it runs past the edges and the canvas
 * crops it. Transparency prints on white.
 */
export async function renderOnPaper(photo: Bitmap, placement: PaperPlacement): Promise<ImageData> {
  const { paper, rect } = placement
  const src = new OffscreenCanvas(photo.width, photo.height)
  src.getContext('2d')?.putImageData(new ImageData(photo.data, photo.width, photo.height), 0, 0)
  const out = new OffscreenCanvas(paper.width, paper.height)
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('could not get a 2D context')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, paper.width, paper.height)
  ctx.drawImage(src, rect.x, rect.y, rect.width, rect.height)
  return ctx.getImageData(0, 0, paper.width, paper.height)
}
