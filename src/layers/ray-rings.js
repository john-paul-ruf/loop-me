// @ts-check
/**
 * Layer type 1 — Ray Rings (FR-6, architecture §10.2 row 1).
 *
 * Rays from an inner radius outward, evenly spaced around the centre.
 * `taper` false strokes each ray at `thickness`; true fills each ray as a
 * triangle that narrows to a point.
 *
 * Strategy per §10.2: one accumulated path, single stroke/fill — built on the
 * ctx's own path (`beginPath` + segments), because §6.5 bans allocating a
 * `Path2D` inside `draw` and every ray endpoint here depends on animated
 * params. `prepare` caches what geometry is static: the per-ray unit vectors,
 * which change only with `rayCount`.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes no PRNG draws — this
 * layer derives no random positions; the consumption-order contract makes
 * "zero draws" as binding as any other count.
 *
 * **per-effect-glow (feature per-effect-glow, FR-6 additive AC).** When
 * `glowStrength > 0`, `draw` runs a matching accumulated pass BEFORE the
 * crisp pass under `globalCompositeOperation = 'lighter'`: the stroke branch
 * re-strokes the same rays at `thickness × K_GLOW` (wide-additive-re-stroke,
 * mirror of `pulse-rings.js`); the taper branch re-fills the same triangles
 * built with `hw × K_GLOW` (widened re-fill, mirror of `orbit-dots.js` option
 * B). No `shadowBlur` (FR-6). `glowStrength` is appended LAST with default
 * `{min:0,max:0}` (§9.2/§9.5): pre-glow seeds decode to `gs === 0`, which is
 * a hard no-op → byte-identical render.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 1,
  name: 'Ray Rings',
  role: 'primary',
  blurb: 'Rays bursting from a centre ring, sweeping and breathing.',
  // Worst case doubles under the glow pass: path built twice (128 pathOps),
  // fill or stroke drawn twice (4 draw calls — 2 halo + 2 crisp bounds).
  worstCase: { pathOps: 128, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('rayCount', 3, 64, { default: 24 }),
  A('innerRadius', 0, 400, { default: { min: 40, max: 140 } }),
  A('length', 40, 900, { default: { min: 220, max: 520 } }),
  A('thickness', 1, 24, { default: { min: 2, max: 7 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.bool('taper'),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
/**
 * Halo width multiplier — widens `thickness` (stroke) or `hw` (taper base).
 * 2.5 mirrors `pulse-rings.js`; at max `thickness = 24`, the halo stroke is
 * 60 px — wide enough to read as a halo, within the doubled worstCase.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} RayRingsPrepared
 * @property {number} count
 * @property {Float64Array} cos
 * @property {Float64Array} sin
 * @property {boolean} taper
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {RayRingsPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.rayCount)
  const cos = new Float64Array(count)
  const sin = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 2 * Math.PI
    cos[i] = Math.cos(a)
    sin[i] = Math.sin(a)
  }
  return {
    count,
    cos,
    sin,
    taper: statics.taper === true,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {RayRingsPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const r0 = /** @type {number} */ (resolved.innerRadius)
  const len = /** @type {number} */ (resolved.length)
  const thick = /** @type {number} */ (resolved.thickness)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const r1 = r0 + len
  const { count, cos, sin } = prepared

  // Animated rotation as a transform: the cached unit vectors stay valid.
  ctx.translate(CX, CY)
  ctx.rotate(rot)

  // Glow pass — drawn FIRST so the crisp rays sit on top (halo under mark).
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow
  // output. See `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.beginPath()
    if (prepared.taper) {
      // Widened re-fill: same triangles, base widened `× K_GLOW` — apex still
      // at r1, so each halo triangle envelops its crisp partner.
      const hwHalo = (thick * K_GLOW) / 2
      for (let i = 0; i < count; i++) {
        const c = cos[i]
        const s = sin[i]
        ctx.moveTo(c * r0 - s * hwHalo, s * r0 + c * hwHalo)
        ctx.lineTo(c * r0 + s * hwHalo, s * r0 - c * hwHalo)
        ctx.lineTo(c * r1, s * r1)
        ctx.closePath()
      }
      ctx.fillStyle = prepared.color
      ctx.fill()
    } else {
      // Wide-additive-re-stroke: same lines, `lineWidth × K_GLOW`.
      for (let i = 0; i < count; i++) {
        const c = cos[i]
        const s = sin[i]
        ctx.moveTo(c * r0, s * r0)
        ctx.lineTo(c * r1, s * r1)
      }
      ctx.strokeStyle = prepared.color
      ctx.lineWidth = thick * K_GLOW
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.beginPath()
  if (prepared.taper) {
    const hw = thick / 2
    for (let i = 0; i < count; i++) {
      const c = cos[i]
      const s = sin[i]
      // Base corners perpendicular to the ray at the inner radius; apex at r1.
      ctx.moveTo(c * r0 - s * hw, s * r0 + c * hw)
      ctx.lineTo(c * r0 + s * hw, s * r0 - c * hw)
      ctx.lineTo(c * r1, s * r1)
      ctx.closePath()
    }
    ctx.fillStyle = prepared.color
    ctx.fill()
  } else {
    for (let i = 0; i < count; i++) {
      const c = cos[i]
      const s = sin[i]
      ctx.moveTo(c * r0, s * r0)
      ctx.lineTo(c * r1, s * r1)
    }
    ctx.strokeStyle = prepared.color
    ctx.lineWidth = thick
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}
