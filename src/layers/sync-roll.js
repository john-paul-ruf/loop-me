// @ts-check
/**
 * Layer type 36 — Sync Roll (FR-6, architecture §10.2 row 36).
 *
 * Vertical hold slip: the composited frame below is snapshotted to a
 * full-frame scratch, then blitted back in two wrap halves offset by
 * `roll` px, with one tear band at the seam kicked sideways by `tear` px.
 * A `bandHeight`-wide seam band pattern (in the layer colour) marks the
 * seam so it reads as *a slipping CRT* rather than *a slight misalignment*.
 *
 * ## Self-overlap fix — snapshot first
 *
 * `ctx.drawImage(ctx.canvas, …)` snapshots its source *before* writing
 * the destination for a **single** call. Two sequential wrap-blits would
 * read from a canvas already partially rewritten by the first — the
 * classic self-overlap hazard. Solution: snapshot once to the scratch
 * via `gCO='copy'`, then every wrap/tear read comes from the scratch
 * (a distinct bitmap) — no self-overlap at all.
 *
 * ## Loop-perfection (FR-3, FR-4)
 *
 * Zero rng draws in `prepare`. `roll`, `tear` are both A, so their
 * per-frame values are loop-closed by `findValue`.
 *
 * ## Allocation-free draw (§6.5)
 *
 * One full-frame scratch (~8 MB) + one narrow seam pattern (Scan Lines
 * style) minted once in `prepare`. `worstCase.drawCalls` = 5 (1 copy to
 * scratch + 2 wrap blits + 1 tear blit + 1 seam pattern fill); `pathOps`
 * = 1 (the seam fillRect). The session prompt's provisional pin was
 * {1, 6}; the enumeration in that same paragraph only listed 5 calls,
 * and this file records the count actually performed — STATE.md's
 * standing rule for provisional worstCase numbers.
 * `fullCanvasOpaque: false` — the wrap covers 1080×1920 exactly, but
 * runs under the painter's envelope alpha so the frame below still
 * shows through.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 36,
  name: 'Sync Roll',
  role: 'glitch',
  blurb: 'Vertical hold slips — the frame rolls and tears like a dying CRT.',
  worstCase: { pathOps: 1, drawCalls: 5 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('bandHeight', 8, 120, { default: 32 }),
  // roll.min ≥ 8: at roll=0 the wrap is a no-op — the "renders nothing"
  // failure mode this bound guards against.
  A('roll', 8, 1912, { unit: 'px', default: { min: 60, max: 700 } }),
  A('tear', 0, 160, { unit: 'px', default: { min: 0, max: 60 } }),
]

const WIDTH = 1080
const HEIGHT = 1920

/**
 * @typedef {object} SyncRollPrepared
 * @property {HTMLCanvasElement} frame  Full-frame snapshot scratch (~8 MB).
 * @property {CanvasPattern} seamPattern  bandHeight × 4 tile in layer colour.
 * @property {number} bandHeight
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {SyncRollPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const scratch = /** @type {import('../model/params.js').ScratchFactory} */ (statics.scratch)
  const color = /** @type {string} */ (statics.color)
  const bandHeight = /** @type {number} */ (statics.bandHeight)

  const frame = scratch(WIDTH, HEIGHT)
  // Seam pattern: a narrow tile in the layer colour that reads as a
  // hard band edge. Width 4 is cosmetic (a pattern repeats), Scan Lines
  // precedent — height matches the tear band so a single fillRect
  // paints the whole seam at once.
  const tile = scratch(4, Math.max(1, bandHeight))
  const tctx = /** @type {CanvasRenderingContext2D} */ (tile.getContext('2d'))
  tctx.fillStyle = color
  tctx.fillRect(0, 0, 4, bandHeight)
  const seamPattern = /** @type {CanvasPattern} */ (tctx.createPattern(tile, 'repeat'))

  return { frame, seamPattern, bandHeight }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {SyncRollPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const roll = Math.min(HEIGHT - 1, Math.max(1, Math.round(/** @type {number} */ (resolved.roll))))
  const tear = Math.round(/** @type {number} */ (resolved.tear))
  const bandHeight = prepared.bandHeight
  const frame = prepared.frame
  const fctx = /** @type {CanvasRenderingContext2D} */ (frame.getContext('2d'))

  // Snapshot the composited frame below to the scratch (self-overlap
  // fix: every read after this comes from `frame`, not `ctx.canvas`).
  fctx.setTransform(1, 0, 0, 1, 0, 0)
  fctx.globalAlpha = 1
  fctx.globalCompositeOperation = 'copy'
  fctx.drawImage(ctx.canvas, 0, 0)

  // Wrap blit A: rows [0, HEIGHT-roll) of the frame land at y=roll.
  ctx.drawImage(frame, 0, 0, WIDTH, HEIGHT - roll, 0, roll, WIDTH, HEIGHT - roll)
  // Wrap blit B: rows [HEIGHT-roll, HEIGHT) of the frame land at y=0.
  ctx.drawImage(frame, 0, HEIGHT - roll, WIDTH, roll, 0, 0, WIDTH, roll)

  // Tear: a bandHeight strip *at the seam* (y = roll) blitted with an
  // ±x offset. Reads come from the pristine scratch, so this is a clean
  // extra copy — no double-tearing.
  const seamY = roll
  const th = Math.min(bandHeight, HEIGHT - seamY)
  ctx.drawImage(frame, 0, seamY, WIDTH, th, tear, seamY, WIDTH, th)

  // Seam pattern: intrinsic pixels — the layer's own colour marks the
  // slipping edge. One pathOp (fillRect), one drawCall.
  ctx.fillStyle = prepared.seamPattern
  ctx.fillRect(0, seamY, WIDTH, bandHeight)
}
