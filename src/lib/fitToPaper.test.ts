import { describe, expect, it } from 'vitest'

import { coverSourceRect, placeOnPaper } from './fitToPaper'
import { PAPERS } from './presets'

describe('placeOnPaper', () => {
  it('makes 4R 1200 x 1800 at 300 DPI', () => {
    const p = placeOnPaper({ width: 2000, height: 3000 }, PAPERS['4r'], 'fit', 'portrait')
    expect(p.paper).toEqual({ width: 1200, height: 1800 })
  })

  it('fit keeps the whole photo and centres it', () => {
    const p = placeOnPaper({ width: 3000, height: 4000 }, PAPERS['4r'], 'fit', 'portrait')
    expect(p.rect.width).toBe(1200)
    expect(p.rect.height).toBe(1600)
    expect(p.rect.x).toBe(0)
    expect(p.rect.y).toBe(100)
  })

  it('fill covers the paper and crops from the centre', () => {
    const p = placeOnPaper({ width: 3000, height: 4000 }, PAPERS['4r'], 'fill', 'portrait')
    expect(p.rect.height).toBe(1800)
    expect(p.rect.width).toBe(1350)
    expect(p.rect.x).toBe(-75)
    expect(p.rect.y).toBe(0)
  })

  it('auto turns the paper for a landscape photo', () => {
    const p = placeOnPaper({ width: 4000, height: 3000 }, PAPERS['4r'], 'fit', 'auto')
    expect(p.landscape).toBe(true)
    expect(p.paper).toEqual({ width: 1800, height: 1200 })
  })

  it('fill still covers every edge for a panorama', () => {
    const p = placeOnPaper({ width: 9000, height: 2000 }, PAPERS['4r'], 'fill', 'auto')
    expect(p.rect.x).toBeLessThanOrEqual(0)
    expect(p.rect.y).toBeLessThanOrEqual(0)
    expect(p.rect.x + p.rect.width).toBeGreaterThanOrEqual(p.paper.width)
    expect(p.rect.y + p.rect.height).toBeGreaterThanOrEqual(p.paper.height)
  })

  it('honours a forced orientation', () => {
    const p = placeOnPaper({ width: 4000, height: 3000 }, PAPERS['3r'], 'fit', 'portrait')
    expect(p.paper.width).toBeLessThan(p.paper.height)
  })
})

describe('coverSourceRect', () => {
  it('crops the centre at zoom 1', () => {
    const r = coverSourceRect({ width: 4000, height: 2000 }, { width: 100, height: 100 }, { zoom: 1, offsetX: 0, offsetY: 0 })
    expect(r).toEqual({ x: 1000, y: 0, width: 2000, height: 2000 })
  })

  it('zooms in around the centre and moves within bounds', () => {
    const r = coverSourceRect({ width: 2000, height: 2000 }, { width: 100, height: 100 }, { zoom: 2, offsetX: 1, offsetY: -1 })
    expect(r).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 })
  })
})
