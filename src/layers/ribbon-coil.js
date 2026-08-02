// @ts-check
/**
 * Layer type 22 — Ribbon Coil (FR-6, architecture §10.2 row 22).
 *
 * A single polyline that spirals outward from centre: angle
 * `θ = u × sweep` and radius `r = innerRadius + (outerRadius − innerRadius)
 * × u`, where `u ∈ [0, 1]`. Plus a sinusoidal radial wobble of amplitude
 * `wobble` that makes the ribbon weave like a coiled spring. The whole
 * thing accumulates on the ctx's path and strokes once. Closest analogue:
 * encircled-spiral's "polyline per arm", but here it is one long arm.
 *
 * Strategy per §10.2: one accumulated path, single stroke — built on the
 * ctx's own path (D1 template), because §6.5 bans allocating a `Path2D`
 * inside `draw` and every point depends on animated radii. `prepare`
 * caches `POINTS` (the sample count) and `turns` (→ `sweepRad`). Consumes
 * zero PRNG draws.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 22,
  name: 'Ribbon Coil',
  role: 'primary',
  blurb: 'A single ribbon spiralling outward, weaving as it goes.',
  worstCase: { pathOps: 400, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('turns', 1, 8, { default: 3 }),
  A('innerRadius', 0, 200, { default: { min: 0, max: 60 } }),
  A('outerRadius', 40, 900, { default: { min: 200, max: 520 } }),
  A('wobble', 0, 120, { default: { min: 0, max: 60 } }),
  A('strokeWeight', 1, 14, { default: { min: 2, max: 6 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/** Sampled points on the polyline (§10.2 path-ops budget). */
const POINTS = 400

/**
 * @typedef {object} RibbonCoilPrepared
 * @property {number} sweepRad  `turns * 2π`.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {RibbonCoilPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const turns = /** @type {number} */ (statics.turns)
  return {
    sweepRad: turns * TWO_PI,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {RibbonCoilPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const r0 = /** @type {number} */ (resolved.innerRadius)
  const r1 = /** @type {number} */ (resolved.outerRadius)
  const wob = /** @type {number} */ (resolved.wobble)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const { sweepRad } = prepared
  const turns = sweepRad / TWO_PI

  ctx.translate(CX, CY)
  ctx.rotate(rot)

  ctx.beginPath()
  for (let i = 0; i < POINTS; i++) {
    const u = i / (POINTS - 1)
    const ang = u * sweepRad
    const r = r0 + (r1 - r0) * u + wob * Math.sin(ang * turns)
    const x = Math.cos(ang) * r
    const y = Math.sin(ang) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = weight
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
}