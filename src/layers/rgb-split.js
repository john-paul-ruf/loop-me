// @ts-check
/**
 * Layer type 34 — RGB Split (FR-6, architecture §10.2 row 34).
 *
 * Chromatic aberration: the composited frame below is split into a red
 * channel and a cyan (G+B) channel by masking two full-frame scratches
 * with `globalCompositeOperation = 'multiply'`, offset by
 * `±shift·(cos,sin)` along `angle`, and re-blitted over the main ctx as a
 * single source-over draw so the painter's envelope alpha *ghosts* the
 * split rather than *erasing* the frame. (A `gCO='copy'` final would fight
 * the envelope by wiping to transparent at low alpha — chose ghosting.)
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Consumes zero rng draws in `prepare` — the effect is a pure function of
 * the animated `shift` and `angle`, both A params so `findValue` closes
 * their loop. `angle` uses `{wrap: true}`: 0 and 360 are adjacent, so a
 * full rotation across the loop stays smooth.
 *
 * ## Allocation-free draw (§6.5)
 *
 * Two full-frame scratches (~8 MB each, ~16 MB total) are minted once via
 * `statics.scratch(WIDTH, HEIGHT)` and reused every frame. Scratch ctx
 * state is reset explicitly at every use (`setTransform`, `gCO`,
 * `globalAlpha`) — nothing is trusted across frames or across the six
 * draw calls. `worstCase.drawCalls` = 6 (2 copies + 2 multiplies + 1
 * lighter + 1 final blit); `pathOps` = 0. `fullCanvasOpaque: false` — the
 * final blit runs under the painter's envelope alpha, so pixels below can
 * always show through.
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 34,
  name: 'RGB Split',
  role: 'glitch',
  blurb: 'Chromatic aberration — the frame splits into shifted colour channels.',
  worstCase: { pathOps: 0, drawCalls: 6 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  // `shift.min` is 2 (not 0): at 0 the split collapses to the original,
  // which is the "renders nothing new" case FR-6's AC rules out.
  A('shift', 2, 60, { unit: 'px', default: { min: 3, max: 24 } }),
  A('angle', 0, 360, { wrap: true, unit: '°' }),
]

const WIDTH = 1080
const HEIGHT = 1920
const DEG = Math.PI / 180

/**
 * @typedef {object} RgbSplitPrepared
 * @property {HTMLCanvasElement} s1  Red channel scratch (~8 MB).
 * @property {HTMLCanvasElement} s2  Cyan (G+B) channel scratch, also holds the composed split (~8 MB).
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {RgbSplitPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  // Two full-frame backing stores — ~8 MB each on desktop, ~16 MB total.
  // Documented rather than hidden; the alternative (per-frame allocation)
  // would violate §6.5.
  const s1 = scratch(WIDTH, HEIGHT)
  const s2 = scratch(WIDTH, HEIGHT)
  return { s1, s2 }
}

/**
 * Reset a scratch ctx to a known state before every use — the frame-to-
 * frame guarantee the painter gives its own ctx (§6.4) does not extend
 * here, so state must be re-established explicitly.
 *
 * @param {CanvasRenderingContext2D} sx
 */
function resetScratch(sx) {
  sx.setTransform(1, 0, 0, 1, 0, 0)
  sx.globalAlpha = 1
  sx.globalCompositeOperation = 'source-over'
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {RgbSplitPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const shift = /** @type {number} */ (resolved.shift)
  const angle = /** @type {number} */ (resolved.angle) * DEG
  const dx = Math.round(Math.cos(angle) * shift)
  const dy = Math.round(Math.sin(angle) * shift)

  const s1 = prepared.s1
  const s2 = prepared.s2
  const c1 = /** @type {CanvasRenderingContext2D} */ (s1.getContext('2d'))
  const c2 = /** @type {CanvasRenderingContext2D} */ (s2.getContext('2d'))

  // s1 ← main frame, masked to red only (multiply against pure red kills
  // green and blue channels).
  resetScratch(c1)
  c1.globalCompositeOperation = 'copy'
  c1.drawImage(ctx.canvas, 0, 0)
  c1.globalCompositeOperation = 'multiply'
  c1.fillStyle = '#FF0000'
  c1.fillRect(0, 0, WIDTH, HEIGHT)

  // s2 ← main frame, masked to cyan (G+B) via multiply against #00FFFF.
  resetScratch(c2)
  c2.globalCompositeOperation = 'copy'
  c2.drawImage(ctx.canvas, 0, 0)
  c2.globalCompositeOperation = 'multiply'
  c2.fillStyle = '#00FFFF'
  c2.fillRect(0, 0, WIDTH, HEIGHT)

  // Compose the split entirely inside s2's colour space: additive of the
  // shifted red channel over the counter-shifted cyan gives back the
  // reconstructed frame plus a `2·(dx, dy)` chromatic offset. This is
  // the whole finished split — one bitmap.
  c2.globalCompositeOperation = 'lighter'
  c2.drawImage(s1, 2 * dx, 2 * dy)

  // One source-over blit to the main ctx: envelope alpha × the painter's
  // blend chip apply here, so at low envelope opacity the split ghosts
  // over the underlying frame instead of wiping it out. (Envelope alpha
  // is already set on ctx by the painter — do NOT overwrite it.)
  ctx.drawImage(s2, -dx, -dy)
}
