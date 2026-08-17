// @ts-check
/**
 * Layer type 11 — Sine Ribbons (FR-6, architecture §10.2 row 11).
 *
 * Horizontal sine waves stacked down the frame, each a 200-point polyline
 * spanning the full width (plus a margin so thick strokes never expose an
 * edge gap). Geometry depends on three animated params, so every ribbon is
 * rebuilt on the ctx's own path each frame (the D1 template) and committed
 * with one stroke — `meta.worstCase` still records §10.2's 12-draw-call
 * budget; the single accumulated stroke simply comes in under it.
 *
 * **`phaseSpread` interpretation (Flag 7 adjacent, reference unreachable):**
 * ribbon i's phase offset is `(i / ribbonCount) × phaseSpread × 2π` —
 * deterministic, not PRNG-drawn. At 0 every ribbon crests together; at 1 the
 * crests distribute evenly across one full cycle (a cascade). Chosen over a
 * PRNG draw because "spread" names a *structure*, not a scatter, and the
 * even distribution is the only one where the bound's endpoints both read as
 * designed states. A constant phase offset added inside `sin()` of
 * loop-closed inputs keeps the loop closed.
 *
 * Never blank: every ribbon crosses the full canvas width at `thickness`
 * ≥ 2 px, at every bound combination. Consumes zero PRNG draws.
 *
 * **per-effect-glow (feature) — widened additive re-stroke.** When
 * `glowStrength > 0`, `draw` re-accumulates every ribbon's polyline and
 * strokes it once more at `thickness × K_GLOW` under
 * `globalCompositeOperation = 'lighter'` BEFORE the crisp stroke — a soft
 * halo along every wave, crisp ribbons drawn on top (halo under mark). FR-6:
 * NO `shadowBlur`; §6.5: zero per-frame allocation (the halo re-uses the
 * ctx's own accumulated path). `gs === 0` is a hard no-op → byte-identical
 * to pre-glow. See `src/util/glow.js` for the canonical draw-time idiom.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 11,
  name: 'Sine Ribbons',
  role: 'secondary',
  blurb: 'Stacked waves rolling across the frame in cascade.',
  // Worst case doubles under the glow pass: another 12 accumulated polyline
  // strokes at K_GLOW × thickness before the crisp pass. Original bound was
  // §10.2's 12-drawCall budget with the crisp coming in under it; the halo
  // uses the same accumulated-then-stroke shape.
  worstCase: { pathOps: 4800, drawCalls: 24 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ribbonCount', 1, 12, { default: 5 }),
  A('amplitude', 20, 500, { default: { min: 80, max: 240 } }),
  A('frequency', 0.5, 6.0, { default: { min: 1, max: 2.5 } }),
  A('thickness', 2, 60, { default: { min: 3, max: 10 } }),
  S.num('phaseSpread', 0, 1, { default: 0.5 }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const W = 1080
const H = 1920
const TWO_PI = Math.PI * 2
/** Points per ribbon (§10.2: 12 × 200). */
const POINTS = 200
/** Horizontal overdraw so a 60 px stroke never exposes an edge gap. */
const MARGIN = 40
const X_START = -MARGIN
const X_SPAN = W + 2 * MARGIN
/**
 * Halo width multiplier for the glow re-stroke. Matches the S02 stroke-batch
 * tuning: below 2 the halo hides inside a 60 px crisp ribbon; above 3 the
 * halo of adjacent ribbons overlaps and the cascade reads as a uniform wash
 * on the tightest `ribbonCount = 1` bound with `amplitude` = 500.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} SineRibbonsPrepared
 * @property {number} count
 * @property {Float64Array} centerY   Per-ribbon vertical centre.
 * @property {Float64Array} phase     Per-ribbon phase offset (radians).
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SineRibbonsPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const count = /** @type {number} */ (statics.ribbonCount)
  const spread = /** @type {number} */ (statics.phaseSpread)
  const centerY = new Float64Array(count)
  const phase = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    centerY[i] = (H * (i + 0.5)) / count
    phase[i] = (i / count) * spread * TWO_PI
  }
  return {
    count,
    centerY,
    phase,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SineRibbonsPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const amp = /** @type {number} */ (resolved.amplitude)
  const freq = /** @type {number} */ (resolved.frequency)
  const thick = /** @type {number} */ (resolved.thickness)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, centerY, phase } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'

  // Glow pass — drawn FIRST so the crisp ribbons sit on top (halo under mark).
  // Same polyline geometry, wider `lineWidth` under 'lighter'. `gs === 0` is
  // a hard no-op → byte-identical to pre-glow. See `src/util/glow.js`.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = thick * K_GLOW
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const cy = centerY[i]
      const ph = phase[i]
      for (let p = 0; p < POINTS; p++) {
        const t = p / (POINTS - 1)
        const x = X_START + t * X_SPAN
        const y = cy + amp * Math.sin(TWO_PI * freq * (x / W) + ph)
        if (p === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
    ctx.restore()
    // `strokeStyle`/`lineJoin` survive `restore()` since they were set
    // before `save()`.
  }

  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const cy = centerY[i]
    const ph = phase[i]
    for (let p = 0; p < POINTS; p++) {
      const t = p / (POINTS - 1)
      const x = X_START + t * X_SPAN
      // Wave phase measured against canvas width, not the overdraw span,
      // so `frequency` means "cycles across the visible frame".
      const y = cy + amp * Math.sin(TWO_PI * freq * (x / W) + ph)
      if (p === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }
  ctx.lineWidth = thick
  ctx.stroke()
}
