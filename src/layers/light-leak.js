// @ts-check
/**
 * Layer type 29 — Light Leak (FR-6, architecture §10.2 row 29).
 *
 * A single off-centre radial glow that drifts across the frame — like
 * fuzz-flare's one-burst variant, but with a fixed shape and an animated
 * translate. The glow is a cached unit radial gradient (vignette-wash /
 * fuzz-flare pattern); the animated `offsetX`/`offsetY` place its centre,
 * and `radius` scales it through the transform. `strength` multiplies the
 * painter's `globalAlpha` (Flag 4 posture).
 *
 * Never opaque: `strength` caps at 0.85 and the gradient fades to
 * transparent at its edge, so no pixel reaches alpha 1.0 — the centre gets
 * `0.85 × 1.0 < 1.0`, and the canvas edges (far from the glow centre) get
 * ≈ 0 alpha from the gradient's transparent outer stop.
 *
 * Strategy per §10.2: one `fillRect` (one path op, one draw call). The
 * gradient is minted once in `prepare` against a scratch 1×1 context;
 * `draw` uses `setTransform` with the animated radius as scale and the
 * animated offset as translation (fuzz-flare's unit-gradient-under-
 * transform pattern). Consumes zero PRNG draws.
 *
 * Imports `model/params.js` only (§4 rule 2).
 *
 * **per-effect-glow (FR-6, §9.5):** appends `glowStrength` LAST (default
 * `{min:0,max:0}` ⇒ pre-glow seeds decode to `gs === 0`, a hard no-op ⇒
 * byte-identical). At `gs > 0` an additional guarded fillRect re-issues
 * the same cached radial gradient under `globalCompositeOperation =
 * 'lighter'` at `alpha = a0 * gs` — a wash-layer additive bloom that
 * brightens the leak in its own colour. No `shadowBlur` (FR-6); zero
 * per-frame allocation (§6.5).
 */

import { A } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 29,
  name: 'Light Leak',
  role: 'overlay',
  blurb: 'A soft glow drifting across the frame like a light leak.',
  // per-effect-glow: additive re-fill of the same cached gradient adds one
  // extra fillRect (one drawCall, one pathOp) when `gs > 0`.
  worstCase: { pathOps: 2, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  A('radius', 100, 900, { default: { min: 240, max: 640 } }),
  A('offsetX', -540, 540, { default: { min: -200, max: 200 } }),
  A('offsetY', -960, 960, { default: { min: -300, max: 300 } }),
  A('strength', 0.05, 0.85, { default: { min: 0.25, max: 0.6 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` (byte-identical to pre-glow output).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960

/**
 * @typedef {object} LightLeakPrepared
 * @property {CanvasGradient} glow  Unit-radius radial gradient, colour → transparent.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {LightLeakPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  const sctx = /** @type {CanvasRenderingContext2D} */ (scratch(1, 1).getContext('2d'))
  const glow = sctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  glow.addColorStop(0, `rgba(${r},${g},${b},0.9)`)
  glow.addColorStop(0.4, `rgba(${r},${g},${b},0.45)`)
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`)
  return { glow }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {LightLeakPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const radius = /** @type {number} */ (resolved.radius)
  const ox = /** @type {number} */ (resolved.offsetX)
  const oy = /** @type {number} */ (resolved.offsetY)
  const strength = /** @type {number} */ (resolved.strength)
  const gs = /** @type {number} */ (resolved.glowStrength)

  // Flag 4 posture: composes with the envelope alpha, never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * strength
  ctx.setTransform(radius, 0, 0, radius, CX + ox, CY + oy)
  ctx.fillStyle = prepared.glow
  // ±2 units → ±2·radius ≥ ±200 px, covering the glow's visible extent.
  ctx.fillRect(-2, -2, 4, 4)

  // per-effect-glow: additive bloom on top of the crisp leak — re-fill the
  // same cached gradient at the same transform under 'lighter'. `gs === 0`
  // skips the pass entirely for byte-identical pre-glow output (§9.5).
  // Transform and fillStyle are still in effect from the crisp pass; save
  // captures blend + alpha so restore returns them for the next layer.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.fillRect(-2, -2, 4, 4)
    ctx.restore()
  }
}