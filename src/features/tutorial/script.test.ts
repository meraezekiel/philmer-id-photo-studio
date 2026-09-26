import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TOUR } from './script'
import { ACTIVE_STEPS } from '../../store/job'

/**
 * A tip whose anchor no longer exists still shows, but points at nothing and
 * floats in the middle of the screen — and nobody notices until a customer
 * does. Renaming a `data-tour` is exactly the kind of edit that causes it, so
 * the anchors are checked against the source rather than trusted.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.tsx') || path.endsWith('.ts') ? [path] : []
  })
}

const sources = sourceFiles('src')
  .filter((path) => !path.includes('tutorial'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

describe('the walkthrough', () => {
  it('points every tip at something that exists', () => {
    for (const tip of TOUR) {
      const attached =
        sources.includes(`data-tour="${tip.anchor}"`) ||
        sources.includes(`tour="${tip.anchor}"`) ||
        // The canvases share one anchor built from the step name.
        (tip.anchor.endsWith('-canvas') && sources.includes('data-tour={`${step}-canvas`}'))
      expect(attached, `no element carries data-tour="${tip.anchor}" (tip ${tip.id})`).toBe(true)
    }
  })

  it('only names steps the operator can actually reach', () => {
    for (const tip of TOUR) {
      expect(ACTIVE_STEPS, `tip ${tip.id} is on an unreachable step`).toContain(tip.step)
    }
  })

  it('covers every step of the flow', () => {
    for (const step of ACTIVE_STEPS) {
      expect(
        TOUR.some((tip) => tip.step === step),
        `nothing is explained on the ${step} step`,
      ).toBe(true)
    }
  })

  it('gives every tip a unique id', () => {
    const ids = TOUR.map((tip) => tip.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the tips in the order the operator meets them', () => {
    const order = TOUR.map((tip) => ACTIVE_STEPS.indexOf(tip.step))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('says what to do next at the end of every step but the last', () => {
    for (const step of ACTIVE_STEPS.slice(0, -1)) {
      const forStep = TOUR.filter((tip) => tip.step === step)
      const last = forStep[forStep.length - 1]
      expect(last?.waitFor, `the ${step} tips do not say how to move on`).toBeTruthy()
    }
  })

  it('is written in short sentences, because it is read standing up', () => {
    for (const tip of TOUR) {
      expect(tip.title.length, `${tip.id} title is too long`).toBeLessThanOrEqual(46)
      expect(tip.body.length, `${tip.id} body is too long`).toBeLessThanOrEqual(260)
    }
  })
})
