// @ts-check
/**
 * Layer type 41 — Ghost Double (FR-6, architecture §10.2 row 41).
 *
 * A single self-blit of the composited frame below at a loop-closed
 * `(dx, dy) = radius·(cos angle, sin angle)` offset, composited under an
 * explicit `mode` (difference|screen). One drawImage snapshots its own
 * source before writing the destination (§6.4), so the shifted self-
 * overlay is safe even where source and destination overlap.
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Zero rng draws in `prepare`. `radius` and `angle` are both A; `angle`
 * uses `{wrap: true}` so 0 and 360 are adjacent, keeping a full angular
 * rotation smooth across the loop closure. No frame history.
 *
 * ## Allocation-free draw (§6.5)
 *
 * No scratches, no per-frame paths. One `drawImage(ctx.canvas, dx, dy)`
 * per frame. `worstCase.drawCalls` = 1, `pathOps` = 0.
 * `fullCanvasOpaque: false` — under the painter's envelope alpha, and
 * even at full envelope the shift leaves the un-overlapped strip at one
 * edge showing the underlying frame.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 41,
  name: 'Ghost Double',
  role: 'glitch',
  blurb: 'A shifted self-blit ghosts the frame under a difference or screen blend.',
  worstCase: { pathOps: 0, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.enum('mode', ['difference', 'screen']),
  // radius.min = 4 (not 0): at 0 the self-blit lands pixel-for-pixel on
  // itself — difference→black, screen→brightened but essentially the
  // original scaled. 4 px keeps the shift visible at every bound.
  A('radius', 4, 90, { unit: 'px', default: { min: 6, max: 40 } }),
  A('angle', 0, 360, { wrap: true, unit: '°' }),
]

const DEG = Math.PI / 180

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {object}
 */
export function prepare(statics, palette, rng) {
  void statics
  void palette
  void rng
  return {}
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {object} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void prepared
  void palette
  const mode = /** @type {GlobalCompositeOperation} */ (
    /** @type {string} */ (resolved.mode)
  )
  const radius = /** @type {number} */ (resolved.radius)
  const angle = /** @type {number} */ (resolved.angle) * DEG
  const dx = Math.round(Math.cos(angle) * radius)
  const dy = Math.round(Math.sin(angle) * radius)

  // Set the composite mode explicitly for the blit — the painter's blend
  // chip already occupies `globalCompositeOperation`, so this is a
  // deliberate override. Painter save/restore around the layer draw
  // resets it after we return (§6.4). globalAlpha stays as the painter
  // set it (envelope), Scan Lines Flag-4 posture — compose, never
  // replace.
  ctx.globalCompositeOperation = mode
  ctx.drawImage(ctx.canvas, dx, dy)
}
