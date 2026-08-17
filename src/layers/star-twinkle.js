// @ts-check
/**
 * Layer type 56 — Star Twinkle (FR-6, architecture §10.2 row 56).
 *
 * A field of `stars` tiny bright dots at fixed positions, each twinkling
 * with its own phase and integer speed. Per frame: every star's alpha is
 * `pulse((k_i · u + phase_i) mod 1) · twinkle`, where `pulse` is the
 * `(1 - cos(2π u))/2` journey (the calmest shape in the algorithm
 * catalog, algorithms.js §primitives) and `u = pulse360/360`. The table
 * IS the sky — positions, sizes, phases, and integer speeds are drawn
 * once in `prepare` and never touched again; every subsequent frame is a
 * pure function of that table plus two global animated values.
 *
 * Loop closure via the integer-speed harmonic (omni-wave S02 precedent):
 * `k_i` is drawn as an integer in [1, 3] at prepare, so at `pulse360 =
 * 360°` each star's local `u_i = k_i · 1 + phase_i` differs from
 * `u_i(0°) = phase_i` by an integer — the journey pulse repeats every
 * unit interval so both frames land on the identical alpha per star.
 *
 * Strategy per §10.2 & §6.5: quantize each star's continuous
 * `pulse((k · u + phase) mod 1)` into `NB = 8` alpha buckets and fill
 * each non-empty bucket as one accumulated multi-arc path (D1 template —
 * no `Path2D` allocation inside `draw`). Bucket 0 is the dim trough and
 * is skipped (alpha under `1/8` reads as darkroom noise on a moving
 * base). All stars in a bucket share the bucket-midpoint pulse value, so
 * the twinkle looks quantized — the print-look on stars.
 *
 * PRNG consumption (FIXED across `stars`, FR-4): always draw
 * `MAX_STARS × 5` = 700 rng values so the seed stream position stays
 * stable across `stars` changes. Only the first `stars × 5` reach live
 * table slots; surplus draws are consumed to keep the count constant.
 *
 * Never blank: `twinkle.min = 0.2` composes with envelope alpha, and
 * `stars.min = 50` guarantees dozens of stars register in some bucket
 * every frame — the sky always has some twinkling stars. Composed alpha
 * caps at `1 · 1 = 1` at the brightest bucket for a single star, but a
 * star occupies at most a 4-px disc so `fullCanvasOpaque: false` holds
 * trivially — most of the frame remains background.
 *
 * Imports `model/params.js` and `core/rng.js` (§4 rule 2).
 */

import { A, S } from '../model/params.js'
import { range, intRange } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 56,
  name: 'Star Twinkle',
  role: 'overlay',
  blurb: 'A quiet field of stars twinkling on their own phases.',
  worstCase: { pathOps: 150, drawCalls: 8 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('stars', 50, 140, { default: 90 }),
  // Global cycle position (u = phase360/360). Integer per-star k · 2π
  // makes wrap:true a truly closed loop — both endpoints identical.
  A('phase360', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // twinkle.min > 0 (0.2) composes with envelope alpha (Flag 4).
  A('twinkle', 0.2, 1, { default: { min: 0.35, max: 0.8 } }),
]

const W = 1080
const H = 1920
const TWO_PI = Math.PI * 2
/** Alpha bucket count — matches drawCalls in the §10.2 pin. */
const NB = 8
/** Fixed star budget — every prepare consumes `MAX_STARS · PER_STAR_DRAWS`
 * rng values regardless of `stars`, so downstream stream position stays
 * stable across compositions (FR-4). */
const MAX_STARS = 140
const PER_STAR_DRAWS = 5
/** Star radius range in px (session prompt: "size 1–4px"). */
const R_MIN = 1
const R_MAX = 4
/** Integer speed range — journey periods per loop. Integer for wrap closure. */
const K_MIN = 1
const K_MAX = 3
/** Inset so stars stay wholly inside the canvas. */
const INSET = 8

/**
 * @typedef {object} StarTwinklePrepared
 * @property {number} stars
 * @property {Float64Array} px      Per-star x centre.
 * @property {Float64Array} py      Per-star y centre.
 * @property {Float64Array} size    Per-star radius in px.
 * @property {Float64Array} phase   Per-star cycle offset in [0, 1).
 * @property {Uint8Array}  k        Per-star integer journey periods per loop.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {StarTwinklePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const stars = /** @type {number} */ (statics.stars)

  const px = new Float64Array(MAX_STARS)
  const py = new Float64Array(MAX_STARS)
  const size = new Float64Array(MAX_STARS)
  const phase = new Float64Array(MAX_STARS)
  const k = new Uint8Array(MAX_STARS)

  // FIXED draw count: MAX_STARS × PER_STAR_DRAWS. Only the first `stars`
  // slots reach draw; surplus draws keep stream position stable.
  for (let i = 0; i < MAX_STARS; i++) {
    const x = range(rng, INSET, W - INSET)
    const y = range(rng, INSET, H - INSET)
    const s = range(rng, R_MIN, R_MAX)
    const ph = rng()
    const speed = intRange(rng, K_MIN, K_MAX)
    if (i < stars) {
      px[i] = x
      py[i] = y
      size[i] = s
      phase[i] = ph
      k[i] = speed
    }
  }

  return {
    stars,
    px,
    py,
    size,
    phase,
    k,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {StarTwinklePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const phase360 = /** @type {number} */ (resolved.phase360)
  const twinkle = /** @type {number} */ (resolved.twinkle)
  const { stars, px, py, size, phase, k } = prepared

  ctx.fillStyle = prepared.color
  const envelope = ctx.globalAlpha
  const u = phase360 / 360

  // NB passes over the star table — each pass fills the stars whose
  // quantized pulse value lands in its bucket. Bucket 0 is the dim
  // trough (alpha < 1/8 · twinkle) and is skipped; that leaves ≤ 7
  // buckets active but pins drawCalls ≤ 8 either way.
  for (let b = 1; b < NB; b++) {
    ctx.beginPath()
    for (let i = 0; i < stars; i++) {
      // Star-local cycle position, wrapped into [0, 1).
      let localU = k[i] * u + phase[i]
      localU = localU - Math.floor(localU)
      const pulse = (1 - Math.cos(TWO_PI * localU)) / 2
      const bucket = pulse >= 1 ? NB - 1 : Math.floor(pulse * NB)
      if (bucket !== b) continue
      const r = size[i]
      ctx.moveTo(px[i] + r, py[i])
      ctx.arc(px[i], py[i], r, 0, TWO_PI)
    }
    // Bucket-midpoint pulse × twinkle × envelope. Flag 4 posture.
    ctx.globalAlpha = envelope * twinkle * ((b + 0.5) / NB)
    ctx.fill()
  }
}
