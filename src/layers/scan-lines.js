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
 *
 * **per-effect-glow — nominal fit (residual gap).** Scan Lines is a *texture*
 * overlay, not a mark: additive glow on a repeating pattern is weak by
 * construction — brightening the band's own colour just makes the bands more
 * saturated rather than radiating light. When `glowStrength > 0`, `draw`
 * re-blits the SAME cached band pattern under `globalCompositeOperation =
 * 'lighter'` at `envelope × opacity × gs × NOMINAL_K` — a subtle brighten of
 * the bands, no new tile allocated. The param is declared for catalog
 * consistency (S08's "every non-glitch layer glows" gate). FR-6 AC: NO
 * `shadowBlur`; §6.5: no per-frame allocation (the tile is minted once in
 * `prepare`). `gs === 0` is a hard no-op ⇒ byte-identical pre-glow output
 * (architecture §9.5). See `src/util/glow.js` for the canonical idiom and
 * the `glowStrength` param convention.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 14,
  name: 'Scan Lines',
  role: 'overlay',
  blurb: 'Drifting CRT bands over the whole frame.',
  // Worst case doubles under the glow pass: one extra pattern `fillRect`
  // under 'lighter' (halo re-blit of the same tile at low alpha). No new
  // path ops — `fillRect` doesn't build a path.
  worstCase: { pathOps: 2, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('bandHeight', 2, 40, { default: 6 }),
  S.int('gap', 2, 40, { default: 10 }),
  A('drift', 0, 1920, { default: { min: 0, max: 480 } }),
  A('opacity', 0.02, 0.60, { default: { min: 0.12, max: 0.3 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const WIDTH = 1080
const HEIGHT = 1920
/**
 * Nominal glow strength for the texture halo re-blit. Scan Lines is a texture
 * pattern (bands + gaps), not a mark — a strong additive re-blit would blow
 * out the crisp bands rather than "glow" them. 0.4× keeps the halo subtle:
 * at `gs=1` the glow adds ≤ 40% of the crisp band brightness, enough to
 * register (per S01's tolerant glow suite) without saturating the band into
 * a wash. Same tuning idea as `stripe-sweep.js` and `grain.js`.
 */
const NOMINAL_K = 0.4

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
  const gs = /** @type {number} */ (resolved.glowStrength)

  // Glow pass — subtle additive re-blit of the same cached band pattern
  // (nominal fit; see the file header for the residual-gap note). Save/restore
  // fences the transform, blend op, alpha, and fillStyle so the crisp pass
  // below runs against the exact same ctx state as pre-glow. `gs === 0` is a
  // hard no-op ⇒ byte-identical pre-glow output.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * opacity * gs * NOMINAL_K
    ctx.translate(0, drift)
    ctx.fillStyle = prepared.pattern
    ctx.fillRect(0, -drift, WIDTH, HEIGHT)
    ctx.restore()
  }

  // The Flag 4 posture: the layer's own `opacity` COMPOSES with the envelope
  // alpha the painter already set — it never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * opacity
  // Patterns anchor to user space: translating the ctx moves the bands, and
  // the rect below maps back onto exactly the full canvas in device space.
  ctx.translate(0, drift)
  ctx.fillStyle = prepared.pattern
  ctx.fillRect(0, -drift, WIDTH, HEIGHT)
}
