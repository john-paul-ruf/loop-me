// @ts-check
/**
 * Layer type 18 — Nested Squares (FR-6, architecture §10.2 row 18).
 *
 * `squareCount` concentric squares, each at half-side
 * `baseRadius + i × stepGap`, each rotated by `rotation + i × rotationStep`.
 * The layered-poly trick specialised to 4 sides: the per-square transform
 * is a clean rotation+scale rather than a 2×2 matrix.
 *
 * Strategy per §10.2: one unit-square `Path2D` (built in `prepare`, since
 * `squareCount` only fixes how many copies are stroked) re-stroked under
 * `squareCount` absolute transforms in `draw`. `lineWidth` is divided by
 * the per-copy scale so stroke weight stays in canvas pixels (layered-poly
 * pattern). `setTransform` is absolute, so no save/restore per copy is
 * needed; the painter's per-layer restore (§6.4) puts the transform back.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 18,
  name: 'Nested Squares',
  role: 'primary',
  blurb: 'Concentric squares turning at different rates as they grow.',
  worstCase: { pathOps: 64, drawCalls: 16 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('squareCount', 2, 16, { default: 6 }),
  A('baseRadius', 40, 400, { default: { min: 80, max: 260 } }),
  A('stepGap', 20, 200, { default: { min: 40, max: 120 } }),
  A('strokeWeight', 1, 12, { default: { min: 2, max: 6 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.num('rotationStep', -30, 30, { unit: '°', default: 8 }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180

/**
 * @typedef {object} NestedSquaresPrepared
 * @property {number} count
 * @property {Path2D} path  Unit square, half-side 1, centred at origin.
 * @property {number} stepRad  `rotationStep` in radians.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {NestedSquaresPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.squareCount)
  const path = new Path2D()
  path.moveTo(-1, -1)
  path.lineTo(1, -1)
  path.lineTo(1, 1)
  path.lineTo(-1, 1)
  path.closePath()
  return {
    count,
    path,
    stepRad: /** @type {number} */ (statics.rotationStep) * DEG,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {NestedSquaresPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const stepGap = /** @type {number} */ (resolved.stepGap)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const { count, path, stepRad } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  for (let k = 0; k < count; k++) {
    const r = base + k * stepGap
    const a = rot + stepRad * k
    const c = Math.cos(a) * r
    const s = Math.sin(a) * r
    ctx.setTransform(c, s, -s, c, CX, CY)
    ctx.lineWidth = weight / r
    ctx.stroke(path)
  }
}