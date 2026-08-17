// @ts-check
/**
 * Layer type 49 — Truchet Tiles (FR-6, architecture §10.2 row 49).
 *
 * The classic Truchet decoration: a square grid where each tile carries two
 * quarter-circle arcs joining opposite edge midpoints, oriented by a per-
 * tile coin flip. The arcs from neighbouring tiles chain into meandering
 * strands across the frame, so the pattern reads as woven cord even
 * though the underlying grid is dead-simple rectangular.
 *
 * Loop closure via dash-phase advance (omni-wave S03 toolbox): the stroke
 * carries a two-segment dash of period `DASH_P`, and `lineDashOffset` is
 * driven by `flow` (0..360°, `{ wrap: true }`) at a rate that advances
 * exactly `DASH_CYCLES` full dash periods across one loop. At `flow = 360°`
 * every dash sits on top of its `flow = 0°` neighbour — the whole moving
 * pattern maps onto itself.
 *
 * Strategy per §10.2: two accumulated paths on the ctx's own path (D1
 * template — §6.5 bans allocating a `Path2D` inside `draw`), one stroke
 * per orientation. Orientation-0 arcs and orientation-1 arcs go into
 * separate paths only for the sake of two clean strokes; the visual
 * result is one interlocking mesh. Consumes exactly `MAX_TILES` rng draws
 * in prepare (one per potential tile slot) — FIXED cross-device
 * draw-count contract even though `tile` selects a variable count.
 *
 * Never blank: `width.min = 2` px so every stroke registers at least
 * 2 device px, and both orientations always paint (orientation is 0 or 1
 * with fair probability across enough tiles). At `tile.max = 180` on
 * 1080×1920 we still have 6×11 = 66 tiles → 132 arcs, dense enough to
 * read as a meandering strand.
 *
 * **per-effect-glow (S04):** wide additive re-stroke archetype. When
 * `glowStrength > 0`, `draw` re-runs both orientation passes once BEFORE
 * the crisp pass under `globalCompositeOperation = 'lighter'` at
 * `lineWidth × K_GLOW` — a soft halo under the woven mesh, crisp arcs on
 * top. The dash pattern (setLineDash + dashOffset) is set outside the
 * save/restore so the halo inherits the same dashed rhythm as the mark,
 * reading as a chunkier version of the same strand rather than a
 * continuous glow. No `shadowBlur` (FR-6); `gs === 0` is a hard no-op →
 * pre-glow seeds decode byte-identical (§9.5). K = 2.0 keeps the halo
 * clearly wider than the mark without merging neighbouring arcs.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 49,
  name: 'Truchet Tiles',
  role: 'secondary',
  blurb: 'A woven mesh of chained quarter-arc tiles.',
  // Worst case doubles under the glow pass: 2 halo strokes + 2 crisp strokes,
  // each halo pass strokes the same orientation-partitioned path.
  worstCase: { pathOps: 1120, drawCalls: 4 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('tile', 90, 180, { default: 120 }),
  // width.min > 0 (2 px): a zero-weight stroke is a null figure.
  A('width', 2, 10, { default: { min: 3, max: 6 } }),
  A('flow', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const W = 1080
const H = 1920
const HALF_PI = Math.PI / 2
/**
 * Halo width multiplier. Up to ~299 tiles × 2 arcs at tile.min = 90 gives
 * ~600 dashed strokes; 2.0 keeps the halo clearly wider than the mark
 * without merging neighbouring arcs along a strand.
 */
const K_GLOW = 2.0
/**
 * Fixed draw budget for the orientation table — the tightest tile size
 * (90 px) yields cols × rows = 13 × 23 = 299 slots including the +1
 * over-cover; every prepare consumes this many rng values regardless of
 * the chosen `tile` so downstream stream position stays stable (FR-4).
 */
const MAX_TILES = 13 * 23
/** Dash period in device px — the visible strand pattern along each arc. */
const DASH_P = 22
/**
 * Integer dash cycles per loop: `dashOffset` advances `DASH_P · DASH_CYCLES`
 * as flow sweeps 0..360°, closing the pattern exactly at wrap.
 */
const DASH_CYCLES = 2

/**
 * @typedef {object} TruchetTilesPrepared
 * @property {number} cols
 * @property {number} rows
 * @property {number} tile
 * @property {number} x0                Top-left of the (0, 0) tile.
 * @property {number} y0
 * @property {Uint8Array} orient        Orientation bit per tile slot (0 or 1).
 * @property {number[]} dash            Preallocated [DASH_P/2, DASH_P/2] segment array.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {TruchetTilesPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const tile = /** @type {number} */ (statics.tile)
  const cols = Math.ceil(W / tile) + 1
  const rows = Math.ceil(H / tile) + 1
  // Centre the tile grid on the canvas (over-cover by one lets the border
  // arcs land off-canvas rather than leave a bare strip).
  const x0 = (W - cols * tile) / 2
  const y0 = (H - rows * tile) / 2

  // FIXED draw count: always consume `MAX_TILES` rng values regardless of
  // the chosen `tile` size, so the seed stream position downstream stays
  // stable across compositions (FR-4, epicycle-chain precedent). Only the
  // first `cols*rows` bits reach the orient table — surplus draws are
  // consumed to keep the count constant, not stored.
  const usable = cols * rows
  const orient = new Uint8Array(usable)
  for (let i = 0; i < MAX_TILES; i++) {
    const bit = rng() < 0.5 ? 0 : 1
    if (i < usable) orient[i] = bit
  }

  return {
    cols,
    rows,
    tile,
    x0,
    y0,
    orient,
    // §6.5 bans array literals on the frame path; setLineDash copies.
    dash: [DASH_P / 2, DASH_P / 2],
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * Emit one tile's two quarter-arcs into the currently-open ctx path.
 * Orientation 0 connects (top-mid ↔ left-mid) and (bottom-mid ↔ right-mid);
 * orientation 1 connects (top-mid ↔ right-mid) and (bottom-mid ↔ left-mid).
 * Each arc starts with an explicit moveTo so it does not chain to the
 * previous tile's stroke via an implicit lineTo.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} tx  Tile top-left x.
 * @param {number} ty  Tile top-left y.
 * @param {number} r   Arc radius (== tile size / 2).
 * @param {number} orient
 */
function emitTile(ctx, tx, ty, r, orient) {
  if (orient === 0) {
    // Arc centred at (tx, ty): top-mid (east, angle 0) → left-mid (south, π/2).
    ctx.moveTo(tx + r, ty)
    ctx.arc(tx, ty, r, 0, HALF_PI)
    // Arc centred at (tx + 2r, ty + 2r): bottom-mid (west, π) → right-mid (north, 3π/2).
    ctx.moveTo(tx + r, ty + 2 * r)
    ctx.arc(tx + 2 * r, ty + 2 * r, r, Math.PI, 3 * HALF_PI)
  } else {
    // Arc centred at (tx + 2r, ty): right-mid (south, π/2) → top-mid (west, π).
    ctx.moveTo(tx + 2 * r, ty + r)
    ctx.arc(tx + 2 * r, ty, r, HALF_PI, Math.PI)
    // Arc centred at (tx, ty + 2r): left-mid (north, 3π/2) → bottom-mid (east, 2π).
    ctx.moveTo(tx, ty + r)
    ctx.arc(tx, ty + 2 * r, r, 3 * HALF_PI, 2 * Math.PI)
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {TruchetTilesPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const flowDeg = /** @type {number} */ (resolved.flow)
  const width = /** @type {number} */ (resolved.width)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { cols, rows, tile, x0, y0, orient, dash } = prepared
  const r = tile / 2

  ctx.strokeStyle = prepared.color
  ctx.lineCap = 'butt'
  ctx.setLineDash(dash)
  // dashOffset = -(flow/360) · DASH_P · DASH_CYCLES so an integer number of
  // dash periods slide past every loop. Negative advances "forward" along
  // the stroke direction.
  ctx.lineDashOffset = -(flowDeg / 360) * DASH_P * DASH_CYCLES

  // Glow pass — both orientations drawn FIRST so the crisp weave sits on
  // top (halo under mark). The dash pattern is set BEFORE `save` so the
  // halo inherits the same dashed rhythm as the mark. `gs === 0` is a
  // hard no-op: skip entirely for byte-identical pre-glow output.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs
    ctx.lineWidth = width * K_GLOW
    // Halo pass 0 — orientation 0 tiles.
    ctx.beginPath()
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (orient[row * cols + col] !== 0) continue
        emitTile(ctx, x0 + col * tile, y0 + row * tile, r, 0)
      }
    }
    ctx.stroke()
    // Halo pass 1 — orientation 1 tiles.
    ctx.beginPath()
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (orient[row * cols + col] !== 1) continue
        emitTile(ctx, x0 + col * tile, y0 + row * tile, r, 1)
      }
    }
    ctx.stroke()
    ctx.restore()
    // `strokeStyle`, dash + offset + lineCap all survive `restore()`.
  }

  ctx.lineWidth = width

  // Pass 0 — every tile whose orientation bit is 0.
  ctx.beginPath()
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (orient[row * cols + col] !== 0) continue
      emitTile(ctx, x0 + col * tile, y0 + row * tile, r, 0)
    }
  }
  ctx.stroke()

  // Pass 1 — every tile whose orientation bit is 1.
  ctx.beginPath()
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (orient[row * cols + col] !== 1) continue
      emitTile(ctx, x0 + col * tile, y0 + row * tile, r, 1)
    }
  }
  ctx.stroke()

  // Painter's per-layer restore clears the dash for the next layer (§6.4)
  // via the ctx.save/restore bracket, so no cleanup needed here.
}
