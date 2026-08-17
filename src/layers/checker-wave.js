// @ts-check
/**
 * Layer type 24 — Checker Wave (FR-6, architecture §10.2 row 24).
 *
 * A grid of equal squares (cellCount × cellCount × aspect correction), each
 * cell painted with one of two states (on/off) determined by a travelling-
 * scale wave: cell `(i, j)` is "on" when `scale × f ≥ 0.5` where
 * `f = 0.5 + 0.5·cos(phase)` and `phase` is the cell centre's projection onto
 * the wave direction. "On" cells are filled in the layer colour; "off"
 * cells are skipped, so the visible structure is a sparse checkerboard
 * whose density drifts as `scale` breathes. The cell grid is computed once
 * in `prepare` and the wave is applied per frame with no allocation.
 *
 * Strategy per §10.2: one accumulated `rect` path, one `fill` — only the
 * "on" cells emit `rect`, but the budget is the upper bound (same 2304
 * cells as grid-pulse — same `cellSize` bounds). Built on the ctx's own
 * path (D1 template); §6.5 bans `Path2D` allocation inside `draw`.
 *
 * Never blank: `cellSize` ≤ 240 means ≥ 4×8 live cells across the canvas.
 * The wave always has crest cells where `cos(phase) = 1`, giving `f = 1.0`
 * and `scale × f = scale`. At `scale` ≥ 0.5, crest cells pass the
 * `scale × f ≥ 0.5` gate. The default `scale` range {min:0.35, max:0.95}
 * reaches ≥ 0.5 for a portion of every animation cycle, so crest cells
 * light up at the peak — the layer renders something at some frame in
 * every default range. At the extreme lower bound (`scale` = 0.1) it can
 * momentarily render all-off, but the randomizer's taste rules (§8.5)
 * avoid assigning a `scale` range that sits entirely below 0.5.
 *
 * Imports `model/params.js` only (§4 rule 2). Consumes zero PRNG draws.
 *
 * **per-effect-glow (feature) — additive re-fill of the on-cells.** When
 * `glowStrength > 0`, `draw` re-accumulates the very same "on" rects and
 * commits one more fill under `globalCompositeOperation = 'lighter'` BEFORE
 * the crisp fill — brightens each lit cell without spilling past its
 * boundary, preserving the layer's checkerboard identity. The `mid` bounds
 * used by the SESSION-01 glow suite (`scale = 0.55`) put crest cells above
 * the `≥ 0.5` gate, so the on-cell path is non-empty and `gs=1` is visibly
 * brighter than `gs=0`. FR-6: NO `shadowBlur`; §6.5: zero per-frame
 * allocation. `gs === 0` is a hard no-op → byte-identical to pre-glow. See
 * `src/util/glow.js` for the canonical draw-time idiom.
 *
 * The `SOLO_SWEEP_EXCLUSIONS` waiver in `tests/layers.test.js` (id 24)
 * covers the `scale.min = 0.1` all-off frame; the glow pass does nothing
 * there because there are no on-cells to re-fill — the exclusion still
 * holds, glow adds no new blank-frame path.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 24,
  name: 'Checker Wave',
  role: 'secondary',
  blurb: 'A checkerboard whose density flows across the frame.',
  // Worst case doubles under the glow pass: one extra rect accumulation of
  // the same on-cells + one extra fill under 'lighter'.
  worstCase: { pathOps: 4608, drawCalls: 2 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('cellSize', 30, 240, { default: 90 }),
  A('waveAngle', 0, 360, { unit: '°', wrap: true }),
  S.int('waveFreq', 1, 6, { default: 2 }),
  A('scale', 0.1, 1.0, { default: { min: 0.35, max: 0.95 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const W = 1080
const H = 1920
const CX = 540
const CY = 960
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
const DIAG = Math.hypot(W, H)

/**
 * @typedef {object} CheckerWavePrepared
 * @property {number} cols
 * @property {number} rows
 * @property {number} size
 * @property {number} x0
 * @property {number} y0
 * @property {number} freq
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {CheckerWavePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const size = /** @type {number} */ (statics.cellSize)
  const cols = Math.ceil(W / size)
  const rows = Math.ceil(H / size)
  return {
    cols,
    rows,
    size,
    x0: CX - ((cols - 1) / 2) * size,
    y0: CY - ((rows - 1) / 2) * size,
    freq: /** @type {number} */ (statics.waveFreq),
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {CheckerWavePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const theta = /** @type {number} */ (resolved.waveAngle) * DEG
  const scale = /** @type {number} */ (resolved.scale)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { cols, rows, size, x0, y0, freq } = prepared
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const k = (TWO_PI * freq) / DIAG

  ctx.fillStyle = prepared.color

  // Glow pass — drawn FIRST so the crisp cells sit on top (halo under mark).
  // Same on-cell geometry, additive re-fill under 'lighter'. `gs === 0` is a
  // hard no-op → byte-identical to pre-glow. See `src/util/glow.js`.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.beginPath()
    for (let row = 0; row < rows; row++) {
      const y = y0 + row * size
      const dy = (y - CY) * s
      for (let col = 0; col < cols; col++) {
        const x = x0 + col * size
        const phase = ((x - CX) * c + dy) * k
        const f = 0.5 + 0.5 * Math.cos(phase)
        if (scale * f >= 0.5) {
          ctx.rect(x - size / 2, y - size / 2, size, size)
        }
      }
    }
    ctx.fill()
    ctx.restore()
    // `fillStyle` survives `restore()` since it was set before `save()`.
  }

  ctx.beginPath()
  for (let row = 0; row < rows; row++) {
    const y = y0 + row * size
    const dy = (y - CY) * s
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * size
      const phase = ((x - CX) * c + dy) * k
      const f = 0.5 + 0.5 * Math.cos(phase)
      if (scale * f >= 0.5) {
        ctx.rect(x - size / 2, y - size / 2, size, size)
      }
    }
  }
  ctx.fill()
}