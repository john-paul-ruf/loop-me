// @ts-check
/**
 * Layer type 47 — Superellipse Stack (FR-6, architecture §10.2 row 47).
 *
 * `rings` concentric superellipses (Lamé curves) with exponent `p`
 * animated 1.4..6:
 *   `x = a·sgn(cos θ)·|cos θ|^(2/p)`
 *   `y = b·sgn(sin θ)·|sin θ|^(2/p)`
 * At p = 2 the ring is a plain circle; p → ∞ trends toward a square; p
 * below 2 is a pinched astroid. Sampling 180 points over θ ∈ [0, 2π]
 * closes each ring intrinsically (both sgn|cos|^e and sgn|sin|^e are 2π
 * periodic, and the trivial first sample at θ = 0 coincides with the
 * θ = 2π sample). The animated `rot` carries `{ wrap: true }` — omni-wave
 * S02 toolbox — and alternates sign per ring so adjacent rings rotate
 * counter-directions, breaking a stack that would otherwise turn as one.
 *
 * Ring i sits at geometric scale `RING_DECAY^i` of `scale · BASE`, so
 * rings compress inward without ever colliding. Each ring is its own
 * stroke; `worstCase.drawCalls` = 8 (max `rings`).
 *
 * Strategy per §10.2: `rings` accumulated polylines on the ctx's own path
 * (D1 template — §6.5 bans allocating a `Path2D` inside `draw`), one
 * stroke per ring. `prepare` caches the per-sample θ trigonometry (`cosT`
 * and `sinT`); `draw` folds in `p` via `Math.pow(|cos θ|, 2/p)` because
 * the exponent is animated. Consumes zero rng draws — the stack is fully
 * deterministic from its statics.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 47,
  name: 'Superellipse Stack',
  role: 'primary',
  blurb: 'Concentric superellipses morphing between circle and square.',
  worstCase: { pathOps: 1460, drawCalls: 8 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('rings', 3, 8, { default: 5 }),
  // exponent.min > 0: p = 1.4 gives a pinched astroid, still clearly a
  // closed curve; p = 6 is nearly a squircle. Never a null figure.
  A('exponent', 1.4, 6, { default: { min: 2, max: 4 } }),
  A('rot', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // scale.min > 0: 0.16 × 1080 ≈ 173 px outer radius — visible even at
  // the min sweep bound.
  A('scale', 0.16, 0.4, { default: { min: 0.22, max: 0.34 } }),
]

const CX = 540
const CY = 960
const BASE = 1080  // min(WIDTH, HEIGHT) — every scale is a fraction of it.
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/** Samples per ring — §10.2 path-ops budget (8 rings × 180 ≈ 1460). */
const N = 180
const RING_DECAY = 0.78

/**
 * @typedef {object} SuperellipseStackPrepared
 * @property {number} rings
 * @property {Float64Array} cosT  Per-sample cos(θ_i), θ_i = 2π·i/N.
 * @property {Float64Array} sinT  Per-sample sin(θ_i).
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SuperellipseStackPrepared}
 */
export function prepare(statics, palette, rng) {
  void rng
  void palette
  const rings = /** @type {number} */ (statics.rings)
  const cosT = new Float64Array(N)
  const sinT = new Float64Array(N)
  // Sample θ ∈ [0, 2π) with N intervals — i = 0 IS the closing sample
  // (i · 2π/N at i = N wraps back to 0), so the polyline is closed by the
  // explicit closePath() in draw rather than a duplicated last vertex.
  for (let i = 0; i < N; i++) {
    const theta = TWO_PI * (i / N)
    cosT[i] = Math.cos(theta)
    sinT[i] = Math.sin(theta)
  }
  return { rings, cosT, sinT, color: /** @type {string} */ (statics.color) }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SuperellipseStackPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const p = /** @type {number} */ (resolved.exponent)
  const rot = /** @type {number} */ (resolved.rot) * DEG
  const scale = /** @type {number} */ (resolved.scale) * BASE
  const { rings, cosT, sinT } = prepared
  const exp = 2 / p

  ctx.translate(CX, CY)
  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // One stroke per ring — up to `rings` (8) draw calls.
  for (let ring = 0; ring < rings; ring++) {
    const r = scale * Math.pow(RING_DECAY, ring)
    // Alternate rotation sign per ring (§ omni-wave S02 note) — even
    // rings turn one way, odd rings the other, so the stack never
    // rotates as a rigid group.
    const rr = ring % 2 === 0 ? rot : -rot
    ctx.save()
    ctx.rotate(rr)
    ctx.lineWidth = Math.max(1, 2.5 * Math.pow(RING_DECAY, ring))
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const c = cosT[i]
      const s = sinT[i]
      const x = r * (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), exp)
      const y = r * (s < 0 ? -1 : 1) * Math.pow(Math.abs(s), exp)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
  }
}
