// @ts-check
/**
 * Layer type 5 — Petal Bloom (FR-6, architecture §10.2 row 5).
 *
 * Petals as ellipses radiating from the centre, in up to 4 rings. Ring k is
 * scaled by `0.62^k` and staggered half a petal, so rings interleave rather
 * than stack. Each petal is an ellipse whose near end touches the centre and
 * whose far end is the petal tip at `petalLength × scale`.
 *
 * Geometry is animated (`petalLength`, `petalWidth`, `rotation` are all A),
 * so per §6.5 each ring accumulates ellipses on the ctx's own path with one
 * fill/stroke per ring — §10.2's "accumulated Path2D per ring", built on the
 * ctx path per the D1 template. A `moveTo` to each ellipse's start point
 * breaks the connecting chord `ellipse` would otherwise draw, which matters
 * for both fill (sliver artifacts) and stroke. Consumes zero PRNG draws.
 *
 * **per-effect-glow — one `glowSprite` per ring (budget-disciplined
 * fill/dot archetype from orbit-dots + `src/util/glow.js`).** A per-petal
 * halo would be up to 144 additive draws (36 × 4), far past this layer's
 * budget. Instead, one `glowSprite` per ring — up to 4 blits — sized to the
 * ring's petal envelope (`petalLength × scales[k] × K_GLOW`) reads as a
 * halo bloom around the ring rather than a sprinkle around each petal, and
 * costs the same one drawCall per ring as the existing crisp pass. The
 * gradient is minted once in `prepare` from the layer's `color` and reused
 * every frame (§6.5). Sprite draws happen inside a save/restore that also
 * absorbs `glowSprite`'s absolute `setTransform`, so the crisp pass's
 * `translate(CX,CY) + rotate(rot)` set up afterwards is undisturbed.
 * `gs === 0` is a hard no-op — pre-glow seeds render byte-identical (§9.5).
 * FR-6 AC: NO `shadowBlur`. See `src/util/glow.js` for the canonical
 * draw-time idiom and the `glowStrength` param convention.
 */

import { A, S } from '../model/params.js'
import { glowGradient, glowSprite } from '../util/glow.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 5,
  name: 'Petal Bloom',
  role: 'primary',
  blurb: 'Rings of petals opening and turning like a flower.',
  // Worst case doubles under glow: 4 rings × 1 sprite blit (glow) + 4 rings ×
  // 1 fill/stroke (crisp) = 8 drawCalls. pathOps: the sprite is a fillRect —
  // no ellipse pathOps added; ring accumulations unchanged at 144.
  worstCase: { pathOps: 144, drawCalls: 8 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('petalCount', 3, 36, { default: 8 }),
  S.int('ringCount', 1, 4, { default: 2 }),
  A('petalLength', 60, 800, { default: { min: 200, max: 480 } }),
  A('petalWidth', 10, 300, { default: { min: 60, max: 160 } }),
  A('rotation', 0, 360, { unit: '°', wrap: true }),
  S.bool('filled', { default: true }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0` is
  // a hard no-op in `draw` and the render is byte-identical to pre-glow
  // (architecture §9.5).
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
const RING_SCALE = 0.62
const STROKE_WIDTH = 3
/**
 * Sprite-radius multiplier for the per-ring glow blit. Rings are close-
 * packed by `RING_SCALE = 0.62` (interleaved by `stagger`), so a large halo
 * would bleed one ring into the next. 1.15× extends the sprite just past
 * the petal tips — a soft aura hugging the ring rather than an ambient wash.
 */
const K_GLOW = 1.15

/**
 * @typedef {object} PetalBloomPrepared
 * @property {number} petals
 * @property {number} rings
 * @property {Float64Array} angles  Per-petal base angle, first petal up.
 * @property {Float64Array} scales  RING_SCALE^k per ring.
 * @property {number} stagger       Half-petal ring offset, radians.
 * @property {boolean} filled
 * @property {string} color
 * @property {CanvasGradient} glowGrad  Unit-radius radial gradient in the
 *   layer's colour, minted once for `glowSprite`.
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {PetalBloomPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const petals = /** @type {number} */ (statics.petalCount)
  const rings = /** @type {number} */ (statics.ringCount)
  const angles = new Float64Array(petals)
  for (let p = 0; p < petals; p++) {
    angles[p] = -Math.PI / 2 + (p / petals) * TWO_PI
  }
  const scales = new Float64Array(rings)
  for (let k = 0; k < rings; k++) scales[k] = Math.pow(RING_SCALE, k)
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)
  return {
    petals,
    rings,
    angles,
    scales,
    stagger: Math.PI / petals,
    filled: statics.filled === true,
    color,
    // Prepare-time gradient mint (§6.5): allocation happens once here, the
    // frame path only blits.
    glowGrad: glowGradient(scratch, color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {PetalBloomPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const len = /** @type {number} */ (resolved.petalLength)
  const wid = /** @type {number} */ (resolved.petalWidth)
  const rot = /** @type {number} */ (resolved.rotation) * DEG
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { petals, rings, angles, scales, stagger } = prepared

  // Glow pass — drawn FIRST so the crisp petals sit on top (halo under
  // mark). `gs === 0` is a hard no-op: skip the pass entirely for byte-
  // identical pre-glow output. Uses world coords via `glowSprite`'s absolute
  // `setTransform`; the surrounding save/restore also restores the identity
  // transform for the crisp pass's `translate + rotate` below. See
  // `src/util/glow.js` for the canonical idiom.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    // One `glowSprite` per ring at the flower's centre (CX,CY), radius the
    // ring's petal envelope × K_GLOW. Ring rotation is irrelevant — the
    // sprite is radially symmetric.
    for (let k = 0; k < rings; k++) {
      const rad = len * scales[k] * K_GLOW
      glowSprite(ctx, prepared.glowGrad, CX, CY, rad)
    }
    ctx.restore()
  }

  ctx.translate(CX, CY)
  ctx.rotate(rot)
  for (let k = 0; k < rings; k++) {
    const rx = (len * scales[k]) / 2
    const ry = (wid * scales[k]) / 2
    const off = stagger * k
    ctx.beginPath()
    for (let p = 0; p < petals; p++) {
      const a = angles[p] + off
      const c = Math.cos(a)
      const s = Math.sin(a)
      // Ellipse centre sits rx out along the petal axis; its param-0 start
      // point is another rx further — the petal tip.
      ctx.moveTo(c * rx * 2, s * rx * 2)
      ctx.ellipse(c * rx, s * rx, rx, ry, a, 0, TWO_PI)
    }
    if (prepared.filled) {
      ctx.fillStyle = prepared.color
      ctx.fill()
    } else {
      ctx.strokeStyle = prepared.color
      ctx.lineWidth = STROKE_WIDTH
      ctx.stroke()
    }
  }
}
