// @ts-check
/**
 * Layer type 21 — Burst Star (FR-6, architecture §10.2 row 21).
 *
 * An `outerPoints`-point star with alternating outer and inner vertices at
 * radii `outerRadius` and `innerRadius`, rotating as one. This is
 * petal-bloom's "radiating wedges" reduced to a pure outline: one closed
 * polygon, single stroke or fill. `innerRadius` is clamped above zero,
 * guaranteeing a star with visible indentations; the outer tips always
 * reach the outer radius.
 *
 * Strategy per §10.2: one accumulated path, single stroke/fill — built on
 * the ctx's own path (D1 template), because §6.5 bans allocating a `Path2D`
 * inside `draw` and every vertex depends on animated radii. `prepare`
 * caches the static vertex angles (which change only with `outerPoints`).
 * Consumes zero PRNG draws.
 *
 * **per-effect-glow — dual technique keyed on the static `filled` flag.**
 * Stroked branch → wide re-stroke of the same accumulated path
 * (pulse-rings archetype): build once, stroke wide+`'lighter'`, then stroke
 * crisp. Filled branch → widened re-fill (orbit-dots archetype): build a
 * larger star (both radii × `K_GLOW_FILL`), fill under `'lighter'`, then
 * build and fill the crisp star. `gs === 0` is a hard no-op — pre-glow seeds
 * render byte-identical (§9.5). FR-6 AC: NO `shadowBlur`. §6.5: zero
 * per-frame allocation, no closures. See `src/util/glow.js` for the
 * canonical draw-time idiom and the `glowStrength` param convention.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 21,
  name: 'Burst Star',
  role: 'primary',
  blurb: 'A many-pointed star pulsing between inner and outer radii.',
  // Worst case doubles under the glow pass. Filled branch: crisp path build
  // (48) + widened path build (48) = 96 pathOps, one fill each = 2 drawCalls.
  // Stroked branch: path built once, stroked twice = 48 pathOps, 2 drawCalls.
  // The filled branch is the worst — pin to it.
  worstCase: { pathOps: 96, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('outerPoints', 3, 24, { default: 6 }),
  A('outerRadius', 60, 800, { default: { min: 200, max: 520 } }),
  A('innerRadius', 20, 400, { default: { min: 60, max: 200 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  A('strokeWeight', 1, 14, { default: { min: 2, max: 6 } }),
  S.bool('filled', { default: false }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/**
 * Halo multipliers for the two glow techniques. `K_GLOW_STROKE` widens the
 * stroke weight of the re-stroke pass (matches pulse-rings' 2.5×); at
 * lower it hides inside the crisp outline, at higher it swamps the star
 * silhouette. `K_GLOW_FILL` extends both star radii for the filled halo —
 * subtle (1.15×) so the shape stays recognisably a star with `outerPoints`
 * up to 24 and the halo just fans outward from the tips and indentations.
 */
const K_GLOW_STROKE = 2.5
const K_GLOW_FILL = 1.15

/**
 * @typedef {object} BurstStarPrepared
 * @property {number} count
 * @property {number} vertexCount
 * @property {Float64Array} angles  Per-vertex angle, first vertex up.
 * @property {boolean} filled
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {BurstStarPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.outerPoints)
  const vertexCount = 2 * count
  const angles = new Float64Array(vertexCount)
  for (let j = 0; j < vertexCount; j++) {
    angles[j] = -Math.PI / 2 + (j / vertexCount) * TWO_PI
  }
  return {
    count,
    vertexCount,
    angles,
    filled: statics.filled === true,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {BurstStarPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const rOut = /** @type {number} */ (resolved.outerRadius)
  const rIn = /** @type {number} */ (resolved.innerRadius)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { vertexCount, angles, filled } = prepared

  ctx.translate(CX, CY)
  ctx.rotate(rot)

  if (filled) {
    // Filled branch — widened re-fill glow, then crisp fill.
    ctx.fillStyle = prepared.color

    // Glow pass — halo under mark. `gs === 0` is a hard no-op → skip. See
    // `src/util/glow.js` for the canonical idiom.
    if (gs > 0) {
      const a0 = ctx.globalAlpha
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = a0 * gs
      const rOutGlow = rOut * K_GLOW_FILL
      const rInGlow = rIn * K_GLOW_FILL
      ctx.beginPath()
      for (let j = 0; j < vertexCount; j++) {
        const r = j % 2 === 0 ? rOutGlow : rInGlow
        const x = Math.cos(angles[j]) * r
        const y = Math.sin(angles[j]) * r
        if (j === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      // `fillStyle` survives `restore()` since it was set before `save()`.
    }

    ctx.beginPath()
    for (let j = 0; j < vertexCount; j++) {
      const r = j % 2 === 0 ? rOut : rIn
      const x = Math.cos(angles[j]) * r
      const y = Math.sin(angles[j]) * r
      if (j === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  } else {
    // Stroked branch — build path once, wide re-stroke first, crisp stroke
    // second (halo under mark). §6.5: same accumulated path, two stroke calls.
    ctx.strokeStyle = prepared.color
    ctx.lineJoin = 'round'

    ctx.beginPath()
    for (let j = 0; j < vertexCount; j++) {
      const r = j % 2 === 0 ? rOut : rIn
      const x = Math.cos(angles[j]) * r
      const y = Math.sin(angles[j]) * r
      if (j === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()

    if (gs > 0) {
      const a0 = ctx.globalAlpha
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = a0 * gs
      ctx.lineWidth = weight * K_GLOW_STROKE
      ctx.stroke()
      ctx.restore()
      // `strokeStyle`/`lineJoin` survive `restore()` (set before `save()`).
    }

    ctx.lineWidth = weight
    ctx.stroke()
  }
}