// @ts-check
/**
 * Layer type 20 — Pulse Rings (FR-6, architecture §10.2 row 20).
 *
 * `ringCount` concentric rings like nth-rings, but each ring's strokeWeight
 * is multiplied by `(0.5 + 0.5·cos(phase))` where
 * `phase = waveFreq × 2π × (i / ringCount) + sweep` — a structural wave
 * along the stack, so the rings "breathe" in a travelling pulse rather
 * than uniformly. `dashCount` > 0 needs a per-ring `setLineDash` (the
 * segment length scales with each ring's radius), matching nth-rings'
 * pattern.
 *
 * Strategy per §10.2: 24 draw calls worst case (dashed case needs a
 * per-ring `setLineDash`). The reused 2-element dash array is preallocated
 * in `prepare` and mutated in `draw` (§6.5 bans array literals on the
 * frame path; `setLineDash` copies it). Consumes zero PRNG draws — phase
 * is deterministic from `sweep` and indices.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 20,
  name: 'Pulse Rings',
  role: 'primary',
  blurb: 'Concentric rings breathing in a travelling wave of weight.',
  worstCase: { pathOps: 24, drawCalls: 24 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ringCount', 2, 24, { default: 10 }),
  A('spacing', 10, 160, { default: { min: 36, max: 88 } }),
  A('baseWeight', 1, 20, { default: { min: 3, max: 10 } }),
  A('radiusOffset', 0, 200, { default: { min: 0, max: 60 } }),
  S.int('dashCount', 0, 48),
  A('sweep', 0, 360, { unit: '°', wrap: true }),
  S.int('waveFreq', 1, 6, { default: 2 }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2

/**
 * @typedef {object} PulseRingsPrepared
 * @property {number} count
 * @property {number} dashCount
 * @property {number} freq
 * @property {number[]} dash   Reused 2-element segment array for setLineDash.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {PulseRingsPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  return {
    count: /** @type {number} */ (statics.ringCount),
    dashCount: /** @type {number} */ (statics.dashCount),
    freq: /** @type {number} */ (statics.waveFreq),
    dash: [0, 0],
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {PulseRingsPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const spacing = /** @type {number} */ (resolved.spacing)
  const baseW = /** @type {number} */ (resolved.baseWeight)
  const off = /** @type {number} */ (resolved.radiusOffset)
  const sweepRad = /** @type {number} */ (resolved.sweep) * DEG
  const { count, dashCount, freq, dash } = prepared

  ctx.strokeStyle = prepared.color

  if (dashCount === 0) {
    for (let i = 0; i < count; i++) {
      const r = off + spacing * (i + 1)
      const phase = freq * TWO_PI * (i / count) + sweepRad
      ctx.lineWidth = Math.max(0.5, baseW * (0.5 + 0.5 * Math.cos(phase)))
      ctx.beginPath()
      ctx.moveTo(CX + r, CY)
      ctx.arc(CX, CY, r, 0, TWO_PI)
      ctx.stroke()
    }
  } else {
    for (let i = 0; i < count; i++) {
      const r = off + spacing * (i + 1)
      const phase = freq * TWO_PI * (i / count) + sweepRad
      ctx.lineWidth = Math.max(0.5, baseW * (0.5 + 0.5 * Math.cos(phase)))
      const seg = (Math.PI * r) / dashCount
      dash[0] = seg
      dash[1] = seg
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.arc(CX, CY, r, 0, TWO_PI)
      ctx.stroke()
    }
  }
}