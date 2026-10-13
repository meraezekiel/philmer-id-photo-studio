import { describe, expect, it } from 'vitest'

import { NEUTRAL_ENHANCE } from './enhance'
import { CENTRED, cropRect } from './bookCrop'
import { approximateMeasure, coverText, pageDraw, pageText } from './bookDraw'
import { resolveFrames, layoutById } from './bookLayouts'
import { DEFAULT_COVER, EDGE_TO_EDGE, newBook, type Book, type BookPhoto } from './bookTypes'

const photo = (id: string, width = 3000, height = 2000): BookPhoto => ({
  id, path: `C:\\${id}.jpg`, name: `${id}.jpg`, width, height, takenAt: null, face: null, enhance: NEUTRAL_ENHANCE,
})

function book(patch: Partial<Book> = {}): Book {
  return {
    ...newBook(),
    photos: [photo('a'), photo('b'), photo('tiny', 300, 200)],
    pages: [
      { id: '1', layoutId: '2-side', frames: [{ photoId: 'a', crop: CENTRED }, { photoId: null, crop: CENTRED }] },
      { id: '2', layoutId: '1-full', frames: [{ photoId: 'b', crop: { cx: 0.5, cy: 0.5, zoom: 2 } }] },
      { id: '3', layoutId: '1-framed', frames: [{ photoId: 'a', crop: CENTRED }] },
      { id: '4', layoutId: 'retired', frames: [] },
    ],
    ...patch,
  }
}

const PAGE = { widthMm: 127, heightMm: 152.4 }

describe('pageDraw', () => {
  it('draws frames where the layout puts them, without bleed', () => {
    const b = book()
    const draw = pageDraw(b, b.pages[0])
    const rects = resolveFrames(layoutById('2-side')!, PAGE, b.style)
    expect(draw.frames.map((f) => f.rect)).toEqual(rects)
    expect(draw.frames[0].source).toEqual(cropRect(1.5, rects[0].w / rects[0].h, CENTRED))
    expect(draw.frames[1].source).toBeNull()
    expect(draw.color).toBe('#FFFFFF')
  })

  it('extends edge frames into the bleed without moving what is inside the trim', () => {
    const b = book({ style: EDGE_TO_EDGE })
    const plain = pageDraw(b, b.pages[1]).frames[0]
    const bled = pageDraw(b, b.pages[1], { bleedMm: 2 }).frames[0]
    expect(bled.rect.x).toBeCloseTo(-2, 9)
    expect(bled.rect.y).toBeCloseTo(-2, 9)
    expect(bled.rect.w).toBeCloseTo(131, 9)
    expect(bled.rect.h).toBeCloseTo(156.4, 9)
    // The source point under the trim corner is the same with and without bleed.
    const at = (f: typeof plain, mmX: number) => f.source!.x + ((mmX - f.rect.x) * f.source!.w) / f.rect.w
    expect(at(bled, 0)).toBeCloseTo(at(plain, 0), 12)
    expect(at(bled, 127)).toBeCloseTo(at(plain, 127), 12)
  })

  it('stops the bleed where the photo ends', () => {
    // Zoom 1 on a matching shape shows the whole photo: nothing left to bleed.
    const b = book({ style: EDGE_TO_EDGE, photos: [photo('a'), photo('b', 1270, 1524), photo('tiny', 300, 200)] })
    const page = { ...b.pages[1], frames: [{ photoId: 'b', crop: CENTRED }] }
    const f = pageDraw(b, page, { bleedMm: 2 }).frames[0]
    for (const [got, want] of [[f.rect.x, 0], [f.rect.y, 0], [f.rect.w, 127], [f.rect.h, 152.4], [f.source!.x, 0], [f.source!.y, 0], [f.source!.w, 1], [f.source!.h, 1]]) {
      expect(got).toBeCloseTo(want, 6)
    }
  })

  it('shrinks a whole-photo frame to the photo and never crops it', () => {
    const b = book()
    const f = pageDraw(b, b.pages[2]).frames[0]
    expect(f.rect.w / f.rect.h).toBeCloseTo(1.5)
    expect(f.source).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('flags missing and low-resolution photos', () => {
    const b = book()
    const missing = pageDraw(b, b.pages[1], { missing: new Set(['b']) }).frames[0]
    expect(missing.missing).toBe(true)
    const small = { ...b.pages[1], frames: [{ photoId: 'tiny', crop: CENTRED }] }
    const f = pageDraw(b, small).frames[0]
    expect(f.lowRes).toBe(true)
    expect(f.dpi).toBeLessThan(200)
    // 3000 px across a centred crop on a 115 mm frame is about 368 DPI.
    const sharp = { ...b.pages[1], frames: [{ photoId: 'b', crop: CENTRED }] }
    expect(pageDraw(b, sharp).frames[0].lowRes).toBe(false)
  })

  it('draws nothing for an unknown layout', () => {
    const b = book()
    expect(pageDraw(b, b.pages[3]).frames).toEqual([])
  })

  it('crops stay inside the photo after the book size changes', () => {
    const edited = book()
    edited.pages[1].frames[0].crop = { cx: 0.98, cy: 0.02, zoom: 1.1 }
    for (const size of ['5x6', '5x7', '8x8', '8x10', 'a4'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const b = { ...edited, size, orientation }
        for (const page of b.pages) {
          for (const f of pageDraw(b, page, { bleedMm: 2 }).frames) {
            if (!f.source) continue
            expect(f.source.x).toBeGreaterThanOrEqual(-1e-9)
            expect(f.source.y).toBeGreaterThanOrEqual(-1e-9)
            expect(f.source.x + f.source.w).toBeLessThanOrEqual(1 + 1e-9)
            expect(f.source.y + f.source.h).toBeLessThanOrEqual(1 + 1e-9)
          }
        }
      }
    }
  })
})

describe('cover text', () => {
  const cover = { ...DEFAULT_COVER, title: 'Juan & Maria', subtitle: '12 October 2026' }

  it('is empty without words', () => {
    expect(coverText({ ...DEFAULT_COVER }, PAGE, approximateMeasure)).toEqual([])
  })

  it('shrinks a long title to fit the page width', () => {
    const long = { ...cover, title: 'A very long title for a wedding book' }
    const [title] = coverText(long, PAGE, approximateMeasure)
    expect(approximateMeasure(title.text, title.font, title.sizeMm)).toBeLessThanOrEqual(PAGE.widthMm * 0.84 + 1e-9)
  })

  it('never goes below the minimum size, even for absurd titles', () => {
    const [title] = coverText({ ...cover, title: 'x'.repeat(2000) }, PAGE, approximateMeasure)
    expect(title.sizeMm).toBe(4)
  })

  it('places the block top, middle or bottom', () => {
    const y = (position: 'top' | 'middle' | 'bottom') => coverText({ ...cover, position }, PAGE, approximateMeasure)[0].baseline
    expect(y('top')).toBeLessThan(y('middle'))
    expect(y('middle')).toBeLessThan(y('bottom'))
    expect(y('bottom')).toBeLessThan(PAGE.heightMm)
  })

  it('only writes text on the cover page', () => {
    const b = { ...book(), cover }
    b.pages = [{ id: 'c', layoutId: 'cover', frames: [{ photoId: 'a', crop: CENTRED }] }, ...b.pages]
    expect(pageText(b, 0, approximateMeasure).map((l) => l.text)).toEqual(['Juan & Maria', '12 October 2026'])
    expect(pageText(b, 1, approximateMeasure)).toEqual([])
    expect(pageText({ ...b, cover: null }, 0, approximateMeasure)).toEqual([])
  })
})
