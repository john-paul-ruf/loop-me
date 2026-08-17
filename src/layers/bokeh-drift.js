// @ts-check
/**
 * Layer type 54 — Bokeh Drift (FR-6, architecture §10.2 row 54).
 *
 * A handful of soft radial-gradient discs float across the frame on
 * elliptical orbits — the depth-of-field bokeh look, translated into an
 * animated overlay. Every disc's base position, orbit shape (rx, ry),
 * integer speed multiplier, phase offset, sprite bucket, and per-disc
 * radius are drawn once in `prepare` from the layer's `rngSeed`; only
 * `drift` (a global cycle position) and `glow` (a global alpha) animate
 * across the frame.
 *
 * **per-effect-glow (FR-6, §9.5):** appends `glowStrength` LAST (default
 * `{min:0,max:0}` ⇒ pre-glow seeds decode to `gs === 0`, a hard no-op ⇒
 * byte-identical). At `gs > 0` a guarded second per-disc loop re-draws
 * the same baked bucket sprite at `K_GLOW × diameter` under
 * `globalCompositeOperation = 'lighter'` at `alpha = a0 * gs` — one halo
 * blit per disc (bounded by `discs`). Discs are already soft; the halo
 * widens the falloff, reading as a stronger bokeh bloom rather than a
 * different mark. No `shadowBlur` (FR-6); zero per-frame allocation (§6.5,
 * the halo reuses the existing pre-baked sprite).
 *
 * Loop closure is intrinsic to the integer-harmonic orbit math (omni-wave
 * S02 precedent): each disc's angle is `k_i · 2π · u + phase_i` with `u =
 * drift/360` and `k_i` a positive integer, so at `u = 1` (drift = 360°)
 * every disc has advanced a whole number of full orbits and lands at the
 * exact same (px, py) as at `u = 0`. The `{ wrap: true }` on `drift` is
 * therefore between two identical frames — no seam, no re-shuffle.
 *
 * Strategy per §10.2 & §6.5: three soft radial-gradient disc sprites are
 * pre-baked into scratches (`SPRITE_SIZES` = [64, 128, 256] px) so the
 * per-frame path allocates nothing (the gradient itself is the expensive
 * bit; a `drawImage` at scale is free). Each disc picks the smallest
 * sprite bucket whose native size covers its per-disc radius, so no disc
 * ever magnifies a tiny sprite into a soft-blur puddle. Draw is one
 * `drawImage` per disc — no accumulated path, `pathOps: 0`.
 *
 * PRNG consumption (FIXED across `discs`, FR-4): always draw
 * `MAX_DISCS × 7` = 112 values so the seed stream position stays stable
 * across `discs` changes. Only the first `discs × 7` reach live table
 * slots; surplus values are consumed to keep the count constant.
 *
 * Never blank: `glow.min = 0.15` composes with the envelope alpha, and
 * `discs.min = 6` disc sprites always paint at least some radius on
 * their orbit — the softest bokeh still tints the frame. Composed alpha
 * caps at `1 · 0.7 = 0.7`, so `fullCanvasOpaque: false` holds.
 *
 * Imports `model/params.js` and `core/rng.js` (§4 rule 2).
 */

import { A, S } from '../model/params.js'
import { range, intRange } from '../core/rng.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 54,
  name: 'Bokeh Drift',
  role: 'overlay',
  blurb: 'Soft glowing discs orbiting across the frame.',
  // per-effect-glow: guarded per-disc additive drawImage under 'lighter' —
  // one extra drawCall per disc when `gs > 0` (16 → 32). drawImage adds no
  // path ops, so `pathOps` stays 0.
  worstCase: { pathOps: 0, drawCalls: 32 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('discs', 6, 16, { default: 10 }),
  // Global orbit phase. Every disc's local angle = k_i · 2π · (drift/360)
  // + phase_i, k_i an integer, so `wrap: true` is between identical frames.
  A('drift', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // glow.min > 0 (0.15) composes with envelope alpha (Flag 4).
  A('glow', 0.15, 0.7, { default: { min: 0.25, max: 0.55 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒
  // pre-glow seeds decode to glow-off (`gs === 0` skips the halo loop
  // entirely, byte-identical). NB: unrelated to the pre-existing `glow`
  // envelope-alpha param above; that one modulates every disc's opacity,
  // while `glowStrength` gates the additive halo pass.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const W = 1080
const H = 1920
const TWO_PI = Math.PI * 2
/** Fixed disc budget — every prepare consumes `MAX_DISCS · 7` rng values
 * regardless of the chosen `discs`, so downstream stream position stays
 * stable across compositions (FR-4). */
const MAX_DISCS = 16
/** Per-disc rng draw count — bumping this renumbers the seed stream, so
 * new per-disc fields must append here rather than insert elsewhere. */
const PER_DISC_DRAWS = 7
/** Radius range in px (session prompt: "radius 40–160"). */
const R_MIN = 40
const R_MAX = 160
/** Max orbit half-axis in px — keeps a big disc from wandering off-canvas. */
const DRIFT_MAX = 220
/** Integer speed range — orbits per loop for each disc. Integers keep
 * the loop closed exactly at `drift = 360°`. */
const K_MIN = 1
const K_MAX = 3
/** Three sprite sizes (px, square). A disc picks the smallest sprite
 * whose native side covers 2 · radius, so a 40 px disc never uses the
 * 256 px sprite (memory) and a 160 px disc never gets a 64 px sprite
 * magnified into a soft-blur puddle. */
const SPRITE_SIZES = [64, 128, 256]
/** Additive halo scale for the per-effect-glow pass. Tuned visually:
 * discs are already soft — a modest widening (1.5×) reads as a stronger
 * bokeh bloom without turning each disc into a flat wash. Below 1.25 the
 * halo hides inside the sprite's own transparent falloff. */
const K_GLOW = 1.5

/**
 * @typedef {object} BokehDriftPrepared
 * @property {number} discs
 * @property {HTMLCanvasElement[]} sprites   Three baked soft-disc sprites.
 * @property {Float64Array} baseX
 * @property {Float64Array} baseY
 * @property {Float64Array} radius
 * @property {Float64Array} rx               Elliptical orbit half-axis, x.
 * @property {Float64Array} ry               Elliptical orbit half-axis, y.
 * @property {Float64Array} phase            Per-disc angle offset in radians.
 * @property {Uint8Array} k                  Per-disc integer orbits per loop.
 * @property {Uint8Array} bucket             Sprite bucket index per disc.
 */

/**
 * Bake one soft-disc sprite: white core → transparent edge in the layer
 * colour, so the frame path is one `drawImage`. Sizing is native (source
 * === dest === `size × size`), so quality holds when `drawImage` scales
 * to the per-disc radius at draw time.
 *
 * @param {import('../model/params.js').ScratchFactory} scratch
 * @param {number} size
 * @param {number} r  Red channel of the layer colour.
 * @param {number} g
 * @param {number} b
 * @returns {HTMLCanvasElement}
 */
function bakeSprite(scratch, size, r, g, b) {
  const canvas = scratch(size, size)
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  const half = size / 2
  const grad = c.createRadialGradient(half, half, 0, half, half, half)
  grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`)
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.35)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c.fillStyle = grad
  c.fillRect(0, 0, size, size)
  return canvas
}

/**
 * Smallest sprite bucket whose native side covers `2 · radius` — else the
 * largest bucket if the disc is bigger than every sprite.
 *
 * @param {number} radius
 * @returns {number}
 */
function pickBucket(radius) {
  const d = 2 * radius
  for (let i = 0; i < SPRITE_SIZES.length; i++) {
    if (SPRITE_SIZES[i] >= d) return i
  }
  return SPRITE_SIZES.length - 1
}

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {BokehDriftPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const discs = /** @type {number} */ (statics.discs)
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  const sprites = new Array(SPRITE_SIZES.length)
  for (let i = 0; i < SPRITE_SIZES.length; i++) {
    sprites[i] = bakeSprite(scratch, SPRITE_SIZES[i], r, g, b)
  }

  // Every table sized to MAX_DISCS so surplus rng draws land somewhere
  // (kept, not read at draw). Only the first `discs` slots reach draw.
  const baseX = new Float64Array(MAX_DISCS)
  const baseY = new Float64Array(MAX_DISCS)
  const radius = new Float64Array(MAX_DISCS)
  const rx = new Float64Array(MAX_DISCS)
  const ry = new Float64Array(MAX_DISCS)
  const phase = new Float64Array(MAX_DISCS)
  const k = new Uint8Array(MAX_DISCS)
  const bucket = new Uint8Array(MAX_DISCS)

  // FIXED draw count: MAX_DISCS × PER_DISC_DRAWS rng values, live values
  // in the first `discs` slots. Order is the contract — see rng.js.
  for (let i = 0; i < MAX_DISCS; i++) {
    const rad = range(rng, R_MIN, R_MAX)
    // Keep base positions ≥ radius + a small margin inside the canvas
    // so an orbit at its extreme rarely leaves the frame entirely.
    const inset = rad + 40
    const bx = range(rng, inset, W - inset)
    const by = range(rng, inset, H - inset)
    const orx = range(rng, 40, DRIFT_MAX)
    const ory = range(rng, 40, DRIFT_MAX)
    const speed = intRange(rng, K_MIN, K_MAX)
    const ph = rng() * TWO_PI
    if (i < discs) {
      radius[i] = rad
      baseX[i] = bx
      baseY[i] = by
      rx[i] = orx
      ry[i] = ory
      k[i] = speed
      phase[i] = ph
      bucket[i] = pickBucket(rad)
    }
  }

  return {
    discs,
    sprites,
    baseX,
    baseY,
    radius,
    rx,
    ry,
    phase,
    k,
    bucket,
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {BokehDriftPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const driftDeg = /** @type {number} */ (resolved.drift)
  const glow = /** @type {number} */ (resolved.glow)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { discs, sprites, baseX, baseY, radius, rx, ry, phase, k, bucket } = prepared

  // Flag 4 posture: composes with envelope alpha, never replaces it.
  ctx.globalAlpha = ctx.globalAlpha * glow

  const u = driftDeg / 360
  for (let i = 0; i < discs; i++) {
    const ang = k[i] * TWO_PI * u + phase[i]
    const px = baseX[i] + rx[i] * Math.cos(ang)
    const py = baseY[i] + ry[i] * Math.sin(ang)
    const rad = radius[i]
    // drawImage scales the native sprite to `2r × 2r` centred on (px, py).
    ctx.drawImage(sprites[bucket[i]], px - rad, py - rad, 2 * rad, 2 * rad)
  }

  // per-effect-glow: guarded additive halo per disc — re-issue the same
  // baked sprite widened to K_GLOW × diameter under 'lighter'. `gs === 0`
  // skips the whole loop (byte-identical to pre-glow output). Save
  // captures blend + alpha so restore returns them cleanly.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    for (let i = 0; i < discs; i++) {
      const ang = k[i] * TWO_PI * u + phase[i]
      const px = baseX[i] + rx[i] * Math.cos(ang)
      const py = baseY[i] + ry[i] * Math.sin(ang)
      const halo = radius[i] * K_GLOW
      ctx.drawImage(sprites[bucket[i]], px - halo, py - halo, 2 * halo, 2 * halo)
    }
    ctx.restore()
  }
}
