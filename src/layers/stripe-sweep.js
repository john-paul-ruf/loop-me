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
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 32,
  name: 'Stripe Sweep',
  role: 'overlay',
  blurb: 'Diagonal stripes sweeping across the frame.',
  worstCase: { pathOps: 1, drawCalls: 1 },
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
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const DIAG = Math.hypot(1080, 1920)

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

  // Flag 4 posture: the layer's `opacity` COMPOSES with the envelope alpha.
  ctx.globalAlpha = ctx.globalAlpha * opacity
  ctx.translate(CX, CY)
  ctx.rotate(angle)
  ctx.translate(-CX + driftX, -CY + driftY)
  ctx.fillStyle = prepared.pattern
  // ±DIAG/2 + margin covers the canvas at any rotation up to 90° and drift ≤ 600.
  const HALF = DIAG / 2 + Math.max(driftX, driftY)
  ctx.fillRect(CX - HALF, CY - HALF, HALF * 2, HALF * 2)
}