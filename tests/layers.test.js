// @ts-check
/**
 * D4 — the per-type render sweep over the complete 16-type catalog.
 *
 * For every catalog type, a composition whose params are pinned to the
 * declaration's min, mid, and max bounds is painted into a detached canvas
 * and scanned against the scheme background:
 *
 *   - non-blank at every bound (FR-6 AC: "no control can drive a layer to
 *     render nothing") — some pixel differs from the background;
 *   - never a full-canvas opaque fill at max bounds for a type whose
 *     `meta.fullCanvasOpaque` is false — some pixel still shows the
 *     background through (differs from the pure layer colour).
 *
 * Params are pinned *generically from the declarations* (min === max makes
 * `findValue` exact, the render.test.js determinism trick), so a seventeenth
 * type joins the sweep with zero changes here.
 *
 * Plus the two Flag 4 real-world pins: Scan Lines and Grain declare a param
 * literally named `opacity`, and their pixels must composite at
 * envelope × layer opacity — proving the layer's value composes with the
 * envelope's rather than overwriting it (or vice versa).
 */

import { suite, test, assert } from './harness.js'
import { setTarget, paint } from '../src/render/painter.js'
import { prewarm } from '../src/render/prepare.js'
import { state } from '../src/core/state.js'
import { list } from '../src/model/registry.js'
import { buildPalette } from '../src/model/schemes.js'
import { defaultOf } from '../src/model/params.js'

/** @typedef {import('../src/model/params.js').Layer} Layer */
/** @typedef {import('../src/model/params.js').Composition} Composition */
/** @typedef {import('../src/model/params.js').AnimValue} AnimValue */
/** @typedef {import('../src/model/registry.js').LayerModule} LayerModule */

const W = 1080
const H = 1920
const TOTAL = 900

// One shared target: every paint begins with a full-canvas background fill,
// so frames cannot leak between tests, and 48 sweep paints reuse one 8 MB
// backing store instead of allocating 48.
const cv = document.createElement('canvas')
cv.width = W
cv.height = H
const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }))

/**
 * @param {number} v
 * @returns {AnimValue}
 */
function pin(v) {
  return { min: v, max: v, times: 1, algorithm: 0 }
}

/**
 * Pin every declared param to one end of its bounds: A params via min === max
 * (exact through findValue), statics at the bound itself. `mid` uses the
 * declared default for bool/enum (there is no meaningful midpoint).
 *
 * @param {LayerModule} mod
 * @param {'min'|'mid'|'max'} which
 * @returns {Record<string, import('../src/model/params.js').ParamValue>}
 */
function pinnedParams(mod, which) {
  /** @type {Record<string, import('../src/model/params.js').ParamValue>} */
  const out = {}
  for (const decl of mod.params) {
    if (decl.kind === 'A') {
      const v = which === 'min' ? decl.min : which === 'max' ? decl.max : (decl.min + decl.max) / 2
      out[decl.name] = pin(v)
    } else if (decl.kind === 'bool') {
      out[decl.name] = which === 'min' ? false : which === 'max' ? true : defaultOf(decl)
    } else if (decl.kind === 'enum') {
      const vs = /** @type {readonly (string|number)[]} */ (decl.values)
      out[decl.name] = which === 'min' ? vs[0] : which === 'max' ? vs[vs.length - 1] : defaultOf(decl)
    } else {
      const mid = (decl.min + decl.max) / 2
      const v = which === 'min' ? decl.min : which === 'max' ? decl.max
        : decl.kind === 'int' ? Math.round(mid) : mid
      out[decl.name] = v
    }
  }
  return out
}

/**
 * @param {number} type
 * @param {Record<string, import('../src/model/params.js').ParamValue>} params
 * @param {AnimValue} [opacity]
 * @returns {Layer}
 */
function makeLayer(type, params, opacity = pin(1)) {
  return { type, blend: 0, rngSeed: 1, color: 'c0', opacity, params, errored: false }
}

/**
 * Install a one-layer composition (Neon Night: bg #07060D, c0 #FF2E88),
 * prewarm, paint frame 0, and return the full pixel read-back.
 *
 * @param {Layer} layer
 * @returns {Uint8ClampedArray}
 */
function paintOne(layer) {
  /** @type {Composition} */
  const c = { durationId: 1, scheme: 0, layers: [layer] }
  state.composition = c
  state.palette = buildPalette(c.scheme, c.layers)
  state.dirty = [false]
  prewarm()
  setTarget(ctx)
  paint(0, TOTAL)
  return ctx.getImageData(0, 0, W, H).data
}

// Neon Night background and c0, as pinned by render.test.js.
const BG = [0x07, 0x06, 0x0D]
const C0 = [0xFF, 0x2E, 0x88]

/**
 * Does any pixel differ from `rgb` by ≥ `tol` on some channel? Early-exits.
 *
 * @param {Uint8ClampedArray} img
 * @param {number[]} rgb
 * @param {number} tol
 * @returns {boolean}
 */
function anyPixelOff(img, rgb, tol) {
  const [r, g, b] = rgb
  for (let i = 0; i < img.length; i += 4) {
    if (
      Math.abs(img[i] - r) >= tol ||
      Math.abs(img[i + 1] - g) >= tol ||
      Math.abs(img[i + 2] - b) >= tol
    ) return true
  }
  return false
}

suite('layers — the 16-type min/mid/max sweep (FR-6 AC)', () => {
  for (const mod of list().filter((m) => m.meta.id <= 16)) {
    test(`type ${mod.meta.id} ${mod.meta.name} renders non-blank at every bound`, () => {
      for (const which of /** @type {('min'|'mid'|'max')[]} */ (['min', 'mid', 'max'])) {
        const img = paintOne(makeLayer(mod.meta.id, pinnedParams(mod, which)))
        assert(
          anyPixelOff(img, BG, 2),
          `${mod.meta.name} at ${which} bounds painted nothing over the background`,
        )
        if (which === 'max' && mod.meta.fullCanvasOpaque === false) {
          assert(
            anyPixelOff(img, C0, 10),
            `${mod.meta.name} at max bounds hid the background everywhere despite fullCanvasOpaque: false`,
          )
        }
      }
    })
  }
})

suite('layers — Flag 4 in the real catalog: layer `opacity` composes with the envelope', () => {
  test('Scan Lines: band pixel = envelope × band opacity, not either alone', () => {
    const params = pinnedParams(/** @type {LayerModule} */ (list().find((m) => m.meta.id === 14)), 'mid')
    params.bandHeight = 40
    params.gap = 40
    params.drift = pin(0)
    params.opacity = pin(0.6)
    const img = paintOne(makeLayer(14, params, pin(0.5)))
    // Band rows start at y = 0; (540, 10) is mid-band. Effective alpha must be
    // 0.5 × 0.6 = 0.3: red = 0.3·255 + 0.7·7 ≈ 81. The collision failure
    // modes are ≈ 156 (layer overwrote envelope) and ≈ 131 (envelope alone).
    const r = img[(10 * W + 540) * 4]
    assert(Math.abs(r - 81) <= 14, `band red ≈ 81 (composed alpha 0.3), got ${r}`)
    assert(r < 115, 'nowhere near either alpha applied alone')
  })

  test('Grain: max pixel deviation is bounded by envelope × grain opacity', () => {
    const params = pinnedParams(/** @type {LayerModule} */ (list().find((m) => m.meta.id === 16)), 'mid')
    params.opacity = pin(0.35)
    params.driftX = pin(0)
    params.driftY = pin(0)
    const img = paintOne(makeLayer(16, params, pin(0.5)))
    // Effective alpha caps at 0.5 × 0.35 = 0.175 → max red ≈ 50 (diff ≈ 43).
    // If the grain opacity overwrote the envelope (0.35), max diff ≈ 87.
    let maxDiff = 0
    for (let i = 0; i < 2000; i++) {
      const d = img[i * 4 * 997 % img.length] - BG[0] // stride-sample the red channel
      if (d > maxDiff) maxDiff = d
    }
    assert(maxDiff <= 60, `max red deviation ${maxDiff} exceeds the composed-alpha bound (collision?)`)
    assert(maxDiff >= 25, `max red deviation ${maxDiff} is too small — grain barely painted`)
  })
})
