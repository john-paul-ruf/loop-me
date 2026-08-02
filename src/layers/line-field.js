// @ts-check
/**
 * Layer type 8 — Line Field (FR-6, architecture §10.2 row 8).
 *
 * Parallel lines covering the whole frame, rotating as one and drifting
 * perpendicular to their own direction. All geometry-shaping params except
 * `lineCount` are animated, so the field is built on the ctx's own path each
 * frame (the D1 template: §6.5 bans `Path2D` allocation inside `draw`) —
 * one accumulated path, single stroke.
 *
 * Coverage guarantee (FR-6 "no control can render nothing"): line spacing is
 * `DIAG / lineCount` ≤ 551 px and each line spans the full diagonal, so the
 * arithmetic sequence of perpendicular offsets (step ≤ 551, shifted ≤ 200 by
 * `offset`) always lands at least one line within ±540 px of centre — inside
 * the canvas's minimum half-extent at every angle.
 *
 * Consumes zero PRNG draws.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 8,
  name: 'Line Field',
  role: 'secondary',
  blurb: 'Parallel lines sweeping the frame in unison.',
  worstCase: { pathOps: 80, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('lineCount', 4, 80, { default: 24 }),
  A('angle', 0, 180, { unit: '°', wrap: true }),
  A('weight', 1, 20, { default: { min: 2, max: 6 } }),
  A('offset', 0, 200, { default: { min: 0, max: 80 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
/** Canvas diagonal — a line this long through centre covers any rotation. */
const DIAG = Math.hypot(1080, 1920)
const HALF = DIAG / 2

/**
 * @typedef {object} LineFieldPrepared
 * @property {number} count
 * @property {number} spacing
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {LineFieldPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.lineCount)
  return {
    count,
    spacing: DIAG / count,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {LineFieldPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const angle = /** @type {number} */ (resolved.angle) * DEG
  const off = /** @type {number} */ (resolved.offset)
  const { count, spacing } = prepared
  const y0 = off - ((count - 1) / 2) * spacing

  ctx.translate(CX, CY)
  ctx.rotate(angle)

  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const y = y0 + i * spacing
    ctx.moveTo(-HALF, y)
    ctx.lineTo(HALF, y)
  }
  ctx.strokeStyle = prepared.color
  ctx.lineWidth = /** @type {number} */ (resolved.weight)
  ctx.stroke()
}
