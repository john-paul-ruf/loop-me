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
 * **per-effect-glow (S04):** wide additive re-stroke archetype. When
 * `glowStrength > 0`, `draw` re-runs the per-source ring loop once BEFORE
 * the crisp pass under `globalCompositeOperation = 'lighter'` at
 * `lineWidth × K_GLOW` — a soft halo under each ring family so the
 * interference read as a glowing moiré. The same `expand` / MIN_R filter
 * applies to the halo, so loop closure is preserved (the family that shifts
 * one slot at `expand = 1` includes the same halo rings as at
 * `expand = 0`). No `shadowBlur` (FR-6); `gs === 0` is a hard no-op →
 * pre-glow seeds decode byte-identical (§9.5). K = 2.5 — the sparse ring
 * families can afford a wider halo without visual overlap.
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
  // Worst case doubles under the glow pass: 3 halo strokes + 3 crisp strokes
  // at sources.max = 3, each halo path is the same shape as its crisp
  // counterpart.
  worstCase: { pathOps: 100, drawCalls: 6 },
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
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const W = 1080
const CX = 540
const CY = 960
const TWO_PI = Math.PI * 2
/**
 * Halo width multiplier. Sparse — at most 3 ring families of ~13 rings each
 * at spacing.min = 40 px. 2.5 gives a generous halo without visual overlap
 * between neighbouring rings within a family.
 */
const K_GLOW = 2.5
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
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { sources, rings, spacing, srcX, srcY } = prepared

  ctx.strokeStyle = prepared.color

  // Glow pass — one halo stroke per source, drawn FIRST so the crisp
  // moiré sits on top (halo under mark). Same `expand` and MIN_R filter
  // as the crisp pass so loop closure is preserved. `gs === 0` is a
  // hard no-op: skip entirely for byte-identical pre-glow output.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    for (let s = 0; s < sources; s++) {
      const cx = srcX[s]
      const cy = srcY[s]
      ctx.beginPath()
      for (let i = 0; i < rings; i++) {
        const t = (i + expand) % rings
        const r = t * spacing
        if (r < MIN_R) continue
        ctx.moveTo(cx + r, cy)
        ctx.arc(cx, cy, r, 0, TWO_PI)
      }
      ctx.stroke()
    }
    ctx.restore()
    // `strokeStyle` survives `restore()` — set before save.
  }

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
