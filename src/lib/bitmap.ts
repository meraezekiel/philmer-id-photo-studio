/**
 * Browser-side pixel plumbing: bytes in, pixels out, bytes back.
 *
 * Kept separate from `composite.ts` so that the compositing maths stays pure
 * and testable in Node. Everything here needs a real canvas.
 */

import type { Bitmap } from './composite'

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
