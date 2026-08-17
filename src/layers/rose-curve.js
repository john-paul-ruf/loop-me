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
 *
 * **per-effect-glow (feature per-effect-glow, FR-6 additive AC).** When
 * `glowStrength > 0`, `draw` re-runs BOTH polylines (main + echo) once
 * BEFORE the crisp strokes under `globalCompositeOperation = 'lighter'` at
 * `lineWidth × K_GLOW` — wide-additive-re-stroke archetype (see
 * `src/util/glow.js`). The halo traces the SAME 720-sample table over the
 * same θ ∈ [0, 2π], so it closes at the same wrap point as the crisp curve —
 * no seam at the loop boundary. The echo halo mirrors the crisp 0.5×
 * alpha factor. No `shadowBlur` (FR-6). `glowStrength` is appended LAST
 * with default `{min:0,max:0}` (§9.2/§9.5): pre-glow seeds decode to
 * `gs === 0`, which is a hard no-op → byte-identical render.
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 44,
  name: 'Rose Curve',
  role: 'primary',
  blurb: 'A polar rose blooming and spinning, with a concentric echo.',
  // Worst case doubles under the glow pass: 2 curves built twice (2900
  // pathOps), 4 strokes total (2 halo + 2 crisp).
  worstCase: { pathOps: 2900, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  // bloom.min > 0: at 0 the rose collapses to a point (r=0 everywhere) —
  // the FR-6 "renders nothing" AC failure mode designed out at declaration.
  A('bloom', 0.25, 1, { default: { min: 0.4, max: 0.9 } }),
  A('spin', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
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
 * Halo width multiplier for the glow re-stroke. 2.5 mirrors `pulse-rings.js`
 * — clearly wider than the crisp `lineWidth = 2` (halo = 5 px) so the halo
 * reads as a distinct outer bloom without swallowing petal detail.
 */
const K_GLOW = 2.5

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
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { rFactor, cosTheta, sinTheta } = prepared
  const scale = MAX_R * bloom
  const inner = scale * ECHO_SCALE

  ctx.translate(CX, CY)
  ctx.rotate(spin)
  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Glow pass — drawn FIRST so the crisp curves sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow
  // output. Both halo passes trace the SAME 720-sample table over the same
  // θ ∈ [0, 2π] as the crisp curves — no seam at the loop wrap. See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 2 * K_GLOW
    // Main petal halo — envelope alpha × gs.
    ctx.globalAlpha = a0 * gs
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const r = scale * rFactor[i]
      const x = r * cosTheta[i]
      const y = r * sinTheta[i]
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    // Inner echo halo — mirrors the crisp 0.5× alpha for depth.
    ctx.globalAlpha = a0 * gs * 0.5
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const r = inner * rFactor[i]
      const x = r * cosTheta[i]
      const y = r * sinTheta[i]
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }

  ctx.lineWidth = 2

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
