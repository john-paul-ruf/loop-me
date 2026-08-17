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
 *
 * **per-effect-glow (feature per-effect-glow, FR-6 additive AC).** When
 * `glowStrength > 0`, `draw` re-runs the per-ring stroke loop once BEFORE
 * the crisp loop under `globalCompositeOperation = 'lighter'` at each ring's
 * `lineWidth × K_GLOW` — the wide-additive-re-stroke archetype (see
 * `src/util/glow.js` and the `pulse-rings.js` reference). Both passes share
 * the alternating per-ring rotation sign (deterministic from `rot` and ring
 * index), so the halo aligns with the crisp ring under every animated `rot`
 * value including the wrap boundary. No `shadowBlur` (FR-6). `glowStrength`
 * is appended LAST with default `{min:0,max:0}` (§9.2/§9.5): pre-glow seeds
 * decode to `gs === 0`, which is a hard no-op → byte-identical render.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 47,
  name: 'Superellipse Stack',
  role: 'primary',
  blurb: 'Concentric superellipses morphing between circle and square.',
  // Worst case doubles under the glow pass: each ring's path built twice
  // (2920 pathOps), 16 total strokes (8 halo + 8 crisp).
  worstCase: { pathOps: 2920, drawCalls: 16 },
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
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
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
 * Halo width multiplier — 2.5 mirrors `pulse-rings.js`. Inner rings decay
 * per `RING_DECAY^ring`, so their halos scale proportionally and stay
 * inside their ring's crisp footprint band.
 */
const K_GLOW = 2.5

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
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { rings, cosT, sinT } = prepared
  const exp = 2 / p

  ctx.translate(CX, CY)
  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Glow pass — drawn FIRST so the crisp rings sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow
  // output. Mirrors the crisp per-ring loop (same rotation sign, same N
  // samples) at `lineWidth × K_GLOW`. See `src/util/glow.js` for the
  // canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    for (let ring = 0; ring < rings; ring++) {
      const r = scale * Math.pow(RING_DECAY, ring)
      const rr = ring % 2 === 0 ? rot : -rot
      ctx.save()
      ctx.rotate(rr)
      ctx.lineWidth = Math.max(1, 2.5 * Math.pow(RING_DECAY, ring)) * K_GLOW
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
    ctx.restore()
  }

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
