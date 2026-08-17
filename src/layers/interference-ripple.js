// @ts-check
/**
 * Layer type 51 — Interference Ripple (FR-6, architecture §10.2 row 51).
 *
 * `sources` fixed points, each emitting `rings` concentric circles at
 * radii `((i + expand) mod rings) · spacing`. Where the ring families
 * from different sources overlap, the moiré that emerges IS the
 * interference — no per-frame compositing, just two or three transparent
 * ring stacks stroked on top of each other.
 *
 * Loop closure via the ring-advance trick (omni-wave S03 toolbox):
 * `expand ∈ [0, 1]` with `{ wrap: true }` shifts every ring outward by
 * one slot per full loop; the mod-`rings` mapping guarantees the set of
 * visible radii at `expand = 1` equals the set at `expand = 0`. The
 * family maps onto itself — the individual rings shift but the diagram
 * cycles.
 *
 * Strategy per §10.2: one accumulated arc path per source, one stroke per
 * source — 2 or 3 draw calls, whichever `sources` selects. `prepare`
 * bakes the sources' positions in a central vertical band and returns
 * flat arrays so `draw` allocates nothing (§6.5).
 *
 * PRNG consumption (FIXED across `sources`, FR-4): always draw
 * `MAX_SOURCES × 2` = 6 values so the seed stream position is stable.
 * Only the first `sources × 2` reach live coordinates.
 *
 * Never blank: `weight.min > 0` and rings > 0 always keep the outer rings
 * stroked visibly; even at `sources = 2`, `rings = 6` there are 10+
 * strokes in one composited frame.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 51,
  name: 'Interference Ripple',
  role: 'secondary',
  blurb: 'Overlapping ring families interfering into moiré.',
  worstCase: { pathOps: 50, drawCalls: 3 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('sources', 2, 3, { default: 3 }),
  S.int('rings', 6, 14, { default: 10 }),
  S.int('spacing', 40, 120, { default: 80 }),
  A('expand', 0, 1, { wrap: true, default: { min: 0, max: 1 } }),
  // weight.min > 0 (1 px): every ring registers.
  A('weight', 1, 6, { default: { min: 1.5, max: 4 } }),
]

const W = 1080
const CX = 540
const CY = 960
const TWO_PI = Math.PI * 2
/**
 * Fixed draw budget for the source-position table. Always this many rng
 * values so the seed stream position downstream stays stable across
 * `sources` changes (FR-4).
 */
const MAX_SOURCES = 3
/**
 * Central vertical band for source placement: sources land in the middle
 * third of the canvas horizontally and vertically so ring families
 * genuinely overlap rather than sit apart at opposite corners.
 */
const BAND_X_MIN = W * 0.25
const BAND_X_MAX = W * 0.75
const BAND_Y_MIN = 400
const BAND_Y_MAX = 1520
/** Skip rings whose current radius is smaller than this — a point-sized
 * ring stroked at weight ≤ 6 reads as a dot and pops at the wrap. */
const MIN_R = 4

/**
 * @typedef {object} InterferenceRipplePrepared
 * @property {number} sources
 * @property {number} rings
 * @property {number} spacing
 * @property {Float64Array} srcX     Source x, indexed 0..sources-1.
 * @property {Float64Array} srcY
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {InterferenceRipplePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const sources = /** @type {number} */ (statics.sources)
  const rings = /** @type {number} */ (statics.rings)
  const spacing = /** @type {number} */ (statics.spacing)

  // FIXED draw count: MAX_SOURCES × 2 rng values, live coordinates in the
  // first `sources` slots (surplus consumed to keep stream position stable).
  const srcX = new Float64Array(MAX_SOURCES)
  const srcY = new Float64Array(MAX_SOURCES)
  for (let i = 0; i < MAX_SOURCES; i++) {
    srcX[i] = BAND_X_MIN + rng() * (BAND_X_MAX - BAND_X_MIN)
    srcY[i] = BAND_Y_MIN + rng() * (BAND_Y_MAX - BAND_Y_MIN)
  }

  return {
    sources,
    rings,
    spacing,
    srcX,
    srcY,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {InterferenceRipplePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const expand = /** @type {number} */ (resolved.expand)
  const weight = /** @type {number} */ (resolved.weight)
  const { sources, rings, spacing, srcX, srcY } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = weight

  // One accumulated arc path per source, one stroke per source.
  for (let s = 0; s < sources; s++) {
    const cx = srcX[s]
    const cy = srcY[s]
    ctx.beginPath()
    for (let i = 0; i < rings; i++) {
      // Ring-advance: at expand = 1 every ring has shifted one slot and
      // the ring at `i = rings-1` wraps back to slot 0, so the set of
      // visible radii equals the set at expand = 0.
      const t = (i + expand) % rings
      const r = t * spacing
      if (r < MIN_R) continue
      ctx.moveTo(cx + r, cy)
      ctx.arc(cx, cy, r, 0, TWO_PI)
    }
    ctx.stroke()
  }
}
