// @ts-check
/**
 * Layer type 25 — Stipple Field (FR-6, architecture §10.2 row 25).
 *
 * A field of `dotCount` dots at PRNG-derived positions within an elliptical
 * spread bounded by `spread` — fuzz-flare's inset-bounds lesson: every dot
 * stays ≥ 100 px inside the canvas. Each dot's size is also PRNG-derived via
 * a per-dot multiplier in `[min(1, sizeSpread), max(1, sizeSpread)]`
 * (orbit-dots pattern). All positions and size multipliers are computed
 * **once per composition** in `prepare` (cached as `Float64Array`) and
 * re-drawn each frame with the animated `baseRadius` scaling all dots
 * uniformly — so the field breathes. The drift params translate the whole
 * field as one; arcs are drawn at absolute cached positions relative to
 * the translated origin.
 *
 * Strategy per §10.2: one accumulated path with one `fill` — the dots
 * accumulate as `arc` calls and commit once (orbit-dots pattern, denser).
 *
 * Never blank: `dotCount` ≥ 8 and `baseRadius` ≥ 1 means at least 8 dots
 * of radius ≥ 0.5 px (sizeSpread ≥ 0.5 guarantees the multiplier ≥ 0.5, so
 * the smallest dot is `1 × 0.5 = 0.5` px — the ctx rounds up to 1 device
 * px). The spread bounds keep centres ≥ 100 px in-canvas so dots never
 * fall off-edge.
 *
 * **PRNG consumption order (FR-4, binding):** per dot ascending —
 * x draw, y draw, size-multiplier draw. 3 × dotCount draws, nothing else.
 * The multiplier uses `range(rng, lo, hi)` exactly as orbit-dots does.
 *
 * Imports `model/params.js` and `core/rng.js` (§4 rule 2).
 *
 * **per-effect-glow (feature) — widened additive re-fill of the same dot
 * path (orbit-dots option B).** When `glowStrength > 0`, `draw`
 * re-accumulates every dot at radius `base × mult × K_GLOW` and commits one
 * additional `fill()` under `globalCompositeOperation = 'lighter'` BEFORE
 * the crisp fill — a soft halo around each dot, crisp dots on top (halo
 * under mark). Chosen over `glowSprite` per dot because stipple-field has
 * no natural clusters and per-dot sprites would blow the drawCall budget at
 * `dotCount = 300`; the single-pass widened re-fill matches orbit-dots'
 * ring-level halo pattern (one extra fill, dots widened by K_GLOW) and
 * costs one extra `fill()` regardless of density. FR-6: NO `shadowBlur`;
 * §6.5: zero per-frame allocation. `gs === 0` is a hard no-op →
 * byte-identical to pre-glow. See `src/util/glow.js` for the canonical
 * draw-time idiom.
 */

import { A, S } from '../model/params.js'
import { range } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 25,
  name: 'Stipple Field',
  role: 'secondary',
  blurb: 'A breathing cloud of dots scattered by a seed.',
  // Worst case doubles under the glow pass: one extra widened `fill()` +
  // one extra widened dot arc per stipple (300 → 600 arcs, 1 → 2 fills).
  worstCase: { pathOps: 600, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('dotCount', 8, 300, { default: 120 }),
  A('baseRadius', 1, 30, { default: { min: 2, max: 14 } }),
  S.num('spread', 0, 1, { default: 0.7 }),
  A('driftX', 0, 360, { default: { min: 0, max: 180 } }),
  A('driftY', 0, 360, { default: { min: 0, max: 240 } }),
  S.num('sizeSpread', 0.5, 3.0, { default: 1.5 }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const TWO_PI = Math.PI * 2
/** Max centre offsets: keeps every dot centre ≥ 100 px inside the canvas. */
const SPREAD_X = 440
const SPREAD_Y = 860
/**
 * Dot-radius multiplier for the additive re-fill glow pass. Matches
 * orbit-dots' K_GLOW (dot archetype): below 1.4 the halo hides inside the
 * crisp dot at tiny `baseRadius = 1` bounds, above 2.5 halos of adjacent
 * dots merge into an ambient wash on dense (`dotCount = 300`) fields. 1.8
 * gives every stipple a visibly wider ring of light without collapsing the
 * cloud into a haze.
 */
const K_GLOW = 1.8

/**
 * @typedef {object} StippleFieldPrepared
 * @property {number} count
 * @property {Float64Array} dx     Per-dot centre x.
 * @property {Float64Array} dy     Per-dot centre y.
 * @property {Float64Array} mult   Per-dot size multiplier.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {StippleFieldPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const count = /** @type {number} */ (statics.dotCount)
  const spread = /** @type {number} */ (statics.spread)
  const sizeSpread = /** @type {number} */ (statics.sizeSpread)
  const lo = Math.min(1, sizeSpread)
  const hi = Math.max(1, sizeSpread)

  const dx = new Float64Array(count)
  const dy = new Float64Array(count)
  const mult = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    dx[i] = CX + (rng() * 2 - 1) * spread * SPREAD_X
    dy[i] = CY + (rng() * 2 - 1) * spread * SPREAD_Y
    mult[i] = range(rng, lo, hi)
  }
  return {
    count,
    dx,
    dy,
    mult,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {StippleFieldPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const driftX = /** @type {number} */ (resolved.driftX)
  const driftY = /** @type {number} */ (resolved.driftY)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, dx, dy, mult } = prepared

  ctx.fillStyle = prepared.color
  ctx.translate(driftX, driftY)

  // Glow pass — drawn FIRST so the crisp dots sit on top (halo under mark).
  // Same dot centres (translated by drift), radius scaled by `K_GLOW`,
  // colour re-filled under 'lighter'. `gs === 0` is a hard no-op →
  // byte-identical to pre-glow. See `src/util/glow.js`.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const r = base * mult[i] * K_GLOW
      ctx.moveTo(dx[i] + r, dy[i])
      ctx.arc(dx[i], dy[i], r, 0, TWO_PI)
    }
    ctx.fill()
    ctx.restore()
    // `fillStyle` survives `restore()` since it was set before `save()`.
    // The `translate()` above is preserved too — the crisp pass below draws
    // at the same translated origin.
  }

  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const r = base * mult[i]
    ctx.moveTo(dx[i] + r, dy[i])
    ctx.arc(dx[i], dy[i], r, 0, TWO_PI)
  }
  ctx.fill()
}