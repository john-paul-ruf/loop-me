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
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws.
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 26,
  name: 'Lattice Weave',
  role: 'secondary',
  blurb: 'Two families of strokes braiding at independent angles.',
  worstCase: { pathOps: 600, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  A('angleA', 0, 180, { unit: '°', wrap: true, default: { min: 20, max: 70 } }),
  A('angleB', 0, 180, { unit: '°', wrap: true, default: { min: 110, max: 160 } }),
  A('spacingA', 10, 120, { default: { min: 24, max: 64 } }),
  A('spacingB', 10, 120, { default: { min: 24, max: 64 } }),
  A('weight', 1, 10, { default: { min: 1, max: 3 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const DIAG = Math.hypot(1080, 1920)
const HALF = DIAG / 2

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

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = /** @type {number} */ (resolved.weight)
  ctx.translate(CX, CY)

  ctx.rotate(aA)
  strokeSet(ctx, spA)

  // Relative turn from set A's frame — the painter's restore (§6.4) resets.
  ctx.rotate(aB - aA)
  strokeSet(ctx, spB)
}