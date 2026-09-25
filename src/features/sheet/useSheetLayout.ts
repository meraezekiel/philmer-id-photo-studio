/**
 * The one place the sheet layout is computed.
 *
 * The preview, the PDF and the sheet JPEG all read from this, so they cannot
 * disagree about where a photo sits — which matters, because the preview is
 * what the operator trusts before committing paper and ink.
 */

import { useMemo } from 'react'

import {
  fillSheetAuto,
  packPackageAuto,
  photoSizeMm,
  requestedCount,
  type PackageRequest,
  type Placement,
} from '../../lib/layout'
import { PAPERS, PHOTO_PRESETS } from '../../lib/presets'
import { useJob } from '../../store/job'

export interface SheetResult {
  placements: Placement[]
  paperWidthMm: number
  paperHeightMm: number
  marginMm: number
  gapMm: number
  paperLandscape: boolean
  /** How many fit at most, for the "Fill sheet" label. */
  capacity: number
  /** Photos actually placed. */
  count: number
  /** False when a package asked for more than the paper can take. */
  fits: boolean
  /** How many the package asked for but could not be placed. */
  missing: number
}

export function useSheetLayout(): SheetResult {
  const paper = useJob((s) => s.paper)
  const presetId = useJob((s) => s.presetId)
  const mode = useJob((s) => s.sheetMode)
  const quantity = useJob((s) => s.quantity)
  const packageRows = useJob((s) => s.packageRows)
  const orientation = useJob((s) => s.paperOrientation)
  const offsetXMm = useJob((s) => s.sheetOffsetXMm)
  const offsetYMm = useJob((s) => s.sheetOffsetYMm)
  const photoOffsets = useJob((s) => s.photoOffsets)

  return useMemo(() => {
    const margin = PAPERS[paper].defaultMarginMm

    /**
     * Per-photo nudges are applied last, on top of the packed layout, so the
     * packer stays a pure function of the settings and a hand-placed photo is
     * simply an offset from where the packer put it.
     */
    const nudge = (placements: Placement[]): Placement[] =>
      placements.map((p, i) => {
        const o = photoOffsets[i]
        return o ? { ...p, xMm: p.xMm + o.xMm, yMm: p.yMm + o.yMm } : p
      })

    if (mode === 'package') {
      const items: PackageRequest[] = packageRows
        .filter((r) => r.qty > 0)
        .map((r) => ({ presetId: r.presetId, qty: r.qty }))
      const result = packPackageAuto(paper, items, orientation, { offsetXMm, offsetYMm })
      const asked = requestedCount(items)
      return {
        placements: nudge(result.placements),
        paperWidthMm: result.paperWidthMm,
        paperHeightMm: result.paperHeightMm,
        marginMm: result.marginMm,
        gapMm: result.gapMm,
        paperLandscape: result.paperLandscape,
        capacity: result.placements.length,
        count: result.placements.length,
        fits: result.fits,
        missing: Math.max(0, asked - result.placements.length),
      }
    }

    const photo = photoSizeMm(
      presetId,
      presetId === 'custom'
        ? { widthMm: PHOTO_PRESETS.custom.widthMm, heightMm: PHOTO_PRESETS.custom.heightMm }
        : undefined,
    )
    // Capacity is measured before any quantity cap, so "Fill sheet" can show
    // the true maximum even while Exact quantity is selected.
    const full = fillSheetAuto(paper, photo, orientation, { marginMm: margin, offsetXMm, offsetYMm })
    const layout =
      mode === 'exact'
        ? fillSheetAuto(paper, photo, orientation, { marginMm: margin, quantity, offsetXMm, offsetYMm })
        : full

    return {
      placements: nudge(layout.placements),
      paperWidthMm: layout.paperWidthMm,
      paperHeightMm: layout.paperHeightMm,
      marginMm: layout.marginMm,
      gapMm: layout.gapMm,
      paperLandscape: layout.paperLandscape,
      capacity: full.capacity,
      count: layout.placements.length,
      // Asking for more than fits is a real condition the UI must surface.
      fits: mode !== 'exact' || quantity <= full.capacity,
      missing: mode === 'exact' ? Math.max(0, quantity - full.capacity) : 0,
    }
  }, [paper, presetId, mode, quantity, packageRows, orientation, offsetXMm, offsetYMm, photoOffsets])
}
