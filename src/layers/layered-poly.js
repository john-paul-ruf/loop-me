// @ts-check
/**
 * Layer type 3 — Layered Poly (FR-6, architecture §10.2 row 3).
 *
 * One regular polygon, re-stroked `polyCount` times, each copy scaled by
 * `scaleStep^k` and turned by `rotationStep × k`. Strategy per §10.2: one
 * `Path2D` (a unit polygon, built in `prepare` — `sides` is static), stroked
 * under 12 absolute transforms in `draw`. `lineWidth` is divided by the
 * per-copy scale so stroke weight stays in canvas pixels while the geometry
 * scales.
 *
 * `setTransform` is absolute, so no save/restore per copy is needed; the
 * painter's per-layer restore (§6.4) puts the transform back.
 * Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 3,
  name: 'Layered Poly',
  role: 'primary',
  blurb: 'Nested polygons spiralling inward, turning as they shrink.',
  worstCase: { pathOps: 144, drawCalls: 12 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('polyCount', 1, 12, { default: 5 }),
  S.int('sides', 3, 12, { default: 6 }),
  A('baseRadius', 60, 700, { default: { min: 200, max: 480 } }),
  S.num('scaleStep', 0.5, 0.95, { default: 0.78 }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.num('rotationStep', -30, 30, { unit: '°', default: 10 }),
  A('strokeWeight', 1, 16, { default: { min: 2, max: 6 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180

/**
 * @typedef {object} LayeredPolyPrepared
 * @property {number} count
 * @property {Path2D} path      Unit polygon, radius 1, first vertex up.
 * @property {Float64Array} scales  scaleStep^k per copy.
 * @property {number} stepRad   rotationStep in radians.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {LayeredPolyPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.polyCount)
  const sides = /** @type {number} */ (statics.sides)
  const scaleStep = /** @type {number} */ (statics.scaleStep)

  const path = new Path2D()
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i / sides) * 2 * Math.PI
    if (i === 0) path.moveTo(Math.cos(a), Math.sin(a))
    else path.lineTo(Math.cos(a), Math.sin(a))
  }
  path.closePath()

  const scales = new Float64Array(count)
  for (let k = 0; k < count; k++) scales[k] = Math.pow(scaleStep, k)

  return {
    count,
    path,
    scales,
    stepRad: /** @type {number} */ (statics.rotationStep) * DEG,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {LayeredPolyPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const { count, path, scales, stepRad } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  for (let k = 0; k < count; k++) {
    const s = base * scales[k]
    const a = rot + stepRad * k
    const c = Math.cos(a) * s
    const n = Math.sin(a) * s
    ctx.setTransform(c, n, -n, c, CX, CY)
    ctx.lineWidth = weight / s
    ctx.stroke(path)
  }
}
