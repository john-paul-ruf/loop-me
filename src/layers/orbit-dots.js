// @ts-check
/**
 * Layer type 6 — Orbit Dots (FR-6, architecture §10.2 row 6).
 *
 * Rings of dots around the centre; ring i sits at `baseRadius + i × ringGap`
 * (both breathe via the animated `baseRadius`). `rateSpread` interpretation
 * (the reference is unreachable, Flag 7): each ring's dot size is scaled by
 * a PRNG-drawn multiplier in `[min(1, rateSpread), max(1, rateSpread)]`, so
 * rings breathe at visibly different amplitudes; 1.0 makes them uniform.
 * A constant multiplier of a loop-closed value keeps the loop closed.
 *
 * Each ring's anchor dot points up (−π/2) with a PRNG jitter of ±30°, and the
 * remaining dots space evenly from it. The jitter bound is deliberate: it
 * keeps the anchor dot on-canvas at the full `baseRadius` bound of 800
 * (540,960-centred portrait canvas), so no control setting can render
 * nothing (FR-6 AC).
 *
 * **PRNG consumption order (FR-4, binding):** for each ring, ascending —
 * one draw for the phase jitter, one for the size multiplier. 2 × ringCount
 * draws total, nothing else.
 *
 * **per-effect-glow reference — the fill/dot budget archetype.**
 *
 * A per-dot `glowSprite` would be 192 additive blits at worst case, well past
 * the original 8-drawCall budget. Instead this layer copies the crisp dot
 * path once more under `globalCompositeOperation = 'lighter'` with the dot
 * radius widened by `K_GLOW` — one extra `fill()` per ring (8 more calls),
 * same number of arc pathOps per pass. That's option B in the SESSION-01
 * decision matrix ("a single additive re-fill of the whole dot path at a
 * widened dot radius") — chosen over option A (per-ring `glowSprite`) because
 * a single sprite per ring reads as an asymmetric spot rather than a per-dot
 * halo, and this layer's identity is *the dots themselves*.
 *
 * S03/S05/S06 fill/dot layers copy this pattern verbatim: widen the mark
 * radius, re-issue the fill under 'lighter', bump `worstCase` by exactly one
 * extra pass. Sprite-based glow (`glowGradient` + `glowSprite`) remains
 * available in `src/util/glow.js` for texture overlays whose "mark" is a
 * gradient itself (see `fuzz-flare.js`).
 */

import { A, S } from '../model/params.js'
import { range } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 6,
  name: 'Orbit Dots',
  role: 'primary',
  blurb: 'Constellations of dots riding invisible orbits.',
  // Worst case doubles under the glow pass: one extra widened `fill()` per
  // ring (8 → 16 drawCalls) and one extra widened dot path per ring
  // (192 → 384 arc pathOps).
  worstCase: { pathOps: 384, drawCalls: 16 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ringCount', 1, 8, { default: 3 }),
  S.int('dotsPerRing', 1, 24, { default: 8 }),
  A('baseRadius', 60, 800, { default: { min: 180, max: 420 } }),
  S.int('ringGap', 40, 220, { default: 120 }),
  A('dotRadius', 2, 30, { default: { min: 6, max: 14 } }),
  S.num('rateSpread', 0.5, 3.0, { default: 1.5 }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const TWO_PI = Math.PI * 2
/** ±30° anchor jitter — see the header for why this bound is load-bearing. */
const JITTER = Math.PI / 3
/**
 * Dot-radius multiplier for the additive re-fill glow pass. Tuned visually:
 * below 1.4 the halo hides inside the crisp dot at every declared radius;
 * above 2.5 adjacent dots' halos merge into an ambient smear on the tightest
 * `dotsPerRing`. 1.8 gives every dot a clearly wider ring of light without
 * bleeding the constellation into a wash.
 */
const K_GLOW = 1.8

/**
 * @typedef {object} OrbitDotsPrepared
 * @property {number} rings
 * @property {number} dots
 * @property {number} gap
 * @property {number} step      Angle between dots in a ring.
 * @property {Float64Array} phase  Per-ring anchor angle.
 * @property {Float64Array} mult   Per-ring dot-size multiplier.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {OrbitDotsPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const rings = /** @type {number} */ (statics.ringCount)
  const dots = /** @type {number} */ (statics.dotsPerRing)
  const spread = /** @type {number} */ (statics.rateSpread)
  const lo = Math.min(1, spread)
  const hi = Math.max(1, spread)
  const phase = new Float64Array(rings)
  const mult = new Float64Array(rings)
  for (let i = 0; i < rings; i++) {
    phase[i] = -Math.PI / 2 + (rng() - 0.5) * JITTER
    mult[i] = range(rng, lo, hi)
  }
  return {
    rings,
    dots,
    gap: /** @type {number} */ (statics.ringGap),
    step: TWO_PI / dots,
    phase,
    mult,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {OrbitDotsPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const dotR = /** @type {number} */ (resolved.dotRadius)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { rings, dots, gap, step, phase, mult } = prepared

  ctx.fillStyle = prepared.color

  // Glow pass — drawn FIRST so the crisp dots sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip the pass entirely for byte-identical
  // pre-glow output. Same dot geometry, radius scaled by `K_GLOW`, colour
  // re-filled under 'lighter'. See `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    for (let i = 0; i < rings; i++) {
      const r = base + i * gap
      const dr = dotR * mult[i] * K_GLOW
      ctx.beginPath()
      for (let d = 0; d < dots; d++) {
        const a = phase[i] + d * step
        const x = CX + Math.cos(a) * r
        const y = CY + Math.sin(a) * r
        ctx.moveTo(x + dr, y)
        ctx.arc(x, y, dr, 0, TWO_PI)
      }
      ctx.fill()
    }
    ctx.restore()
    // `fillStyle` survives `restore()` since it was set before `save()`.
  }

  for (let i = 0; i < rings; i++) {
    const r = base + i * gap
    const dr = dotR * mult[i]
    ctx.beginPath()
    for (let d = 0; d < dots; d++) {
      const a = phase[i] + d * step
      const x = CX + Math.cos(a) * r
      const y = CY + Math.sin(a) * r
      ctx.moveTo(x + dr, y) // break the chord `arc` would draw from the previous dot
      ctx.arc(x, y, dr, 0, TWO_PI)
    }
    ctx.fill()
  }
}
