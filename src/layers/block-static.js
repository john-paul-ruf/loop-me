// @ts-check
/**
 * Layer type 35 — Block Static (FR-6, architecture §10.2 row 35).
 *
 * Bursts of corrupted blocks: some blocks are shuffled patches of the
 * composited frame below, others are blocks of injected coloured noise.
 * The shuffle is self-blitted (`ctx.drawImage(ctx.canvas, …)`) — later
 * blocks may re-read regions written by earlier ones in the same frame,
 * producing a compounding smear. That is **accepted, not a bug**: the
 * frame is snapshotted only inside a single drawImage call, and the order
 * over blocks is deterministic (fixed table lookup) so the smear is
 * loop-perfect (FR-3).
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Prepare draws exactly `256*256 + ROWS*MAX_BLOCKS*5 = 65536 + 2720 =
 * 68256` rng values regardless of `blockSize`/`density`/`row` — the FR-4
 * cross-device contract. Per-frame chaos is a table lookup indexed by the
 * animated `row`; every driving param is loop-closed by A / `findValue`.
 *
 * ## Allocation-free draw (§6.5)
 *
 * The noise tile (createImageData ONCE — Grain FR-6 precedent) and the
 * block table (`Float64Array(17 * 32 * 5)`) are minted in `prepare`. Draw
 * does at most `MAX_BLOCKS = 32` `drawImage` calls, no `getImageData` or
 * `putImageData`. `worstCase.drawCalls` = 32, `pathOps` = 0.
 * `fullCanvasOpaque: false` — noise blocks run under envelope alpha; the
 * frame-shuffle path never covers new pixels beyond the noise blocks.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 35,
  name: 'Block Static',
  role: 'glitch',
  blurb: 'Bursts of corrupted blocks — frame shuffle and injected static.',
  worstCase: { pathOps: 0, drawCalls: 32 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('blockSize', 40, 240, { default: 120 }),
  // density.min > 0: at 0 the layer would emit no blocks — the
  // "renders nothing" AC failure mode we design out.
  A('density', 0.05, 1, { default: { min: 0.1, max: 0.6 } }),
  A('row', 0, 16, { default: { min: 0, max: 16 } }),
]

const WIDTH = 1080
const HEIGHT = 1920
const ROWS = 17
const MAX_BLOCKS = 32
const TILE = 256
const NOISE_KIND_THRESHOLD = 0.3  // kind < this ⇒ inject noise; else shuffle
const FIELDS_PER_BLOCK = 5

/**
 * @typedef {object} BlockStaticPrepared
 * @property {HTMLCanvasElement} noise  256×256 coloured static tile.
 * @property {Float64Array} table  ROWS × MAX_BLOCKS × 5, values in [0, 1).
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {BlockStaticPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  // Coloured noise: Grain's FR-6 precedent — ONE createImageData in
  // prepare, per-pixel alpha from the seeded rng. TILE² draws, row-major.
  const noise = scratch(TILE, TILE)
  const nctx = /** @type {CanvasRenderingContext2D} */ (noise.getContext('2d'))
  const img = nctx.createImageData(TILE, TILE)
  const data = img.data
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = (rng() * 256) | 0
  }
  nctx.putImageData(img, 0, 0)

  // Block table: fixed size regardless of `blockSize`/`density`/`row`.
  // Layout per block: [sx, sy, dxOff, dyOff, kind]. All normalized [0,1).
  const table = new Float64Array(ROWS * MAX_BLOCKS * FIELDS_PER_BLOCK)
  for (let i = 0; i < table.length; i++) table[i] = rng()

  return { noise, table }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {BlockStaticPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const size = /** @type {number} */ (resolved.blockSize)
  const density = /** @type {number} */ (resolved.density)
  const row = Math.min(ROWS - 1, Math.floor(/** @type {number} */ (resolved.row)))
  const count = Math.max(1, Math.round(density * MAX_BLOCKS))
  const table = prepared.table
  const rowBase = row * MAX_BLOCKS * FIELDS_PER_BLOCK
  const gridW = Math.max(1, Math.floor(WIDTH / size))
  const gridH = Math.max(1, Math.floor(HEIGHT / size))
  const noise = prepared.noise

  // Painter has set envelope alpha + blend chip; keep both.
  for (let i = 0; i < count; i++) {
    const off = rowBase + i * FIELDS_PER_BLOCK
    // Quantize src/dst rects onto a `size` grid: any read/write stays
    // aligned, so a self-blit into a subsequent read-slot leaves no
    // torn edges. Grid indices clamped by the row/col count.
    const sCol = Math.min(gridW - 1, Math.floor(table[off + 0] * gridW))
    const sRow = Math.min(gridH - 1, Math.floor(table[off + 1] * gridH))
    const dCol = Math.min(gridW - 1, Math.floor(table[off + 2] * gridW))
    const dRow = Math.min(gridH - 1, Math.floor(table[off + 3] * gridH))
    const kind = table[off + 4]
    const sx = sCol * size
    const sy = sRow * size
    const dx = dCol * size
    const dy = dRow * size
    if (kind < NOISE_KIND_THRESHOLD) {
      // Noise block: read from the 256² tile modulo TILE — one drawImage
      // wraps into the tile by clamping src-rect to the tile bounds, and
      // the visible edge falls at the block boundary, not inside it.
      const nx = (sCol * size) % TILE
      const ny = (sRow * size) % TILE
      const nw = Math.min(size, TILE - nx)
      const nh = Math.min(size, TILE - ny)
      ctx.drawImage(noise, nx, ny, nw, nh, dx, dy, size, size)
    } else {
      // Frame shuffle: self-blit a `size`-square chunk. Later blocks may
      // read a region we already wrote earlier this frame — that
      // compounding smear is deterministic (fixed table lookup, fixed
      // per-layer rngSeed) so it stays loop-perfect across cycles.
      ctx.drawImage(ctx.canvas, sx, sy, size, size, dx, dy, size, size)
    }
  }
}
