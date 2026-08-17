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
 * **per-effect-glow — the showcase sprite layer.** When `glowStrength > 0`,
 * `draw` blits one `glowSprite` per star BEFORE the crisp bucket loop, sized
 * to `size[i] × K_HALO` at the star's centre under `globalCompositeOperation
 * = 'lighter'`. Each halo's alpha inherits the star's bucket-midpoint pulse
 * (same modulation as the crisp pass) times `gs`, so haloes twinkle in sync
 * with their stars rather than glowing uniformly. Bucket-0 stars are skipped
 * — no halo where the twinkle troughs. Gradient minted once in `prepare` from
 * `statics.scratch` + `statics.color` (§6.5: zero per-frame allocation).
 * FR-6 AC: NO `shadowBlur`. `gs === 0` is a hard no-op ⇒ byte-identical
 * pre-glow output (architecture §9.5). See `src/util/glow.js` for the
 * canonical draw-time idiom and the `glowStrength` param convention.
 *
 * Imports `model/params.js`, `core/rng.js`, `util/glow.js` (§4 rule 2).
 */

import { A, S } from '../model/params.js'
import { range, intRange } from '../core/rng.js'
import { glowGradient, glowSprite } from '../util/glow.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 56,
  name: 'Star Twinkle',
  role: 'overlay',
  blurb: 'A quiet field of stars twinkling on their own phases.',
  // Worst case grows under the glow pass: crisp is 7 bucket-fills (bucket 0
  // skipped) accumulating up to 140 arcs total; the halo pass adds up to
  // MAX_STARS = 140 additive `fillRect` sprite blits (one per star, still
  // skipping bucket 0). No arc pathOps are added — `fillRect` doesn't build
  // a path. Both dimensions raised to 150 covers halo + a small buffer.
  worstCase: { pathOps: 150, drawCalls: 150 },
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
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
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
 * Halo-radius multiplier for the per-star `glowSprite` blit. Stars are 1–4 px
 * discs, so a raw sprite at `size[i]` is invisible against the crisp mark.
 * K = 6 lifts the halo out to 6–24 px — a clear aura around each star at the
 * default fields (`stars ≤ 140`, canvas 1080×1920, ≥ ~7000 px² per star at
 * mean spacing). Higher (10+) blobs adjacent stars into a wash on the tightest
 * spacing; lower (≤ 3) reads as a fringe rather than a glow. This is the
 * showcase layer for per-effect-glow — the widest halo the budget allows.
 */
const K_HALO = 6

/**
 * @typedef {object} StarTwinklePrepared
 * @property {number} stars
 * @property {Float64Array} px      Per-star x centre.
 * @property {Float64Array} py      Per-star y centre.
 * @property {Float64Array} size    Per-star radius in px.
 * @property {Float64Array} phase   Per-star cycle offset in [0, 1).
 * @property {Uint8Array}  k        Per-star integer journey periods per loop.
 * @property {string} color
 * @property {CanvasGradient} glowGrad  Unit-radius radial gradient in the
 *   layer's colour, minted once for per-star `glowSprite` blits (§6.5).
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
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)

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
    color,
    // Prepare-time gradient mint (§6.5): allocation happens once here, the
    // frame path only blits via `glowSprite`.
    glowGrad: glowGradient(scratch, color),
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
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { stars, px, py, size, phase, k } = prepared

  const envelope = ctx.globalAlpha
  const u = phase360 / 360

  // Glow pass — drawn FIRST so the crisp stars sit on top of their haloes.
  // `gs === 0` is a hard no-op: skip the pass entirely for byte-identical
  // pre-glow output. Per-star `glowSprite` blit under 'lighter' with alpha
  // = envelope × gs × twinkle × bucket-midpoint — halos twinkle in sync with
  // their stars rather than shining uniformly. Bucket 0 is skipped (matches
  // the crisp pass: dim-trough stars get no halo either). See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = prepared.glowGrad
    for (let i = 0; i < stars; i++) {
      let localU = k[i] * u + phase[i]
      localU = localU - Math.floor(localU)
      const pulse = (1 - Math.cos(TWO_PI * localU)) / 2
      const bucket = pulse >= 1 ? NB - 1 : Math.floor(pulse * NB)
      if (bucket === 0) continue
      ctx.globalAlpha = envelope * gs * twinkle * ((bucket + 0.5) / NB)
      const rad = size[i] * K_HALO
      // Absolute setTransform (see `glowSprite`); save/restore fences it.
      ctx.setTransform(rad, 0, 0, rad, px[i], py[i])
      ctx.fillRect(-1, -1, 2, 2)
    }
    ctx.restore()
  }

  ctx.fillStyle = prepared.color

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
