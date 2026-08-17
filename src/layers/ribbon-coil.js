// @ts-check
/**
 * Layer type 22 — Ribbon Coil (FR-6, architecture §10.2 row 22).
 *
 * A single polyline that spirals outward from centre: angle
 * `θ = u × sweep` and radius `r = innerRadius + (outerRadius − innerRadius)
 * × u`, where `u ∈ [0, 1]`. Plus a sinusoidal radial wobble of amplitude
 * `wobble` that makes the ribbon weave like a coiled spring. The whole
 * thing accumulates on the ctx's path and strokes once. Closest analogue:
 * encircled-spiral's "polyline per arm", but here it is one long arm.
 *
 * Strategy per §10.2: one accumulated path, single stroke — built on the
 * ctx's own path (D1 template), because §6.5 bans allocating a `Path2D`
 * inside `draw` and every point depends on animated radii. `prepare`
 * caches `POINTS` (the sample count) and `turns` (→ `sweepRad`). Consumes
 * zero PRNG draws.
 *
 * **per-effect-glow — wide re-stroke (pulse-rings archetype).** When
 * `glowStrength > 0`, `draw` accumulates the polyline once on the ctx path
 * and issues *two* strokes: first a wide (`weight × K_GLOW`) stroke under
 * `globalCompositeOperation = 'lighter'` as the halo, then the crisp stroke
 * on top. Reusing the same path (rather than rebuilding it twice like
 * pulse-rings, which needs per-ring `lineWidth`) saves 400 `lineTo` ops per
 * frame — `lineWidth` is uniform along the ribbon, so one accumulation
 * covers both passes. `gs === 0` is a hard no-op — pre-glow seeds render
 * byte-identical (§9.5). FR-6 AC: NO `shadowBlur`. §6.5: zero per-frame
 * allocation, no closures. See `src/util/glow.js` for the canonical draw-
 * time idiom and the `glowStrength` param convention.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 22,
  name: 'Ribbon Coil',
  role: 'primary',
  blurb: 'A single ribbon spiralling outward, weaving as it goes.',
  // Worst case: same accumulated path (400 pathOps), stroked twice under
  // glow (wide halo + crisp mark). Path is built once — pathOps unchanged.
  worstCase: { pathOps: 400, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('turns', 1, 8, { default: 3 }),
  A('innerRadius', 0, 200, { default: { min: 0, max: 60 } }),
  A('outerRadius', 40, 900, { default: { min: 200, max: 520 } }),
  A('wobble', 0, 120, { default: { min: 0, max: 60 } }),
  A('strokeWeight', 1, 14, { default: { min: 2, max: 6 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
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
/** Sampled points on the polyline (§10.2 path-ops budget). */
const POINTS = 400
/**
 * Halo width multiplier for the wide re-stroke glow pass. Matches
 * pulse-rings' 2.5×: below 2 the halo hides inside the crisp ribbon at any
 * `strokeWeight`; above 3 it bleeds neighbouring turns of the spiral
 * together and the coil reads as an ambient wash rather than a woven line.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} RibbonCoilPrepared
 * @property {number} sweepRad  `turns * 2π`.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {RibbonCoilPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const turns = /** @type {number} */ (statics.turns)
  return {
    sweepRad: turns * TWO_PI,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {RibbonCoilPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const r0 = /** @type {number} */ (resolved.innerRadius)
  const r1 = /** @type {number} */ (resolved.outerRadius)
  const wob = /** @type {number} */ (resolved.wobble)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { sweepRad } = prepared
  const turns = sweepRad / TWO_PI

  ctx.translate(CX, CY)
  ctx.rotate(rot)

  ctx.strokeStyle = prepared.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Accumulate the polyline once — `lineWidth` is uniform along the ribbon,
  // so both the glow and crisp strokes reuse the same path.
  ctx.beginPath()
  for (let i = 0; i < POINTS; i++) {
    const u = i / (POINTS - 1)
    const ang = u * sweepRad
    const r = r0 + (r1 - r0) * u + wob * Math.sin(ang * turns)
    const x = Math.cos(ang) * r
    const y = Math.sin(ang) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }

  // Glow pass — drawn FIRST so the crisp ribbon sits on top (halo under
  // mark). `gs === 0` is a hard no-op: skip the pass entirely for byte-
  // identical pre-glow output. See `src/util/glow.js` for the canonical
  // idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    ctx.stroke()
    ctx.restore()
    // `strokeStyle`/`lineCap`/`lineJoin` survive `restore()` — set before `save()`.
  }

  ctx.lineWidth = weight
  ctx.stroke()
}