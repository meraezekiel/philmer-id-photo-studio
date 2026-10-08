/**
 * Attire templates shipped with the app.
 *
 * These are placeholders until licensed or self-photographed templates
 * replace them. Only add a file here whose licence allows redistributing it
 * inside the product: everything in this folder goes into every installer.
 */

import blazerTie from './blazer-tie.svg?url'
import shirtTie from './shirt-tie.svg?url'

export interface BundledAttire {
  id: string
  name: string
  url: string
}

export const BUNDLED_ATTIRE: BundledAttire[] = [
  { id: 'bundled:shirt-tie', name: 'Shirt and tie', url: shirtTie },
  { id: 'bundled:blazer-tie', name: 'Blazer and tie', url: blazerTie },
]
