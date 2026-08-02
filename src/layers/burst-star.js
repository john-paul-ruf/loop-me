// @ts-check
/**
 * Layer type 21 — Burst Star (FR-6, architecture §10.2 row 21).
 *
 * An `outerPoints`-point star with alternating outer and inner vertices at
 * radii `outerRadius` and `innerRadius`, rotating as one. This is
 * petal-bloom's "radiating wedges" reduced to a pure outline: one closed
 * polygon, single stroke or fill. `innerRadius` is clamped above zero,
 * guaranteeing a star with visible indentations; the outer tips always
 * reach the outer radius.
 *
 * Strategy per §10.2: one accumulated path, single stroke/fill — built on
 * the ctx's own path (D1 template), because §6.5 bans allocating a `Path2D`
 * inside `draw` and every vertex depends on animated radii. `prepare`
 * caches the static vertex angles (which change only with `outerPoints`).
 * Consumes zero PRNG draws.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 21,
  name: 'Burst Star',
  role: 'primary',
  blurb: 'A many-pointed star pulsing between inner and outer radii.',
  worstCase: { pathOps: 48, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('outerPoints', 3, 24, { default: 6 }),
  A('outerRadius', 60, 800, { default: { min: 200, max: 520 } }),
  A('innerRadius', 20, 400, { default: { min: 60, max: 200 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  A('strokeWeight', 1, 14, { default: { min: 2, max: 6 } }),
  S.bool('filled', { default: false }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2

/**
 * @typedef {object} BurstStarPrepared
 * @property {number} count
 * @property {number} vertexCount
 * @property {Float64Array} angles  Per-vertex angle, first vertex up.
 * @property {boolean} filled
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {BurstStarPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.outerPoints)
  const vertexCount = 2 * count
  const angles = new Float64Array(vertexCount)
  for (let j = 0; j < vertexCount; j++) {
    angles[j] = -Math.PI / 2 + (j / vertexCount) * TWO_PI
  }
  return {
    count,
    vertexCount,
    angles,
    filled: statics.filled === true,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {BurstStarPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const rOut = /** @type {number} */ (resolved.outerRadius)
  const rIn = /** @type {number} */ (resolved.innerRadius)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const { vertexCount, angles, filled } = prepared

  ctx.translate(CX, CY)
  ctx.rotate(rot)

  ctx.beginPath()
  for (let j = 0; j < vertexCount; j++) {
    const r = j % 2 === 0 ? rOut : rIn
    const x = Math.cos(angles[j]) * r
    const y = Math.sin(angles[j]) * r
    if (j === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()

  if (filled) {
    ctx.fillStyle = prepared.color
    ctx.fill()
  } else {
    ctx.strokeStyle = prepared.color
    ctx.lineWidth = weight
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
}