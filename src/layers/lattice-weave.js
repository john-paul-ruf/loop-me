// @ts-check
/**
 * Layer type 26 — Lattice Weave (FR-6, architecture §10.2 row 26).
 *
 * Two families of equally-spaced parallel lines at independent animated
 * angles, each family covering the full diagonal so coverage holds at
 * every rotation. Closest analogue: crosshatch, but crosshatch shares one
 * `spacing`; lattice-weave has two independent `spacingA`/`spacingB` so the
 * families braid at different densities. Each family is built on the ctx's
 * own path (D1 template, no `Path2D` allocation in `draw` — both spacings
 * are animated) and stroked separately, so two draw calls.
 *
 * Strategy per §10.2: two draw calls (one stroke per family). Mirrors
 * crosshatch exactly — `count = ceil(DIAG / spacing)` lines spanning the
 * full diagonal per family. The second family uses a relative
 * `ctx.rotate(aB - aA)` to chain within one transform stack (crosshatch's
 * trick).
 *
 * Never blank: each family's lines span the full diagonal (`HALF` in each
 * direction), so at least one line crosses the canvas at every angle.
 * `spacing` ≤ 120 means ≥ 17 lines per family — dense, never blank.
 *
 * **per-effect-glow (S04):** wide additive re-stroke archetype. When
 * `glowStrength > 0`, `draw` re-runs the two-family stroke sequence in the
 * SAME family order (A then B) once BEFORE the crisp pass under
 * `globalCompositeOperation = 'lighter'` at `lineWidth × K_GLOW` — matching
 * the crisp ordering keeps the halo reading as one coherent weave (over/
 * under stacking of the two families is preserved). No `shadowBlur` (FR-6);
 * `gs === 0` is a hard no-op → pre-glow seeds decode byte-identical (§9.5).
 * K = 1.8 keeps the halo modest across the dense braided pattern.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws.
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 26,
  name: 'Lattice Weave',
  role: 'secondary',
  blurb: 'Two families of strokes braiding at independent angles.',
  // Worst case doubles under the glow pass: 2 halo strokes + 2 crisp strokes,
  // each halo path is the same shape as its crisp counterpart.
  worstCase: { pathOps: 1200, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  A('angleA', 0, 180, { unit: '°', wrap: true, default: { min: 20, max: 70 } }),
  A('angleB', 0, 180, { unit: '°', wrap: true, default: { min: 110, max: 160 } }),
  A('spacingA', 10, 120, { default: { min: 24, max: 64 } }),
  A('spacingB', 10, 120, { default: { min: 24, max: 64 } }),
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
 * Halo width multiplier. Dense braid — both families at spacing.min = 10 px
 * give 221 lines each. 1.8 keeps the halo clearly wider than the mark at
 * every `weight` without merging neighbouring lines into an ambient wash.
 */
const K_GLOW = 1.8

/**
 * @typedef {object} LatticeWeavePrepared
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {LatticeWeavePrepared}
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
 * @param {LatticeWeavePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const aA = /** @type {number} */ (resolved.angleA) * DEG
  const aB = /** @type {number} */ (resolved.angleB) * DEG
  const spA = /** @type {number} */ (resolved.spacingA)
  const spB = /** @type {number} */ (resolved.spacingB)
  const weight = /** @type {number} */ (resolved.weight)
  const gs = /** @type {number} */ (resolved.glowStrength)

  ctx.strokeStyle = prepared.color
  ctx.translate(CX, CY)

  // Glow pass — drawn FIRST so the crisp weave sits on top (halo under mark).
  // Same A-then-B family order as the crisp pass so the halo's over/under
  // stacking matches the mark's — one coherent weave halo, not a smear.
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    ctx.rotate(aA)
    strokeSet(ctx, spA)
    ctx.rotate(aB - aA)
    strokeSet(ctx, spB)
    ctx.restore()
    // `strokeStyle` and transform (translate CX,CY) survive `restore()`.
  }

  ctx.lineWidth = weight
  ctx.rotate(aA)
  strokeSet(ctx, spA)

  // Relative turn from set A's frame — the painter's restore (§6.4) resets.
  ctx.rotate(aB - aA)
  strokeSet(ctx, spB)
}