// @ts-check
/**
 * Layer type 53 — Halftone Sweep (FR-6, architecture §10.2 row 53).
 *
 * A static dot grid whose per-dot radius peaks inside a horizontal band
 * and fades to zero at `spread` px above/below the band centre — the
 * classic halftone print effect, animated by sliding the band across the
 * canvas. `spacing` sets the grid pitch (44..80 px → up to ~1100 dots on
 * a 1080×1920 canvas); every dot's centre is fixed at prepare, and only
 * the per-dot radius modulates each frame.
 *
 * Loop closure via the cosine-traversal trick (band-exit precedent, but
 * with a periodic mapping): `band` sweeps 0..360° with `{ wrap: true }`
 * and drives the band centre through `bandY = CY − TRAVEL·cos(band·DEG)`.
 * `cos` is 2π-periodic in `band`, so `bandY(0°) === bandY(360°)`
 * identically — the wrap jump is between two identical frames. Unlike
 * Stripe Sweep's off-canvas linear glide, the band is always ON-canvas
 * for every fixed value of `band`, so the FR-6 min/mid/max sweep sees
 * visible dots at every bound (a linear off-canvas traversal would paint
 * nothing at `band = 0°`).
 *
 * Strategy per §10.2: quantize each dot's continuous radius factor into 6
 * alpha buckets, then commit each bucket as one accumulated multi-arc
 * path (D1 template — §6.5 bans allocating a `Path2D` inside `draw`) with
 * one `fill` per bucket. All dots in a bucket share the bucket-midpoint
 * radius, which yields the punchy halftone print look rather than a
 * smoothly-shaded gradient — six fills total, up to ~1100 arcs summed.
 * Consumes zero PRNG draws.
 *
 * Never blank: `opacity.min = 0.15` composes with the envelope alpha, and
 * as the band sweeps through the canvas the top bucket always contains
 * the dots closest to the band centre — some dot always paints visibly.
 * `fullCanvasOpaque: false` — even at max coverage the grid leaves gaps
 * between dots (radius peaks at `spacing · 0.4`, so at least 20% of each
 * cell remains uncovered) and the composed alpha caps at `1 · 0.7 = 0.7`.
 *
 * **per-effect-glow — additive re-fill per bucket (option B, from
 * `orbit-dots.js`).** When `glowStrength > 0`, `draw` re-runs the bucket loop
 * ONCE more BEFORE the crisp pass under `globalCompositeOperation = 'lighter'`
 * at each bucket's dot radius × `K_GLOW` — a widened halo per bucket, crisp
 * dots on top. Option A (per-dot `glowSprite`) was rejected the same way
 * `orbit-dots.js` rejected it: up to ~1170 additive blits at worst case
 * (spacing=44) far exceeds this layer's budget, and a single sprite can't
 * cover dots distributed across the canvas. The additive re-fill costs one
 * extra `fill()` per non-trough bucket (+5 drawCalls) and re-issues the same
 * arc pathOps under the wider radius (path ops double). FR-6 AC: NO
 * `shadowBlur`; §6.5: no per-frame allocation (no gradient needed — plain
 * colour re-fill). `gs === 0` is a hard no-op ⇒ byte-identical pre-glow
 * output (architecture §9.5). See `src/util/glow.js` for the canonical
 * draw-time idiom and the `glowStrength` param convention.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 53,
  name: 'Halftone Sweep',
  role: 'overlay',
  blurb: 'A halftone dot grid pulsing under a swept band.',
  // Worst case doubles under the glow pass: the halo re-runs the same NB-1
  // bucket loop at widened radius (+5 fills, +up to ~1170 arc pathOps at
  // spacing=44). Crisp is 5 fills / ~1170 arcs; glow adds another 5 / ~1170.
  worstCase: { pathOps: 2200, drawCalls: 12 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  // Grid pitch in px. min = 44 → ~25 × 45 = 1125 dots on 1080×1920.
  S.int('spacing', 44, 80, { default: 56 }),
  // Half-band fade radius in px. spread.min > 0 (60 px) so the band is
  // always at least a few rows tall when it crosses the canvas.
  A('spread', 60, 400, { unit: 'px', default: { min: 120, max: 320 } }),
  // Band centre position, mapped through `cos(band·DEG)` so 0° and 360°
  // land at the exact same y — wrap is between two identical frames.
  A('band', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // opacity.min > 0 (0.15) composes with envelope alpha (Flag 4).
  A('opacity', 0.15, 0.7, { default: { min: 0.2, max: 0.5 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const W = 1080
const H = 1920
const CY = H / 2
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
/** Bucket count — matches drawCalls in the §10.2 pin. */
const NB = 6
/** Half-amplitude of the cosine traversal in px. The band centre reaches
 * `CY ± TRAVEL`, i.e. y ∈ [160, 1760]: 160 px of inset at both ends
 * leaves room for `spread ≤ 400` to still touch on-canvas dots at every
 * pinned value of `band`. */
const TRAVEL = CY - 160
/** Cell fraction the max dot radius occupies (never touches the neighbour). */
const RADIUS_FRAC = 0.4
/**
 * Halo radius multiplier for the additive re-fill glow pass. Matches
 * `orbit-dots.js` (the fill/dot budget archetype) at 1.8× the dot radius —
 * below 1.4× the halo hides inside the crisp dot; above 2.5× adjacent haloes
 * merge into a wash at the tightest `spacing`. 1.8 widens each bucket's dot
 * to a clear ring of light without bleeding the grid into a smear.
 */
const K_GLOW = 1.8

/**
 * @typedef {object} HalftoneSweepPrepared
 * @property {number} dotCount
 * @property {Float64Array} dotX
 * @property {Float64Array} dotY
 * @property {number} rmax        Max dot radius in px (== spacing · RADIUS_FRAC).
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {HalftoneSweepPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const spacing = /** @type {number} */ (statics.spacing)
  const cols = Math.ceil(W / spacing) + 1
  const rows = Math.ceil(H / spacing) + 1
  // Centre the grid on the canvas — over-cover by one row/col so the
  // outermost dots sit off-canvas rather than leave a bare border.
  const x0 = (W - (cols - 1) * spacing) / 2
  const y0 = (H - (rows - 1) * spacing) / 2

  const dotCount = cols * rows
  const dotX = new Float64Array(dotCount)
  const dotY = new Float64Array(dotCount)
  let idx = 0
  for (let row = 0; row < rows; row++) {
    const cy = y0 + row * spacing
    for (let col = 0; col < cols; col++) {
      dotX[idx] = x0 + col * spacing
      dotY[idx] = cy
      idx++
    }
  }

  return {
    dotCount,
    dotX,
    dotY,
    rmax: spacing * RADIUS_FRAC,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {HalftoneSweepPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const bandDeg = /** @type {number} */ (resolved.band)
  const spread = /** @type {number} */ (resolved.spread)
  const opacity = /** @type {number} */ (resolved.opacity)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { dotCount, dotX, dotY, rmax } = prepared

  // Flag 4 posture: composes with the envelope alpha, never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * opacity
  ctx.fillStyle = prepared.color

  // Cosine traversal — `bandY(0°) === bandY(360°)` identically, so the
  // wrap is between two identical frames. Band centre stays on-canvas at
  // every pinned value of `band` so the FR-6 min/mid/max sweep always
  // paints visible dots.
  const bandY = CY - TRAVEL * Math.cos(bandDeg * DEG)
  const invSpread = 1 / spread

  // Glow pass — additive re-fill per bucket at K_GLOW × dot radius (option B,
  // matching `orbit-dots.js`). Drawn FIRST so the crisp dots sit on top of
  // their haloes. `gs === 0` is a hard no-op ⇒ byte-identical pre-glow
  // output. See `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const aC = ctx.globalAlpha  // already envelope × opacity
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = aC * gs
    for (let b = 1; b < NB; b++) {
      const r = rmax * ((b + 0.5) / NB) * K_GLOW
      ctx.beginPath()
      for (let i = 0; i < dotCount; i++) {
        const d = Math.abs(dotY[i] - bandY) * invSpread
        const inf = d >= 1 ? 0 : 1 - d
        const bucket = inf >= 1 ? NB - 1 : Math.floor(inf * NB)
        if (bucket !== b) continue
        ctx.moveTo(dotX[i] + r, dotY[i])
        ctx.arc(dotX[i], dotY[i], r, 0, TWO_PI)
      }
      ctx.fill()
    }
    ctx.restore()
  }

  // Six passes over the dot table — each pass fills the dots whose
  // quantized influence lands in its bucket. Bucket 0 is the trough (no
  // radius, skipped); bucket NB-1 is the crest. All dots in a bucket
  // share the bucket-midpoint radius — the halftone-print look.
  for (let b = 1; b < NB; b++) {
    const r = rmax * ((b + 0.5) / NB)
    ctx.beginPath()
    for (let i = 0; i < dotCount; i++) {
      const d = Math.abs(dotY[i] - bandY) * invSpread
      // influence = max(0, 1 - d); bucket floor(influence · NB), clamped.
      const inf = d >= 1 ? 0 : 1 - d
      const bucket = inf >= 1 ? NB - 1 : Math.floor(inf * NB)
      if (bucket !== b) continue
      ctx.moveTo(dotX[i] + r, dotY[i])
      ctx.arc(dotX[i], dotY[i], r, 0, TWO_PI)
    }
    ctx.fill()
  }
}
