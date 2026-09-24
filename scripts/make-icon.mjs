// Generates design/app-icon.png (1024x1024), the source the Tauri CLI slices
// into every installer/taskbar size. Original artwork: an ID card with a
// portrait bust and a shutter notch, which reads at 16 px because it is only
// three shapes.
//
//   node scripts/make-icon.mjs
//   npx tauri icon design/app-icon.png
//
// Written with zlib only so the repo needs no image dependency.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const S = 1024

// Deep teal accent from DESIGN_BRIEF §5, on a transparent ground.
const TEAL = [15, 118, 126]
const TEAL_DEEP = [10, 88, 96]
const CARD = [255, 255, 255]

const buf = new Uint8Array(S * S * 4) // RGBA, premultiplied by nothing

const px = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return
  const i = (y * S + x) * 4
  // Simple source-over so the shapes can be layered with soft coverage.
  const sa = a / 255
  const da = buf[i + 3] / 255
  const oa = sa + da * (1 - sa)
  if (oa === 0) return
  for (let c = 0; c < 3; c++) {
    buf[i + c] = Math.round((([r, g, b][c] * sa) + buf[i + c] * da * (1 - sa)) / oa)
  }
  buf[i + 3] = Math.round(oa * 255)
}

/** Coverage of a rounded rect at a point, antialiased over ~1.5 px. */
const roundRect = (x, y, l, t, w, h, r) => {
  const cx = Math.min(Math.max(x, l + r), l + w - r)
  const cy = Math.min(Math.max(y, t + r), t + h - r)
  const d = Math.hypot(x - cx, y - cy)
  if (x < l - 1 || x > l + w + 1 || y < t - 1 || y > t + h + 1) return 0
  return Math.min(1, Math.max(0, (r - d + 0.75) / 1.5))
}

const disc = (x, y, cx, cy, r) =>
  Math.min(1, Math.max(0, (r - Math.hypot(x - cx, y - cy) + 0.75) / 1.5))

// Layout: a 1024 grid with a 72 px safe margin.
const L = 72, T = 152, W = S - L * 2, H = S - T * 2

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // Card body, teal, with a subtle vertical shade so it is not flat.
    const body = roundRect(x, y, L, T, W, H, 120)
    if (body > 0) {
      const t = (y - T) / H
      const col = TEAL.map((c, i) => Math.round(c + (TEAL_DEEP[i] - c) * t))
      px(x, y, col, Math.round(body * 255))
    }
  }
}

// Portrait window: a white rounded panel on the left two-thirds.
const PL = L + 96, PT = T + 92, PW = 392, PH = H - 184
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const a = roundRect(x, y, PL, PT, PW, PH, 56)
    if (a > 0) px(x, y, CARD, Math.round(a * 255))
  }
}

// Bust: head disc plus shoulders, clipped to the portrait window.
const headR = 96
const headCx = PL + PW / 2
const headCy = PT + PH * 0.36
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const clip = roundRect(x, y, PL, PT, PW, PH, 56)
    if (clip <= 0) continue
    let a = disc(x, y, headCx, headCy, headR)
    // Shoulders: a wide disc pushed below the window's lower edge.
    a = Math.max(a, disc(x, y, headCx, PT + PH * 1.02, PW * 0.42))
    if (a > 0) px(x, y, TEAL, Math.round(Math.min(a, clip) * 255))
  }
}

// Data lines on the right, the "card" cue.
const RX = PL + PW + 64
for (const [i, w] of [200, 248, 168].entries()) {
  const ly = PT + 72 + i * 96
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = roundRect(x, y, RX, ly, w, 40, 20)
      if (a > 0) px(x, y, CARD, Math.round(a * 200))
    }
  }
}

// --- PNG encode (RGBA8, one IDAT) ---
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filter: none
  Buffer.from(buf.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b) => {
  let c = 0xffffffff
  for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = 'design/app-icon.png'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${S}x${S}, ${png.length} bytes)`)
