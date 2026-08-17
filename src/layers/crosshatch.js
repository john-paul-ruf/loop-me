// @ts-check
/**
 * Layer type 12 — Crosshatch (FR-6, architecture §10.2 row 12).
 *
 * Two families of parallel lines at independent animated angles, weaving a
 * hatched texture across the whole frame. The only layer in the catalog with
 * an all-animatable declaration — even `spacing` breathes — so nothing can
 * be cached: both line sets are built on the ctx's own path each frame
 * (the D1 template) and stroked separately, matching §10.2's two draw calls.
 *
 * The per-frame line count derives from the animated `spacing`
 * (`ceil(DIAG / spacing)`, ≤ 221 per set at the 10 px bound) — arithmetic
 * only, no allocation on the frame path (§6.5).
 *
 * Never blank: each set is centred on the canvas with lines spanning the
 * full diagonal at spacing ≤ 120 px, so dozens of lines cross the frame at
 * every angle and every bound combination. Consumes zero PRNG draws.
 *
 * **per-effect-glow (S04):** wide additive re-stroke archetype. When
 * `glowStrength > 0`, `draw` runs the same two-family stroke sequence once
 * BEFORE the crisp pass under `globalCompositeOperation = 'lighter'` at
 * `lineWidth × K_GLOW` — a soft halo under the hatch, crisp lines on top. No
 * `shadowBlur` (FR-6); `gs === 0` is a hard no-op → pre-glow seeds decode
 * byte-identical (§9.5). K = 1.8 keeps the halo modest across a dense hatch.
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 12,
  name: 'Crosshatch',
  role: 'secondary',
  blurb: 'Two families of strokes weaving a shifting hatch.',
  // Worst case doubles under the glow pass: 2 halo strokes + 2 crisp strokes,
  // each halo path is the same shape as its crisp counterpart.
  worstCase: { pathOps: 1200, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  A('angleA', 0, 180, { unit: '°', wrap: true, default: { min: 20, max: 70 } }),
  A('angleB', 0, 180, { unit: '°', wrap: true, default: { min: 110, max: 160 } }),
  A('spacing', 10, 120, { default: { min: 24, max: 64 } }),
  A('weight', 1, 10, { default: { min: 1, max: 3 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const DIAG = Math.hypot(1080, 1920)
const HALF = DIAG / 2
/**
 * Halo width multiplier. Dense hatch — at spacing.min = 10 px we already
 * have 221 lines per family, and the halo doubles the visible stroke count.
 * 1.8 keeps the halo clearly wider than the mark at every `weight` without
 * bleeding neighbouring lines together into an ambient wash.
 */
const K_GLOW = 1.8

/**
 * @typedef {object} CrosshatchPrepared
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {CrosshatchPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  return {
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * One centred line set on the current transform's x-axis alignment.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} spacing
 */
function strokeSet(ctx, spacing) {
  const count = Math.ceil(DIAG / spacing)
  const y0 = -((count - 1) / 2) * spacing
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const y = y0 + i * spacing
    ctx.moveTo(-HALF, y)
    ctx.lineTo(HALF, y)
  }
  ctx.stroke()
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {CrosshatchPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const aA = /** @type {number} */ (resolved.angleA) * DEG
  const aB = /** @type {number} */ (resolved.angleB) * DEG
  const spacing = /** @type {number} */ (resolved.spacing)
  const weight = /** @type {number} */ (resolved.weight)
  const gs = /** @type {number} */ (resolved.glowStrength)

  ctx.strokeStyle = prepared.color
  ctx.translate(CX, CY)

  // Glow pass — drawn FIRST so the crisp hatch sits on top (halo under mark).
  // `gs === 0` is a hard no-op: skip the pass entirely for byte-identical
  // pre-glow output. See `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    ctx.rotate(aA)
    strokeSet(ctx, spacing)
    ctx.rotate(aB - aA)
    strokeSet(ctx, spacing)
    ctx.restore()
    // `strokeStyle` and transform (translate CX,CY) survive `restore()`.
  }

  ctx.lineWidth = weight
  ctx.rotate(aA)
  strokeSet(ctx, spacing)

  // Relative turn from set A's frame — the painter's restore (§6.4) resets.
  ctx.rotate(aB - aA)
  strokeSet(ctx, spacing)
}
