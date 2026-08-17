// @ts-check
/**
 * Layer type 38 — Interlace Comb (FR-6, architecture §10.2 row 38).
 *
 * Alternating even/odd bands of the composited frame are self-blitted with
 * opposite horizontal shears — a comb-tooth misalignment that reads as a
 * torn interlaced signal. Each band's source rect equals its destination
 * rect in y (a horizontal shift only), so bands are y-disjoint across
 * sequential calls: Slice Shift precedent — the safe self-overlap case
 * (§6.4).
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Zero rng draws in `prepare`. `shear` is A, so `findValue` closes the
 * per-frame loop; parity alternation is deterministic (`i & 1`). No frame
 * history, no per-frame entropy.
 *
 * ## Allocation-free draw (§6.5)
 *
 * No scratches, no per-frame paths. Up to `bands` `drawImage` calls
 * (max 32). `worstCase.drawCalls` = 32, `pathOps` = 0.
 * `fullCanvasOpaque: false` — the sheared bands still show the pixels below
 * through the painter's envelope alpha.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 38,
  name: 'Interlace Comb',
  role: 'glitch',
  blurb: 'Even/odd fields shear in opposite directions like a torn interlace.',
  worstCase: { pathOps: 0, drawCalls: 32 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  // Meant to be even so parity balances the shears; the effect still works
  // at odd counts (one extra band picks up the +shear side).
  S.int('bands', 8, 32, { default: 20 }),
  // shear.min = 2 (not 0): at 0 the alternating shift collapses to a no-op
  // — the "renders nothing at every bound" AC failure mode.
  A('shear', 2, 80, { unit: 'px', default: { min: 4, max: 40 } }),
]

const WIDTH = 1080
const HEIGHT = 1920

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
  const bands = /** @type {number} */ (resolved.bands)
  const shear = Math.round(/** @type {number} */ (resolved.shear))

  // Explicit identity — painter guarantees it (§6.4), but this layer follows
  // the glitch W1 posture of asserting state at every use.
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  for (let i = 0; i < bands; i++) {
    const y0 = Math.floor(i * HEIGHT / bands)
    const y1 = Math.floor((i + 1) * HEIGHT / bands)
    const h = y1 - y0
    if (h <= 0) continue
    // Alternating parity: even bands shift +shear, odd bands shift −shear.
    const dx = (i & 1) === 0 ? shear : -shear
    // Safe self-blit: source rect is snapshotted before dst is written, and
    // every band's y-range is disjoint from every other band's.
    ctx.drawImage(ctx.canvas, 0, y0, WIDTH, h, dx, y0, WIDTH, h)
  }
}
