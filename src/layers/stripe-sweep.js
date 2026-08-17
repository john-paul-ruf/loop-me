// @ts-check
/**
 * Layer type 32 — Stripe Sweep (FR-6, architecture §10.2 row 32).
 *
 * Diagonal stripes drawn as a `CanvasPattern` tile (one stripe + one
 * gap, like scan-lines but rotated by a `stripeAngle`), swept across the
 * frame by an animated translate. `opacity` composes with the envelope
 * alpha (Flag 4 posture).
 *
 * Never opaque: `gap ≥ 4` always leaves at least 4 px of uncovered rows
 * between stripes, and `opacity ≤ 0.55` means even at the maximum the
 * painted stripe contributes at most 55% alpha over whatever's beneath —
 * never opaque. The pattern covers the canvas so coverage is total; a
 * pattern fill at any opacity > 0 leaves visible stripes (never blank,
 * vacuously for an overlay).
 *
 * Strategy per §10.2: one pattern fill of a full-canvas rect (one path
 * op, one draw call), exactly like scan-lines and grain. The stripe tile
 * is built once in `prepare` (horizontal stripe through the top of a
 * `side × side` tile); `draw` applies the animated `stripeAngle` as a
 * `ctx.rotate` before the pattern fill, and translates by `driftX`/`driftY`
 * to sweep. Consumes zero PRNG draws.
 *
 * **per-effect-glow — nominal fit (residual gap).** Stripe Sweep is a
 * *texture* overlay, not a mark: additive glow on a repeating stripe pattern
 * is weak — brightening the stripe's own colour just saturates the stripes
 * rather than radiating light. When `glowStrength > 0`, `draw` re-blits the
 * SAME cached stripe pattern under `globalCompositeOperation = 'lighter'` at
 * `envelope × opacity × gs × NOMINAL_K` — a subtle brighten of the stripes,
 * no new tile allocated, same rotation/drift transforms. The param is
 * declared for catalog consistency (S08's "every non-glitch layer glows"
 * gate). FR-6 AC: NO `shadowBlur`; §6.5: no per-frame allocation. `gs === 0`
 * is a hard no-op ⇒ byte-identical pre-glow output (architecture §9.5). See
 * `src/util/glow.js` for the canonical idiom and the `glowStrength` param
 * convention.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 32,
  name: 'Stripe Sweep',
  role: 'overlay',
  blurb: 'Diagonal stripes sweeping across the frame.',
  // Worst case doubles under the glow pass: one extra pattern `fillRect`
  // under 'lighter' (halo re-blit of the same tile at low alpha).
  worstCase: { pathOps: 2, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('stripeWidth', 4, 80, { default: 20 }),
  S.int('gap', 4, 80, { default: 20 }),
  A('stripeAngle', 0, 90, { unit: '°', default: { min: 0, max: 45 } }),
  A('driftX', 0, 600, { default: { min: 0, max: 300 } }),
  A('driftY', 0, 600, { default: { min: 0, max: 400 } }),
  A('opacity', 0.02, 0.55, { default: { min: 0.1, max: 0.3 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const DIAG = Math.hypot(1080, 1920)
/**
 * Nominal glow strength for the texture halo re-blit. Stripe Sweep is a
 * texture pattern (stripe + gap), not a mark — a strong additive re-blit
 * would blow out the stripes rather than "glow" them. 0.4× keeps the halo
 * subtle: at `gs=1` the glow adds ≤ 40% of the crisp stripe brightness,
 * enough to register (S01's tolerant glow suite) without saturating into a
 * wash. Same tuning idea as `scan-lines.js` and `grain.js`.
 */
const NOMINAL_K = 0.4

/**
 * @typedef {object} StripeSweepPrepared
 * @property {CanvasPattern} pattern  One horizontal stripe + gap, repeating.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {StripeSweepPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const stripeWidth = /** @type {number} */ (statics.stripeWidth)
  const gap = /** @type {number} */ (statics.gap)
  const side = stripeWidth + gap
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)

  const tile = scratch(side, side)
  const tctx = /** @type {CanvasRenderingContext2D} */ (tile.getContext('2d'))
  tctx.fillStyle = /** @type {string} */ (statics.color)
  tctx.fillRect(0, 0, side, stripeWidth)
  const pattern = /** @type {CanvasPattern} */ (tctx.createPattern(tile, 'repeat'))
  return { pattern }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {StripeSweepPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const angle = /** @type {number} */ (resolved.stripeAngle) * DEG
  const driftX = /** @type {number} */ (resolved.driftX)
  const driftY = /** @type {number} */ (resolved.driftY)
  const opacity = /** @type {number} */ (resolved.opacity)
  const gs = /** @type {number} */ (resolved.glowStrength)

  // ±DIAG/2 + margin covers the canvas at any rotation up to 90° and drift ≤ 600.
  const HALF = DIAG / 2 + Math.max(driftX, driftY)

  // Glow pass — subtle additive re-blit of the same cached stripe pattern
  // (nominal fit; see the file header for the residual-gap note). Save/restore
  // fences the transform, blend op, alpha, and fillStyle so the crisp pass
  // below runs against the exact same ctx state as pre-glow. `gs === 0` is a
  // hard no-op ⇒ byte-identical pre-glow output.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * opacity * gs * NOMINAL_K
    ctx.translate(CX, CY)
    ctx.rotate(angle)
    ctx.translate(-CX + driftX, -CY + driftY)
    ctx.fillStyle = prepared.pattern
    ctx.fillRect(CX - HALF, CY - HALF, HALF * 2, HALF * 2)
    ctx.restore()
  }

  // Flag 4 posture: the layer's `opacity` COMPOSES with the envelope alpha.
  ctx.globalAlpha = ctx.globalAlpha * opacity
  ctx.translate(CX, CY)
  ctx.rotate(angle)
  ctx.translate(-CX + driftX, -CY + driftY)
  ctx.fillStyle = prepared.pattern
  ctx.fillRect(CX - HALF, CY - HALF, HALF * 2, HALF * 2)
}