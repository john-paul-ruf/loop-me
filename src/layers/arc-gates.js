// @ts-check
/**
 * Layer type 7 — Arc Gates (FR-6, architecture §10.2 row 7, §5.1's own
 * worked example).
 *
 * Thick arc segments at several radii, rotating independently. Gate g sits
 * at radius `radiusStep × (g + 1)` (cached in `prepare` — `radiusStep` is
 * static; gate 0 is at most 200 px out, so at least one gate is always
 * on-canvas). Independence comes from the layer PRNG: each gate gets a fixed
 * angular offset and a rotation-rate multiplier.
 *
 * `rateSpread` interpretation (the reference is unreachable, Flag 7): the
 * per-gate rate multiplier is drawn from `[min(1, rateSpread),
 * max(1, rateSpread)]` and multiplies the resolved `rotation` value. The
 * resolved value is identical at frame 0 and frame total (FR-3, structural),
 * so a constant multiple of it is too — per-gate rates cannot tear the loop.
 *
 * **PRNG consumption order (FR-4, binding):** for each gate, ascending —
 * one draw for the angular offset, one for the rate multiplier.
 * 2 × gateCount draws total, nothing else.
 *
 * **per-effect-glow (feature per-effect-glow, FR-6 additive AC).** When
 * `glowStrength > 0`, `draw` re-runs the gate loop once BEFORE the crisp
 * pass under `globalCompositeOperation = 'lighter'` at `lineWidth × K_GLOW`
 * — the canonical wide-additive-re-stroke archetype (see `src/util/glow.js`
 * and the `pulse-rings.js` reference). No `shadowBlur` (FR-6). `glowStrength`
 * is appended LAST with default `{min:0,max:0}` (§9.2/§9.5): pre-glow seeds
 * decode to `gs === 0`, which is a hard no-op → byte-identical render.
 */

import { A, S } from '../model/params.js'
import { range } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 7,
  name: 'Arc Gates',
  role: 'primary',
  blurb: 'Thick arc segments at several radii, rotating independently.',
  // Worst case doubles under the glow pass: 10 crisp arcs + 10 halo arcs.
  worstCase: { pathOps: 20, drawCalls: 20 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('gateCount', 2, 10, { default: 5 }),
  A('arcSpan', 10, 170, { unit: '°', default: { min: 40, max: 120 } }),
  A('weight', 4, 60, { default: { min: 8, max: 20 } }),
  S.int('radiusStep', 40, 200, { default: 90 }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.num('rateSpread', 0.5, 3.0, { default: 1.5 }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/**
 * Halo width multiplier for the glow re-stroke. 2.5 keeps the halo clearly
 * wider than the arc at every `weight` without bleeding neighbouring gates
 * together — mirrors `pulse-rings.js` tuning.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} ArcGatesPrepared
 * @property {number} count
 * @property {Float64Array} radii   Per-gate radius.
 * @property {Float64Array} offset  Per-gate fixed angular offset.
 * @property {Float64Array} mult    Per-gate rotation-rate multiplier.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {ArcGatesPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const count = /** @type {number} */ (statics.gateCount)
  const radiusStep = /** @type {number} */ (statics.radiusStep)
  const spread = /** @type {number} */ (statics.rateSpread)
  const lo = Math.min(1, spread)
  const hi = Math.max(1, spread)
  const radii = new Float64Array(count)
  const offset = new Float64Array(count)
  const mult = new Float64Array(count)
  for (let g = 0; g < count; g++) {
    radii[g] = radiusStep * (g + 1)
    offset[g] = rng() * TWO_PI
    mult[g] = range(rng, lo, hi)
  }
  return {
    count,
    radii,
    offset,
    mult,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {ArcGatesPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const half = (/** @type {number} */ (resolved.arcSpan) * DEG) / 2
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const weight = /** @type {number} */ (resolved.weight)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, radii, offset, mult } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineCap = 'round'

  // Glow pass — drawn FIRST so the crisp arcs sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow
  // output. See `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    for (let g = 0; g < count; g++) {
      const a = rot * mult[g] + offset[g]
      ctx.beginPath()
      ctx.arc(CX, CY, radii[g], a - half, a + half)
      ctx.stroke()
    }
    ctx.restore()
    // `strokeStyle` and `lineCap` survive `restore()` — set before `save()`.
  }

  ctx.lineWidth = weight
  for (let g = 0; g < count; g++) {
    const a = rot * mult[g] + offset[g]
    ctx.beginPath()
    ctx.arc(CX, CY, radii[g], a - half, a + half)
    ctx.stroke()
  }
}
