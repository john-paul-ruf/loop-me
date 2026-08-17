// @ts-check
/**
 * Layer type 44 — Rose Curve (FR-6, architecture §10.2 row 44).
 *
 * The polar rose `r = R·bloom·cos(kθ)` for a static integer petal count
 * `k` ∈ 2..9, sampled as a 720-point polyline over θ ∈ [0, 2π]. Loop
 * closure is intrinsic: `cos(k·2π) = cos(0) = 1` for any integer `k`, and
 * the animated `spin` carries `{ wrap: true }` (omni-wave S02 toolbox —
 * integer harmonics + wrapped phases). Sampling the full [0, 2π] window
 * closes both odd-`k` roses (which trace once, `k` petals) and even-`k`
 * roses (which trace once, `2k` petals) without special-casing.
 *
 * Inner echo: a second stroke at 0.6× scale — same base curve, no fresh
 * table — so the flower reads as concentric layers rather than a single
 * outline. Half alpha for depth, applied via `globalAlpha` (painter's
 * per-layer save/restore restores it, §6.4).
 *
 * Strategy per §10.2: two accumulated polylines on the ctx's own path (D1
 * template — §6.5 bans allocating a `Path2D` inside `draw`), one stroke
 * each. `prepare` caches the per-sample unit vectors and the radial
 * modulator `cos(kθ)`; draw multiplies them by the animated envelope.
 * Consumes exactly 1 rng draw in prepare (the `k` pick), regardless of
 * downstream frame count — FR-4.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 44,
  name: 'Rose Curve',
  role: 'primary',
  blurb: 'A polar rose blooming and spinning, with a concentric echo.',
  worstCase: { pathOps: 1450, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  // bloom.min > 0: at 0 the rose collapses to a point (r=0 everywhere) —
  // the FR-6 "renders nothing" AC failure mode designed out at declaration.
  A('bloom', 0.25, 1, { default: { min: 0.4, max: 0.9 } }),
  A('spin', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
]

const CX = 540
const CY = 960
/** Half-height, in canvas pixels — every rose fits `bloom · MAX_R` from centre. */
const MAX_R = 500
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/** Sample count per stroke — §10.2 path-ops budget. */
const N = 720
const K_MIN = 2
const K_MAX = 9
const ECHO_SCALE = 0.6

/**
 * @typedef {object} RoseCurvePrepared
 * @property {number} k
 * @property {Float64Array} rFactor  `cos(k·θ_i)`, θ_i = 2π·i/(N-1).
 * @property {Float64Array} cosTheta `cos(θ_i)`.
 * @property {Float64Array} sinTheta `sin(θ_i)`.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {RoseCurvePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  // FIXED draw count: exactly 1 rng value picks `k` in 2..9 — the same
  // seed reproduces the same rose across devices (FR-4).
  const k = K_MIN + Math.floor(rng() * (K_MAX - K_MIN + 1))

  const rFactor = new Float64Array(N)
  const cosTheta = new Float64Array(N)
  const sinTheta = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const theta = TWO_PI * (i / (N - 1))
    rFactor[i] = Math.cos(k * theta)
    cosTheta[i] = Math.cos(theta)
    sinTheta[i] = Math.sin(theta)
  }
  return { k, rFactor, cosTheta, sinTheta, color: /** @type {string} */ (statics.color) }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {RoseCurvePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const bloom = /** @type {number} */ (resolved.bloom)
  const spin = /** @type {number} */ (resolved.spin) * DEG
  const { rFactor, cosTheta, sinTheta } = prepared
  const scale = MAX_R * bloom

  ctx.translate(CX, CY)
  ctx.rotate(spin)
  ctx.strokeStyle = prepared.color
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Main petals: `r = scale · cos(kθ)` → (r·cosθ, r·sinθ). r can go
  // negative — the polyline visits the antipodal point, which for a rose
  // is another petal, not a rendering bug.
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const r = scale * rFactor[i]
    const x = r * cosTheta[i]
    const y = r * sinTheta[i]
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Inner echo at 0.6 scale, half alpha for depth. Same table, no fresh
  // trig. globalAlpha is restored by the painter's per-layer restore.
  const inner = scale * ECHO_SCALE
  ctx.globalAlpha *= 0.5
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const r = inner * rFactor[i]
    const x = r * cosTheta[i]
    const y = r * sinTheta[i]
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}
