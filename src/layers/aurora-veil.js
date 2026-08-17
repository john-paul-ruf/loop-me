// @ts-check
/**
 * Layer type 55 — Aurora Veil (FR-6, architecture §10.2 row 55).
 *
 * A small stack of vertical curved ribbons drifting sideways — the aurora
 * borealis idea, translated into a lightweight overlay. Each ribbon is a
 * closed quad-strip of `SAMPLES` vertices on each edge, whose centreline
 * curls left and right down the canvas under a per-frame horizontal
 * displacement `dx = amp · sin(K · SPACING · y + freq · sway · DEG +
 * phase)`. The strip is filled with a horizontal linear-gradient sprite
 * pre-baked in `prepare` (light-leak's minted-gradient policy), so the
 * frame path allocates nothing (§6.5).
 *
 * Loop closure via the integer-harmonic phase trick (omni-wave S02
 * precedent): each ribbon's `freq` is an integer chosen at prepare, and
 * the sway argument is `freq · sway · DEG`. At `sway = 360°` the
 * argument has advanced by exactly `freq · 2π` — a whole number of full
 * turns of `sin` — so the centreline lands on its `sway = 0°` shape
 * pixel-for-pixel. `{ wrap: true }` is therefore between two identical
 * frames.
 *
 * Strategy per §10.2 & §6.5: `ribbons` ∈ [2, 4] closed paths on the
 * ctx's own path (D1 template — no `Path2D` allocation inside `draw`),
 * one `fill` per ribbon. Each ribbon: 1 moveTo + `SAMPLES - 1` lineTo
 * down the left edge + `SAMPLES` lineTo up the right edge + closePath ≈
 * 2·SAMPLES ops per ribbon. At `ribbons = 4` and `SAMPLES = 12` that
 * lands around the 110-pathOp §10.2 pin.
 *
 * PRNG consumption (FIXED across `ribbons`, FR-4): always draw
 * `MAX_RIBBONS × 5` = 20 rng values so the seed stream position stays
 * stable across `ribbons` changes. Only the first `ribbons × 5` reach
 * live table slots; the rest are consumed to keep the count constant.
 *
 * Never blank: `lumen.min = 0.1` composes with the envelope alpha, and
 * `ribbons.min = 2` always paints at least two full-height stripes; the
 * gradient peaks at `0.7` alpha at the centreline, so at least a mid-
 * grey glow always tints the frame. Composed alpha caps at
 * `1 · 0.5 = 0.5`, so `fullCanvasOpaque: false` holds.
 *
 * Imports `model/params.js` and `core/rng.js` (§4 rule 2).
 */

import { A, S } from '../model/params.js'
import { range, intRange } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 55,
  name: 'Aurora Veil',
  role: 'overlay',
  blurb: 'Slow luminous ribbons drifting across the frame.',
  worstCase: { pathOps: 110, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('ribbons', 2, 4, { default: 3 }),
  // Global sway phase — integer freq per ribbon closes the loop at 360°.
  A('sway', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // lumen.min > 0 (0.1) composes with envelope alpha (Flag 4).
  A('lumen', 0.1, 0.5, { default: { min: 0.18, max: 0.4 } }),
]

const W = 1080
const H = 1920
const DEG = Math.PI / 180
/** Vertices per edge — total per-ribbon strip is 2 · SAMPLES. */
const SAMPLES = 12
/** y step between edge samples. */
const SPACING = H / (SAMPLES - 1)
/** Fixed ribbon budget for the prepare table — every prepare consumes
 * `MAX_RIBBONS · PER_RIBBON_DRAWS` rng values regardless of `ribbons`
 * (FR-4 stream-position stability). */
const MAX_RIBBONS = 4
const PER_RIBBON_DRAWS = 5
/** Horizontal placement band for anchors, in px. */
const ANCHOR_MIN = 180
const ANCHOR_MAX = W - 180
/** Ribbon half-width bounds in px. */
const HALFW_MIN = 60
const HALFW_MAX = 150
/** Sway amplitude bounds in px — how far a ribbon curls sideways. */
const AMP_MIN = 40
const AMP_MAX = 140
/** Integer sway frequency bounds (integer for wrap closure). */
const FREQ_MIN = 1
const FREQ_MAX = 3
/** Vertical sinusoid wavenumber — one wavelength per canvas height. */
const K = (2 * Math.PI) / H

/**
 * @typedef {object} AuroraVeilPrepared
 * @property {number} ribbons
 * @property {Float64Array} anchorX   Per-ribbon centre x.
 * @property {Float64Array} halfW     Per-ribbon strip half-width.
 * @property {Float64Array} amp       Per-ribbon sway amplitude in px.
 * @property {Float64Array} phase     Per-ribbon starting phase.
 * @property {Uint8Array}  freq       Per-ribbon integer sway frequency.
 * @property {CanvasGradient[]} grads Per-ribbon horizontal linear gradient sprite.
 */

/**
 * Parse a `#RRGGBB` string into a 3-tuple `[r, g, b]` uint8s.
 *
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function parseHex(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {AuroraVeilPrepared}
 */
export function prepare(statics, palette, rng) {
  const ribbons = /** @type {number} */ (statics.ribbons)
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const layerColor = /** @type {string} */ (statics.color)
  // Palette pick: draw from scheme.colors so a stack of ribbons paints
  // in the composition's own palette rather than a single tint. Fall back
  // to the layer's resolved colour so an empty palette still renders.
  const paletteColors = palette.scheme.colors.length > 0
    ? palette.scheme.colors
    : [layerColor]

  const sctx = /** @type {CanvasRenderingContext2D} */ (scratch(1, 1).getContext('2d'))

  const anchorX = new Float64Array(MAX_RIBBONS)
  const halfW = new Float64Array(MAX_RIBBONS)
  const amp = new Float64Array(MAX_RIBBONS)
  const phase = new Float64Array(MAX_RIBBONS)
  const freq = new Uint8Array(MAX_RIBBONS)
  const grads = /** @type {CanvasGradient[]} */ (new Array(MAX_RIBBONS))

  // FIXED draw count: MAX_RIBBONS × PER_RIBBON_DRAWS rng values. Only the
  // first `ribbons` slots reach draw; surplus draws are consumed only to
  // keep the stream position stable across `ribbons` changes.
  for (let i = 0; i < MAX_RIBBONS; i++) {
    const ax = range(rng, ANCHOR_MIN, ANCHOR_MAX)
    const hw = range(rng, HALFW_MIN, HALFW_MAX)
    const am = range(rng, AMP_MIN, AMP_MAX)
    const ph = rng() * (Math.PI * 2)
    const colorIdx = Math.min(paletteColors.length - 1, Math.floor(rng() * paletteColors.length))
    const fq = intRange(rng, FREQ_MIN, FREQ_MAX)
    if (i < ribbons) {
      anchorX[i] = ax
      halfW[i] = hw
      amp[i] = am
      phase[i] = ph
      freq[i] = fq
      const [r, g, b] = parseHex(paletteColors[colorIdx])
      // Horizontal linear gradient centred on the ribbon anchor, tapering
      // from transparent at the edges to a mid-alpha core (light-leak's
      // minted-gradient policy — allocation is in prepare, not draw).
      const grad = sctx.createLinearGradient(ax - hw, 0, ax + hw, 0)
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
      grad.addColorStop(0.5, `rgba(${r},${g},${b},0.7)`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
      grads[i] = grad
    }
  }

  return { ribbons, anchorX, halfW, amp, phase, freq, grads }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {AuroraVeilPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const swayDeg = /** @type {number} */ (resolved.sway)
  const lumen = /** @type {number} */ (resolved.lumen)
  const { ribbons, anchorX, halfW, amp, phase, freq, grads } = prepared

  // Flag 4 posture: composes with envelope alpha, never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * lumen
  const swayRad = swayDeg * DEG

  for (let r = 0; r < ribbons; r++) {
    const ax = anchorX[r]
    const hw = halfW[r]
    const am = amp[r]
    const ph = phase[r]
    const fq = freq[r]

    ctx.beginPath()
    // Down the left edge.
    for (let s = 0; s < SAMPLES; s++) {
      const y = s * SPACING
      const dx = am * Math.sin(K * y + fq * swayRad + ph)
      const x = ax + dx - hw
      if (s === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    // Up the right edge — reuse the same centreline sinusoid so left and
    // right stay parallel across the strip.
    for (let s = SAMPLES - 1; s >= 0; s--) {
      const y = s * SPACING
      const dx = am * Math.sin(K * y + fq * swayRad + ph)
      ctx.lineTo(ax + dx + hw, y)
    }
    ctx.closePath()
    ctx.fillStyle = grads[r]
    ctx.fill()
  }
}
