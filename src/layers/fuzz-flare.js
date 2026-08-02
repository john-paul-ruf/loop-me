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
 */

import { A, S } from '../model/params.js'
import { range } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 13,
  name: 'Fuzz Flare',
  role: 'overlay',
  blurb: 'Soft glow bursts drifting over everything beneath.',
  worstCase: { pathOps: 8, drawCalls: 8 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('burstCount', 1, 8, { default: 3 }),
  A('radius', 100, 900, { default: { min: 200, max: 480 } }),
  A('intensity', 0.05, 1.0, { default: { min: 0.3, max: 0.7 } }),
  S.num('spread', 0, 1, { default: 0.6 }),
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
  const { bursts, glow, bx, by, mult } = prepared

  // Composes with the envelope alpha the painter already set (Flag 4 posture).
  ctx.globalAlpha = ctx.globalAlpha * intensity
  ctx.fillStyle = glow
  for (let i = 0; i < bursts; i++) {
    const s = radius * mult[i]
    // Absolute transform: the painter's per-layer restore resets it.
    ctx.setTransform(s, 0, 0, s, bx[i], by[i])
    ctx.fillRect(-1, -1, 2, 2)
  }
}
