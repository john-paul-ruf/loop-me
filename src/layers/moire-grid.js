// @ts-check
/**
 * Layer type 9 — Moiré Grid (FR-6, architecture §10.2 row 9).
 *
 * Two copies of one line grid: grid A axis-fixed, grid B rotated by
 * `relativeAngle` and pushed `drift` px along its own normal. The
 * interference pattern between them is the artwork; tiny animated angles
 * produce large-scale moiré movement — §10.2's "cheap-to-draw / high-payoff"
 * case.
 *
 * The §10.2 strategy survives §6.5 contact unchanged here (unlike most of
 * the catalog): both geometry params (`spacing`, `weight`) are static, so the
 * grid IS a `prepare`-built `Path2D`, stroked twice under transforms —
 * layered-poly's pattern. Grid A never moves, which is also the FR-6
 * "renders nothing" guarantee: an axis-aligned grid of diagonal-length lines
 * at ≤ 60 px spacing always crosses the canvas.
 *
 * Interpretation (Flag 7 adjacent, reference unreachable): `drift` displaces
 * grid B only — displacing both symmetrically doubles the code for an
 * identical relative offset, and the relative offset is all moiré sees.
 * Consumes zero PRNG draws.
 *
 * **per-effect-glow (feature) — widened additive re-stroke of the two
 * transformed grids.** When `glowStrength > 0`, `draw` re-strokes both grid
 * passes at `weight × K_GLOW` under `globalCompositeOperation = 'lighter'`
 * BEFORE the crisp strokes — a soft halo laid along every grid line, crisp
 * lines drawn on top (halo under mark). FR-6: NO `shadowBlur`; §6.5: zero
 * per-frame allocation (the prepared `Path2D` is stroked, not rebuilt).
 * `gs === 0` is a hard no-op → byte-identical to pre-glow. See
 * `src/util/glow.js` for the canonical draw-time idiom and the
 * `glowStrength` param convention.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 9,
  name: 'Moiré Grid',
  role: 'secondary',
  blurb: 'Twin line grids sliding into shimmering interference.',
  // Worst case doubles under the glow pass: 2 crisp strokes + 2 halo strokes
  // of the same prepared Path2D under transforms.
  worstCase: { pathOps: 1500, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('spacing', 8, 60, { default: 22 }),
  A('relativeAngle', 0, 45, { unit: '°', default: { min: 2, max: 14 } }),
  S.int('weight', 1, 4, { default: 1 }),
  A('drift', 0, 120, { default: { min: 0, max: 60 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const DIAG = Math.hypot(1080, 1920)
const HALF = DIAG / 2
/**
 * Halo width multiplier for the glow re-stroke. Matches the S02 stroke-batch
 * tuning (pulse-rings/etc.): below 2 the halo hides inside the crisp line at
 * every `weight` bound, above 3 halos of adjacent grid lines merge at the
 * tightest `spacing = 8` and the moiré interference reads as a wash.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} MoireGridPrepared
 * @property {Path2D} path    Centre-origin line grid covering the diagonal.
 * @property {number} weight
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Resolved} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {MoireGridPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const spacing = /** @type {number} */ (statics.spacing)
  const count = Math.ceil(DIAG / spacing) + 1
  const y0 = -((count - 1) / 2) * spacing

  const path = new Path2D()
  for (let i = 0; i < count; i++) {
    const y = y0 + i * spacing
    path.moveTo(-HALF, y)
    path.lineTo(HALF, y)
  }

  return {
    path,
    weight: /** @type {number} */ (statics.weight),
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {MoireGridPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const rel = /** @type {number} */ (resolved.relativeAngle) * DEG
  const drift = /** @type {number} */ (resolved.drift)
  const gs = /** @type {number} */ (resolved.glowStrength)

  // Glow pass — drawn FIRST so the crisp grid sits on top (halo under mark).
  // `gs === 0` is a hard no-op: skip the pass entirely for byte-identical
  // pre-glow output. Wrapped in save/restore so the crisp pass below starts
  // from the painter's identity transform. See `src/util/glow.js`.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.strokeStyle = prepared.color
    ctx.lineWidth = prepared.weight * K_GLOW
    ctx.translate(CX, CY)
    ctx.stroke(prepared.path)
    ctx.rotate(rel)
    ctx.translate(0, drift)
    ctx.stroke(prepared.path)
    ctx.restore()
  }

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = prepared.weight
  ctx.translate(CX, CY)

  // Grid A — fixed. Its coverage is the layer's never-blank guarantee.
  ctx.stroke(prepared.path)

  // Grid B — rotated, then displaced along its own (post-rotation) normal.
  ctx.rotate(rel)
  ctx.translate(0, drift)
  ctx.stroke(prepared.path)
}
