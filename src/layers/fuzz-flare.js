// @ts-check
/**
 * Layer type 13 — Fuzz Flare (FR-6, architecture §10.2 row 13).
 *
 * Soft radial glow bursts. **No `shadowBlur` anywhere** (FR-6 AC) — the glow
 * is one cached unit-radius `CanvasGradient`, minted once in `prepare` against
 * a scratch context and re-drawn per burst under a transform whose scale is
 * the animated `radius`. That squares §10.2's "cached gradient per burst"
 * with §6.5's ban on gradient creation in `draw` even though `radius`
 * animates: geometry lives in the transform, not in the gradient.
 *
 * Burst positions derive from the layer PRNG, bounded so every centre stays
 * ≥ 100 px inside the canvas at every `spread` value (the orbit-dots anchor
 * lesson): with `radius` ≥ 100 and size multiplier ≥ 0.6, no bound
 * combination can render nothing (FR-6 AC). `intensity` multiplies the
 * painter's globalAlpha, so it composes with — never overwrites — the
 * envelope opacity.
 *
 * **PRNG consumption order (FR-4, binding):** per burst ascending —
 * x draw, y draw, size-multiplier draw. 3 × burstCount draws, nothing else.
 *
 * **per-effect-glow reference — the animate-existing-glow archetype.**
 *
 * Fuzz Flare's whole point IS additive glow — the layer was self-glowing
 * before the feature landed. So the standard `glowStrength` envelope hooks
 * into the existing `ctx.globalAlpha × intensity` multiplication instead of
 * gaining a second additive pass: `α ← α × intensity × glowStrength`. Draw
 * calls, path ops, and blend op are unchanged; `worstCase` stays `[8, 8]`.
 *
 * **The `{min:1,max:1}` default exception (SESSION-01 Design Decision).**
 * The append-only backward-compat contract requires every pre-glow seed to
 * render byte-identical after this feature. For every OTHER glowing layer
 * that means default `{min:0,max:0}` (glow off ⇒ pre-glow output). For Fuzz
 * Flare the pre-glow output already WAS the glow: intensity alone drove it.
 * Multiplying by a new param defaulting to 0 would blank every pre-glow
 * seed. So Fuzz Flare's `glowStrength` defaults to `{min:1,max:1}` — the
 * multiplicative identity for its `α × intensity × 1` — and animated
 * modulation is what the new param adds. This is the only glowing layer
 * whose glow default is 1, not 0; S08's "every non-glitch layer glows"
 * gate enforces the exception by ID.
 */

import { A, S } from '../model/params.js'
import { range } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 13,
  name: 'Fuzz Flare',
  role: 'overlay',
  blurb: 'Soft glow bursts drifting over everything beneath.',
  // Unchanged — `glowStrength` folds into the existing alpha multiplication,
  // adding zero draw calls and zero path ops.
  worstCase: { pathOps: 8, drawCalls: 8 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('burstCount', 1, 8, { default: 3 }),
  A('radius', 100, 900, { default: { min: 200, max: 480 } }),
  A('intensity', 0.05, 1.0, { default: { min: 0.3, max: 0.7 } }),
  S.num('spread', 0, 1, { default: 0.6 }),
  // Appended LAST — feature per-effect-glow. Default `{min:1,max:1}` is the
  // documented exception (see the file header): pre-glow Fuzz Flare *was* the
  // glow, so its neutral (byte-identical) value is 1, not 0. `α × intensity ×
  // 1` reproduces the pre-glow frame exactly; animating the range adds the
  // new modulation on top of the existing intensity envelope.
  A('glowStrength', 0, 1, { default: { min: 1, max: 1 } }),
]

const CX = 540
const CY = 960
/** Max centre offsets: keeps every burst centre ≥ 100 px inside the canvas. */
const SPREAD_X = 440
const SPREAD_Y = 860

/**
 * @typedef {object} FuzzFlarePrepared
 * @property {number} bursts
 * @property {CanvasGradient} glow  Unit-radius radial gradient, colour → transparent.
 * @property {Float64Array} bx      Per-burst centre x.
 * @property {Float64Array} by      Per-burst centre y.
 * @property {Float64Array} mult    Per-burst radius multiplier, 0.6–1.0.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {FuzzFlarePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const bursts = /** @type {number} */ (statics.burstCount)
  const spread = /** @type {number} */ (statics.spread)
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)

  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  const sctx = /** @type {CanvasRenderingContext2D} */ (scratch(1, 1).getContext('2d'))
  const glow = sctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  glow.addColorStop(0, `rgba(${r},${g},${b},1)`)
  glow.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`)
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`)

  const bx = new Float64Array(bursts)
  const by = new Float64Array(bursts)
  const mult = new Float64Array(bursts)
  for (let i = 0; i < bursts; i++) {
    bx[i] = CX + (rng() * 2 - 1) * spread * SPREAD_X
    by[i] = CY + (rng() * 2 - 1) * spread * SPREAD_Y
    mult[i] = range(rng, 0.6, 1.0)
  }
  return { bursts, glow, bx, by, mult }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {FuzzFlarePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const radius = /** @type {number} */ (resolved.radius)
  const intensity = /** @type {number} */ (resolved.intensity)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { bursts, glow, bx, by, mult } = prepared

  // Composes with the envelope alpha the painter already set (Flag 4 posture).
  // `glowStrength` (per-effect-glow) folds into the same multiplication rather
  // than adding a second additive pass — pre-glow output already IS the glow;
  // see the file header for why the default is `{min:1,max:1}`.
  ctx.globalAlpha = ctx.globalAlpha * intensity * gs
  ctx.fillStyle = glow
  for (let i = 0; i < bursts; i++) {
    const s = radius * mult[i]
    // Absolute transform: the painter's per-layer restore resets it.
    ctx.setTransform(s, 0, 0, s, bx[i], by[i])
    ctx.fillRect(-1, -1, 2, 2)
  }
}
