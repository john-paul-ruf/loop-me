// @ts-check
/**
 * Layer type 19 — Sunburst (FR-6, architecture §10.2 row 19).
 *
 * `wedgeCount` filled triangular wedges radiating from radius `innerRadius`
 * out to `innerRadius + wedgeLength`, each spanning `wedgeSpan` degrees,
 * evenly spaced and rotating as one. The filled analogue of ray-rings:
 * each ray is a fat pie wedge; `taper` makes the outer edge a point.
 *
 * Strategy per §10.2: one accumulated path, single fill — built on the
 * ctx's own path (D1 template), because §6.5 bans allocating a `Path2D`
 * inside `draw` and every wedge corner depends on animated radii/spans.
 * `prepare` caches the static per-wedge base angles (which change only
 * with `wedgeCount`) and the `taper` flag.
 *
 * **per-effect-glow — widened additive re-fill (orbit-dots archetype for
 * filled shapes).** When `glowStrength > 0`, `draw` first accumulates a
 * *widened* version of the wedge path — outer radius scaled by `K_GLOW_LEN`
 * and half-span by `K_GLOW_SPAN` — and fills it under
 * `globalCompositeOperation = 'lighter'`, then draws the crisp wedges over
 * it. Widening radially *and* angularly gives each wedge a soft fanning
 * halo rather than a flat brightness bump. FR-6 AC: NO `shadowBlur`. §6.5:
 * no per-frame allocation, no closures — the halo re-uses the ctx's own
 * path just like the crisp pass. See `src/util/glow.js` for the canonical
 * draw-time idiom and the `glowStrength` param convention.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws —
 * wedge angles are `rotation + (i/wedgeCount)*2π`, purely deterministic.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 19,
  name: 'Sunburst',
  role: 'primary',
  blurb: 'Fat pie wedges radiating from a hub, sweeping and breathing.',
  // Worst case doubles under the glow pass: one widened wedge accumulation +
  // fill (144 pathOps) plus the crisp accumulation + fill (144 pathOps).
  worstCase: { pathOps: 288, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('wedgeCount', 3, 36, { default: 12 }),
  A('innerRadius', 0, 200, { default: { min: 0, max: 80 } }),
  A('wedgeLength', 40, 900, { default: { min: 200, max: 520 } }),
  A('wedgeSpan', 5, 60, { unit: '°', default: { min: 15, max: 35 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.bool('taper', { default: true }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
/**
 * Halo extension multipliers for the widened re-fill glow pass. Tuned
 * visually: `K_GLOW_LEN` extends the wedge tip outward just enough that the
 * halo escapes the crisp fill; `K_GLOW_SPAN` widens each wedge angularly so
 * adjacent wedges' halos blend into a "fanning light" rather than reading as
 * a flat colour shift. Bumped enough to be clearly visible at every
 * `wedgeSpan` bound; not so much that the halo swamps the wedge silhouette
 * at max `wedgeCount` (36 wedges @ 60° span = severe overlap even crisp).
 */
const K_GLOW_LEN = 1.15
const K_GLOW_SPAN = 1.5

/**
 * @typedef {object} SunburstPrepared
 * @property {number} count
 * @property {Float64Array} angles  Per-wedge base angle, `(i/count)*2π`.
 * @property {boolean} taper
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SunburstPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.wedgeCount)
  const angles = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    angles[i] = (i / count) * 2 * Math.PI
  }
  return {
    count,
    angles,
    taper: statics.taper === true,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SunburstPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const r0 = /** @type {number} */ (resolved.innerRadius)
  const len = /** @type {number} */ (resolved.wedgeLength)
  const span = /** @type {number} */ (resolved.wedgeSpan) * DEG
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, angles, taper } = prepared
  const r1 = r0 + len
  const halfSpan = span / 2

  ctx.translate(CX, CY)
  ctx.rotate(rot)
  ctx.fillStyle = prepared.color

  // Glow pass — drawn FIRST so the crisp wedges sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip the pass entirely for byte-identical
  // pre-glow output. Widened wedges (outer radius × K_GLOW_LEN, halfSpan ×
  // K_GLOW_SPAN) accumulate the same way, filled once under 'lighter'. See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    const r1Glow = r0 + len * K_GLOW_LEN
    const halfSpanGlow = halfSpan * K_GLOW_SPAN
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const a = angles[i]
      const aLo = a - halfSpanGlow
      const aHi = a + halfSpanGlow
      ctx.moveTo(Math.cos(aLo) * r0, Math.sin(aLo) * r0)
      ctx.lineTo(Math.cos(aHi) * r0, Math.sin(aHi) * r0)
      if (taper) {
        ctx.lineTo(Math.cos(a) * r1Glow, Math.sin(a) * r1Glow)
      } else {
        ctx.lineTo(Math.cos(aHi) * r1Glow, Math.sin(aHi) * r1Glow)
        ctx.lineTo(Math.cos(aLo) * r1Glow, Math.sin(aLo) * r1Glow)
      }
      ctx.closePath()
    }
    ctx.fill()
    ctx.restore()
    // `fillStyle` survives `restore()` since it was set before `save()`.
  }

  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const a = angles[i]
    const aLo = a - halfSpan
    const aHi = a + halfSpan
    // Inner two corners of the wedge (at radius r0, ±halfSpan off the axis).
    ctx.moveTo(Math.cos(aLo) * r0, Math.sin(aLo) * r0)
    ctx.lineTo(Math.cos(aHi) * r0, Math.sin(aHi) * r0)
    if (taper) {
      // Sharp tip on the wedge axis at the outer radius.
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
    } else {
      // Square outer edge: two corners at radius r1, ±halfSpan off the axis.
      ctx.lineTo(Math.cos(aHi) * r1, Math.sin(aHi) * r1)
      ctx.lineTo(Math.cos(aLo) * r1, Math.sin(aLo) * r1)
    }
    ctx.closePath()
  }

  ctx.fill()
}