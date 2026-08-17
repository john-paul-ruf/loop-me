// @ts-check
/**
 * Layer type 46 — Star Polygon (FR-6, architecture §10.2 row 46).
 *
 * The `{n/k}` skip-star: place `n` points evenly on a circle, then walk
 * every `k`-th point, tracing the closed chord chain. Static `n` is 5..12;
 * static `k` is picked in prepare from `[2..⌊(n−1)/2⌋]`, preferring
 * gcd(n, k) = 1 (a coprime pair traces one connected star in `n` chords;
 * a compound pair traces a rosette of smaller stars — still a valid
 * closed figure, and mathematically legible). The `layers` static stamps
 * 1..3 concentric copies at 0.85× scale steps, so a `layers = 3` star
 * reads as an inner echo pair. Loop closure is intrinsic: every chord
 * path returns to its starting vertex; the animated `rot` carries
 * `{ wrap: true }`.
 *
 * `pulse` modulates the vertex radius uniformly — a subtle breathing that
 * shrinks and grows the whole star without breaking its {n/k} identity.
 * Bounded 0.7..1 (not 0..1) so the min end still traces a visible star.
 *
 * Strategy per §10.2: 1..3 accumulated closed paths on the ctx's own path
 * (D1 template — §6.5 bans allocating a `Path2D` inside `draw`), one
 * stroke per layer. `prepare` caches the per-vertex unit angles (which
 * change only with `n`) and the skip-schedule (`n` chords, each an index
 * into the angle table). Consumes exactly 1 rng draw in prepare (the `k`
 * pick) — FR-4 cross-device draw-count contract.
 *
 * Imports `model/params.js` only (§4 rule 2).
 */

import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 46,
  name: 'Star Polygon',
  role: 'primary',
  blurb: 'A {n/k} skip-star, breathing and turning in concentric echoes.',
  worstCase: { pathOps: 40, drawCalls: 3 },
  fullCanvasOpaque: false,
}

/** Positional: seed field order, UI order, resolver order. APPEND ONLY. */
export const params = [
  S.int('n', 5, 12, { default: 8 }),
  S.int('layers', 1, 3, { default: 2 }),
  A('rot', 0, 360, { unit: '°', wrap: true, default: { min: 0, max: 360 } }),
  // pulse.min > 0: at 0 the star collapses to a point. 0.7 keeps the star
  // clearly readable at every sweep bound (FR-6 AC visibility floor).
  A('pulse', 0.7, 1, { default: { min: 0.85, max: 1 } }),
]

const CX = 540
const CY = 960
/** Star base radius, in canvas pixels — fits inside the 1080-wide stage. */
const BASE_R = 460
const DEG = Math.PI / 180
const TWO_PI = Math.PI * 2
const LAYER_SCALE = 0.85

/**
 * Greatest common divisor — trivial Euclid. Used once at prepare time to
 * prefer gcd(n, k) = 1 skip choices.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function gcd(a, b) {
  while (b !== 0) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

/**
 * @typedef {object} StarPolygonPrepared
 * @property {number} n
 * @property {number} k
 * @property {number} layers
 * @property {Float64Array} vCos  Per-vertex unit x, indexed by vertex 0..n-1.
 * @property {Float64Array} vSin  Per-vertex unit y.
 * @property {Uint8Array}  order  Walk order — `n` vertex indices, `(i·k) mod n`.
 * @property {string} color
 */

/**
 * @param {import('../model/params.js').Statics} statics
 * @param {import('../model/params.js').Palette} palette
 * @param {() => number} rng
 * @returns {StarPolygonPrepared}
 */
export function prepare(statics, palette, rng) {
  void palette
  const n = /** @type {number} */ (statics.n)
  const layerCount = /** @type {number} */ (statics.layers)

  // `k` range is [2 .. floor((n-1)/2)]. For n=5 that's [2..2] — one
  // choice. For n=12 it's [2..5] — four choices.
  const kMax = Math.floor((n - 1) / 2)
  const kOptions = []
  for (let kk = 2; kk <= kMax; kk++) kOptions.push(kk)
  // Prefer gcd(n, k) = 1 — a coprime skip traces one continuous star.
  // Compound stars are still valid (a legible rosette); fall back to the
  // full option set if no coprime k exists (n = 5 → k must be 2, gcd = 1;
  // this branch is dead-code for the declared bounds but keeps the pick
  // total across future range changes).
  const coprime = kOptions.filter((kk) => gcd(n, kk) === 1)
  const pool = coprime.length > 0 ? coprime : kOptions
  // FIXED draw count: exactly 1 rng value per prepare, whatever the pool.
  const k = pool[Math.floor(rng() * pool.length)]

  // Vertex table — n unit points around the circle, first vertex up
  // (angle = -π/2), matching the burst-star convention.
  const vCos = new Float64Array(n)
  const vSin = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * TWO_PI
    vCos[i] = Math.cos(a)
    vSin[i] = Math.sin(a)
  }

  // Walk order — index (i·k) mod n for i = 0..n-1. Closes back to vertex 0
  // exactly (i = n gives (n·k) mod n = 0), so the path is a valid closed
  // figure regardless of gcd(n, k).
  const order = new Uint8Array(n)
  for (let i = 0; i < n; i++) order[i] = (i * k) % n

  return {
    n,
    k,
    layers: layerCount,
    vCos,
    vSin,
    order,
    color: /** @type {string} */ (statics.color),
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../model/params.js').Resolved} resolved
 * @param {StarPolygonPrepared} prepared
 * @param {import('../model/params.js').Palette} palette
 */
export function draw(ctx, resolved, prepared, palette) {
  void palette
  const rot = /** @type {number} */ (resolved.rot) * DEG
  const pulse = /** @type {number} */ (resolved.pulse)
  const { n, layers, vCos, vSin, order } = prepared

  ctx.translate(CX, CY)
  ctx.rotate(rot)
  ctx.strokeStyle = prepared.color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // One stroke per concentric layer — up to `layers` (3) draw calls.
  // Layer i scales radius by LAYER_SCALE^i; stroke weight thins with it
  // so the inner echoes read as depth rather than a bolder outline.
  for (let layer = 0; layer < layers; layer++) {
    const scale = Math.pow(LAYER_SCALE, layer)
    const r = BASE_R * pulse * scale
    ctx.lineWidth = 2.5 * scale + 0.5
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const idx = order[i]
      const x = vCos[idx] * r
      const y = vSin[idx] * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  }
}
