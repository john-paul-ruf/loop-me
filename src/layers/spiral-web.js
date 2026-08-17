// @ts-check
/**
 * Layer type 17 — Spiral Web (FR-6, architecture §10.2 row 17).
 *
 * `ringCount` concentric regular polygons, each at radius
 * `baseRadius + i × spacing`, laced by `spokeCount` radial spokes that
 * pierce every ring — a radar/cobweb structure.
 *
 * Strategy per §10.2: one accumulated path, single stroke — built on the
 * ctx's own path (D1 template), because §6.5 bans allocating a `Path2D`
 * inside `draw` and every polygon vertex depends on animated `baseRadius`
 * and `spacing`. `prepare` caches the static spoke angles (which change
 * only with `spokeCount`) and the ring count.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws —
 * the structure is fully deterministic from params.
 *
 * **per-effect-glow (feature per-effect-glow, FR-6 additive AC).** When
 * `glowStrength > 0`, `draw` re-runs the identical accumulated polygon +
 * spoke path once BEFORE the crisp stroke under
 * `globalCompositeOperation = 'lighter'` at `strokeWeight × K_GLOW` — the
 * wide-additive-re-stroke archetype (see `src/util/glow.js` and the
 * `pulse-rings.js` reference). Same polygons and same spokes → the halo
 * closes at every polygon vertex and spoke tip exactly where the crisp
 * stroke does. No `shadowBlur` (FR-6). `glowStrength` is appended LAST with
 * default `{min:0,max:0}` (§9.2/§9.5): pre-glow seeds decode to `gs === 0`,
 * which is a hard no-op → byte-identical render.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 17,
  name: 'Spiral Web',
  role: 'primary',
  blurb: 'Concentric polygons laced with radial spokes — a radar web.',
  // Worst case doubles under the glow pass: path built twice (864 pathOps),
  // 2 total strokes (1 halo + 1 crisp).
  worstCase: { pathOps: 864, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ringCount', 2, 12, { default: 5 }),
  S.int('spokeCount', 3, 24, { default: 8 }),
  A('baseRadius', 20, 400, { default: { min: 60, max: 200 } }),
  A('spacing', 30, 200, { default: { min: 48, max: 120 } }),
  A('strokeWeight', 1, 10, { default: { min: 1.5, max: 4 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
/**
 * Halo width multiplier — 2.5 mirrors `pulse-rings.js`. At the max
 * `strokeWeight = 10` the halo stroke is 25 px, wide enough to read as an
 * outer bloom without smearing adjacent spokes/rings together.
 */
const K_GLOW = 2.5

/**
 * @typedef {object} SpiralWebPrepared
 * @property {number} ringCount
 * @property {number} spokeCount
 * @property {Float64Array} spokeCos  Per-spoke unit x, `cos(i/spokeCount * 2π)`.
 * @property {Float64Array} spokeSin  Per-spoke unit y, `sin(i/spokeCount * 2π)`.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SpiralWebPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const ringCount = /** @type {number} */ (statics.ringCount)
  const spokeCount = /** @type {number} */ (statics.spokeCount)
  const spokeCos = new Float64Array(spokeCount)
  const spokeSin = new Float64Array(spokeCount)
  for (let i = 0; i < spokeCount; i++) {
    const a = (i / spokeCount) * 2 * Math.PI
    spokeCos[i] = Math.cos(a)
    spokeSin[i] = Math.sin(a)
  }
  return {
    ringCount,
    spokeCount,
    spokeCos,
    spokeSin,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SpiralWebPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const spacing = /** @type {number} */ (resolved.spacing)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { ringCount, spokeCount, spokeCos, spokeSin } = prepared
  const spokeRadius = base + (ringCount - 1) * spacing

  ctx.translate(CX, CY)
  ctx.rotate(rot)
  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'

  // Glow pass — drawn FIRST so the crisp web sits on top (halo under mark).
  // `gs === 0` is a hard no-op: skip entirely for byte-identical pre-glow
  // output. Re-runs the identical path (same polygons, same spokes) so the
  // halo closes at every vertex where the crisp stroke does. See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    ctx.beginPath()
    for (let r = 0; r < ringCount; r++) {
      const rad = base + r * spacing
      for (let j = 0; j < spokeCount; j++) {
        const x = spokeCos[j] * rad
        const y = spokeSin[j] * rad
        if (j === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }
    for (let j = 0; j < spokeCount; j++) {
      ctx.moveTo(0, 0)
      ctx.lineTo(spokeCos[j] * spokeRadius, spokeSin[j] * spokeRadius)
    }
    ctx.stroke()
    ctx.restore()
  }

  ctx.beginPath()
  // Polygons: ring i at radius `base + i*spacing`, walked over the spoke
  // directions so the polygon has `spokeCount` vertices.
  for (let r = 0; r < ringCount; r++) {
    const rad = base + r * spacing
    for (let j = 0; j < spokeCount; j++) {
      const x = spokeCos[j] * rad
      const y = spokeSin[j] * rad
      if (j === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
  // Spokes: radial lines from the centre to the outermost ring's radius.
  for (let j = 0; j < spokeCount; j++) {
    ctx.moveTo(0, 0)
    ctx.lineTo(spokeCos[j] * spokeRadius, spokeSin[j] * spokeRadius)
  }

  ctx.lineWidth = weight
  ctx.stroke()
}