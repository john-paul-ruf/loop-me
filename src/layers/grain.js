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
 *
 * **per-effect-glow — nominal fit (residual gap).** Grain is a *texture*
 * overlay, not a mark: additive glow on a noise tile is weak — brightening
 * random pixels just makes the noise more saturated. When `glowStrength > 0`,
 * `draw` re-blits the SAME cached noise pattern under
 * `globalCompositeOperation = 'lighter'` at `envelope × opacity × gs ×
 * NOMINAL_K` — a low-alpha halo re-blit of the exact tile the crisp pass
 * uses. **No per-frame tile work** (FR-6 AC, §6.5): the tile is still minted
 * exactly once in `prepare`; the halo pass just calls `fillRect` on the same
 * `prepared.pattern`. The param is declared for catalog consistency (S08's
 * "every non-glitch layer glows" gate). `gs === 0` is a hard no-op ⇒ byte-
 * identical pre-glow output (architecture §9.5). See `src/util/glow.js` for
 * the canonical idiom and the `glowStrength` param convention.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 16,
  name: 'Grain',
  role: 'overlay',
  blurb: 'Animated film grain in the scheme’s own colour.',
  // Worst case doubles under the glow pass: one extra pattern `fillRect`
  // under 'lighter' (halo re-blit of the SAME cached tile — no new tile
  // work, §6.5 upheld).
  worstCase: { pathOps: 2, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.enum('tileSize', [128, 256]),
  A('opacity', 0.02, 0.35, { default: { min: 0.05, max: 0.15 } }),
  A('driftX', 0, 256, { default: { min: 0, max: 128 } }),
  A('driftY', 0, 256, { default: { min: 0, max: 128 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const WIDTH = 1080
const HEIGHT = 1920
/**
 * Nominal glow strength for the texture halo re-blit. Grain is per-pixel
 * noise, not a mark — a strong additive re-blit would just make the noise
 * uniformly brighter rather than "glow". 0.35× keeps the halo subtle: at
 * `gs=1` the glow adds ≤ 35% of the crisp noise brightness, enough to
 * register (S01's tolerant glow suite) without saturating into a haze. A
 * touch below `scan-lines.js` / `stripe-sweep.js` because grain covers the
 * full canvas at some alpha in every pixel; the visible cumulative brighten
 * is larger for the same K.
 */
const NOMINAL_K = 0.35

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
  const gs = /** @type {number} */ (resolved.glowStrength)

  // Glow pass — subtle additive re-blit of the SAME cached noise pattern
  // (nominal fit; see the file header). NO new tile work (§6.5, FR-6 AC):
  // `prepare` still runs its per-pixel loop exactly once per composition.
  // Save/restore fences the transform, blend op, alpha, and fillStyle so
  // the crisp pass below runs against the exact same ctx state as pre-glow.
  // `gs === 0` is a hard no-op ⇒ byte-identical pre-glow output.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * opacity * gs * NOMINAL_K
    ctx.translate(dx, dy)
    ctx.fillStyle = prepared.pattern
    ctx.fillRect(-dx, -dy, WIDTH, HEIGHT)
    ctx.restore()
  }

  // Flag 4 posture: the layer's `opacity` composes with the envelope alpha.
  ctx.globalAlpha = ctx.globalAlpha * opacity
  ctx.translate(dx, dy)
  ctx.fillStyle = prepared.pattern
  ctx.fillRect(-dx, -dy, WIDTH, HEIGHT)
}
