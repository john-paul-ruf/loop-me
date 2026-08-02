// @ts-check
/**
 * Layer type 27 — Concentric Waves (FR-6, architecture §10.2 row 27).
 *
 * `ringCount` concentric circles whose radii are modulated by a travelling
 * wave around their circumference — each ring is a wobbly closed polyline
 * shaped by `cos(waveFreq × θ) × amplitude`. Closest to nth-rings
 * (concentric arcs) combined with sine-ribbons (sampled polylines). Each
 * ring is a `POINTS`-vertex polyline; the whole stack accumulates on one
 * ctx path and strokes once.
 *
 * Strategy per §10.2: one accumulated path, single stroke — built on the
 * ctx's own path (D1 template); §6.5 bans `Path2D` allocation inside
 * `draw` because every vertex radius depends on animated params.
 *
 * Never blank: `ringCount` ≥ 2 and `baseRadius` ≥ 40 means at least two
 * rings with baseline radius ≥ 40. The `Math.max(2, …)` guard on each
 * vertex radius keeps every ring ≥ 2 px even at the extreme where
 * `amplitude` (80) exceeds `baseRadius` (40) at the wave trough — so no
 * vertex ever collapses to the origin or goes negative.
 *
 * `prepare` caches `POINTS`, the angular `step`, and `waveFreq`.
 * `draw` reads `baseRadius`, `spacing`, `amplitude`, `strokeWeight`,
 * `rotation` — all animated.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws —
 * phase is `rotation * DEG`, purely animated.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 27,
  name: 'Concentric Waves',
  role: 'secondary',
  blurb: 'Concentric rings rippling with a travelling wave.',
  worstCase: { pathOps: 600, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ringCount', 2, 12, { default: 5 }),
  A('baseRadius', 40, 400, { default: { min: 80, max: 240 } }),
  A('spacing', 20, 180, { default: { min: 48, max: 120 } }),
  A('amplitude', 0, 80, { default: { min: 0, max: 40 } }),
  S.int('waveFreq', 1, 8, { default: 3 }),
  A('strokeWeight', 1, 10, { default: { min: 1.5, max: 4 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/** Points per ring (§10.2: 12 × 50 = 600). */
const POINTS = 50

/**
 * @typedef {object} ConcentricWavesPrepared
 * @property {number} count
 * @property {number} step
 * @property {number} freq
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {ConcentricWavesPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  return {
    count: /** @type {number} */ (statics.ringCount),
    step: TWO_PI / POINTS,
    freq: /** @type {number} */ (statics.waveFreq),
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {ConcentricWavesPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const spacing = /** @type {number} */ (resolved.spacing)
  const amp = /** @type {number} */ (resolved.amplitude)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const { count, step, freq } = prepared

  ctx.translate(CX, CY)
  ctx.rotate(rot)

  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const rBase = base + i * spacing
    for (let p = 0; p < POINTS; p++) {
      const ang = p * step
      const r = Math.max(2, rBase + amp * Math.cos(freq * ang))
      const x = r * Math.cos(ang)
      const y = r * Math.sin(ang)
      if (p === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = weight
  ctx.lineJoin = 'round'
  ctx.stroke()
}