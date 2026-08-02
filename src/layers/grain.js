// @ts-check
/**
 * Layer type 16 — Grain (FR-6, architecture §10.2 row 16).
 *
 * Film grain: a noise tile generated **once per composition** via
 * `createImageData` (FR-6 AC — `prepare` is exactly once-per-composition for
 * a layer whose geometry params are static), wrapped in a `CanvasPattern`
 * and re-blitted with the animated `driftX`/`driftY` offset. No per-pixel
 * work per frame: `draw` is one translate and one pattern fill — §10.2's
 * {1, 1}.
 *
 * Like Scan Lines, this layer declares a param literally named `opacity`
 * (the Flag 4 real-world case): it reaches `draw` as `resolved.opacity` and
 * **multiplies** the envelope alpha the painter set — composes, never
 * replaces.
 *
 * The tile is the layer's colour at PRNG-drawn per-pixel alpha, so grain
 * tints with the scheme rather than shipping a hardcoded grey.
 *
 * **PRNG consumption order (FR-4, binding):** one draw per tile pixel, in
 * row-major order — tileSize² draws, nothing else.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 16,
  name: 'Grain',
  role: 'overlay',
  blurb: 'Animated film grain in the scheme’s own colour.',
  worstCase: { pathOps: 1, drawCalls: 1 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.enum('tileSize', [128, 256]),
  A('opacity', 0.02, 0.35, { default: { min: 0.05, max: 0.15 } }),
  A('driftX', 0, 256, { default: { min: 0, max: 128 } }),
  A('driftY', 0, 256, { default: { min: 0, max: 128 } }),
]

const WIDTH = 1080
const HEIGHT = 1920

/**
 * @typedef {object} GrainPrepared
 * @property {CanvasPattern} pattern  The repeating noise tile.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {GrainPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const size = /** @type {number} */ (statics.tileSize)
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  const tile = scratch(size, size)
  const tctx = /** @type {CanvasRenderingContext2D} */ (tile.getContext('2d'))
  const img = tctx.createImageData(size, size)
  const data = img.data
  // Row-major, one PRNG draw per pixel (the binding order above).
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = (rng() * 256) | 0
  }
  tctx.putImageData(img, 0, 0)
  const pattern = /** @type {CanvasPattern} */ (tctx.createPattern(tile, 'repeat'))
  return { pattern }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {GrainPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const dx = /** @type {number} */ (resolved.driftX)
  const dy = /** @type {number} */ (resolved.driftY)
  const opacity = /** @type {number} */ (resolved.opacity)

  // Flag 4 posture: the layer's `opacity` composes with the envelope alpha.
  ctx.globalAlpha = ctx.globalAlpha * opacity
  ctx.translate(dx, dy)
  ctx.fillStyle = prepared.pattern
  ctx.fillRect(-dx, -dy, WIDTH, HEIGHT)
}
