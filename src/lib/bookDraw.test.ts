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

  it('still covers the bleed when the crop already shows the whole photo', () => {
    // Zoom 1 on a matching shape shows the whole photo: the crop is taken
    // for the bled rectangle instead, so no page colour shows in the bleed.
    const b = book({ style: EDGE_TO_EDGE, photos: [photo('a'), photo('b', 1270, 1524), photo('tiny', 300, 200)] })
    const page = { ...b.pages[1], frames: [{ photoId: 'b', crop: CENTRED }] }
    const f = pageDraw(b, page, { bleedMm: 2 }).frames[0]
    for (const [got, want] of [[f.rect.x, -2], [f.rect.y, -2], [f.rect.w, 131], [f.rect.h, 156.4]]) {
      expect(got).toBeCloseTo(want, 6)
    }
    const s = f.source!
    expect(s.x).toBeGreaterThanOrEqual(-1e-9)
    expect(s.y).toBeGreaterThanOrEqual(-1e-9)
    expect(s.x + s.w).toBeLessThanOrEqual(1 + 1e-9)
    expect(s.y + s.h).toBeLessThanOrEqual(1 + 1e-9)
    // Not stretched: the photo pixels drawn have the bled rectangle's shape.
    expect((s.w * 1270) / (s.h * 1524)).toBeCloseTo(131 / 156.4, 6)
  })

  it('covers the bleed on the axis where a zoom-1 crop uses the whole photo', () => {
    // A 3:2 photo on a portrait page uses its full height at zoom 1.
    const b = book({ style: EDGE_TO_EDGE })
    const page = { ...b.pages[1], frames: [{ photoId: 'b', crop: CENTRED }] }
    const plain = pageDraw(b, page).frames[0]
    const f = pageDraw(b, page, { bleedMm: 2 }).frames[0]
    expect(plain.source!.h).toBeCloseTo(1, 9)
    expect(f.rect.y).toBeCloseTo(-2, 9)
    expect(f.rect.h).toBeCloseTo(156.4, 9)
    expect(f.rect.x).toBeCloseTo(-2, 9)
    expect(f.rect.w).toBeCloseTo(131, 9)
    expect(f.source!.y).toBeGreaterThanOrEqual(-1e-9)
    expect(f.source!.y + f.source!.h).toBeLessThanOrEqual(1 + 1e-9)
    expect((f.source!.w * 3000) / (f.source!.h * 2000)).toBeCloseTo(131 / 156.4, 6)
  })

  it('only grows a frame into the bleed on the sides that touch the page edge', () => {
    const b = book({ style: EDGE_TO_EDGE })
    const page = { ...b.pages[0], frames: [{ photoId: 'b', crop: CENTRED }, { photoId: 'a', crop: CENTRED }] }
    const plain = pageDraw(b, page).frames
    const bled = pageDraw(b, page, { bleedMm: 2 }).frames
    for (let i = 0; i < 2; i++) {
      const p = plain[i].rect
      const r = bled[i].rect
      const inner = (edge: number) => edge > 1e-6 && edge < PAGE.widthMm - 1e-6
      // An inner edge (the gap between the two photos) stays where it was.
      if (inner(p.x)) expect(r.x).toBeCloseTo(p.x, 9)
      else expect(r.x).toBeCloseTo(-2, 9)
      if (inner(p.x + p.w)) expect(r.x + r.w).toBeCloseTo(p.x + p.w, 9)
      else expect(r.x + r.w).toBeCloseTo(PAGE.widthMm + 2, 9)
      // Both photos run from the top edge to the bottom edge.
      expect(r.y).toBeCloseTo(-2, 9)
      expect(r.y + r.h).toBeCloseTo(PAGE.heightMm + 2, 9)
      const s = bled[i].source!
      expect(s.x).toBeGreaterThanOrEqual(-1e-9)
      expect(s.y).toBeGreaterThanOrEqual(-1e-9)
      expect(s.x + s.w).toBeLessThanOrEqual(1 + 1e-9)
      expect(s.y + s.h).toBeLessThanOrEqual(1 + 1e-9)
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
