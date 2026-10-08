import { useMemo } from 'react'

import { framedCrop, useJob } from './job'

/** The crop every preview and export uses: Adjust's framing plus any head move. */
export function useFramedCrop() {
  const cropRect = useJob((s) => s.cropRect)
  const headShift = useJob((s) => s.headShift)
  const headScale = useJob((s) => s.headScale)
  const faces = useJob((s) => s.faces)
  const info = useJob((s) => s.info)
  return useMemo(
    () => framedCrop({ cropRect, headShift, headScale, faces, info }),
    [cropRect, headShift, headScale, faces, info],
  )
}
