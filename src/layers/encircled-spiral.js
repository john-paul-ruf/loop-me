// @ts-check
/**
 * Layer type 4 — Encircled Spiral (FR-6, architecture §10.2 row 4).
 *
 * `armCount` spiral arms from the centre, evenly spaced. Each arm is a
 * 180-point polyline from an 8 px start radius out to an outer radius set by
 * `tightness` — interpretation (the reference is unreachable, Flag 7):
 * higher tightness = a more tightly wound, smaller spiral, so the outer
 * radius is `900 − 840 × tightness` (858 at 0.05, 60 at 1.0 — always
 * visible, never blank). `sweep` is the angular travel of each arm.
 *
 * §10.2's cache note ("cached in prepare when rotation is the only animated
 * param") does not apply as stated: `tightness`, `sweep`, and `strokeWeight`
 * are all A, so geometry is animated every frame. All arms accumulate on the
 * ctx's own path with a single stroke — within the 12-draw-call budget and
 * honouring §6.5's allocation ban (recorded in the build plan's D2 briefing).
 * `prepare` caches the per-arm base angles, which change only with
 * `armCount`. Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 4,
  name: 'Encircled Spiral',
  role: 'primary',
  blurb: 'Winding spiral arms that coil, sweep, and unwind.',
  worstCase: { pathOps: 2160, drawCalls: 12 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('armCount', 1, 12, { default: 3 }),
  A('tightness', 0.05, 1.0, { default: { min: 0.3, max: 0.6 } }),
  A('sweep', 90, 1440, { unit: '°', default: { min: 360, max: 720 } }),
  A('strokeWeight', 1, 14, { default: { min: 2, max: 6 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
/** Points per arm: 12 arms × 180 = §10.2's 2,160 path ops. */
const POINTS = 180
const R_START = 8

/**
 * @typedef {object} EncircledSpiralPrepared
 * @property {number} count
 * @property {Float64Array} angles  Per-arm base angle.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {EncircledSpiralPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.armCount)
  const angles = new Float64Array(count)
  for (let i = 0; i < count; i++) angles[i] = (i / count) * 2 * Math.PI
  return {
    count,
    angles,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {EncircledSpiralPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const tight = /** @type {number} */ (resolved.tightness)
  const sweepRad = /** @type {number} */ (resolved.sweep) * DEG
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const outer = 900 - 840 * tight
  const { count, angles } = prepared

  ctx.beginPath()
  for (let a = 0; a < count; a++) {
    const base = rot + angles[a]
    for (let i = 0; i < POINTS; i++) {
      const u = i / (POINTS - 1)
      const ang = base + u * sweepRad
      const r = R_START + u * (outer - R_START)
      const x = CX + Math.cos(ang) * r
      const y = CY + Math.sin(ang) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }
  ctx.strokeStyle = prepared.color
  ctx.lineWidth = /** @type {number} */ (resolved.strokeWeight)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}
