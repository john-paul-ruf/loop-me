// @ts-check
/**
 * Layer type 48 — Hex Lattice (FR-6, architecture §10.2 row 48).
 *
 * A pointy-top hexagonal tiling of the frame — the geometry the primary and
 * secondary catalogues had been missing (square grids and triangles already
 * covered). Each cell is a full 6-vertex hex outline; per-frame the cell's
 * distance from canvas centre feeds a radial travelling wave
 * `alpha = 0.5 + 0.5·cos(dist·k − phase)` which is quantized into 6 alpha
 * buckets. Each bucket accumulates its cells' outlines on the ctx's own
 * path and commits with one `stroke` — six draw calls, no per-cell
 * `setLineDash` or state churn (omni-wave S03 toolbox: alpha-bucket batching
 * keeps `drawCalls ≤ 8` even when the per-cell alpha is continuous).
 *
 * Loop closure is intrinsic: `phase` wraps 0..360 (`{ wrap: true }`) and
 * `cos` is 2π-periodic in that argument, so the family of cell alphas at
 * `phase = 360°` is exactly the family at `phase = 0°`. `WAVE_FREQ` is an
 * integer so the wave count across the radius is coherent — the crests
 * form a clean bullseye rather than an off-centre swirl.
 *
 * Strategy per §10.2: six accumulated paths on the ctx's own path (D1
 * template — §6.5 bans allocating a `Path2D` inside `draw`), one stroke
 * per alpha bucket. `prepare` caches per-cell centres and distances, plus
 * six unit-vertex offsets shared by every cell. Consumes zero PRNG draws.
 *
 * Never blank: `glow.min = 0.15` and the top bucket has alpha
 * ≈ `envelope · glow · (5.5/6)`, so at least the highest-crest cells always
 * stroke visibly. `cell.min = 72` → ~480 cells × 7 pathops = ~3360 across
 * the six buckets, matching the §10.2 pin.
 *
 * **per-effect-glow (S04):** wide additive re-stroke archetype. When
 * `glowStrength > 0`, `draw` re-runs the six-bucket alpha-modulated loop
 * once BEFORE the crisp pass under `globalCompositeOperation = 'lighter'`
 * at `lineWidth × K_GLOW` — a soft halo under the pulsing hex mesh, crisp
 * outlines on top. Re-running the bucketed loop preserves the travelling-
 * wave modulation in the halo (uniform-alpha halo behind a pulsing mesh
 * would read as a static wash under a moving wave). No `shadowBlur` (FR-6);
 * `gs === 0` is a hard no-op → pre-glow seeds decode byte-identical (§9.5).
 * K = 2.0 keeps the halo modest against the 480+ cell budget.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 48,
  name: 'Hex Lattice',
  role: 'secondary',
  blurb: 'A hexagonal grid pulsing outward from centre.',
  // Worst case doubles under the glow pass: 6 halo bucket strokes + 6 crisp
  // bucket strokes; each halo bucket path is the same shape as its crisp
  // counterpart.
  worstCase: { pathOps: 5800, drawCalls: 12 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  // Pointy-top hex flat-to-flat width. min = 72 → ~480 cells over 1080×1920.
  S.int('cell', 72, 160, { default: 108 }),
  A('phase', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // glow.min > 0: at 0 every bucket composites at zero alpha — a null
  // figure. 0.15 keeps at least the top crest bucket visibly stroked.
  A('glow', 0.15, 1, { default: { min: 0.35, max: 0.85 } }),
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
/** Bucket count — matches drawCalls in the §10.2 pin. */
const NB = 6
/** Integer wave count across the canvas half-diagonal — keeps crests coherent. */
const WAVE_FREQ = 3
/** Half-diagonal, the largest dist any cell centre can reach from CX/CY. */
const MAX_DIST = Math.hypot(W, H) / 2
/** Radians per pixel of distance so `WAVE_FREQ` full cycles fit across MAX_DIST. */
const K = (TWO_PI * WAVE_FREQ) / MAX_DIST
/** Base outline width; the halo re-stroke uses `LINE_W × K_GLOW`. */
const LINE_W = 2
/**
 * Halo width multiplier. ~480 cells at cell.min = 72; a wider halo would
 * flood the small gaps between neighbouring cell outlines. K = 2.0 keeps
 * the halo (4 px) clearly wider than the crisp outline (2 px) while
 * preserving cell separation across the mesh.
 */
const K_GLOW = 2.0

/**
 * @typedef {object} HexLatticePrepared
 * @property {number} cellCount
 * @property {Float64Array} cellCX
 * @property {Float64Array} cellCY
 * @property {Float64Array} cellDist   Distance from canvas centre, per cell.
 * @property {Float64Array} vertX      Six shared vertex x-offsets from a cell centre.
 * @property {Float64Array} vertY      Six shared vertex y-offsets.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {HexLatticePrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  void rng
  const cellW = /** @type {number} */ (statics.cell)
  // Pointy-top hex: flat-to-flat width = cellW; vertex radius = cellW/√3.
  const cellR = cellW / Math.sqrt(3)
  const hSpacing = cellW
  const vSpacing = cellR * 1.5
  // Over-cover by one in each direction so offset rows never leave a
  // triangular gap at the boundary.
  const cols = Math.ceil(W / hSpacing) + 1
  const rows = Math.ceil(H / vSpacing) + 1
  // Centre the grid on the canvas — the odd-row shift comes from xOff below.
  const x0 = CX - ((cols - 1) / 2) * hSpacing
  const y0 = CY - ((rows - 1) / 2) * vSpacing

  const cellCount = cols * rows
  const cellCX = new Float64Array(cellCount)
  const cellCY = new Float64Array(cellCount)
  const cellDist = new Float64Array(cellCount)
  let idx = 0
  for (let row = 0; row < rows; row++) {
    const cy = y0 + row * vSpacing
    const xOff = row % 2 === 0 ? 0 : hSpacing / 2
    for (let col = 0; col < cols; col++) {
      const cx = x0 + xOff + col * hSpacing
      cellCX[idx] = cx
      cellCY[idx] = cy
      cellDist[idx] = Math.hypot(cx - CX, cy - CY)
      idx++
    }
  }

  // Six pointy-top vertex offsets, going CW from the top vertex.
  // Angles measured from +x axis: top = 90°, then step -60°.
  const vertX = new Float64Array(6)
  const vertY = new Float64Array(6)
  for (let v = 0; v < 6; v++) {
    const ang = Math.PI / 2 - v * (Math.PI / 3)
    vertX[v] = cellR * Math.cos(ang)
    // Canvas y grows downward; negate so vertex 0 sits above centre.
    vertY[v] = -cellR * Math.sin(ang)
  }

  return {
    cellCount,
    cellCX,
    cellCY,
    cellDist,
    vertX,
    vertY,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {HexLatticePrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const phaseRad = /** @type {number} */ (resolved.phase) * DEG
  const glow = /** @type {number} */ (resolved.glow)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { cellCount, cellCX, cellCY, cellDist, vertX, vertY } = prepared

  ctx.strokeStyle = prepared.color
  ctx.lineWidth = LINE_W
  ctx.lineJoin = 'round'

  // Painter's per-layer save/restore restores globalAlpha (§6.4).
  const envelope = ctx.globalAlpha

  // Glow pass — six bucket loops drawn FIRST so the crisp mesh sits on top
  // (halo under mark). Re-running the bucketed loop preserves the travelling-
  // wave modulation in the halo. `gs === 0` is a hard no-op: skip entirely
  // for byte-identical pre-glow output.
  if (gs > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = LINE_W * K_GLOW
    for (let b = 0; b < NB; b++) {
      ctx.beginPath()
      for (let i = 0; i < cellCount; i++) {
        const raw = 0.5 + 0.5 * Math.cos(cellDist[i] * K - phaseRad)
        const bucket = raw >= 1 ? NB - 1 : Math.floor(raw * NB)
        if (bucket !== b) continue
        const cx = cellCX[i]
        const cy = cellCY[i]
        ctx.moveTo(cx + vertX[0], cy + vertY[0])
        for (let v = 1; v < 6; v++) ctx.lineTo(cx + vertX[v], cy + vertY[v])
        ctx.closePath()
      }
      ctx.globalAlpha = envelope * glow * ((b + 0.5) / NB) * gs
      ctx.stroke()
    }
    ctx.restore()
    // `strokeStyle`, `lineJoin`, `lineWidth = LINE_W`, and envelope alpha
    // all restore to their pre-save values.
  }

  // Six passes over the cell table — each pass strokes the cells whose
  // quantized wave amplitude lands in its bucket. Bucket 0 is the trough
  // (darkest), bucket 5 the crest (brightest); alpha uses the bucket
  // midpoint so the top bucket never fully clips to envelope.
  for (let b = 0; b < NB; b++) {
    ctx.beginPath()
    for (let i = 0; i < cellCount; i++) {
      const raw = 0.5 + 0.5 * Math.cos(cellDist[i] * K - phaseRad)
      // Math.min guards the raw === 1 edge case (Math.floor(1 * 6) === 6).
      const bucket = raw >= 1 ? NB - 1 : Math.floor(raw * NB)
      if (bucket !== b) continue
      const cx = cellCX[i]
      const cy = cellCY[i]
      ctx.moveTo(cx + vertX[0], cy + vertY[0])
      for (let v = 1; v < 6; v++) ctx.lineTo(cx + vertX[v], cy + vertY[v])
      ctx.closePath()
    }
    ctx.globalAlpha = envelope * glow * ((b + 0.5) / NB)
    ctx.stroke()
  }
}
