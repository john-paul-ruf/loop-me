// @ts-check
/**
 * Layer type 28 — Triangulation (FR-6, architecture §10.2 row 28).
 *
 * A triangular grid (an equilateral tiling of the frame) where each triangle
 * is stroked as an outline. All triangle outlines accumulate on one ctx path
 * and stroke once — single draw call. Triangles tile the canvas by row,
 * alternating orientation per row (up/down), so coverage is total at any
 * base weight. The whole lattice rotates as one via an animated `rotation`.
 *
 * Strategy per §10.2: one accumulated path, single stroke — built on the
 * ctx's own path (D1 template); §6.5 bans `Path2D` allocation inside `draw`.
 * The `pathOps` budget counts triangles (not segments) matching grid-pulse's
 * convention ("2,304 cells @ cellSize 30"). The literal segment count is 3×
 * the triangle count, but the registry test pins `pathOps` against §10.2's
 * table, which records the cell count.
 *
 * Never blank: `baseWeight` ≥ 0.5 means every triangle gets a stroke ≥ 0.5
 * device px — visible. The grid tiles the frame so at least one triangle
 * exists on canvas at every `cellSize`/`rotation` combination.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 28,
  name: 'Triangulation',
  role: 'secondary',
  blurb: 'A rotating triangular lattice across the frame.',
  worstCase: { pathOps: 2304, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('cellSize', 30, 240, { default: 120 }),
  A('baseWeight', 0.5, 8, { default: { min: 1, max: 4 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
]

const W = 1080
const H = 1920
const CX = 540
const CY = 960
const DEG = Math.PI / 180
/** Equilateral triangle height: `cellSize × sin(60°)`. */
const TRI_H_FACTOR = 0.8660254037844386

/**
 * @typedef {object} TriangulationPrepared
 * @property {number} cols
 * @property {number} rows
 * @property {number} size
 * @property {number} triH   Triangle height.
 * @property {number} x0     Left edge of the grid (centred on canvas).
 * @property {number} y0    Top edge of the grid.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {TriangulationPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const size = /** @type {number} */ (statics.cellSize)
  const triH = size * TRI_H_FACTOR
  // Over-cover by one column and one row so rotation never exposes an edge.
  const cols = Math.ceil(W / size) + 2
  const rows = Math.ceil(H / triH) + 2
  return {
    cols,
    rows,
    size,
    triH,
    x0: CX - (cols * size) / 2,
    y0: CY - (rows * triH) / 2,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {TriangulationPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const weight = /** @type {number} */ (resolved.baseWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const { cols, rows, size, triH, x0, y0 } = prepared

  ctx.translate(CX, CY)
  ctx.rotate(rot)

  ctx.beginPath()
  for (let row = 0; row < rows; row++) {
    const y = y0 + row * triH
    // Alternate row offset so up/down triangles share edges — a tessellation.
    const xOff = row % 2 === 0 ? 0 : size / 2
    for (let col = 0; col < cols; col++) {
      const x = x0 + xOff + col * size
      // Up-triangle (apex up).
      ctx.moveTo(x, y + triH)
      ctx.lineTo(x + size / 2, y)
      ctx.lineTo(x + size, y + triH)
      ctx.closePath()
      // Down-triangle (apex down) — shares the up-triangle's top edge.
      ctx.moveTo(x + size / 2, y)
      ctx.lineTo(x + size + size / 2, y)
      ctx.lineTo(x + size, y + triH)
      ctx.closePath()
    }
  }

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = weight
  ctx.lineJoin = 'round'
  ctx.stroke()
}