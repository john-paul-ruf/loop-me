// @ts-check
/**
 * Layer type 42 — Contrast Crush (FR-6, architecture §10.2 row 42).
 *
 * `passes` full-frame self-blits under a chosen `mode`
 * (multiply = crush | screen = bloom), each at effective alpha
 * `envelope × strength`. Pass 2 reads the canvas as pass 1 left it — a
 * **deterministic compounding self-read** (Block Static precedent). The
 * order over passes is fixed (1, then 2) and every input is loop-closed,
 * so the compounding stays bit-for-bit stable across cycles (FR-3).
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Zero rng draws in `prepare`. `strength` is A. No frame history.
 * `mode` and `passes` are static — constant across a loop.
 *
 * ## Allocation-free draw (§6.5)
 *
 * No scratches, no per-frame paths. One `drawImage(ctx.canvas, 0, 0)`
 * per pass. `worstCase.drawCalls` = 2 (max `passes`), `pathOps` = 0.
 * `fullCanvasOpaque: false` — every pass composites at
 * `envelope × strength` ≤ envelope, so pixels below always show.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 42,
  name: 'Contrast Crush',
  role: 'glitch',
  blurb: 'The frame multiplies or screens against itself — crush or bloom.',
  worstCase: { pathOps: 0, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.enum('mode', ['multiply', 'screen']),
  S.int('passes', 1, 2, { default: 1 }),
  // strength.min = 0.15 (not 0): at 0 the pass composites at zero alpha —
  // invisible, the "renders nothing" FR-6 AC failure mode.
  A('strength', 0.15, 0.9, { default: { min: 0.25, max: 0.7 } }),
]

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
  const passes = /** @type {number} */ (resolved.passes)
  const strength = /** @type {number} */ (resolved.strength)

  // Snapshot the envelope alpha the painter set — every pass composes with
  // it (Scan Lines Flag-4 posture — compose, never replace).
  const envelope = ctx.globalAlpha
  ctx.globalCompositeOperation = mode
  ctx.globalAlpha = envelope * strength

  for (let i = 0; i < passes; i++) {
    // Full-frame self-blit under `mode`. Pass ≥ 2 reads a canvas already
    // modified by earlier passes — deterministic compounding (Block Static
    // precedent). Painter save/restore around the layer draw resets
    // gCO / globalAlpha after we return (§6.4).
    ctx.drawImage(ctx.canvas, 0, 0)
  }
}
