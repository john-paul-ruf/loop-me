// @ts-check
/**
 * Layer type 50 — Voronoi Shards (FR-6, architecture §10.2 row 50).
 *
 * A Voronoi diagram of `sites` seed points, rendered as an animated wire
 * frame: each frame reveals a growing prefix of the edge list. The cell
 * polygons themselves are static — computed once in `prepare` by
 * successive half-plane clipping of the canvas rectangle against every
 * perpendicular bisector — so the animation carries no per-frame geometry
 * cost, only a per-frame edge-count bound.
 *
 * Loop closure is intrinsic through the value engine: `reveal` is A-typed
 * with algorithm `journeySin` (the FR-3 default), which returns the same
 * value at loop start and loop end — the edge count breathes 0.2×E..1.0×E
 * and comes back to where it started. No wrap discontinuity because
 * `reveal` is not an angular quantity.
 *
 * Strategy per §10.2: two accumulated paths on the ctx's own path (D1
 * template — §6.5 bans allocating a `Path2D` inside `draw`), one stroke
 * for edges and one fill for site dots. `prepare` runs the O(N²)
 * half-plane clipping (N ≤ 40 → 1600 iterations, prepare-time only),
 * dedupes shared edges into one edge list, and stores endpoints in flat
 * `Float64Array` pairs.
 *
 * PRNG consumption (FIXED across `sites`, FR-4): always draw
 * `MAX_SITES × 2` = 80 values so the seed stream position downstream is
 * stable. Only the first `sites × 2` reach live site coordinates; the
 * remainder are consumed and discarded.
 *
 * Never blank: `reveal.min = 0.2` guarantees ≥ 20 % of ~120 edges plus 40
 * site dots draw at every bound; the edge count grows with `sites`, so
 * even at `sites.min = 12` there are ~30 edges revealed.
 *
 * Imports `model/params.js` only (§4 rule 2).
 *
 * **per-effect-glow (feature) — mixed technique: wide additive re-stroke
 * of the revealed edges (K_GLOW_STROKE), widened additive re-fill of the
 * site dots (K_GLOW_DOT).** When `glowStrength > 0`, `draw` re-issues both
 * primitives under `globalCompositeOperation = 'lighter'` BEFORE their
 * crisp counterparts — a soft halo along every visible edge and around
 * every site dot, crisp lines/dots drawn on top (halo under mark). The
 * two K_GLOW constants match the S01/S02 archetype tuning: 2.5 for stroked
 * edges (pulse-rings), 1.8 for dot fills (orbit-dots). FR-6: NO
 * `shadowBlur`; §6.5: zero per-frame allocation (halo re-uses the same
 * cached edge/site tables). `gs === 0` is a hard no-op → byte-identical to
 * pre-glow. See `src/util/glow.js` for the canonical draw-time idiom.
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 50,
  name: 'Voronoi Shards',
  role: 'secondary',
  blurb: 'A Voronoi wireframe revealing itself edge by edge.',
  // Worst case doubles under the glow pass: one extra edge re-stroke +
  // one extra dot re-fill (3 → 5 drawCalls; ~260 → 520 path ops covering
  // the halo edges and dots alongside the crisp).
  worstCase: { pathOps: 520, drawCalls: 5 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('sites', 12, 40, { default: 22 }),
  // reveal.min > 0 (0.2): a zero prefix hides every edge — null figure.
  A('reveal', 0.2, 1, { default: { min: 0.35, max: 1 } }),
  // Appended LAST — feature per-effect-glow. Default `{min:0,max:0}` ⇒ every
  // pre-glow seed decodes to glow-off via `clampComposition`, so `gs === 0`
  // is a hard no-op in `draw` and the render is byte-identical to pre-glow.
  A('glowStrength', 0, 1, { default: { min: 0, max: 0 } }),
]

const W = 1080
const H = 1920
const TWO_PI = Math.PI * 2
/**
 * Fixed draw budget for the site position table — every prepare consumes
 * this many rng values regardless of the chosen `sites`, so downstream
 * stream position stays stable (FR-4, epicycle-chain precedent).
 */
const MAX_SITES = 40
/** Inset from canvas edges so sites never sit on the boundary. */
const INSET = 90
/** Site dot radius (device px). */
const DOT_R = 5
/** Vertex-coordinate rounding for edge dedup — 1 device px is finer than
 * any perceptible visual difference and coarser than any float drift the
 * clipping can produce on a 1080×1920 canvas. */
const EDGE_QUANT = 1
/**
 * Edge-halo width multiplier — matches the S02 stroke-batch tuning. Crisp
 * `lineWidth = 2`, halo `lineWidth = 5`: below 2× hides the halo inside
 * the crisp line; above 3× halos of adjacent shared edges merge into a
 * cell wash on dense (`sites = 40`) diagrams.
 */
const K_GLOW_STROKE = 2.5
/**
 * Site-dot halo multiplier — matches orbit-dots (the dot archetype). Crisp
 * `DOT_R = 5`, halo `r = 9`: below 1.4× hides the halo inside the crisp
 * dot; above 2.5× halos of adjacent sites (min separation ~2 × INSET)
 * begin to merge on the tightest `sites = 40`.
 */
const K_GLOW_DOT = 1.8

/**
 * @typedef {object} VoronoiShardsPrepared
 * @property {number} sites          Live site count.
 * @property {Float64Array} siteX    Site x, indexed 0..sites-1.
 * @property {Float64Array} siteY    Site y.
 * @property {number} edgeCount
 * @property {Float64Array} edgeAX   Edge endpoint A x, indexed 0..edgeCount-1.
 * @property {Float64Array} edgeAY
 * @property {Float64Array} edgeBX
 * @property {Float64Array} edgeBY
 * @property {string} color
 */

/**
 * Clip a convex polygon by a half-plane. `pi` is inside; the half-plane
 * boundary is the perpendicular bisector of `pi` and `pj`. Returns the
 * clipped polygon as a new flat array `[x0, y0, x1, y1, …]`.
 *
 * Point p is inside iff `(p - M) · (pj - pi) ≤ 0` where M is the midpoint
 * — that is, p is on `pi`'s side of the bisector. Standard
 * Sutherland-Hodgman applied to a single half-plane.
 *
 * @param {number[]} poly Flat `[x0, y0, x1, y1, …]`.
 * @param {number} pix
 * @param {number} piy
 * @param {number} pjx
 * @param {number} pjy
 * @returns {number[]}
 */
function clipHalfPlane(poly, pix, piy, pjx, pjy) {
  const nx = pjx - pix
  const ny = pjy - piy
  const mx = (pix + pjx) / 2
  const my = (piy + pjy) / 2
  /** @type {number[]} */
  const out = []
  const n = poly.length / 2
  if (n === 0) return out
  let px = poly[(n - 1) * 2]
  let py = poly[(n - 1) * 2 + 1]
  let pInside = (px - mx) * nx + (py - my) * ny <= 0
  for (let i = 0; i < n; i++) {
    const cx = poly[i * 2]
    const cy = poly[i * 2 + 1]
    const cInside = (cx - mx) * nx + (cy - my) * ny <= 0
    if (cInside !== pInside) {
      // Line P→C, intersect with bisector. Parametric: P + t(C - P).
      // Bisector: (X - M)·n = 0. Solve for t.
      const denom = (cx - px) * nx + (cy - py) * ny
      const t = denom !== 0 ? ((mx - px) * nx + (my - py) * ny) / denom : 0
      out.push(px + t * (cx - px), py + t * (cy - py))
    }
    if (cInside) out.push(cx, cy)
    px = cx
    py = cy
    pInside = cInside
  }
  return out
}

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {VoronoiShardsPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const sites = /** @type {number} */ (statics.sites)

  // FIXED draw count: always fill MAX_SITES × 2 rng slots so seed stream
  // position downstream is stable across `sites` changes.
  const siteX = new Float64Array(MAX_SITES)
  const siteY = new Float64Array(MAX_SITES)
  for (let i = 0; i < MAX_SITES; i++) {
    siteX[i] = INSET + rng() * (W - 2 * INSET)
    siteY[i] = INSET + rng() * (H - 2 * INSET)
  }

  // For each live site, clip the canvas rectangle against every other
  // live site's perpendicular bisector. Result is the site's Voronoi cell.
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {number[]} */
  const edgeAX = []
  /** @type {number[]} */
  const edgeAY = []
  /** @type {number[]} */
  const edgeBX = []
  /** @type {number[]} */
  const edgeBY = []
  for (let i = 0; i < sites; i++) {
    let poly = [0, 0, W, 0, W, H, 0, H]
    const pix = siteX[i]
    const piy = siteY[i]
    for (let j = 0; j < sites; j++) {
      if (j === i) continue
      poly = clipHalfPlane(poly, pix, piy, siteX[j], siteY[j])
      if (poly.length === 0) break
    }
    // Emit the cell's edges, dedup'd by rounded endpoint pair. An edge
    // shared by two cells appears with reversed endpoints on the other
    // side; the canonical key sorts endpoints so both look identical.
    const vCount = poly.length / 2
    for (let k = 0; k < vCount; k++) {
      const ax = poly[k * 2]
      const ay = poly[k * 2 + 1]
      const nxt = (k + 1) % vCount
      const bx = poly[nxt * 2]
      const by = poly[nxt * 2 + 1]
      const arx = Math.round(ax / EDGE_QUANT)
      const ary = Math.round(ay / EDGE_QUANT)
      const brx = Math.round(bx / EDGE_QUANT)
      const bry = Math.round(by / EDGE_QUANT)
      // Canonical key: order endpoints lexicographically so reversed edges collide.
      const key = arx < brx || (arx === brx && ary <= bry)
        ? `${arx},${ary}|${brx},${bry}`
        : `${brx},${bry}|${arx},${ary}`
      if (seen.has(key)) continue
      seen.add(key)
      edgeAX.push(ax)
      edgeAY.push(ay)
      edgeBX.push(bx)
      edgeBY.push(by)
    }
  }

  return {
    sites,
    siteX,
    siteY,
    edgeCount: edgeAX.length,
    edgeAX: new Float64Array(edgeAX),
    edgeAY: new Float64Array(edgeAY),
    edgeBX: new Float64Array(edgeBX),
    edgeBY: new Float64Array(edgeBY),
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {VoronoiShardsPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const reveal = /** @type {number} */ (resolved.reveal)
  const gs = /** @type {number} */ (resolved.glowStrength)
  const { sites, siteX, siteY, edgeCount, edgeAX, edgeAY, edgeBX, edgeBY } = prepared
  // Round-and-clamp so reveal ∈ [0.2, 1] always emits at least a few edges
  // at the low end and every edge at the top.
  const showN = Math.min(edgeCount, Math.max(1, Math.round(reveal * edgeCount)))

  ctx.strokeStyle = prepared.color
  ctx.lineCap = 'round'
  ctx.fillStyle = prepared.color

  // Glow pass — drawn FIRST so the crisp wireframe and dots sit on top
  // (halo under mark). Two halo primitives: wide re-stroke of the revealed
  // edges, then widened re-fill of the site dots — both under 'lighter'.
  // `gs === 0` is a hard no-op → byte-identical to pre-glow. See
  // `src/util/glow.js`.
  if (gs > 0) {
    const a0 = ctx.globalAlpha
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a0 * gs

    // Halo 1 — widened edge re-stroke.
    ctx.lineWidth = 2 * K_GLOW_STROKE
    ctx.beginPath()
    for (let i = 0; i < showN; i++) {
      ctx.moveTo(edgeAX[i], edgeAY[i])
      ctx.lineTo(edgeBX[i], edgeBY[i])
    }
    ctx.stroke()

    // Halo 2 — widened site-dot re-fill.
    const glowR = DOT_R * K_GLOW_DOT
    ctx.beginPath()
    for (let i = 0; i < sites; i++) {
      ctx.moveTo(siteX[i] + glowR, siteY[i])
      ctx.arc(siteX[i], siteY[i], glowR, 0, TWO_PI)
    }
    ctx.fill()

    ctx.restore()
    // `strokeStyle`/`fillStyle`/`lineCap` survive `restore()` since they
    // were set before `save()`.
  }

  ctx.lineWidth = 2

  // Draw 1 — the revealed edges (moveTo + lineTo per edge).
  ctx.beginPath()
  for (let i = 0; i < showN; i++) {
    ctx.moveTo(edgeAX[i], edgeAY[i])
    ctx.lineTo(edgeBX[i], edgeBY[i])
  }
  ctx.stroke()

  // Draw 2 — always-visible site dots (fill).
  ctx.beginPath()
  for (let i = 0; i < sites; i++) {
    ctx.moveTo(siteX[i] + DOT_R, siteY[i])
    ctx.arc(siteX[i], siteY[i], DOT_R, 0, TWO_PI)
  }
  ctx.fill()
}
