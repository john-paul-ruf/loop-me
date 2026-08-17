// @ts-check
/**
 * Layer type 33 — Slice Shift (FR-6, architecture §10.2 row 33).
 *
 * The first of the four glitch-role layers: torn horizontal bands of the
 * already-composited frame are self-blitted sideways. Because a single
 * `ctx.drawImage(ctx.canvas, …)` snapshots its source rect *before* writing
 * the destination, and each band's read range equals its write range in y,
 * the bands are y-disjoint and cannot re-read a modified region — the safe
 * self-overlap case (§6.4 painter identity-transform / single-ctx contract).
 *
 * The dropout seams (a Path2D of 2 px rects at kicked-band boundaries,
 * filled with the layer colour) are the layer's own intrinsic pixels, so
 * even solo-over-background this layer emits *something* the FR-18 fence
 * can see.
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * No frame history and no per-frame `Math.random()`. Chaos is a
 * `Float64Array(17 * 24)` table filled once in `prepare` from the injected
 * per-layer mulberry32 stream and indexed by the animated `row` param.
 * `row` is A-clamped by `findValue`, so its per-frame value is a
 * loop-closed function of the frame — the table lookup inherits that
 * closure. Every cell draws exactly two rng values (sign, magnitude), for
 * a fixed 17 × 24 × 2 = 816 draws per prepare regardless of `slices` —
 * the FR-4 cross-device determinism contract.
 *
 * ## Allocation-free draw (§6.5)
 *
 * The offset table is minted in prepare; one shared Path2D per frame is
 * accepted (§6.5 allows a single per-frame path build, matching Grid Pulse
 * precedent). `worstCase.drawCalls` = 24 band blits + 1 dropout fill = 25;
 * `pathOps` = 24 rects. `fullCanvasOpaque: false` — a glitch layer
 * redistributes what is below, it does not hide it.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 33,
  name: 'Slice Shift',
  role: 'glitch',
  blurb: 'Torn horizontal bands of the frame, kicked sideways in bursts.',
  worstCase: { pathOps: 24, drawCalls: 25 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('slices', 4, 24, { default: 10 }),
  // `jolt.min` is 8 (not 0): the driving param must guarantee visible
  // motion at every bound — the "never renders nothing" AC (FR-6) applied
  // to glitch layers, which have no intrinsic image of their own.
  A('jolt', 8, 220, { unit: 'px', default: { min: 12, max: 90 } }),
  A('row', 0, 16, { default: { min: 0, max: 16 } }),
]

const WIDTH = 1080
const HEIGHT = 1920
const ROWS = 17           // row indices 0..16, clamped from `resolved.row`
const MAX_SLICES = 24     // matches `slices` max — the widest table row
/** A kick large enough to warrant a dropout seam. Normalized |offset|. */
const SEAM_THRESHOLD = 0.7

/**
 * @typedef {object} SliceShiftPrepared
 * @property {Float64Array} offsets  ROWS × MAX_SLICES, values in [-1, -0.35] ∪ [0.35, 1].
 * @property {string} color          Layer's resolved #RRGGBB, used for seam dropout fills.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SliceShiftPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  // Fixed-size fill regardless of the static `slices` — consumption order
  // and count are the FR-4 cross-device contract.
  const offsets = new Float64Array(ROWS * MAX_SLICES)
  for (let i = 0; i < offsets.length; i++) {
    const sign = rng() < 0.5 ? -1 : 1
    // Magnitude bottom-clamped to 0.35: at min `jolt` = 8 px this gives
    // ≥ 3 px of visible shift on every band, so no cell can render "no
    // motion" at any bound.
    const mag = 0.35 + 0.65 * rng()
    offsets[i] = sign * mag
  }
  return { offsets, color: /** @type {string} */ (statics.color) }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SliceShiftPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const slices = /** @type {number} */ (resolved.slices)
  const jolt = /** @type {number} */ (resolved.jolt)
  const row = Math.min(ROWS - 1, Math.floor(/** @type {number} */ (resolved.row)))
  const base = row * MAX_SLICES
  const offsets = prepared.offsets

  // Painter has already applied envelope alpha + blend chip: keep both
  // intact (Scan Lines Flag-4 posture — compose, never replace).
  const seams = new Path2D()
  for (let i = 0; i < slices; i++) {
    // Integer band rows partition the height exactly, no overlap.
    const y0 = Math.floor(i * HEIGHT / slices)
    const y1 = Math.floor((i + 1) * HEIGHT / slices)
    const h = y1 - y0
    if (h <= 0) continue
    const off = offsets[base + i]
    const dx = Math.round(off * jolt)
    // Safe self-blit: source rect is snapshotted before dst is written,
    // and each band's y-range is disjoint from every other band's.
    ctx.drawImage(ctx.canvas, 0, y0, WIDTH, h, dx, y0, WIDTH, h)
    if (Math.abs(off) > SEAM_THRESHOLD) {
      seams.rect(0, y1 - 1, WIDTH, 2)
    }
  }
  ctx.fillStyle = prepared.color
  ctx.fill(seams)
}
