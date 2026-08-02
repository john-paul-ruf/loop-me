// @ts-check
/**
 * Layer type 14 — Scan Lines (FR-6, architecture §10.2 row 14).
 *
 * Horizontal CRT bands: one band-plus-gap tile built in `prepare`, wrapped in
 * a `CanvasPattern`, and translated vertically by the animated `drift` —
 * exactly §10.2's strategy, one path op, one draw call.
 *
 * This layer declares a param literally named `opacity` (FR-6) — the Flag 4
 * real-world case. It reaches `draw` as `resolved.opacity` (the *layer's*
 * value) and **multiplies** the globalAlpha the painter already set from the
 * envelope, so the two compose: effective alpha = envelope × band opacity.
 *
 * Never blank (FR-6 AC): a `bandHeight` ≥ 2 tile repeats from y = 0 across
 * the whole canvas at every bound, and `opacity` ≥ 0.02 over the scheme
 * background is ≥ 1 display level for every scheme colour bucket. Never
 * opaque: `gap` ≥ 2 always leaves uncovered rows, and opacity caps at 0.60.
 * Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 14,
  name: 'Scan Lines',
  role: 'overlay',
  blurb: 'Drifting CRT bands over the whole frame.',
  worstCase: { pathOps: 1, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('bandHeight', 2, 40, { default: 6 }),
  S.int('gap', 2, 40, { default: 10 }),
  A('drift', 0, 1920, { default: { min: 0, max: 480 } }),
  A('opacity', 0.02, 0.60, { default: { min: 0.12, max: 0.3 } }),
]

const WIDTH = 1080
const HEIGHT = 1920

/**
 * @typedef {object} ScanLinesPrepared
 * @property {CanvasPattern} pattern  One band + one gap, repeating.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {ScanLinesPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const band = /** @type {number} */ (statics.bandHeight)
  const gap = /** @type {number} */ (statics.gap)
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)

  // Tile width 4: a pattern repeats, so width is cosmetic; 1 would do.
  const tile = scratch(4, band + gap)
  const tctx = /** @type {CanvasRenderingContext2D} */ (tile.getContext('2d'))
  tctx.fillStyle = /** @type {string} */ (statics.color)
  tctx.fillRect(0, 0, 4, band)
  const pattern = /** @type {CanvasPattern} */ (tctx.createPattern(tile, 'repeat'))
  return { pattern }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {ScanLinesPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const drift = /** @type {number} */ (resolved.drift)
  const opacity = /** @type {number} */ (resolved.opacity)

  // The Flag 4 posture: the layer's own `opacity` COMPOSES with the envelope
  // alpha the painter already set — it never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * opacity
  // Patterns anchor to user space: translating the ctx moves the bands, and
  // the rect below maps back onto exactly the full canvas in device space.
  ctx.translate(0, drift)
  ctx.fillStyle = prepared.pattern
  ctx.fillRect(0, -drift, WIDTH, HEIGHT)
}
