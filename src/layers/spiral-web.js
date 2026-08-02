// @ts-check
/**
 * Layer type 17 — Spiral Web (FR-6, architecture §10.2 row 17).
 *
 * `ringCount` concentric regular polygons, each at radius
 * `baseRadius + i × spacing`, laced by `spokeCount` radial spokes that
 * pierce every ring — a radar/cobweb structure.
 *
 * Strategy per §10.2: one accumulated path, single stroke — built on the
 * ctx's own path (D1 template), because §6.5 bans allocating a `Path2D`
 * inside `draw` and every polygon vertex depends on animated `baseRadius`
 * and `spacing`. `prepare` caches the static spoke angles (which change
 * only with `spokeCount`) and the ring count.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws —
 * the structure is fully deterministic from params.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 17,
  name: 'Spiral Web',
  role: 'primary',
  blurb: 'Concentric polygons laced with radial spokes — a radar web.',
  worstCase: { pathOps: 432, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ringCount', 2, 12, { default: 5 }),
  S.int('spokeCount', 3, 24, { default: 8 }),
  A('baseRadius', 20, 400, { default: { min: 60, max: 200 } }),
  A('spacing', 30, 200, { default: { min: 48, max: 120 } }),
  A('strokeWeight', 1, 10, { default: { min: 1.5, max: 4 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180

/**
 * @typedef {object} SpiralWebPrepared
 * @property {number} ringCount
 * @property {number} spokeCount
 * @property {Float64Array} spokeCos  Per-spoke unit x, `cos(i/spokeCount * 2π)`.
 * @property {Float64Array} spokeSin  Per-spoke unit y, `sin(i/spokeCount * 2π)`.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SpiralWebPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const ringCount = /** @type {number} */ (statics.ringCount)
  const spokeCount = /** @type {number} */ (statics.spokeCount)
  const spokeCos = new Float64Array(spokeCount)
  const spokeSin = new Float64Array(spokeCount)
  for (let i = 0; i < spokeCount; i++) {
    const a = (i / spokeCount) * 2 * Math.PI
    spokeCos[i] = Math.cos(a)
    spokeSin[i] = Math.sin(a)
  }
  return {
    ringCount,
    spokeCount,
    spokeCos,
    spokeSin,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SpiralWebPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const spacing = /** @type {number} */ (resolved.spacing)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const { ringCount, spokeCount, spokeCos, spokeSin } = prepared

  ctx.translate(CX, CY)
  ctx.rotate(rot)

  ctx.beginPath()
  // Polygons: ring i at radius `base + i*spacing`, walked over the spoke
  // directions so the polygon has `spokeCount` vertices.
  for (let r = 0; r < ringCount; r++) {
    const rad = base + r * spacing
    for (let j = 0; j < spokeCount; j++) {
      const x = spokeCos[j] * rad
      const y = spokeSin[j] * rad
      if (j === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
  // Spokes: radial lines from the centre to the outermost ring's radius.
  const spokeRadius = base + (ringCount - 1) * spacing
  for (let j = 0; j < spokeCount; j++) {
    ctx.moveTo(0, 0)
    ctx.lineTo(spokeCos[j] * spokeRadius, spokeSin[j] * spokeRadius)
  }

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = weight
  ctx.lineJoin = 'round'
  ctx.stroke()
}