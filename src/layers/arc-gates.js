// @ts-check
/**
 * Layer type 7 — Arc Gates (FR-6, architecture §10.2 row 7, §5.1's own
 * worked example).
 *
 * Thick arc segments at several radii, rotating independently. Gate g sits
 * at radius `radiusStep × (g + 1)` (cached in `prepare` — `radiusStep` is
 * static; gate 0 is at most 200 px out, so at least one gate is always
 * on-canvas). Independence comes from the layer PRNG: each gate gets a fixed
 * angular offset and a rotation-rate multiplier.
 *
 * `rateSpread` interpretation (the reference is unreachable, Flag 7): the
 * per-gate rate multiplier is drawn from `[min(1, rateSpread),
 * max(1, rateSpread)]` and multiplies the resolved `rotation` value. The
 * resolved value is identical at frame 0 and frame total (FR-3, structural),
 * so a constant multiple of it is too — per-gate rates cannot tear the loop.
 *
 * **PRNG consumption order (FR-4, binding):** for each gate, ascending —
 * one draw for the angular offset, one for the rate multiplier.
 * 2 × gateCount draws total, nothing else.
 */

import { A, S } from '../model/params.js'
import { range } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 7,
  name: 'Arc Gates',
  role: 'primary',
  blurb: 'Thick arc segments at several radii, rotating independently.',
  worstCase: { pathOps: 10, drawCalls: 10 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('gateCount', 2, 10, { default: 5 }),
  A('arcSpan', 10, 170, { unit: '°', default: { min: 40, max: 120 } }),
  A('weight', 4, 60, { default: { min: 8, max: 20 } }),
  S.int('radiusStep', 40, 200, { default: 90 }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.num('rateSpread', 0.5, 3.0, { default: 1.5 }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2

/**
 * @typedef {object} ArcGatesPrepared
 * @property {number} count
 * @property {Float64Array} radii   Per-gate radius.
 * @property {Float64Array} offset  Per-gate fixed angular offset.
 * @property {Float64Array} mult    Per-gate rotation-rate multiplier.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {ArcGatesPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const count = /** @type {number} */ (statics.gateCount)
  const radiusStep = /** @type {number} */ (statics.radiusStep)
  const spread = /** @type {number} */ (statics.rateSpread)
  const lo = Math.min(1, spread)
  const hi = Math.max(1, spread)
  const radii = new Float64Array(count)
  const offset = new Float64Array(count)
  const mult = new Float64Array(count)
  for (let g = 0; g < count; g++) {
    radii[g] = radiusStep * (g + 1)
    offset[g] = rng() * TWO_PI
    mult[g] = range(rng, lo, hi)
  }
  return {
    count,
    radii,
    offset,
    mult,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {ArcGatesPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const half = (/** @type {number} */ (resolved.arcSpan) * DEG) / 2
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const { count, radii, offset, mult } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = /** @type {number} */ (resolved.weight)
  ctx.lineCap = 'round'
  for (let g = 0; g < count; g++) {
    const a = rot * mult[g] + offset[g]
    ctx.beginPath()
    ctx.arc(CX, CY, radii[g], a - half, a + half)
    ctx.stroke()
  }
}
