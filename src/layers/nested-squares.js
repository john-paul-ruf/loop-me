// @ts-check
/**
 * Layer type 18 — Nested Squares (FR-6, architecture §10.2 row 18).
 *
 * `squareCount` concentric squares, each at half-side
 * `baseRadius + i × stepGap`, each rotated by `rotation + i × rotationStep`.
 * The layered-poly trick specialised to 4 sides: the per-square transform
 * is a clean rotation+scale rather than a 2×2 matrix.
 *
 * Strategy per §10.2: one unit-square `Path2D` (built in `prepare`, since
 * `squareCount` only fixes how many copies are stroked) re-stroked under
 * `squareCount` absolute transforms in `draw`. `lineWidth` is divided by
 * the per-copy scale so stroke weight stays in canvas pixels (layered-poly
 * pattern). `setTransform` is absolute, so no save/restore per copy is
 * needed; the painter's per-layer restore (§6.4) puts the transform back.
 *
 * **per-effect-glow — wide re-stroke per copy (pulse-rings archetype,
 * layered-poly form).** `lineWidth` varies per copy (weight / r), so the
 * glow pass walks the same 16-copy schedule as the crisp pass — one
 * guarded `'lighter'` loop first with `weight × K_GLOW / r`, the crisp
 * loop second. The unit `Path2D` is stroked in both. `gs === 0` is a hard
 * no-op — pre-glow seeds render byte-identical (§9.5). FR-6 AC: NO
 * `shadowBlur`. §6.5: no per-frame allocation. See `src/util/glow.js` for
 * the canonical draw-time idiom and the `glowStrength` param convention.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 18,
  name: 'Nested Squares',
  role: 'primary',
  blurb: 'Concentric squares turning at different rates as they grow.',
  // Worst case doubles under the glow pass: 16 copies × (crisp stroke +
  // glow stroke) = 32 drawCalls. pathOps: 4 sides × 16 copies × 2 passes =
  // 128.
  worstCase: { pathOps: 128, drawCalls: 32 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('squareCount', 2, 16, { default: 6 }),
  A('baseRadius', 40, 400, { default: { min: 80, max: 260 } }),
  A('stepGap', 20, 200, { default: { min: 40, max: 120 } }),
  A('strokeWeight', 1, 12, { default: { min: 2, max: 6 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.num('rotationStep', -30, 30, { unit: '°', default: 8 }),
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
 * pulse-rings' 2.5× — clearly wider than the crisp per-copy line at every
 * `strokeWeight` bound, without swamping the inner (small-radius) squares.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} NestedSquaresPrepared
 * @property {number} count
 * @property {Path2D} path  Unit square, half-side 1, centred at origin.
 * @property {number} stepRad  `rotationStep` in radians.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {NestedSquaresPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.squareCount)
  const path = new Path2D()
  path.moveTo(-1, -1)
  path.lineTo(1, -1)
  path.lineTo(1, 1)
  path.lineTo(-1, 1)
  path.closePath()
  return {
    count,
    path,
    stepRad: /** @type {number} */ (statics.rotationStep) * DEG,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {NestedSquaresPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const stepGap = /** @type {number} */ (resolved.stepGap)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, path, stepRad } = prepared

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
      const r = base + k * stepGap
      const a = rot + stepRad * k
      const c = Math.cos(a) * r
      const s = Math.sin(a) * r
      ctx.setTransform(c, s, -s, c, CX, CY)
      ctx.lineWidth = (weight * K_GLOW) / r
      ctx.stroke(path)
    }
    ctx.restore()
    // `strokeStyle`/`lineJoin` survive `restore()` — set before `save()`.
  }

  for (let k = 0; k < count; k++) {
    const r = base + k * stepGap
    const a = rot + stepRad * k
    const c = Math.cos(a) * r
    const s = Math.sin(a) * r
    ctx.setTransform(c, s, -s, c, CX, CY)
    ctx.lineWidth = weight / r
    ctx.stroke(path)
  }
}