// @ts-check
/**
 * Layer type 31 — Dot Haze (FR-6, architecture §10.2 row 31).
 *
 * `dotCount` large soft dots at PRNG-derived positions, each drawn as a
 * cached unit radial gradient under a per-dot transform whose scale is the
 * animated `baseRadius`. Closest analogue: fuzz-flare (multiple cached-
 * gradient bursts at random positions) + stipple-field's per-dot PRNG
 * layout. The position PRNG is consumed once per composition in `prepare`;
 * only the radii animate via transforms in `draw`. `intensity` composes
 * with the envelope alpha (Flag 4 posture).
 *
 * Never opaque: `intensity ≤ 0.7` and each gradient fades to transparent,
 * so each dot's max contribution is `0.7 × 1.0 = 0.7` alpha. Under normal
 * blend the max is 0.7; the randomizer's flash cap (§8.5 rule 5) handles
 * the additive/screen case.
 *
 * **PRNG consumption order (FR-4, binding):** per dot ascending —
 * x draw, y draw, size-multiplier draw. 3 × dotCount draws, nothing else.
 * The multiplier uses `range(rng, lo, hi)` exactly as orbit-dots / fuzz-
 * flare does. Bounds keep centres ≥ 100 px inside like fuzz-flare
 * (`SPREAD_X = 440, SPREAD_Y = 860`).
 *
 * Imports `model/params.js` and `core/rng.js` (§4 rule 2).
 *
 * **per-effect-glow (FR-6, §9.5):** appends `glowStrength` LAST (default
 * `{min:0,max:0}` ⇒ pre-glow seeds decode to `gs === 0`, a hard no-op ⇒
 * byte-identical). At `gs > 0` a guarded second per-dot loop re-blits the
 * same cached radial gradient at `K_GLOW × radius` under
 * `globalCompositeOperation = 'lighter'` at `alpha = a0 * gs` — one halo
 * blit per haze cluster (bounded by `dotCount`, budget-disciplined).
 * `orbit-dots.js` reference: single additive re-issue of the same sprite
 * geometry at a widened scale, no new sprite mint. No `shadowBlur` (FR-6);
 * zero per-frame allocation (§6.5).
 */

import { A, S } from '../model/params.js'
import { range } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 31,
  name: 'Dot Haze',
  role: 'overlay',
  blurb: 'Soft drifting glow dots suspended over the frame.',
  // per-effect-glow: guarded second per-dot loop under 'lighter' — one
  // extra fillRect per dot when `gs > 0` (12 → 24 draws and pathOps).
  worstCase: { pathOps: 24, drawCalls: 24 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('dotCount', 1, 12, { default: 4 }),
  A('baseRadius', 80, 800, { default: { min: 160, max: 480 } }),
  A('intensity', 0.05, 0.7, { default: { min: 0.25, max: 0.55 } }),
  S.num('spread', 0, 1, { default: 0.7 }),
  S.num('sizeSpread', 0.5, 2.0, { default: 1.3 }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒
  // pre-glow seeds decode to glow-off (`gs === 0` skips the halo loop
  // entirely, byte-identical). See file header for the technique.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
/** Max centre offsets: keeps every dot centre ≥ 100 px inside the canvas. */
const SPREAD_X = 440
const SPREAD_Y = 860
/** Additive halo scale for the per-effect-glow pass. Tuned visually: below
 * 1.25 the halo hides inside the crisp dot at every declared radius; above
 * 1.75 adjacent dots' halos merge into an ambient wash on the max dotCount
 * (12) × min spread configuration. 1.5 gives each dot a clearly wider ring
 * of light without blowing the haze into a flat glow. */
const K_GLOW = 1.5

/**
 * @typedef {object} DotHazePrepared
 * @property {number} count
 * @property {CanvasGradient} glow  Unit-radius radial gradient, colour → transparent.
 * @property {Float64Array} dx      Per-dot centre x.
 * @property {Float64Array} dy      Per-dot centre y.
 * @property {Float64Array} mult    Per-dot radius multiplier.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {DotHazePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const count = /** @type {number} */ (statics.dotCount)
  const spread = /** @type {number} */ (statics.spread)
  const sizeSpread = /** @type {number} */ (statics.sizeSpread)
  const lo = Math.min(1, sizeSpread)
  const hi = Math.max(1, sizeSpread)
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)

  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  const sctx = /** @type {CanvasRenderingContext2D} */ (scratch(1, 1).getContext('2d'))
  const glow = sctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  glow.addColorStop(0, `rgba(${r},${g},${b},1)`)
  glow.addColorStop(0.35, `rgba(${r},${g},${b},0.5)`)
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`)

  const dx = new Float64Array(count)
  const dy = new Float64Array(count)
  const mult = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    dx[i] = CX + (rng() * 2 - 1) * spread * SPREAD_X
    dy[i] = CY + (rng() * 2 - 1) * spread * SPREAD_Y
    mult[i] = range(rng, lo, hi)
  }
  return { count, glow, dx, dy, mult }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {DotHazePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const intensity = /** @type {number} */ (resolved.intensity)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, glow, dx, dy, mult } = prepared

  // Flag 4 posture: composes with the envelope alpha, never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * intensity
  ctx.fillStyle = glow
  for (let i = 0; i < count; i++) {
    const s = base * mult[i]
    ctx.setTransform(s, 0, 0, s, dx[i], dy[i])
    ctx.fillRect(-1, -1, 2, 2)
  }

  // per-effect-glow: guarded additive halo per dot — same sprite, widened
  // to K_GLOW × radius under 'lighter'. `gs === 0` skips the whole loop
  // (byte-identical to pre-glow output). fillStyle survives from the crisp
  // pass; save captures blend + alpha so restore returns them cleanly.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    for (let i = 0; i < count; i++) {
      const s = base * mult[i] * K_GLOW
      ctx.setTransform(s, 0, 0, s, dx[i], dy[i])
      ctx.fillRect(-1, -1, 2, 2)
    }
    ctx.restore()
  }
}