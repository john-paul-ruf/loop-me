// @ts-check
/**
 * Layer type 57 — Anamorphic Flare (FR-6, architecture §10.2 row 57).
 *
 * The horizontal streak-and-blob signature of an anamorphic lens flare —
 * a small number of bright bars slide left and right across the frame at
 * fixed y-heights, each carrying a soft glow ball at its centre and a
 * thin hot core along its middle. Three prepared sprites are baked once
 * (a horizontal streak gradient, a soft blob, and the thin core rect is
 * a direct `fillRect` — no allocation), then reused across every disc
 * position on every frame (§6.5).
 *
 * Loop closure via the trigonometric-orbit trick (Bokeh Drift precedent):
 * each streak's centre is `cx = STREAK_CX + amp · cos(sweep · DEG +
 * phase)`. `cos` is 2π-periodic in `sweep`, so `cx(sweep = 0°)` and
 * `cx(sweep = 360°)` land on the exact same pixel — `{ wrap: true }` is
 * between two identical frames.
 *
 * Strategy per §10.2 & §6.5: three draw calls per streak (streak sprite,
 * blob sprite, core `fillRect`), no `beginPath`/`fill` in the frame
 * path. At `streaks = 3` that pins `drawCalls = 9`. The core `fillRect`
 * is the only pathOp per streak; `worstCase.pathOps = 6` covers the
 * upper bound with margin (each `fillRect` counting as ≤ 2 in the
 * project's conservative accounting).
 *
 * Palette bucket pick: each streak's core-rect fillStyle is drawn from
 * `palette.scheme.colors` (fallback to `statics.color` on an empty
 * scheme), so a stack of streaks reads as three different-coloured
 * flares against a shared warm haze from the sprites — the same
 * multi-tint feel Aurora Veil gets from its per-ribbon gradient pick.
 * Sprites remain in the layer's resolved colour so the composed frame
 * still centres on the layer's chosen tint.
 *
 * PRNG consumption (FIXED across `streaks`, FR-4): always draw
 * `MAX_STREAKS × 4` = 12 rng values so the seed stream position stays
 * stable across `streaks` changes. Only the first `streaks × 4` reach
 * live table slots.
 *
 * Never blank: `flare.min = 0.15` composes with the envelope alpha; a
 * streak always paints at least 30% of the canvas width as a soft
 * horizontal glow. Composed alpha caps at `1 · 0.8 = 0.8`, so
 * `fullCanvasOpaque: false` holds — most of the vertical extent stays
 * background.
 *
 * Imports `model/params.js` and `core/rng.js` (§4 rule 2).
 */

import { A, S } from '../model/params.js'
import { range } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 57,
  name: 'Anamorphic Flare',
  role: 'overlay',
  blurb: 'Anamorphic streaks drifting bright across the frame.',
  worstCase: { pathOps: 6, drawCalls: 9 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('streaks', 1, 3, { default: 2 }),
  // Streak length as a fraction of canvas width. length.min > 0 (0.3).
  A('length', 0.3, 0.9, { default: { min: 0.4, max: 0.75 } }),
  // Global sweep — cos(sweep·DEG + phase_i) closes the loop at 360°.
  A('sweep', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // flare.min > 0 (0.15) composes with envelope alpha (Flag 4).
  A('flare', 0.15, 0.8, { default: { min: 0.25, max: 0.6 } }),
]

const W = 1080
const H = 1920
const CX = W / 2
const DEG = Math.PI / 180
/** Streak sprite native size — the horizontal gradient runs across STREAK_SW,
 * uniform across STREAK_SH. `drawImage` scales this to the per-frame length. */
const STREAK_SW = 512
const STREAK_SH = 24
/** Glow-blob sprite native size — square radial gradient. */
const BLOB_S = 128
/** Fixed streak budget for the prepare table (FR-4 stream stability). */
const MAX_STREAKS = 3
const PER_STREAK_DRAWS = 4
/** Sweep amplitude in px — how far each streak drifts from centre. */
const AMP_MIN = 40
const AMP_MAX = 220
/** Vertical placement band — streaks stay clear of the very top and bottom. */
const Y_MIN = 260
const Y_MAX = H - 260
/** Thin core rect dimensions. */
const CORE_HH = 2
const CORE_WFRAC = 0.7

/**
 * @typedef {object} AnamorphicFlarePrepared
 * @property {number} streaks
 * @property {HTMLCanvasElement} streakSprite  Native horizontal-gradient bar.
 * @property {HTMLCanvasElement} blobSprite    Native radial-gradient blob.
 * @property {Float64Array} y                  Per-streak y-position.
 * @property {Float64Array} amp                Per-streak x drift amplitude.
 * @property {Float64Array} phase              Per-streak sweep phase in radians.
 * @property {string[]} coreColor              Per-streak core-rect fillStyle.
 */

/**
 * Parse `#RRGGBB` into `[r, g, b]` uint8s.
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
 * Bake the streak sprite — a horizontal linear gradient tapering from
 * transparent at both edges to a bright core in the layer colour. Sized
 * `STREAK_SW × STREAK_SH` so per-frame `drawImage` can stretch it to any
 * pixel length without pre-stretching artefacts.
 *
 * @param {import('../model/params.js').ScratchFactory} scratch
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {HTMLCanvasElement}
 */
function bakeStreak(scratch, r, g, b) {
  const canvas = scratch(STREAK_SW, STREAK_SH)
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  const grad = c.createLinearGradient(0, 0, STREAK_SW, 0)
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`)
  grad.addColorStop(0.5, `rgba(${r},${g},${b},0.85)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c.fillStyle = grad
  c.fillRect(0, 0, STREAK_SW, STREAK_SH)
  return canvas
}

/**
 * Bake the glow-blob sprite — a soft radial gradient in the layer colour.
 *
 * @param {import('../model/params.js').ScratchFactory} scratch
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {HTMLCanvasElement}
 */
function bakeBlob(scratch, r, g, b) {
  const canvas = scratch(BLOB_S, BLOB_S)
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  const half = BLOB_S / 2
  const grad = c.createRadialGradient(half, half, 0, half, half, half)
  grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`)
  grad.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c.fillStyle = grad
  c.fillRect(0, 0, BLOB_S, BLOB_S)
  return canvas
}

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {AnamorphicFlarePrepared}
 */
export function prepare(statics, palette, rng) {
  const streaks = /** @type {number} */ (statics.streaks)
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const layerColor = /** @type {string} */ (statics.color)
  const paletteColors = palette.scheme.colors.length > 0
    ? palette.scheme.colors
    : [layerColor]

  const [lr, lg, lb] = parseHex(layerColor)
  const streakSprite = bakeStreak(scratch, lr, lg, lb)
  const blobSprite = bakeBlob(scratch, lr, lg, lb)

  const y = new Float64Array(MAX_STREAKS)
  const amp = new Float64Array(MAX_STREAKS)
  const phase = new Float64Array(MAX_STREAKS)
  const coreColor = /** @type {string[]} */ (new Array(MAX_STREAKS))

  // FIXED draw count: MAX_STREAKS × PER_STREAK_DRAWS. Surplus consumed
  // to keep stream position stable across `streaks` changes (FR-4).
  for (let i = 0; i < MAX_STREAKS; i++) {
    const yi = range(rng, Y_MIN, Y_MAX)
    const ai = range(rng, AMP_MIN, AMP_MAX)
    const colorIdx = Math.min(paletteColors.length - 1, Math.floor(rng() * paletteColors.length))
    const ph = rng() * (Math.PI * 2)
    if (i < streaks) {
      y[i] = yi
      amp[i] = ai
      phase[i] = ph
      coreColor[i] = paletteColors[colorIdx]
    }
  }

  return { streaks, streakSprite, blobSprite, y, amp, phase, coreColor }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {AnamorphicFlarePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const length = /** @type {number} */ (resolved.length)
  const sweepDeg = /** @type {number} */ (resolved.sweep)
  const flare = /** @type {number} */ (resolved.flare)
  const { streaks, streakSprite, blobSprite, y, amp, phase, coreColor } = prepared

  // Flag 4 posture: composes with envelope alpha, never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * flare
  const sweepRad = sweepDeg * DEG
  const streakLen = length * W
  const halfLen = streakLen / 2
  const coreLen = streakLen * CORE_WFRAC
  const halfCoreLen = coreLen / 2
  // Glow blob scales with streak length so shorter flares carry smaller
  // halos — reads as one physical light source rather than two effects.
  const blobSize = Math.max(160, streakLen * 0.35)
  const halfBlob = blobSize / 2

  for (let i = 0; i < streaks; i++) {
    const cx = CX + amp[i] * Math.cos(sweepRad + phase[i])
    const yy = y[i]
    // 1. The stretched horizontal streak sprite.
    ctx.drawImage(streakSprite, cx - halfLen, yy - STREAK_SH / 2, streakLen, STREAK_SH)
    // 2. The glow blob at the streak's centre.
    ctx.drawImage(blobSprite, cx - halfBlob, yy - halfBlob, blobSize, blobSize)
    // 3. The thin hot core, in the palette-picked colour.
    ctx.fillStyle = coreColor[i]
    ctx.fillRect(cx - halfCoreLen, yy - CORE_HH, coreLen, CORE_HH * 2)
  }
}
