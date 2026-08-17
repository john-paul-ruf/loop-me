// @ts-check
/**
 * Layer type 3 — Layered Poly (FR-6, architecture §10.2 row 3).
 *
 * One regular polygon, re-stroked `polyCount` times, each copy scaled by
 * `scaleStep^k` and turned by `rotationStep × k`. Strategy per §10.2: one
 * `Path2D` (a unit polygon, built in `prepare` — `sides` is static), stroked
 * under 12 absolute transforms in `draw`. `lineWidth` is divided by the
 * per-copy scale so stroke weight stays in canvas pixels while the geometry
 * scales.
 *
 * `setTransform` is absolute, so no save/restore per copy is needed; the
 * painter's per-layer restore (§6.4) puts the transform back.
 * Consumes zero PRNG draws.
 *
 * **per-effect-glow — wide re-stroke per copy (pulse-rings archetype).**
 * `lineWidth` varies per copy (weight / scale), so the glow pass walks the
 * same 12-copy schedule as the crisp pass — one guarded `'lighter'` loop
 * first with `weight × K_GLOW / scale`, the crisp loop second. The unit
 * `Path2D` is stroked in both. `gs === 0` is a hard no-op — pre-glow seeds
 * render byte-identical (§9.5). FR-6 AC: NO `shadowBlur`. §6.5: no
 * per-frame allocation. See `src/util/glow.js` for the canonical draw-time
 * idiom and the `glowStrength` param convention.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 3,
  name: 'Layered Poly',
  role: 'primary',
  blurb: 'Nested polygons spiralling inward, turning as they shrink.',
  // Worst case doubles under the glow pass: 12 copies × (crisp stroke +
  // glow stroke) = 24 drawCalls. pathOps: sides × copies × 2 passes = 12 ×
  // 12 × 2 = 288.
  worstCase: { pathOps: 288, drawCalls: 24 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('polyCount', 1, 12, { default: 5 }),
  S.int('sides', 3, 12, { default: 6 }),
  A('baseRadius', 60, 700, { default: { min: 200, max: 480 } }),
  S.num('scaleStep', 0.5, 0.95, { default: 0.78 }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.num('rotationStep', -30, 30, { unit: '°', default: 10 }),
  A('strokeWeight', 1, 16, { default: { min: 2, max: 6 } }),
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
 * Halo width multiplier for the wide re-stroke glow pass. Matches
 * pulse-rings' 2.5× — the per-copy widening reads as a soft aura on each
 * nested polygon at every `strokeWeight` and `scaleStep` combination.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} LayeredPolyPrepared
 * @property {number} count
 * @property {Path2D} path      Unit polygon, radius 1, first vertex up.
 * @property {Float64Array} scales  scaleStep^k per copy.
 * @property {number} stepRad   rotationStep in radians.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {LayeredPolyPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.polyCount)
  const sides = /** @type {number} */ (statics.sides)
  const scaleStep = /** @type {number} */ (statics.scaleStep)

  const path = new Path2D()
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i / sides) * 2 * Math.PI
    if (i === 0) path.moveTo(Math.cos(a), Math.sin(a))
    else path.lineTo(Math.cos(a), Math.sin(a))
  }
  path.closePath()

  const scales = new Float64Array(count)
  for (let k = 0; k < count; k++) scales[k] = Math.pow(scaleStep, k)

  return {
    count,
    path,
    scales,
    stepRad: /** @type {number} */ (statics.rotationStep) * DEG,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {LayeredPolyPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, path, scales, stepRad } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'

  // Glow pass — halo under mark. Same per-copy transform schedule as the
  // crisp pass, only `lineWidth` scaled by K_GLOW. `gs === 0` is a hard
  // no-op: skip entirely for byte-identical pre-glow output. See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    for (let k = 0; k < count; k++) {
      const s = base * scales[k]
      const a = rot + stepRad * k
      const c = Math.cos(a) * s
      const n = Math.sin(a) * s
      ctx.setTransform(c, n, -n, c, CX, CY)
      ctx.lineWidth = (weight * K_GLOW) / s
      ctx.stroke(path)
    }
    ctx.restore()
    // `strokeStyle`/`lineJoin` survive `restore()` — set before `save()`.
  }

  for (let k = 0; k < count; k++) {
    const s = base * scales[k]
    const a = rot + stepRad * k
    const c = Math.cos(a) * s
    const n = Math.sin(a) * s
    ctx.setTransform(c, n, -n, c, CX, CY)
    ctx.lineWidth = weight / s
    ctx.stroke(path)
  }
}
