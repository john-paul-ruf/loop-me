// @ts-check
/**
 * Layer type 30 — Soft Tint (FR-6, architecture §10.2 row 30).
 *
 * A full-frame linear colour wash at low opacity. Two-colour gradient
 * (layer colour → transparent) along an animated `angle`, with `strength`
 * composing with the painter's envelope alpha (Flag 4 posture). The
 * whole-frame linear gradient is a cached unit gradient drawn under an
 * animated rotation+scale transform like vignette-wash's linear mode —
 * mint the unit linear gradient in `prepare`, scale it to cover the canvas
 * diagonal + margin in `draw`, rotate by `angle`.
 *
 * Never opaque: `strength ≤ 0.75` × gradient peak (1.0 at the colour stop) =
 * 0.75 max, so the brightest pixel is at 75% alpha over the background —
 * never opaque. The gradient fades to fully transparent, so whatever is
 * beneath stays visible.
 *
 * Strategy per §10.2: one `fillRect` (one path op, one draw call). The
 * gradient is minted once in `prepare`; `draw` uses `setTransform` with
 * `DIAG / falloff` as scale and the animated `angle` as rotation. Consumes
 * zero PRNG draws.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 30,
  name: 'Soft Tint',
  role: 'overlay',
  blurb: 'A gentle colour wash brushing the frame at an angle.',
  worstCase: { pathOps: 1, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  A('angle', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  A('strength', 0.05, 0.75, { default: { min: 0.15, max: 0.4 } }),
  A('falloff', 0.1, 1.0, { default: { min: 0.4, max: 0.8 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const DIAG = Math.hypot(1080, 1920)

/**
 * @typedef {object} SoftTintPrepared
 * @property {CanvasGradient} wash  Unit linear gradient, colour → transparent.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SoftTintPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  const sctx = /** @type {CanvasRenderingContext2D} */ (scratch(1, 1).getContext('2d'))
  const wash = sctx.createLinearGradient(0, 0, 1, 0)
  wash.addColorStop(0, `rgba(${r},${g},${b},1)`)
  wash.addColorStop(1, `rgba(${r},${g},${b},0)`)
  return { wash }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SoftTintPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const angle = /** @type {number} */ (resolved.angle) * DEG
  const strength = /** @type {number} */ (resolved.strength)
  const falloff = /** @type {number} */ (resolved.falloff)

  // Flag 4 posture: composes with the envelope alpha, never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * strength

  const s = DIAG / falloff
  const c = Math.cos(angle)
  const si = Math.sin(angle)
  ctx.setTransform(s * c, s * si, -s * si, s * c, CX, CY)
  ctx.fillStyle = prepared.wash
  // ±2 units → ±2·s ≥ ±2196 px, covers the canvas at any rotation.
  ctx.fillRect(-2, -2, 4, 4)
}