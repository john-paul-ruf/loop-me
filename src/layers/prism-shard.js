// @ts-check
/**
 * Layer type 23 — Prism Shard (FR-6, architecture §10.2 row 23).
 *
 * A central triangular shard (a regular 3-sided polygon at `outerRadius`)
 * with `accentCount` thinner inner triangles at radii shrinking toward
 * the centre — a stained-glass facet. The outer triangle is filled; the
 * inner accents are stroked.
 *
 * Strategy per §10.2: one unit-triangle `Path2D` (built in `prepare`, since
 * the shape is a fixed 3-sided polygon) reused for the outer fill under
 * `setTransform` and for each accent stroke under a shrinking scale. The
 * outer fill uses the animated `outerRadius` as the scale; each accent
 * uses `outerRadius × accentStep^k`. `lineWidth` is divided by the per-copy
 * scale so stroke weight stays in canvas pixels (layered-poly pattern).
 * `setTransform` is absolute; the painter's restore (§6.4) resets.
 *
 * **per-effect-glow — dual technique, per primitive.**
 * Outer filled triangle → widened re-fill (same unit `tri` re-rendered under
 * a scale of `outerRadius × K_GLOW_FILL`), analogous to orbit-dots option B
 * for filled marks: the halo carries the triangle's shape rather than a
 * circular blob. Each accent stroke → wide re-stroke (matching pulse-rings)
 * at `lineWidth × K_GLOW_STROKE / scale`. Both glow passes run first inside
 * one guarded `'lighter'` block so the crisp facet sits on top. `gs === 0`
 * is a hard no-op — pre-glow seeds render byte-identical (§9.5). FR-6 AC:
 * NO `shadowBlur`. §6.5: no per-frame allocation — the shared unit `tri`
 * `Path2D` handles both passes. See `src/util/glow.js` for the canonical
 * draw-time idiom and the `glowStrength` param convention.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 23,
  name: 'Prism Shard',
  role: 'primary',
  blurb: 'A faceted triangle with concentric accent outlines.',
  // Worst case at accentCount=8, gs=1: 1 widened outer fill + 8 accent
  // wide-strokes (glow) + 1 crisp outer fill + 8 accent crisp-strokes = 18
  // draw calls. pathOps: 3 per stroke/fill × 18 = 54.
  worstCase: { pathOps: 54, drawCalls: 18 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('accentCount', 0, 8, { default: 3 }),
  A('outerRadius', 60, 700, { default: { min: 200, max: 480 } }),
  S.num('accentStep', 0.1, 0.9, { default: 0.66 }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  A('strokeWeight', 1, 10, { default: { min: 1.5, max: 4 } }),
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
 * Halo multipliers for the two glow techniques. `K_GLOW_FILL` widens the
 * outer triangle just enough that the halo escapes its silhouette without
 * distorting the shard's shape (a triangle stays legibly a triangle at
 * 1.15×). `K_GLOW_STROKE` matches pulse-rings' 2.5× — the halo has to
 * stand off the accent's crisp line at every `strokeWeight` bound.
 */
const K_GLOW_FILL = 1.15
const K_GLOW_STROKE = 2.5

/**
 * @typedef {object} PrismShardPrepared
 * @property {number} accentCount
 * @property {Path2D} tri     Unit triangle, radius 1, first vertex up.
 * @property {Float64Array} scales  accentStep^k per accent, k = 0 .. accentCount-1.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {PrismShardPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const accentCount = /** @type {number} */ (statics.accentCount)
  const step = /** @type {number} */ (statics.accentStep)

  const tri = new Path2D()
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * TWO_PI
    if (i === 0) tri.moveTo(Math.cos(a), Math.sin(a))
    else tri.lineTo(Math.cos(a), Math.sin(a))
  }
  tri.closePath()

  const scales = new Float64Array(accentCount)
  for (let k = 0; k < accentCount; k++) scales[k] = Math.pow(step, k)

  return {
    accentCount,
    tri,
    scales,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {PrismShardPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const outer = /** @type {number} */ (resolved.outerRadius)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { accentCount, tri, scales } = prepared

  const c = Math.cos(rot)
  const s = Math.sin(rot)

  // Glow pass — halo under mark. All glow draws run inside one guarded
  // `'lighter'` block so the crisp facet sits on top. `gs === 0` is a hard
  // no-op: skip the pass entirely for byte-identical pre-glow output. See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs

    // Outer widened re-fill.
    const outerGlow = outer * K_GLOW_FILL
    ctx.setTransform(outerGlow * c, outerGlow * s, -outerGlow * s, outerGlow * c, CX, CY)
    ctx.fillStyle = prepared.color
    ctx.fill(tri)

    // Accent wide re-strokes at the crisp positions/scales.
    ctx.strokeStyle = prepared.color
    ctx.lineJoin = 'round'
    for (let k = 0; k < accentCount; k++) {
      const scale = outer * scales[k]
      ctx.setTransform(scale * c, scale * s, -scale * s, scale * c, CX, CY)
      ctx.lineWidth = (weight * K_GLOW_STROKE) / scale
      ctx.stroke(tri)
    }

    ctx.restore()
    // `restore()` puts the transform, alpha, and blend op back to what they
    // were on entry — the painter's per-layer fence handles top-level reset.
  }

  // Outer fill: scale + rotate by outerRadius.
  ctx.setTransform(outer * c, outer * s, -outer * s, outer * c, CX, CY)
  ctx.fillStyle = prepared.color
  ctx.fill(tri)

  // Accents: stroke the same unit triangle under shrinking scales.
  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  for (let k = 0; k < accentCount; k++) {
    const scale = outer * scales[k]
    ctx.setTransform(scale * c, scale * s, -scale * s, scale * c, CX, CY)
    ctx.lineWidth = weight / scale
    ctx.stroke(tri)
  }
}