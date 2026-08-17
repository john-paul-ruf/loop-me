// @ts-check
/**
 * Layer type 39 — Zoom Echo (FR-6, architecture §10.2 row 39).
 *
 * Compounding scale echoes: `echoes` self-blits, each scaled `zoom^i` about
 * the canvas centre (540, 960) and composited at alpha `fade` × the
 * painter's envelope. The i-th blit reads a canvas that already carries
 * echoes 1..i-1 — a **deterministic compounding self-read** (Block Static
 * precedent). The order over `i` is fixed and every A/S input is loop-
 * closed, so the smear stays bit-for-bit stable across cycles (FR-3).
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Zero rng draws in `prepare`. `zoom` and `fade` are both A. No frame
 * history. `echoes` is static, so its value never changes across a loop.
 *
 * ## Allocation-free draw (§6.5)
 *
 * No scratches, no per-frame paths. `setTransform` per iteration, one
 * `drawImage(ctx.canvas, 0, 0)` per iteration. `worstCase.drawCalls` = 5
 * (max `echoes`), `pathOps` = 0. `fullCanvasOpaque: false` — each echo
 * composites at `envelope × fade` ≤ envelope, so pixels below always show.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 39,
  name: 'Zoom Echo',
  role: 'glitch',
  blurb: 'Compounding scale echoes trail out from the centre of the frame.',
  worstCase: { pathOps: 0, drawCalls: 5 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('echoes', 2, 5, { default: 3 }),
  // zoom.min > 1 (not 1.00): at zoom=1.0 the transform is identity — every
  // echo would land pixel-for-pixel on the source, invisible. 1.01 gives
  // ≥ 1% edge displacement, enough for the FR-6 min-bound visibility floor.
  A('zoom', 1.01, 1.10, { default: { min: 1.02, max: 1.06 } }),
  // fade.min = 0.15: at 0 the echo would composite at zero alpha —
  // invisible. 0.15 × envelope keeps a visible trail at every bound.
  A('fade', 0.15, 0.6, { default: { min: 0.2, max: 0.4 } }),
]

const CX = 540
const CY = 960

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
  const echoes = /** @type {number} */ (resolved.echoes)
  const zoom = /** @type {number} */ (resolved.zoom)
  const fade = /** @type {number} */ (resolved.fade)

  // Snapshot the envelope alpha the painter set (Scan Lines Flag-4 posture)
  // so every echo composes rather than replaces it.
  const envelope = ctx.globalAlpha

  for (let i = 1; i <= echoes; i++) {
    const s = Math.pow(zoom, i)
    // Scale about the canvas centre: setTransform(a, 0, 0, d, e, f) with
    // a=d=s and (e, f) = (cx - cx·s, cy - cy·s) preserves (cx, cy).
    ctx.setTransform(s, 0, 0, s, CX - CX * s, CY - CY * s)
    ctx.globalAlpha = envelope * fade
    // Self-blit reads the canvas as it stands right now — including the
    // previous i−1 echoes we already stamped. That compounding is accepted
    // and deterministic (Block Static precedent).
    ctx.drawImage(ctx.canvas, 0, 0)
  }
}
