// @ts-check
/**
 * Layer type 5 — Petal Bloom (FR-6, architecture §10.2 row 5).
 *
 * Petals as ellipses radiating from the centre, in up to 4 rings. Ring k is
 * scaled by `0.62^k` and staggered half a petal, so rings interleave rather
 * than stack. Each petal is an ellipse whose near end touches the centre and
 * whose far end is the petal tip at `petalLength × scale`.
 *
 * Geometry is animated (`petalLength`, `petalWidth`, `rotation` are all A),
 * so per §6.5 each ring accumulates ellipses on the ctx's own path with one
 * fill/stroke per ring — §10.2's "accumulated Path2D per ring", built on the
 * ctx path per the D1 template. A `moveTo` to each ellipse's start point
 * breaks the connecting chord `ellipse` would otherwise draw, which matters
 * for both fill (sliver artifacts) and stroke. Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 5,
  name: 'Petal Bloom',
  role: 'primary',
  blurb: 'Rings of petals opening and turning like a flower.',
  worstCase: { pathOps: 144, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('petalCount', 3, 36, { default: 8 }),
  S.int('ringCount', 1, 4, { default: 2 }),
  A('petalLength', 60, 800, { default: { min: 200, max: 480 } }),
  A('petalWidth', 10, 300, { default: { min: 60, max: 160 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.bool('filled', { default: true }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
const RING_SCALE = 0.62
const STROKE_WIDTH = 3

/**
 * @typedef {object} PetalBloomPrepared
 * @property {number} petals
 * @property {number} rings
 * @property {Float64Array} angles  Per-petal base angle, first petal up.
 * @property {Float64Array} scales  RING_SCALE^k per ring.
 * @property {number} stagger       Half-petal ring offset, radians.
 * @property {boolean} filled
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {PetalBloomPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const petals = /** @type {number} */ (statics.petalCount)
  const rings = /** @type {number} */ (statics.ringCount)
  const angles = new Float64Array(petals)
  for (let p = 0; p < petals; p++) {
    angles[p] = -Math.PI / 2 + (p / petals) * TWO_PI
  }
  const scales = new Float64Array(rings)
  for (let k = 0; k < rings; k++) scales[k] = Math.pow(RING_SCALE, k)
  return {
    petals,
    rings,
    angles,
    scales,
    stagger: Math.PI / petals,
    filled: statics.filled === true,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {PetalBloomPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const len = /** @type {number} */ (resolved.petalLength)
  const wid = /** @type {number} */ (resolved.petalWidth)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const { petals, rings, angles, scales, stagger } = prepared

  ctx.translate(CX, CY)
  ctx.rotate(rot)
  for (let k = 0; k < rings; k++) {
    const rx = (len * scales[k]) / 2
    const ry = (wid * scales[k]) / 2
    const off = stagger * k
    ctx.beginPath()
    for (let p = 0; p < petals; p++) {
      const a = angles[p] + off
      const c = Math.cos(a)
      const s = Math.sin(a)
      // Ellipse centre sits rx out along the petal axis; its param-0 start
      // point is another rx further — the petal tip.
      ctx.moveTo(c * rx * 2, s * rx * 2)
      ctx.ellipse(c * rx, s * rx, rx, ry, a, 0, TWO_PI)
    }
    if (prepared.filled) {
      ctx.fillStyle = prepared.color
      ctx.fill()
    } else {
      ctx.strokeStyle = prepared.color
      ctx.lineWidth = STROKE_WIDTH
      ctx.stroke()
    }
  }
}
