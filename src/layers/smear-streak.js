// @ts-check
/**
 * Layer type 40 — Smear Streak (FR-6, architecture §10.2 row 40).
 *
 * A pixel-sort fake: narrow vertical strips of the composited frame below
 * are self-blitted with a vertical stretch — each strip's `w × 8` source
 * band is drawn into a `w × (8 + reach·1920)` destination rect one column
 * down. Source ⊂ destination within a single `drawImage` call is safe
 * (snapshot-before-write, §6.4), and slivers live in non-overlapping x
 * slots so sequential calls never sample a modified column (Slice Shift
 * precedent). No `getImageData` — the render/governor §6.5 rule.
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Prepare draws exactly `MAX_SLIVERS × 3 = 72` rng values regardless of
 * the static `slivers` count — the FR-4 cross-device contract. `reach` is
 * A, so `findValue` closes its per-frame loop. No frame history.
 *
 * ## Allocation-free draw (§6.5)
 *
 * The sliver table (`Float64Array(72)`) is minted in `prepare`; draw is
 * per-frame `drawImage`s only. Slivers live in fixed x-slots so drawing
 * fewer than `MAX_SLIVERS` leaves the tail of the table unused.
 * `worstCase.drawCalls` = 24 (max `slivers`), `pathOps` = 0.
 * `fullCanvasOpaque: false` — smears cover thin vertical bands only.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 40,
  name: 'Smear Streak',
  role: 'glitch',
  blurb: 'Narrow strips of the frame stretch downward like a pixel-sort smear.',
  worstCase: { pathOps: 0, drawCalls: 24 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('slivers', 6, 24, { default: 12 }),
  // reach.min = 0.05 (not 0): at 0 the destination height equals the 8 px
  // source, so nothing "smears" — the FR-6 AC failure mode.
  A('reach', 0.05, 0.45, { default: { min: 0.1, max: 0.35 } }),
]

const WIDTH = 1080
const HEIGHT = 1920
const MAX_SLIVERS = 24
const FIELDS_PER_SLIVER = 3  // xOffsetInSlot, y0Ratio, widthPick
const SRC_H = 8
const SLOT_W = WIDTH / MAX_SLIVERS  // 45 px

/**
 * @typedef {object} SmearStreakPrepared
 * @property {Float64Array} table  MAX_SLIVERS × 3, values in [0, 1).
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SmearStreakPrepared}
 */
export function prepare(statics, palette, rng) {
  void statics
  void palette
  // Fixed 72 draws regardless of the static `slivers` — consumption count
  // is the FR-4 cross-device contract.
  const table = new Float64Array(MAX_SLIVERS * FIELDS_PER_SLIVER)
  for (let i = 0; i < table.length; i++) table[i] = rng()
  return { table }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SmearStreakPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const slivers = /** @type {number} */ (resolved.slivers)
  const reach = /** @type {number} */ (resolved.reach)
  const destH = Math.max(SRC_H + 1, Math.round(SRC_H + reach * HEIGHT))
  const table = prepared.table

  // Explicit identity — the glitch W1 posture at every use (§6.4).
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  for (let i = 0; i < slivers; i++) {
    const base = i * FIELDS_PER_SLIVER
    const w = 2 + Math.floor(table[base + 2] * 5)      // 2..6 px
    // Slivers live in fixed x-slots (WIDTH/MAX_SLIVERS wide), each nudged
    // by a per-sliver rng within its slot. Non-overlapping x by
    // construction — safe sequential self-blits.
    const x = Math.min(
      WIDTH - w,
      Math.round(i * SLOT_W + table[base] * (SLOT_W - w)),
    )
    const y0 = Math.floor(table[base + 1] * (HEIGHT - SRC_H))
    // Source ⊂ destination inside a single drawImage — snapshot-before-
    // write covers the vertical overlap.
    ctx.drawImage(ctx.canvas, x, y0, w, SRC_H, x, y0, w, destH)
  }
}
