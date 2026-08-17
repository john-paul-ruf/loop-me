// @ts-check
/**
 * Layer type 52 — Flow Strands (FR-6, architecture §10.2 row 52).
 *
 * Streamlines through a static synthetic vector field: three sinusoid
 * terms with integer frequencies sum into a divergence-free flow, and
 * `strands` streamlines seeded across the canvas are integrated forward
 * `STEPS` fixed steps and cached as polylines. The frame just re-strokes
 * those cached lines with an animated dash offset, so animation carries
 * no per-frame geometry cost — matching the `line-field.js` precedent
 * for stroke-heavy secondary textures.
 *
 * Loop closure via dash-phase advance (omni-wave S03 toolbox): the stroke
 * dashes with period `DASH_P` and `lineDashOffset` advances exactly
 * `DASH_CYCLES` full dash periods per `flow` sweep 0..360°; at `flow = 360°`
 * every dash sits on top of its `flow = 0°` neighbour. `shimmer` is
 * A-typed via the default algorithm (`journeySin`), which is structurally
 * loop-closed.
 *
 * Strategy per §10.2: at most `NB = 8` accumulated paths on the ctx's
 * own path (D1 template — §6.5 bans allocating a `Path2D` inside `draw`),
 * one stroke per alpha bucket. Each strand is assigned to a bucket in
 * `prepare` (fixed rng); each bucket path chains its assigned strands.
 *
 * PRNG consumption (FIXED across `strands`, FR-4): always draw
 * `FIELD_DRAWS + MAX_STRANDS × (2 + 1)` values so the seed stream
 * position downstream is stable. `strands.min = 20`, `strands.max = 60`,
 * and prepare consumes `9 + 60 · 3 = 189` values regardless.
 *
 * Never blank: `shimmer.min = 0.15` keeps at least the top bucket
 * composited at 15 % × envelope × (7.5/8), which is well above the
 * detectability floor at the min bound.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 52,
  name: 'Flow Strands',
  role: 'secondary',
  blurb: 'Streamlines threading a static synthetic flow field.',
  worstCase: { pathOps: 2280, drawCalls: 8 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('strands', 20, 60, { default: 40 }),
  A('flow', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // shimmer.min > 0 (0.15): a zero alpha collapses every bucket to void.
  A('shimmer', 0.15, 1, { default: { min: 0.35, max: 0.85 } }),
]

const W = 1080
const H = 1920
const TWO_PI = Math.PI * 2
/** Fixed count of vector-field terms — matches the prepared draw budget. */
const FIELD_TERMS = 3
/** rng values per term: fx, fy, phase. */
const FIELD_DRAWS_PER_TERM = 3
/** Fixed strand seed budget — one per potential strand slot, plus one
 * bucket assignment. Consumed in full regardless of live `strands`. */
const MAX_STRANDS = 60
/** Samples per streamline — geometry-bound by §10.2. */
const STEPS = 36
/** Step length for Euler integration (device px). */
const STEP_SIZE = 34
/** Alpha bucket count (== drawCalls upper bound). */
const NB = 8
/** Dash period in device px along each stroke. */
const DASH_P = 26
/** Integer dash cycles per `flow` sweep so loop closure is exact. */
const DASH_CYCLES = 2
/** Integer frequency range for field terms (each direction). */
const FREQ_MIN = 1
const FREQ_MAX = 4
/**
 * Inset for strand seeds so streamlines don't start on the boundary
 * (an integration that immediately walks off-canvas contributes nothing).
 */
const SEED_INSET = 60

/**
 * @typedef {object} FlowStrandsPrepared
 * @property {number} strands
 * @property {Float64Array} lineX    Sample x, indexed strand·STEPS + step.
 * @property {Float64Array} lineY    Sample y.
 * @property {Uint8Array} bucket     Alpha bucket per strand.
 * @property {number[]} dash         Preallocated dash pattern.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {FlowStrandsPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const strands = /** @type {number} */ (statics.strands)

  // FIXED draw count: FIELD_TERMS × FIELD_DRAWS_PER_TERM + MAX_STRANDS × 3.
  // All draws happen regardless of live `strands`, so the seed stream
  // position stays stable.
  const fx = new Int32Array(FIELD_TERMS)
  const fy = new Int32Array(FIELD_TERMS)
  const phase = new Float64Array(FIELD_TERMS)
  const freqSpan = FREQ_MAX - FREQ_MIN + 1
  for (let k = 0; k < FIELD_TERMS; k++) {
    fx[k] = FREQ_MIN + Math.floor(rng() * freqSpan)
    fy[k] = FREQ_MIN + Math.floor(rng() * freqSpan)
    phase[k] = rng() * TWO_PI
  }

  const seedX = new Float64Array(MAX_STRANDS)
  const seedY = new Float64Array(MAX_STRANDS)
  const bucket = new Uint8Array(MAX_STRANDS)
  for (let s = 0; s < MAX_STRANDS; s++) {
    seedX[s] = SEED_INSET + rng() * (W - 2 * SEED_INSET)
    seedY[s] = SEED_INSET + rng() * (H - 2 * SEED_INSET)
    const b = rng()
    // Guard the b === 1 edge case (Math.floor(1 · NB) === NB, out of range).
    bucket[s] = b >= 1 ? NB - 1 : Math.floor(b * NB)
  }

  // Integrate `strands` streamlines × STEPS steps of Euler advection into
  // one flat Float64Array. Only the first `strands` seeds are integrated
  // — the remaining seed values are dead entropy for FR-4 stability.
  const lineX = new Float64Array(strands * STEPS)
  const lineY = new Float64Array(strands * STEPS)
  const kxScale = TWO_PI / W
  const kyScale = TWO_PI / H
  for (let s = 0; s < strands; s++) {
    let x = seedX[s]
    let y = seedY[s]
    lineX[s * STEPS] = x
    lineY[s * STEPS] = y
    for (let step = 1; step < STEPS; step++) {
      // Sum three sinusoid terms. Component (vx, vy) per term uses
      // (sin, cos) so the field is roughly divergence-free.
      let vx = 0
      let vy = 0
      for (let k = 0; k < FIELD_TERMS; k++) {
        vx += Math.sin(fx[k] * x * kxScale + phase[k])
        vy += Math.cos(fy[k] * y * kyScale + phase[k])
      }
      // Normalize so the streamline advances a consistent STEP_SIZE per
      // step (numerical field magnitude has no physical meaning here).
      const len = Math.hypot(vx, vy)
      if (len > 1e-9) {
        vx /= len
        vy /= len
      }
      x += vx * STEP_SIZE
      y += vy * STEP_SIZE
      lineX[s * STEPS + step] = x
      lineY[s * STEPS + step] = y
    }
  }

  return {
    strands,
    lineX,
    lineY,
    bucket,
    // §6.5 bans array literals on the frame path.
    dash: [DASH_P / 2, DASH_P / 2],
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {FlowStrandsPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const flowDeg = /** @type {number} */ (resolved.flow)
  const shimmer = /** @type {number} */ (resolved.shimmer)
  const { strands, lineX, lineY, bucket, dash } = prepared

  const envelope = ctx.globalAlpha
  ctx.strokeStyle = prepared.color
  ctx.lineWidth = 1.5
  ctx.lineCap = 'butt'
  ctx.setLineDash(dash)
  ctx.lineDashOffset = -(flowDeg / 360) * DASH_P * DASH_CYCLES

  // One pass per alpha bucket — each bucket's strands accumulate on the
  // ctx's own path (no per-bucket Path2D allocation, §6.5).
  for (let b = 0; b < NB; b++) {
    ctx.beginPath()
    for (let s = 0; s < strands; s++) {
      if (bucket[s] !== b) continue
      const base = s * STEPS
      ctx.moveTo(lineX[base], lineY[base])
      for (let step = 1; step < STEPS; step++) {
        ctx.lineTo(lineX[base + step], lineY[base + step])
      }
    }
    ctx.globalAlpha = envelope * shimmer * ((b + 0.5) / NB)
    ctx.stroke()
  }
}
