// @ts-check
/**
 * Layer type 27 — Concentric Waves (FR-6, architecture §10.2 row 27).
 *
 * `ringCount` concentric circles whose radii are modulated by a travelling
 * wave around their circumference — each ring is a wobbly closed polyline
 * shaped by `cos(waveFreq × θ) × amplitude`. Closest to nth-rings
 * (concentric arcs) combined with sine-ribbons (sampled polylines). Each
 * ring is a `POINTS`-vertex polyline; the whole stack accumulates on one
 * ctx path and strokes once.
 *
 * Strategy per §10.2: one accumulated path, single stroke — built on the
 * ctx's own path (D1 template); §6.5 bans `Path2D` allocation inside
 * `draw` because every vertex radius depends on animated params.
 *
 * Never blank: `ringCount` ≥ 2 and `baseRadius` ≥ 40 means at least two
 * rings with baseline radius ≥ 40. The `Math.max(2, …)` guard on each
 * vertex radius keeps every ring ≥ 2 px even at the extreme where
 * `amplitude` (80) exceeds `baseRadius` (40) at the wave trough — so no
 * vertex ever collapses to the origin or goes negative.
 *
 * `prepare` caches `POINTS`, the angular `step`, and `waveFreq`.
 * `draw` reads `baseRadius`, `spacing`, `amplitude`, `strokeWeight`,
 * `rotation` — all animated.
 *
 * **per-effect-glow (S04):** wide additive re-stroke archetype. When
 * `glowStrength > 0`, `draw` re-runs the ring-by-ring polyline loop once
 * BEFORE the crisp pass under `globalCompositeOperation = 'lighter'` at
 * `lineWidth × K_GLOW` — a soft halo under the wobbly rings, crisp
 * contours on top. Loop closure is preserved because every halo ring is
 * built by the same `p = 0..POINTS-1` sweep with a `closePath()` — the
 * halo family at `rotation = 360°` maps onto its `rotation = 0°` self,
 * just like the crisp family. No `shadowBlur` (FR-6); `gs === 0` is a
 * hard no-op → pre-glow seeds decode byte-identical (§9.5). K = 2.2 keeps
 * the halo distinct without merging neighbouring rings at spacing.min = 20.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws —
 * phase is `rotation * DEG`, purely animated.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 27,
  name: 'Concentric Waves',
  role: 'secondary',
  blurb: 'Concentric rings rippling with a travelling wave.',
  // Worst case doubles under the glow pass: 1 halo stroke + 1 crisp stroke,
  // halo path is the same wobbly-ring polyline as the crisp path.
  worstCase: { pathOps: 1200, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ringCount', 2, 12, { default: 5 }),
  A('baseRadius', 40, 400, { default: { min: 80, max: 240 } }),
  A('spacing', 20, 180, { default: { min: 48, max: 120 } }),
  A('amplitude', 0, 80, { default: { min: 0, max: 40 } }),
  S.int('waveFreq', 1, 8, { default: 3 }),
  A('strokeWeight', 1, 10, { default: { min: 1.5, max: 4 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/** Points per ring (§10.2: 12 × 50 = 600). */
const POINTS = 50
/**
 * Halo width multiplier. Moderate density (up to 12 rings × 50 verts);
 * `spacing.min = 20` allows the closest rings to sit 20 px apart. 2.2 keeps
 * the halo clearly wider than the mark at every `strokeWeight` without
 * bleeding adjacent rings into each other.
 */
const K_GLOW = 2.2

/**
 * @typedef {object} ConcentricWavesPrepared
 * @property {number} count
 * @property {number} step
 * @property {number} freq
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {ConcentricWavesPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  return {
    count: /** @type {number} */ (statics.ringCount),
    step: TWO_PI / POINTS,
    freq: /** @type {number} */ (statics.waveFreq),
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {ConcentricWavesPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const base = /** @type {number} */ (resolved.baseRadius)
  const spacing = /** @type {number} */ (resolved.spacing)
  const amp = /** @type {number} */ (resolved.amplitude)
  const weight = /** @type {number} */ (resolved.strokeWeight)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { count, step, freq } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.translate(CX, CY)
  ctx.rotate(rot)

  // Glow pass — drawn FIRST so the crisp rings sit on top (halo under mark).
  // Same p = 0..POINTS-1 sweep + `closePath()` per ring preserves loop
  // closure in the halo. `gs === 0` is a hard no-op: skip entirely for
  // byte-identical pre-glow output.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = weight * K_GLOW
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const rBase = base + i * spacing
      for (let p = 0; p < POINTS; p++) {
        const ang = p * step
        const r = Math.max(2, rBase + amp * Math.cos(freq * ang))
        const x = r * Math.cos(ang)
        const y = r * Math.sin(ang)
        if (p === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }
    ctx.stroke()
    ctx.restore()
    // `strokeStyle`, `lineJoin`, and transform survive `restore()`.
  }

  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const rBase = base + i * spacing
    for (let p = 0; p < POINTS; p++) {
      const ang = p * step
      const r = Math.max(2, rBase + amp * Math.cos(freq * ang))
      const x = r * Math.cos(ang)
      const y = r * Math.sin(ang)
      if (p === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }

  ctx.lineWidth = weight
  ctx.stroke()
}