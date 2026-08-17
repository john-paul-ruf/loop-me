// @ts-check
/**
 * Layer type 37 — Mirror Fold (FR-6, architecture §10.2 row 37).
 *
 * A glitch-role reflect: a strip of the composited frame below on one side of
 * a fold line is mirrored onto the other side via a negative-scale transform
 * and a single `ctx.drawImage(ctx.canvas, …)` call. The source strip and its
 * destination sit on opposite sides of the fold, so source and destination
 * rects are y-disjoint (or x-disjoint) — no self-overlap even without the
 * snapshot-before-write guarantee (§6.4 painter identity-transform / single-
 * ctx contract, Slice Shift precedent).
 *
 * ## The 0.18–0.44 fold range (composed-sweep visibility trap)
 *
 * `layers.test.js`'s composed sweep uses Grid Pulse (mid-pinned) as the base.
 * Grid Pulse is symmetric about the canvas centre — a fold *at* 0.5 would
 * produce a visual no-op (the mirror would map identical content onto
 * identical content). Bounding `fold` to 0.18–0.44 keeps every bound
 * strictly off-centre so the mirror always changes pixels, satisfying the
 * FR-6 "no bound renders nothing" AC.
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Consumes zero rng draws in `prepare`. `fold` and `reach` are both A, so
 * their per-frame values are loop-closed by `findValue`. No frame history.
 *
 * ## Allocation-free draw (§6.5)
 *
 * No scratches, no per-frame paths. One `setTransform` + one `drawImage`.
 * `worstCase.drawCalls` = 1, `pathOps` = 0. `fullCanvasOpaque: false` —
 * the mirrored strip only covers reach·WIDTH (or reach·HEIGHT) of the
 * canvas and runs under the painter's envelope alpha.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 37,
  name: 'Mirror Fold',
  role: 'glitch',
  blurb: 'A strip of the frame is reflected across a fold line.',
  worstCase: { pathOps: 0, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.enum('axis', ['vertical', 'horizontal']),
  // fold ∈ [0.18, 0.44]: strictly off-centre at every bound (see header).
  A('fold', 0.18, 0.44, { default: { min: 0.22, max: 0.4 } }),
  // reach.min = 0.2 (not 0): at 0 the mirrored strip would be zero-width,
  // rendering nothing — the FR-6 AC failure mode we design out.
  A('reach', 0.2, 1, { default: { min: 0.3, max: 0.8 } }),
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
  const axis = /** @type {string} */ (resolved.axis)
  const fold = /** @type {number} */ (resolved.fold)
  const reach = /** @type {number} */ (resolved.reach)

  if (axis === 'horizontal') {
    // Fold line at y = foldY. Source strip [foldY, foldY+reachH]; destination
    // is the mirror image at [foldY-reachH, foldY]. Negative-y-scale about
    // foldY: setTransform(1, 0, 0, -1, 0, 2*foldY).
    const foldY = Math.round(fold * HEIGHT)
    const reachH = Math.max(1, Math.round(reach * HEIGHT))
    ctx.setTransform(1, 0, 0, -1, 0, 2 * foldY)
    // Source rect below the fold; destination rect (in transformed space)
    // starts at foldY too — the mirror puts it above the fold in screen
    // space. Snapshot-before-write covers the (rare) overlap at the seam.
    ctx.drawImage(ctx.canvas, 0, foldY, WIDTH, reachH, 0, foldY, WIDTH, reachH)
  } else {
    // Vertical fold line at x = foldX. Source [foldX, foldX+reachW] on the
    // right, mirrored to [foldX-reachW, foldX] on the left. Negative-x-scale
    // about foldX: setTransform(-1, 0, 0, 1, 2*foldX, 0).
    const foldX = Math.round(fold * WIDTH)
    const reachW = Math.max(1, Math.round(reach * WIDTH))
    ctx.setTransform(-1, 0, 0, 1, 2 * foldX, 0)
    ctx.drawImage(ctx.canvas, foldX, 0, reachW, HEIGHT, foldX, 0, reachW, HEIGHT)
  }
  // Painter save/restore around this draw resets the transform after we
  // return (§6.4); no need to unwind it here.
}
