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
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 1,
  name: 'Ray Rings',
  role: 'primary',
  blurb: 'Rays bursting from a centre ring, sweeping and breathing.',
  worstCase: { pathOps: 64, drawCalls: 2 },
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
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180

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
  const r1 = r0 + len
  const { count, cos, sin } = prepared

  // Animated rotation as a transform: the cached unit vectors stay valid.
  ctx.translate(CX, CY)
  ctx.rotate(rot)

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
