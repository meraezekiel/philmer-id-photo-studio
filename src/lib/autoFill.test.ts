import { describe, expect, it } from 'vitest'

import { ASPECT_LIMIT, autoFill, autoPageCount, distribute, type FillOptions, type FillPhoto } from './autoFill'
import { layoutById, rectAspect, resolveFrames } from './bookLayouts'
import type { BookPage } from './bookTypes'

const photos = (n: number, aspect = 1.5): FillPhoto[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, aspect, face: null }))

function options(patch: Partial<FillOptions> = {}): FillOptions {
  let id = 0
  return {
    pageCount: 'auto',
    cover: false,
    page: { widthMm: 127, heightMm: 152.4 },
    style: { marginMm: 6, gapMm: 3 },
    newId: () => `pg${id++}`,
    ...patch,
  }
}

function pagesOf(result: ReturnType<typeof autoFill>): BookPage[] {
  if (!result.ok) throw new Error(result.message)
  return result.pages
}

const index = (id: string | null) => Number(id!.slice(1))

describe('distribute', () => {
  it('spreads every photo over the pages, 1 to 6 each', () => {
    for (const [n, p] of [[10, 4], [37, 15], [40, 20], [120, 20], [6, 1], [5, 5]]) {
      const counts = distribute(n, p)
      expect(counts).toHaveLength(p)
      expect(counts.reduce((a, b) => a + b, 0)).toBe(n)
      for (const c of counts) {
        expect(c).toBeGreaterThanOrEqual(1)
        expect(c).toBeLessThanOrEqual(6)
      }
    }
  })

  it('keeps every fifth page a single photo while the rest have room', () => {
    const counts = distribute(40, 20)
    for (let i = 0; i < 20; i += 5) expect(counts[i]).toBe(1)
  })

  it('fills the feature pages too when there are very many photos', () => {
    expect(distribute(60, 10)).toEqual(new Array(10).fill(6))
  })
})

describe('autoFill', () => {
  it('picks about 2.5 photos a page when the count is automatic', () => {
    expect(autoPageCount(37)).toBe(15)
    expect(autoPageCount(1)).toBe(1)
    expect(autoPageCount(2)).toBe(1)
    expect(pagesOf(autoFill(photos(37), options()))).toHaveLength(15)
  })

  it('uses every photo exactly once, in consecutive groups', () => {
    const pages = pagesOf(autoFill(photos(37), options()))
    let next = 0
    for (const page of pages) {
      const ids = page.frames.map((f) => index(f.photoId)).sort((a, b) => a - b)
      expect(ids).toEqual(ids.map((_, k) => next + k))
      next += ids.length
    }
    expect(next).toBe(37)
  })

  it('makes exactly the requested number of pages, plus the cover', () => {
    expect(pagesOf(autoFill(photos(50), options({ pageCount: 20 })))).toHaveLength(20)
    const withCover = pagesOf(autoFill(photos(50), options({ pageCount: 20, cover: true })))
    expect(withCover).toHaveLength(21)
    expect(withCover[0].layoutId).toBe('cover')
    expect(withCover[0].frames.map((f) => f.photoId)).toEqual(['p0'])
    expect(withCover.slice(1).flatMap((p) => p.frames).some((f) => f.photoId === 'p0')).toBe(false)
  })

  it('makes only the cover when the cover is the only photo', () => {
    const pages = pagesOf(autoFill(photos(1), options({ cover: true })))
    expect(pages.map((p) => p.layoutId)).toEqual(['cover'])
  })

  it('puts one photo on every fifth page', () => {
    const pages = pagesOf(autoFill(photos(40), options({ pageCount: 20 })))
    for (let i = 0; i < 20; i += 5) expect(pages[i].frames).toHaveLength(1)
  })

  it('stacks two landscape photos on a portrait page instead of squeezing them side by side', () => {
    const pages = pagesOf(autoFill(photos(2, 1.5), options({ pageCount: 1, page: { widthMm: 203.2, heightMm: 254 } })))
    expect(pages[0].layoutId).toBe('2-stack')
  })

  it('keeps frames within the aspect limit when a layout allows it', () => {
    const page = { widthMm: 127, heightMm: 152.4 }
    const style = { marginMm: 6, gapMm: 3 }
    // Each case was checked by hand to have at least one layout within the limit.
    for (const [n, aspect] of [[1, 1.5], [2, 1.5], [3, 1.5], [6, 0.667], [1, 0.667]] as const) {
      const [only] = pagesOf(autoFill(photos(n, aspect), options({ pageCount: 1 })))
      const layout = layoutById(only.layoutId)!
      const rects = resolveFrames(layout, page, style)
      layout.frames.forEach((frame, i) => {
        if (frame.fit) return
        const ratio = Math.max(rectAspect(rects[i]) / aspect, aspect / rectAspect(rects[i]))
        expect(ratio, `${n} x ${aspect} on ${layout.id}`).toBeLessThanOrEqual(ASPECT_LIMIT + 1e-9)
      })
    }
  })

  it('still lays out four landscape photos on a portrait page', () => {
    const pages = pagesOf(autoFill(photos(4, 1.5), options({ pageCount: 1 })))
    expect(pages[0].frames).toHaveLength(4)
  })

  it('never uses the same layout three pages in a row when another fits', () => {
    // Landscape photos on a landscape 5x7: both single layouts pass.
    const pages = pagesOf(autoFill(photos(3, 1.5), options({ pageCount: 3, page: { widthMm: 177.8, heightMm: 127 } })))
    const ids = pages.map((p) => p.layoutId)
    expect(new Set(ids).size).toBeGreaterThan(1)
    for (let i = 2; i < ids.length; i++) expect(ids[i] === ids[i - 1] && ids[i] === ids[i - 2]).toBe(false)
  })

  it('is deterministic', () => {
    const a = pagesOf(autoFill(photos(23, 1.2), options()))
    const b = pagesOf(autoFill(photos(23, 1.2), options()))
    expect(a.map((p) => [p.layoutId, p.frames])).toEqual(b.map((p) => [p.layoutId, p.frames]))
  })

  it('autoFill survives zero-size frames', () => {
    const pages = pagesOf(autoFill(photos(12, 1.5), options({ pageCount: 2, style: { marginMm: 80, gapMm: 10 } })))
    expect(pages.flatMap((p) => p.frames)).toHaveLength(12)
    for (const frame of pages.flatMap((p) => p.frames)) {
      expect(Number.isFinite(frame.crop.cx) && Number.isFinite(frame.crop.cy)).toBe(true)
    }
  })

  it('refuses an empty book', () => {
    expect(autoFill([], options())).toEqual({ ok: false, message: 'Add at least one photo first.' })
  })

  it('says how many photos to add when there are fewer photos than pages', () => {
    const result = autoFill(photos(12), options({ pageCount: 20 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('12 photos cannot fill 20 pages. Add 8 more photos or choose fewer pages.')
  })

  it('says how many to remove, and which page count fits, when there are too many', () => {
    const result = autoFill(photos(200), options({ pageCount: 20 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('200 photos do not fit on 20 pages (6 per page at most). Remove 80 photos or choose 40 pages.')
  })

  it('does not suggest a page count when none of the offered ones fits', () => {
    const result = autoFill(photos(400), options({ pageCount: 50 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('400 photos do not fit on 50 pages (6 per page at most). Remove 100 photos.')
  })

  it('handles hundreds of photos', () => {
    const pages = pagesOf(autoFill(photos(300, 1.33), options()))
    expect(pages).toHaveLength(120)
  })
})
