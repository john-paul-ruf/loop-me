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
 * **per-effect-glow (S04):** wide additive re-stroke archetype. When
 * `glowStrength > 0`, `draw` re-runs the triangle-tiling loop once BEFORE
 * the crisp pass under `globalCompositeOperation = 'lighter'` at
 * `lineWidth × K_GLOW` — a soft halo under the lattice, crisp edges on top.
 * No `shadowBlur` (FR-6); `gs === 0` is a hard no-op → pre-glow seeds
 * decode byte-identical (§9.5). K = 1.8 keeps the halo modest against the
 * very dense triangle count (2304 triangles at cellSize.min = 30).
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
  // Worst case doubles under the glow pass: 1 halo stroke + 1 crisp stroke,
  // halo path is the same shape as the crisp path.
  worstCase: { pathOps: 4608, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('cellSize', 30, 240, { default: 120 }),
  A('baseWeight', 0.5, 8, { default: { min: 1, max: 4 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const W = 1080
const H = 1920
const CX = 540
const CY = 960
const DEG = Math.PI / 180
/** Equilateral triangle height: `cellSize × sin(60°)`. */
const TRI_H_FACTOR = 0.8660254037844386
/**
 * Halo width multiplier. Very dense — 2304+ triangle outlines at
 * cellSize.min = 30. 1.8 keeps the halo clearly wider than the mark at
 * every `baseWeight` without flooding the small triangle interiors.
 */
const K_GLOW = 1.8

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
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { cols, rows, size, triH, x0, y0 } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.translate(CX, CY)
  ctx.rotate(rot)

  // Glow pass — drawn FIRST so the crisp lattice sits on top (halo under
  // mark). `gs === 0` is a hard no-op: skip the pass entirely for byte-
  // identical pre-glow output. See `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    ctx.beginPath()
    for (let row = 0; row < rows; row++) {
      const y = y0 + row * triH
      const xOff = row % 2 === 0 ? 0 : size / 2
      for (let col = 0; col < cols; col++) {
        const x = x0 + xOff + col * size
        ctx.moveTo(x, y + triH)
        ctx.lineTo(x + size / 2, y)
        ctx.lineTo(x + size, y + triH)
        ctx.closePath()
        ctx.moveTo(x + size / 2, y)
        ctx.lineTo(x + size + size / 2, y)
        ctx.lineTo(x + size, y + triH)
        ctx.closePath()
      }
    }
    ctx.stroke()
    ctx.restore()
    // `strokeStyle`, `lineJoin`, and transform survive `restore()`.
  }

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

  ctx.lineWidth = weight
  ctx.stroke()
}