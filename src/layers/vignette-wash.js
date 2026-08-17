// @ts-check
/**
 * Layer type 15 — Vignette Wash (FR-6, architecture §10.2 row 15).
 *
 * A colour wash that deepens toward the edges (radial) or one edge (linear).
 * §10.2 says "cached gradient", but `falloff` and `strength` are **A** —
 * the fuzz-flare resolution applies: one *unit* gradient with fixed stops is
 * minted in `prepare`, and the animated params live outside it — `falloff`
 * scales the gradient through the transform, `strength` multiplies the
 * painter's globalAlpha (so it composes with the envelope, Flag 4 posture).
 *
 * Interpretation (Flag 7 adjacent): the unit gradient's alpha ramp is
 * ≈ √t (piecewise stops), so alpha at unit radius `t` ≈ √t. The transform
 * maps unit radius 1 to `CORNER / falloff` px; the canvas corner therefore
 * sits at unit radius = `falloff`, giving corner alpha ≈ √falloff × strength:
 * `falloff` 1.0 is a hard frame, 0.1 a faint breath — and the √ ramp keeps
 * even the minimum bounds ≥ 1 display level over the scheme background
 * (never blank, FR-6 AC). `strength` caps at 0.90, so the wash can never be
 * a full-canvas opaque fill. Linear mode is the same gradient logic along a
 * `wrap`-animated `angle`. One path op, one draw call. Zero PRNG draws.
 *
 * **per-effect-glow — nominal fit (FR-6, §9.5).** Vignette Wash is a
 * *darkening* wash, so additive glow is a weak conceptual fit — but the
 * param is declared for catalog consistency (S08 asserts every non-glitch
 * layer declares `glowStrength`). Behaviour: at `gs > 0` an additional
 * fillRect re-issues the same cached gradient under `'lighter'` at
 * `alpha = a0 * gs * NOMINAL_K`, giving a gentle rim brighten in the
 * layer's own colour — a subtle lift, never a blown highlight. Default
 * `{min:0,max:0}` ⇒ `gs === 0` is a hard no-op ⇒ byte-identical to
 * pre-glow output. No `shadowBlur`; zero per-frame allocation.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 15,
  name: 'Vignette Wash',
  role: 'overlay',
  blurb: 'A colour wash that deepens toward the edges.',
  // per-effect-glow: nominal additive re-fill adds one extra fillRect (one
  // drawCall, one pathOp) when `gs > 0`.
  worstCase: { pathOps: 2, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.enum('mode', ['radial', 'linear']),
  A('angle', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 0 } }),
  A('falloff', 0.1, 1.0, { default: { min: 0.4, max: 0.8 } }),
  A('strength', 0.05, 0.90, { default: { min: 0.2, max: 0.45 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒
  // pre-glow seeds decode to glow-off, `gs === 0` skips the additive pass
  // (byte-identical). Nominal fit — see file header.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
/** Centre-to-corner distance: hypot(540, 960). */
const CORNER = Math.hypot(CX, CY)
const DEG = Math.PI / 180
/** Nominal-fit tuning: darkening-wash + additive glow is a weak conceptual
 * match, so the additive re-fill's alpha is scaled DOWN by this factor so
 * even `gs = 1` reads as a gentle rim brighten rather than a blown-out
 * halo. Tuned visually — above 0.5 the corners over-bloom; below 0.2 the
 * pass is invisible even at strength = 0.9. */
const NOMINAL_K = 0.35

/**
 * @typedef {object} VignetteWashPrepared
 * @property {boolean} radial
 * @property {CanvasGradient} wash  Unit gradient, alpha ramp ≈ √t.
 */

/**
 * ≈ √t alpha ramp as fixed stops — fixed because animated stops would need a
 * per-frame gradient, which §6.5 bans.
 *
 * @param {CanvasGradient} grad
 * @param {number} r
 * @param {number} g
 * @param {number} b
 */
function sqrtStops(grad, r, g, b) {
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
  grad.addColorStop(0.04, `rgba(${r},${g},${b},0.2)`)
  grad.addColorStop(0.16, `rgba(${r},${g},${b},0.4)`)
  grad.addColorStop(0.36, `rgba(${r},${g},${b},0.6)`)
  grad.addColorStop(0.64, `rgba(${r},${g},${b},0.8)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},1)`)
}

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {VignetteWashPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const radial = statics.mode === 'radial'
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  const sctx = /** @type {CanvasRenderingContext2D} */ (scratch(1, 1).getContext('2d'))
  const wash = radial
    ? sctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    : sctx.createLinearGradient(0, 0, 1, 0)
  sqrtStops(wash, r, g, b)
  return { radial, wash }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {VignetteWashPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const angle = /** @type {number} */ (resolved.angle) * DEG
  const falloff = /** @type {number} */ (resolved.falloff)
  const strength = /** @type {number} */ (resolved.strength)
  const gs = /** @type {number} */ (resolved.glowStrength)

  // Flag 4 posture: composes with the envelope alpha, never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * strength

  // Unit radius 1 ↦ CORNER / falloff px, rotated by `angle` (radial mode is
  // rotation-invariant, so the same transform serves both). Absolute — the
  // painter's per-layer restore resets it.
  const s = CORNER / falloff
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  ctx.setTransform(s * cos, s * sin, -s * sin, s * cos, CX, CY)
  ctx.fillStyle = prepared.wash
  // ±2 units ↦ ≥ ±2203 px from centre: covers every canvas pixel at any
  // rotation (corner distance is 1101.6), for radial and linear alike.
  ctx.fillRect(-2, -2, 4, 4)

  // per-effect-glow: nominal additive bloom — re-fill the same wash under
  // 'lighter' at NOMINAL_K × gs × envelope alpha. Darkening-wash + additive
  // is a weak fit, so K is low: max lift is a subtle rim brighten, never a
  // blown highlight. `gs === 0` skips the pass entirely (§9.5, byte-identical).
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs * NOMINAL_K
    ctx.fillRect(-2, -2, 4, 4)
    ctx.restore()
  }
}
