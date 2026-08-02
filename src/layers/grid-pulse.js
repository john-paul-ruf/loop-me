// @ts-check
/**
 * Layer type 10 — Grid Pulse (FR-6, architecture §10.2 row 10).
 *
 * **Heaviest layer in the catalog**: a full-frame grid of squares, each
 * scaled by a spatial wave travelling in the `waveAngle` direction —
 * 2,304 cells at `cellSize` 30, all accumulated on the ctx's own path and
 * committed with a single fill (or stroke). If this cannot hold 60 fps on
 * the reference phone the fix is raising the declared `cellSize` minimum in
 * FR-6 — never drawing fewer cells (arch §13 Q5; determinism outranks
 * performance).
 *
 * Interpretation (Flag 7 adjacent, reference unreachable): a cell's side is
 * `cellSize × cellScale × (0.55 + 0.45·cos(phase))`, where `phase` is the
 * cell centre's projection onto the wave direction, `waveFreq` full cycles
 * across the canvas diagonal. Two properties of this formula are
 * load-bearing:
 *
 *  - Every factor is a pure function of loop-closed resolved values, so the
 *    wave itself closes the loop (FR-3 structural closure).
 *  - The crest factor is 1.0 but the trough is 0.1, so even at
 *    `cellScale` pinned to 1.0 the grid can never become a uniform
 *    full-canvas fill — the FR-6 "full-canvas opaque" AC is impossible by
 *    construction, matching `fullCanvasOpaque: false`. And at the low bound
 *    (`cellScale` 0.1, `cellSize` 30) crest cells are still 3 px across a
 *    2,304-cell field — never blank.
 *
 * Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 10,
  name: 'Grid Pulse',
  role: 'secondary',
  blurb: 'A field of cells swelling in a travelling wave.',
  worstCase: { pathOps: 2304, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('cellSize', 30, 240, { default: 90 }),
  A('waveAngle', 0, 360, { unit: '°', wrap: true }),
  S.int('waveFreq', 1, 6, { default: 2 }),
  A('cellScale', 0.1, 1.0, { default: { min: 0.35, max: 0.9 } }),
  S.bool('filled', { default: true }),
]

const W = 1080
const H = 1920
const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
const DIAG = Math.hypot(W, H)
/** Stroke width for the unfilled variant — a hint of cell outline. */
const STROKE_W = 2

/**
 * @typedef {object} GridPulsePrepared
 * @property {number} cols
 * @property {number} rows
 * @property {number} size
 * @property {number} x0     Centre x of column 0 (grid centred on canvas).
 * @property {number} y0     Centre y of row 0.
 * @property {number} freq
 * @property {boolean} filled
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {GridPulsePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const size = /** @type {number} */ (statics.cellSize)
  const cols = Math.ceil(W / size)
  const rows = Math.ceil(H / size)
  return {
    cols,
    rows,
    size,
    x0: CX - ((cols - 1) / 2) * size,
    y0: CY - ((rows - 1) / 2) * size,
    freq: /** @type {number} */ (statics.waveFreq),
    filled: statics.filled === true,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {GridPulsePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const theta = /** @type {number} */ (resolved.waveAngle) * DEG
  const scale = /** @type {number} */ (resolved.cellScale)
  const { cols, rows, size, x0, y0, freq } = prepared
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  // phase per unit of projected distance: waveFreq cycles across the diagonal.
  const k = (TWO_PI * freq) / DIAG

  ctx.beginPath()
  for (let row = 0; row < rows; row++) {
    const y = y0 + row * size
    const dy = (y - CY) * s
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * size
      const phase = ((x - CX) * c + dy) * k
      const side = size * scale * (0.55 + 0.45 * Math.cos(phase))
      ctx.rect(x - side / 2, y - side / 2, side, side)
    }
  }
  if (prepared.filled) {
    ctx.fillStyle = prepared.color
    ctx.fill()
  } else {
    ctx.strokeStyle = prepared.color
    ctx.lineWidth = STROKE_W
    ctx.stroke()
  }
}
