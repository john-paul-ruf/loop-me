// @ts-check
/**
 * Layer type 4 — Encircled Spiral (FR-6, architecture §10.2 row 4).
 *
 * `armCount` spiral arms from the centre, evenly spaced. Each arm is a
 * 180-point polyline from an 8 px start radius out to an outer radius set by
 * `tightness` — interpretation (the reference is unreachable, Flag 7):
 * higher tightness = a more tightly wound, smaller spiral, so the outer
 * radius is `900 − 840 × tightness` (858 at 0.05, 60 at 1.0 — always
 * visible, never blank). `sweep` is the angular travel of each arm.
 *
 * §10.2's cache note ("cached in prepare when rotation is the only animated
 * param") does not apply as stated: `tightness`, `sweep`, and `strokeWeight`
 * are all A, so geometry is animated every frame. All arms accumulate on the
 * ctx's own path with a single stroke — within the 12-draw-call budget and
 * honouring §6.5's allocation ban (recorded in the build plan's D2 briefing).
 * `prepare` caches the per-arm base angles, which change only with
 * `armCount`. Consumes zero PRNG draws.
 *
 * **per-effect-glow (feature per-effect-glow, FR-6 additive AC).** When
 * `glowStrength > 0`, `draw` re-runs the identical arm loop once BEFORE the
 * crisp stroke under `globalCompositeOperation = 'lighter'` at
 * `strokeWeight × K_GLOW` — the wide-additive-re-stroke archetype (see
 * `src/util/glow.js` and the `pulse-rings.js` reference). Same POINTS
 * samples, same `u = i / (POINTS - 1)` parameterisation → the halo hits
 * every vertex where the crisp arm does; the arm has no wrap seam (open
 * curve from centre out), so the loop-closure concern applies via the
 * animated `rotation` wrap only, which both passes share by consuming the
 * same `resolved.rotation`. No `shadowBlur` (FR-6). `glowStrength` is
 * appended LAST with default `{min:0,max:0}` (§9.2/§9.5): pre-glow seeds
 * decode to `gs === 0`, which is a hard no-op → byte-identical render.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 4,
  name: 'Encircled Spiral',
  role: 'primary',
  blurb: 'Winding spiral arms that coil, sweep, and unwind.',
  // Worst case doubles under the glow pass: path built twice (4320 pathOps),
  // draw-call declaration also doubled to match the archetype (24 = 12 halo +
  // 12 crisp bounds, even though both passes accumulate to a single stroke
  // in practice — the declaration matches the historical [_, 12] budget).
  worstCase: { pathOps: 4320, drawCalls: 24 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('armCount', 1, 12, { default: 3 }),
  A('tightness', 0.05, 1.0, { default: { min: 0.3, max: 0.6 } }),
  A('sweep', 90, 1440, { unit: '°', default: { min: 360, max: 720 } }),
  A('strokeWeight', 1, 14, { default: { min: 2, max: 6 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
/** Points per arm: 12 arms × 180 = §10.2's 2,160 path ops. */
const POINTS = 180
const R_START = 8
/**
 * Halo width multiplier — 2.5 mirrors `pulse-rings.js`. At max
 * `strokeWeight = 14` the halo stroke is 35 px; adjacent arms at max
 * `armCount = 12` are 30° apart at the outer rim (~858 px) → ~450 px of
 * arc between arm tips, so a 35-px halo stays comfortably clear of them.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} EncircledSpiralPrepared
 * @property {number} count
 * @property {Float64Array} angles  Per-arm base angle.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {EncircledSpiralPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.armCount)
  const angles = new Float64Array(count)
  for (let i = 0; i < count; i++) angles[i] = (i / count) * 2 * Math.PI
  return {
    count,
    angles,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {EncircledSpiralPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const tight = /** @type {number} */ (resolved.tightness)
  const sweepRad = /** @type {number} */ (resolved.sweep) * DEG
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const outer = 900 - 840 * tight
  const { count, angles } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Glow pass — drawn FIRST so the crisp arms sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow
  // output. Re-runs the identical POINTS-sample arm loop → halo traces the
  // same polyline as the crisp arm, so no seam anywhere along the spiral.
  // See `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    ctx.beginPath()
    for (let a = 0; a < count; a++) {
      const base = rot + angles[a]
      for (let i = 0; i < POINTS; i++) {
        const u = i / (POINTS - 1)
        const ang = base + u * sweepRad
        const r = R_START + u * (outer - R_START)
        const x = CX + Math.cos(ang) * r
        const y = CY + Math.sin(ang) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
    ctx.restore()
  }

  ctx.beginPath()
  for (let a = 0; a < count; a++) {
    const base = rot + angles[a]
    for (let i = 0; i < POINTS; i++) {
      const u = i / (POINTS - 1)
      const ang = base + u * sweepRad
      const r = R_START + u * (outer - R_START)
      const x = CX + Math.cos(ang) * r
      const y = CY + Math.sin(ang) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }
  ctx.lineWidth = weight
  ctx.stroke()
}
