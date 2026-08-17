// @ts-check
/**
 * Layer type 43 — Lissajous Weave (FR-6, architecture §10.2 row 43).
 *
 * Two overlaid Lissajous curves at `(size·sin(a·2πt + δ), size·sin(b·2πt))`,
 * sampled as a 720-point polyline over `t ∈ [0, 1]`. The static frequency
 * integers `a`, `b` are drawn from a prepare-time table biased away from
 * `a === b` (a === b degenerates to a segment, which reads as "renders
 * nothing" against the FR-6 AC even at max bounds). Loop closure is
 * intrinsic: at integer `a`, `b` the last sample coincides with the first,
 * and the animated `δ` phase carries `{ wrap: true }` (omni-wave S02
 * toolbox — integer harmonics + wrapped phases).
 *
 * Two strokes: the base at `δ`, and a half-alpha weave at `δ + 90°` — the
 * quadrature phase turns the single curve into an interlaced pair without
 * doubling the sample budget. Both strokes share the prepared
 * `sinA/cosA/sinB` tables; the second stroke reuses them via the identity
 * `sin(x + π/2) = cos(x)`, `cos(x + π/2) = -sin(x)`.
 *
 * Strategy per §10.2: two accumulated polylines on the ctx's own path (D1
 * template — §6.5 bans allocating a `Path2D` inside `draw`), one stroke
 * each. Consumes exactly 2 rng draws in prepare, regardless of subsequent
 * frequency chosen — the FR-4 cross-device draw-count contract.
 *
 * Imports `model/params.js` only (§4 rule 2).
 *
 * **per-effect-glow (feature per-effect-glow, FR-6 additive AC).** When
 * `glowStrength > 0`, `draw` re-runs BOTH weave passes (base at δ and
 * quadrature at δ + 90°) once BEFORE the crisp strokes under
 * `globalCompositeOperation = 'lighter'` at `lineWidth × K_GLOW` — the
 * wide-additive-re-stroke archetype (see `src/util/glow.js` and the
 * `pulse-rings.js` reference). Both halos consume the same `(cd, sd)` phase
 * and the same sinA/cosA/sinB tables as the crisp passes, so they close at
 * the same integer-harmonic wrap boundary — no seam. The quadrature halo
 * mirrors the crisp 0.5× alpha factor. No `shadowBlur` (FR-6). `glowStrength`
 * is appended LAST with default `{min:0,max:0}` (§9.2/§9.5): pre-glow seeds
 * decode to `gs === 0`, which is a hard no-op → byte-identical render.
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 43,
  name: 'Lissajous Weave',
  role: 'primary',
  blurb: 'Two overlaid Lissajous curves weaving in quadrature.',
  // Worst case doubles under the glow pass: 2 curves built twice (2900
  // pathOps), 4 strokes total (2 halo + 2 crisp).
  worstCase: { pathOps: 2900, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  // size.min > 0: the sweep at `min` bounds must still paint a visible
  // curve (0.18 × 1080 ≈ 194 px half-amplitude), never a null figure.
  A('size', 0.18, 0.42, { default: { min: 0.22, max: 0.35 } }),
  A('delta', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const BASE = 1080  // min(WIDTH, HEIGHT) — every "size" is a fraction of it.
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/** Sample count per stroke — §10.2 path-ops budget. */
const N = 720
const A_MIN = 1
const A_MAX = 7
/**
 * Halo width multiplier — 2.5 mirrors `pulse-rings.js`. Crisp `lineWidth`
 * is 2, so the halo is 5 px — wide enough to read as a bloom around each
 * interlaced weave strand without smearing the two strands together.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} LissajousWeavePrepared
 * @property {number} a
 * @property {number} b
 * @property {Float64Array} sinA  Per-sample `sin(a·2π·t_i)`.
 * @property {Float64Array} cosA  Per-sample `cos(a·2π·t_i)`.
 * @property {Float64Array} sinB  Per-sample `sin(b·2π·t_i)`.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {LissajousWeavePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  // Prepare-time frequency table: two rng draws pick `a` and `b` in 1..7,
  // then bias off the diagonal — `a === b` collapses the curve to a line
  // segment through the origin, which the FR-6 sweep would flag as "hides
  // nothing at max bounds" and, more importantly, reads as a null figure
  // to the eye. FIXED draw count: exactly 2 rng values consumed regardless.
  const range = A_MAX - A_MIN + 1
  const a = A_MIN + Math.floor(rng() * range)
  let b = A_MIN + Math.floor(rng() * range)
  if (b === a) b = A_MIN + ((b - A_MIN + 1) % range)  // ring shift, still 1..7

  const sinA = new Float64Array(N)
  const cosA = new Float64Array(N)
  const sinB = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const ang = TWO_PI * t
    sinA[i] = Math.sin(a * ang)
    cosA[i] = Math.cos(a * ang)
    sinB[i] = Math.sin(b * ang)
  }
  return { a, b, sinA, cosA, sinB, color: /** @type {string} */ (statics.color) }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {LissajousWeavePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const size = /** @type {number} */ (resolved.size) * BASE
  const delta = /** @type {number} */ (resolved.delta) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { sinA, cosA, sinB } = prepared
  const cd = Math.cos(delta)
  const sd = Math.sin(delta)

  ctx.translate(CX, CY)
  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Glow pass — drawn FIRST so the crisp weaves sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow
  // output. Both halos use the same (cd, sd) and same tables as the crisp
  // passes — same integer-harmonic wrap boundary, no seam. See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 2 * K_GLOW
    // Base weave halo — envelope alpha × gs.
    ctx.globalAlpha = a0 * gs
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const x = size * (sinA[i] * cd + cosA[i] * sd)
      const y = size * sinB[i]
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    // Quadrature weave halo — mirrors the crisp 0.5× alpha factor.
    ctx.globalAlpha = a0 * gs * 0.5
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const x = size * (sinA[i] * (-sd) + cosA[i] * cd)
      const y = size * sinB[i]
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }

  ctx.lineWidth = 2

  // Stroke 1 — base curve at phase δ:
  //   x = size · sin(a·2πt + δ) = size · (sinA·cosδ + cosA·sinδ)
  //   y = size · sin(b·2πt)     = size · sinB
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const x = size * (sinA[i] * cd + cosA[i] * sd)
    const y = size * sinB[i]
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Stroke 2 — quadrature weave at δ + 90°. sin(x + π/2) = cos(x),
  // cos(x + π/2) = -sin(x), so the extra rotation collapses to swapping
  // cd/sd with (-sd, cd) — no fresh trig, no fresh tables. Half alpha via
  // globalAlpha; the painter's per-layer save/restore restores it (§6.4).
  ctx.globalAlpha *= 0.5
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const x = size * (sinA[i] * (-sd) + cosA[i] * cd)
    const y = size * sinB[i]
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}
