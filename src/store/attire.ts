/**
 * The attire template library: shipped placeholders plus the operator's
 * uploads, each decoded once and measured once.
 *
 * Templates are small (a few hundred pixels across), so one decoded bitmap
 * serves the canvas, the sheet preview and the 300 DPI export alike.
 */

import { create } from 'zustand'

import { BUNDLED_ATTIRE } from '../assets/attire'
import { measureTemplate, type TemplateAnchors } from '../lib/attire'
import { decodeToBitmap } from '../lib/bitmap'
import {
  asAppError,
  bytesToObjectUrl,
  importAttire,
  listAttire,
  readAttire,
  removeAttire,
  type AttireEntry,
} from '../lib/tauri'

export type AttireGroup = AttireEntry['group'] | 'placeholder'

export interface AttireTemplate {
  id: string
  name: string
  group: AttireGroup
  source: 'bundled' | 'user'
  /** For thumbnails. */
  url: string
  bitmap: ImageData
  anchors: TemplateAnchors
}

interface AttireLibrary {
  templates: AttireTemplate[]
  status: 'idle' | 'loading' | 'ready'
  /** Why the operator's own templates could not be read; shipped ones still show. */
  error: string | null
  load: () => Promise<void>
  add: (path: string, name: string, group: AttireEntry['group']) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** SVGs cannot go through createImageBitmap, so rasterise via an <img>. */
async function rasteriseUrl(url: string, scale: number): Promise<ImageData> {
  const img = new Image()
  img.src = url
  await img.decode()
  const width = Math.round(img.naturalWidth * scale)
  const height = Math.round(img.naturalHeight * scale)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('could not get a 2D context')
  ctx.drawImage(img, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

let bundledCache: Promise<AttireTemplate[]> | null = null

function loadBundled(): Promise<AttireTemplate[]> {
  bundledCache ??= Promise.all(
    BUNDLED_ATTIRE.map(async (b) => {
      const bitmap = await rasteriseUrl(b.url, 2)
      return {
        id: b.id,
        name: b.name,
        group: 'placeholder' as const,
        source: 'bundled' as const,
        url: b.url,
        bitmap,
        anchors: measureTemplate(bitmap),
      }
    }),
  )
  return bundledCache
}

async function loadUser(): Promise<AttireTemplate[]> {
  const entries = await listAttire()
  const loaded = await Promise.all(
    entries.map(async (entry): Promise<AttireTemplate | null> => {
      try {
        const bytes = await readAttire(entry.id)
        const bitmap = await decodeToBitmap(bytes, 'image/png')
        return {
          id: entry.id,
          name: entry.name,
          group: entry.group,
          source: 'user',
          url: bytesToObjectUrl(bytes, 'image/png'),
          bitmap,
          anchors: measureTemplate(bitmap),
        }
      } catch {
        // One unreadable upload must not hide the rest.
        return null
      }
    }),
  )
  return loaded.filter((t): t is AttireTemplate => t !== null)
}

export const useAttireLibrary = create<AttireLibrary>((set, get) => ({
  templates: [],
  status: 'idle',
  error: null,

  load: async () => {
    set({ status: 'loading' })
    for (const t of get().templates) if (t.source === 'user') URL.revokeObjectURL(t.url)
    const bundled = await loadBundled()
    try {
      const user = await loadUser()
      set({ templates: [...user, ...bundled], status: 'ready', error: null })
    } catch (error) {
      set({ templates: bundled, status: 'ready', error: asAppError(error).message })
    }
  },

  add: async (path, name, group) => {
    await importAttire({ path, name, group })
    await get().load()
  },

  remove: async (id) => {
    await removeAttire(id)
    await get().load()
  },
}))
