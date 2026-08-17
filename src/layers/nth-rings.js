// @ts-check
/**
 * Layer type 2 — Nth Rings (FR-6, architecture §10.2 row 2).
 *
 * Concentric rings marching outward from the centre. Ring i sits at radius
 * `radiusOffset + spacing × (i + 1)` — all three radial inputs are animated,
 * so the whole ring stack breathes. `dashCount` 0 strokes solid rings as one
 * accumulated ctx path (1 draw call); a non-zero `dashCount` needs a per-ring
 * `setLineDash` because the dash segment length scales with each ring's
 * radius (24 draw calls worst case, §10.2).
 *
 * The dash pattern array is preallocated in `prepare` and mutated in `draw`
 * (§6.5 bans array literals on the frame path; `setLineDash` copies it).
 * Consumes zero PRNG draws.
 *
 * **per-effect-glow (feature per-effect-glow, FR-6 additive AC).** Sibling of
 * `pulse-rings.js` — when `glowStrength > 0`, `draw` re-runs the ring pass
 * once BEFORE the crisp pass under `globalCompositeOperation = 'lighter'` at
 * `strokeWeight × K_GLOW` (wide-additive-re-stroke archetype; see
 * `src/util/glow.js`). No `shadowBlur` (FR-6). `glowStrength` is appended
 * LAST with default `{min:0,max:0}` (§9.2/§9.5): pre-glow seeds decode to
 * `gs === 0`, which is a hard no-op → byte-identical render.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 2,
  name: 'Nth Rings',
  role: 'primary',
  blurb: 'Concentric rings breathing outward, solid or dashed.',
  // Worst case doubles under the glow pass: 24 crisp strokes + 24 halo strokes
  // (dashed path — solid path is 1 accumulated stroke, doubled to 2, well
  // within the 48 headroom).
  worstCase: { pathOps: 48, drawCalls: 48 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ringCount', 2, 24, { default: 8 }),
  A('spacing', 10, 160, { default: { min: 36, max: 88 } }),
  A('strokeWeight', 1, 20, { default: { min: 2, max: 6 } }),
  A('radiusOffset', 0, 200, { default: { min: 0, max: 60 } }),
  S.int('dashCount', 0, 48),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const TWO_PI = Math.PI * 2
/**
 * Halo width multiplier for the glow re-stroke. 2.5 mirrors `pulse-rings.js`
 * — clearly wider than any `strokeWeight` (max 20 → halo 50) without bleeding
 * adjacent rings into a wash at close `spacing`.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} NthRingsPrepared
 * @property {number} count
 * @property {number} dashCount
 * @property {number[]} dash   Reused 2-element segment array for setLineDash.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {NthRingsPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  return {
    count: /** @type {number} */ (statics.ringCount),
    dashCount: /** @type {number} */ (statics.dashCount),
    dash: [0, 0],
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {NthRingsPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const spacing = /** @type {number} */ (resolved.spacing)
  const off = /** @type {number} */ (resolved.radiusOffset)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, dashCount, dash } = prepared

  ctx.strokeStyle = prepared.color

  // Glow pass — drawn FIRST so the crisp rings sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow
  // output. See `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    if (dashCount === 0) {
      ctx.beginPath()
      for (let i = 0; i < count; i++) {
        const r = off + spacing * (i + 1)
        ctx.moveTo(CX + r, CY)
        ctx.arc(CX, CY, r, 0, TWO_PI)
      }
      ctx.stroke()
    } else {
      for (let i = 0; i < count; i++) {
        const r = off + spacing * (i + 1)
        const seg = (Math.PI * r) / dashCount
        dash[0] = seg
        dash[1] = seg
        ctx.setLineDash(dash)
        ctx.beginPath()
        ctx.arc(CX, CY, r, 0, TWO_PI)
        ctx.stroke()
      }
    }
    ctx.restore()
    // `strokeStyle` survives `restore()` since it was set before `save()`.
  }

  ctx.lineWidth = weight

  if (dashCount === 0) {
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const r = off + spacing * (i + 1)
      ctx.moveTo(CX + r, CY) // break the chord `arc` would draw from the previous ring
      ctx.arc(CX, CY, r, 0, TWO_PI)
    }
    ctx.stroke()
  } else {
    for (let i = 0; i < count; i++) {
      const r = off + spacing * (i + 1)
      // dashCount dashes + dashCount gaps around a 2πr circumference.
      const seg = (Math.PI * r) / dashCount
      dash[0] = seg
      dash[1] = seg
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.arc(CX, CY, r, 0, TWO_PI)
      ctx.stroke()
    }
  }
}
