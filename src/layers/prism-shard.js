// @ts-check
/**
 * Layer type 23 — Prism Shard (FR-6, architecture §10.2 row 23).
 *
 * A central triangular shard (a regular 3-sided polygon at `outerRadius`)
 * with `accentCount` thinner inner triangles at radii shrinking toward
 * the centre — a stained-glass facet. The outer triangle is filled; the
 * inner accents are stroked. Two draw calls (one fill, one stroke) is the
 * worst case.
 *
 * Strategy per §10.2: one unit-triangle `Path2D` (built in `prepare`, since
 * the shape is a fixed 3-sided polygon) reused for the outer fill under
 * `setTransform` and for each accent stroke under a shrinking scale. The
 * outer fill uses the animated `outerRadius` as the scale; each accent
 * uses `outerRadius × accentStep^k`. `lineWidth` is divided by the per-copy
 * scale so stroke weight stays in canvas pixels (layered-poly pattern).
 * `setTransform` is absolute; the painter's restore (§6.4) resets.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 23,
  name: 'Prism Shard',
  role: 'primary',
  blurb: 'A faceted triangle with concentric accent outlines.',
  worstCase: { pathOps: 27, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('accentCount', 0, 8, { default: 3 }),
  A('outerRadius', 60, 700, { default: { min: 200, max: 480 } }),
  S.num('accentStep', 0.1, 0.9, { default: 0.66 }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  A('strokeWeight', 1, 10, { default: { min: 1.5, max: 4 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2

/**
 * @typedef {object} PrismShardPrepared
 * @property {number} accentCount
 * @property {Path2D} tri     Unit triangle, radius 1, first vertex up.
 * @property {Float64Array} scales  accentStep^k per accent, k = 0 .. accentCount-1.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {PrismShardPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const accentCount = /** @type {number} */ (statics.accentCount)
  const step = /** @type {number} */ (statics.accentStep)

  const tri = new Path2D()
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * TWO_PI
    if (i === 0) tri.moveTo(Math.cos(a), Math.sin(a))
    else tri.lineTo(Math.cos(a), Math.sin(a))
  }
  tri.closePath()

  const scales = new Float64Array(accentCount)
  for (let k = 0; k < accentCount; k++) scales[k] = Math.pow(step, k)

  return {
    accentCount,
    tri,
    scales,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {PrismShardPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const outer = /** @type {number} */ (resolved.outerRadius)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const { accentCount, tri, scales } = prepared

  const c = Math.cos(rot)
  const s = Math.sin(rot)

  // Outer fill: scale + rotate by outerRadius.
  ctx.setTransform(outer * c, outer * s, -outer * s, outer * c, CX, CY)
  ctx.fillStyle = prepared.color
  ctx.fill(tri)

  // Accents: stroke the same unit triangle under shrinking scales.
  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  for (let k = 0; k < accentCount; k++) {
    const scale = outer * scales[k]
    ctx.setTransform(scale * c, scale * s, -scale * s, scale * c, CX, CY)
    ctx.lineWidth = weight / scale
    ctx.stroke(tri)
  }
}