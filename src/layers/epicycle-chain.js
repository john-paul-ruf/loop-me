// @ts-check
/**
 * Layer type 45 — Epicycle Chain (FR-6, architecture §10.2 row 45).
 *
 * A tiny Fourier machine: `arms` circles chained tip-to-base, each with a
 * geometric radius `r_i = R_DECAY^i` and an integer angular speed
 * `k_i ∈ {-5..5} \ {0}`. The traced sum-path is
 * `Σ_i r_i · (cos(k_i·2π·t + spread_i), sin(k_i·2π·t + spread_i))`,
 * sampled 720 times over `t ∈ [0, 1]`. Loop closure is intrinsic: every
 * `k_i` is an integer, so at `t = 1` every arm has completed an integer
 * number of turns and the last sample coincides with the first (omni-wave
 * S02 toolbox — integer harmonics). The traced curve is *static* — same
 * pixels every frame — and the animated `phase` moves an arm-chain
 * overlay around it, showing which point on the sum-path is "now".
 * `phase` carries `{ wrap: true }` to sweep through the loop without
 * discontinuity.
 *
 * Strategy per §10.2: three draw calls — sum-path stroke, chain stroke,
 * pivot dots fill. `prepare` mints a FIXED-COUNT table (`MAX_ARMS` entries
 * even when only `arms` are used) so seed replay is bit-identical across
 * `arms` choices — FR-4 cross-device draw-count contract, block-static
 * precedent. Consumes exactly 10 rng draws in prepare (2 per potential
 * arm), always. All per-frame arrays (`pivotX/Y`) live on the prepared
 * cache so `draw` allocates nothing (§6.5).
 *
 * **per-effect-glow — wide re-stroke of the closed sum-path (pulse-rings
 * archetype).** The sum-path IS the primary shape — the traced Fourier
 * curve; the chain + pivots are ephemeral overlays showing where the
 * machine is "now". Glow lives under the sum-path only: same polyline
 * accumulated once on the ctx path (§6.5, no rebuild), stroked wide+
 * `'lighter'` first as the halo, then crisp on top. Loop closure is
 * preserved because both strokes trace the same integer-harmonic samples.
 * `gs === 0` is a hard no-op — pre-glow seeds render byte-identical
 * (§9.5). FR-6 AC: NO `shadowBlur`. See `src/util/glow.js` for the
 * canonical draw-time idiom and the `glowStrength` param convention.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 45,
  name: 'Epicycle Chain',
  role: 'primary',
  blurb: 'A Fourier chain tracing its own closed sum-path.',
  // Worst case adds one wide re-stroke of the 720-sample sum-path: pathOps
  // unchanged (path built once, stroked twice), drawCalls 3 → 4.
  worstCase: { pathOps: 740, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('arms', 3, 5, { default: 4 }),
  // scale.min > 0: at 0 all radii collapse to zero, the curve to a point.
  // 0.15 × 1080 ≈ 162 px base radius — always visible under the sweep.
  A('scale', 0.15, 0.35, { default: { min: 0.18, max: 0.3 } }),
  A('phase', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const BASE = 1080  // min(WIDTH, HEIGHT) — scale is a fraction of it.
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/** Sample count for the sum-path — §10.2 path-ops budget. */
const N = 720
/** Fixed table width — always this many entries, `arms` selects a prefix. */
const MAX_ARMS = 5
const R_DECAY = 0.55
const SPEED_MIN = -5
const SPEED_MAX = 5
const TIP_DOT_R = 8
const CHAIN_ALPHA = 0.4
const TIP_ALPHA = 0.85
/**
 * Halo width multiplier for the wide re-stroke of the sum-path. Matches
 * pulse-rings' 2.5× — clearly wider than the crisp 2.5px stroke at every
 * `scale`, without swamping the traced curve's finer harmonics.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} EpicycleChainPrepared
 * @property {number} arms
 * @property {Float64Array} radii   `MAX_ARMS` normalized radii — `R_DECAY^i`.
 * @property {Int8Array}   speeds   `MAX_ARMS` integer speeds, non-zero.
 * @property {Float64Array} spread  `MAX_ARMS` per-arm initial phase offsets, radians.
 * @property {Float64Array} sumX    Per-sample base sum-path x, unit radius.
 * @property {Float64Array} sumY    Per-sample base sum-path y, unit radius.
 * @property {Float64Array} pivotX  Preallocated `arms + 1` slots — pivot x per frame (unit).
 * @property {Float64Array} pivotY  Same, y.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {EpicycleChainPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const arms = /** @type {number} */ (statics.arms)

  // FIXED draw count: fill `MAX_ARMS` entries regardless of `arms` so the
  // seed stream position is stable across compositions (FR-4). Two rng()
  // draws per entry → 10 total.
  const radii = new Float64Array(MAX_ARMS)
  const speeds = new Int8Array(MAX_ARMS)
  const spread = new Float64Array(MAX_ARMS)
  for (let i = 0; i < MAX_ARMS; i++) {
    radii[i] = Math.pow(R_DECAY, i)
    // Speed range is `[SPEED_MIN..SPEED_MAX] \ {0}` — 10 values. Pick from
    // an 11-wide window and remap the zero to `SPEED_MAX` so no draw is
    // wasted (a re-draw would break the fixed-count contract).
    const raw = SPEED_MIN + Math.floor(rng() * (SPEED_MAX - SPEED_MIN + 1))
    speeds[i] = raw === 0 ? SPEED_MAX : raw
    spread[i] = rng() * TWO_PI
  }

  // Sum-path base at unit radius. Baked once — the whole traced curve is
  // static (only `scale` rescales it uniformly), so precomputing here
  // saves N × arms trig ops per frame.
  const sumX = new Float64Array(N)
  const sumY = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const twoPiT = TWO_PI * (i / (N - 1))
    let x = 0
    let y = 0
    for (let j = 0; j < arms; j++) {
      const a = speeds[j] * twoPiT + spread[j]
      x += radii[j] * Math.cos(a)
      y += radii[j] * Math.sin(a)
    }
    sumX[i] = x
    sumY[i] = y
  }

  return {
    arms,
    radii,
    speeds,
    spread,
    sumX,
    sumY,
    // Preallocated (§6.5) — reused every frame by the chain overlay.
    pivotX: new Float64Array(arms + 1),
    pivotY: new Float64Array(arms + 1),
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {EpicycleChainPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const scale = /** @type {number} */ (resolved.scale) * BASE
  const phaseRad = /** @type {number} */ (resolved.phase) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { arms, radii, speeds, spread, sumX, sumY, pivotX, pivotY } = prepared

  ctx.translate(CX, CY)
  ctx.strokeStyle = prepared.color
  ctx.fillStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Accumulate the sum-path once — `lineWidth` differs between glow and
  // crisp, but the path samples are identical (loop-closed integer harmonics
  // preserved under both strokes).
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const x = scale * sumX[i]
    const y = scale * sumY[i]
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }

  // Glow pass — wide re-stroke first, halo under the crisp sum-path. Only
  // the primary shape (sum-path) glows; the chain + pivots are ephemeral
  // "now" markers, not marks. `gs === 0` is a hard no-op. See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = 2.5 * K_GLOW
    ctx.stroke()
    ctx.restore()
    // `strokeStyle`/`lineJoin`/`lineCap` survive `restore()` — set before `save()`.
  }

  // Draw 1 — the static traced sum-path. Same pixels every frame.
  ctx.lineWidth = 2.5
  ctx.stroke()

  // Compute the arm chain's current pivots at `phase`. `phase` is a
  // time-like sweep: at `phase` radians the machine is at the point on
  // the sum-path corresponding to `t = phase / (2π)`.
  pivotX[0] = 0
  pivotY[0] = 0
  let cx = 0
  let cy = 0
  for (let j = 0; j < arms; j++) {
    const a = speeds[j] * phaseRad + spread[j]
    cx += radii[j] * Math.cos(a)
    cy += radii[j] * Math.sin(a)
    pivotX[j + 1] = scale * cx
    pivotY[j + 1] = scale * cy
  }

  // Draw 2 — faint arm chain: one polyline from centre through every
  // pivot to the tip. The tip rides the sum-path exactly.
  ctx.globalAlpha *= CHAIN_ALPHA
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (let j = 1; j <= arms; j++) ctx.lineTo(pivotX[j], pivotY[j])
  ctx.stroke()

  // Draw 3 — solid dots at every pivot including the tip, one filled
  // path. Alpha bumped from the faint chain up to `TIP_ALPHA` of envelope,
  // so the tips read as anchors above the trailing chain.
  ctx.globalAlpha = (ctx.globalAlpha / CHAIN_ALPHA) * TIP_ALPHA
  ctx.beginPath()
  for (let j = 0; j <= arms; j++) {
    ctx.moveTo(pivotX[j] + TIP_DOT_R, pivotY[j])
    ctx.arc(pivotX[j], pivotY[j], TIP_DOT_R, 0, TWO_PI)
  }
  ctx.fill()
}
