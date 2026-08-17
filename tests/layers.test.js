// @ts-check
/**
 * D4 (omni-wave update) — the per-type render sweep over the whole
 * non-glitch catalog up to the current append-only frontier.
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
 * `findValue` exact, the render.test.js determinism trick), so a new
 * primary/secondary/overlay type joins the sweep with zero changes here.
 *
 * Glitch-role types (33+) are excluded because they redistribute the frame
 * below rather than emit imagery of their own — see the composed glitch
 * sweep further down. Individual pre-omni-wave types that fail this
 * newly-extended sweep may go into `SOLO_SWEEP_EXCLUSIONS` with a
 * documented reason (cross-lease waiver protocol — this session's lease
 * does not include those layer files). New types must never need a waiver.
 *
 * Plus the two Flag 4 real-world pins: Scan Lines and Grain declare a param
 * literally named `opacity`, and their pixels must composite at
 * envelope × layer opacity — proving the layer's value composes with the
 * envelope's rather than overwriting it (or vice versa).
 */

import { suite, test, assert, assertEq } from './harness.js'
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

/**
 * The append-only catalog frontier — bumps as each omni-wave chain session
 * (S01–S04) lands its ID block: 42 → 47 → 52 → 57. Synthetic test types
 * stay at IDs ≥ 900 and are filtered out. S02 raises to 47 up front:
 * unregistered IDs (46–47 until S03 lands them) simply don't appear in
 * `list()`, so the sweep is a no-op for them until they exist.
 */
const CATALOG_FRONTIER = 47

/**
 * Legacy IDs (< 33) waived from the solo sweep at S01 modernization time.
 * Cross-lease waiver protocol: this session's lease excludes layer files
 * outside 37–42, so a 17–32 type that regresses the newly-extended sweep
 * gets an ID here with a one-line reason, and the followUp handoff flags
 * it for a future session. New types (33+) must never need a waiver.
 * @type {Set<number>}
 */
const SOLO_SWEEP_EXCLUSIONS = new Set([
  // 24 Checker Wave — its own header documents that `scale`.min = 0.1 can
  // render all-off (crest cells fail the `scale × f ≥ 0.5` gate); the
  // layer relies on randomize.js's taste rules to avoid that zone rather
  // than on bounds enforcement. Not a regression the sweep can fix
  // without touching the layer file (outside this session's lease).
  24,
])

suite('layers — solo min/mid/max sweep, non-glitch catalog (FR-6 AC)', () => {
  for (const mod of list().filter((m) =>
    m.meta.id <= CATALOG_FRONTIER
    && m.meta.role !== 'glitch'
    && !SOLO_SWEEP_EXCLUSIONS.has(m.meta.id)
  )) {
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

/**
 * Glitch layers (role === 'glitch', IDs 33+) redistribute the frame below
 * rather than emit imagery of their own — solo over a bare background they
 * are visually void by design (see also SESSION-01 §"Composed sweep, not
 * solo sweep"). The min/mid/max sweep above pins that solo case as `id ≤
 * 16` only (which is stale for 17–32 too — a separate maintenance concern
 * flagged in STATE.md).
 *
 * This suite pins the *composed* case: paint a solid base first, then the
 * glitch on top, at every declared bound. Every driving param's `.min > 0`
 * (jolt ≥ 8, shift ≥ 2, density > 0, roll ≥ 8) so no bound is silently
 * invisible.
 */

// Grid Pulse (10) at mid, pinned — a dense, non-blank base that never
// paints a flat colour.
/** @type {LayerModule} */
const gridPulseMod = /** @type {LayerModule} */ (list().find((m) => m.meta.id === 10))
const glitchLayers = list().filter((m) => m.meta.role === 'glitch')

/**
 * Snapshot Grid Pulse painted alone (deterministic — pinned rngSeed and
 * min===max A params). Cached because the composed sweep re-uses it.
 * @returns {Uint8ClampedArray}
 */
function baseGridPulseSnapshot() {
  const base = makeLayer(10, pinnedParams(gridPulseMod, 'mid'))
  const img = paintOne(base)
  // Copy: paintOne shares the ctx, so the next paint would overwrite the
  // typed array underneath us.
  return new Uint8ClampedArray(img)
}

/**
 * Paint Grid Pulse + one glitch layer on top; return the pixel read-back.
 *
 * @param {number} glitchType
 * @param {Record<string, import('../src/model/params.js').ParamValue>} glitchParams
 * @returns {Uint8ClampedArray}
 */
function paintComposed(glitchType, glitchParams) {
  const base = makeLayer(10, pinnedParams(gridPulseMod, 'mid'))
  const glitch = makeLayer(glitchType, glitchParams)
  /** @type {Composition} */
  const c = { durationId: 1, scheme: 0, layers: [base, glitch] }
  state.composition = c
  state.palette = buildPalette(c.scheme, c.layers)
  state.dirty = [false, false]
  prewarm()
  setTarget(ctx)
  paint(0, TOTAL)
  return ctx.getImageData(0, 0, W, H).data
}

/**
 * Does any pixel in `a` differ from `b` by ≥ `tol` on some channel?
 * @param {Uint8ClampedArray} a
 * @param {Uint8ClampedArray} b
 * @param {number} tol
 * @returns {boolean}
 */
function anyPixelDiffers(a, b, tol) {
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i] - b[i]) >= tol ||
      Math.abs(a[i + 1] - b[i + 1]) >= tol ||
      Math.abs(a[i + 2] - b[i + 2]) >= tol
    ) return true
  }
  return false
}

/**
 * Is every pixel the same colour (within `tol`)? A glitch layer that
 * covered the frame in a flat colour would smuggle "hides the stack"
 * behaviour past `fullCanvasOpaque: false`.
 * @param {Uint8ClampedArray} img
 * @param {number} tol
 * @returns {boolean}
 */
function isMonochrome(img, tol) {
  const r = img[0]
  const g = img[1]
  const b = img[2]
  for (let i = 4; i < img.length; i += 4) {
    if (
      Math.abs(img[i] - r) > tol ||
      Math.abs(img[i + 1] - g) > tol ||
      Math.abs(img[i + 2] - b) > tol
    ) return false
  }
  return true
}

suite('layers — glitch composed sweep (base + glitch, FR-6 AC via §6.4 self-sampling)', () => {
  for (const mod of glitchLayers) {
    test(`type ${mod.meta.id} ${mod.meta.name}: composed with Grid Pulse alters every bound`, () => {
      const baseSnap = baseGridPulseSnapshot()
      for (const which of /** @type {('min'|'mid'|'max')[]} */ (['min', 'mid', 'max'])) {
        const params = pinnedParams(mod, which)
        const img = paintComposed(mod.meta.id, params)
        assert(
          anyPixelDiffers(img, baseSnap, 4),
          `${mod.meta.name} at ${which} bounds did nothing — some pixel must differ from the base-alone frame`,
        )
        assert(
          !isMonochrome(img, 4),
          `${mod.meta.name} at ${which} bounds flattened the frame to one colour`,
        )
      }
    })

    test(`type ${mod.meta.id} ${mod.meta.name}: solo over bare background does not throw`, () => {
      for (const which of /** @type {('min'|'mid'|'max')[]} */ (['min', 'mid', 'max'])) {
        // Void by design (nothing to sample) but the FR-18 fence must not
        // fire — no throw, no error report.
        paintOne(makeLayer(mod.meta.id, pinnedParams(mod, which)))
      }
    })
  }
})

/**
 * The driving A param on every glitch type — the one whose value at `min`
 * must be > 0 for the layer to actually redistribute pixels. A bounds
 * regression here reads as "the glitch does nothing at low bounds" and
 * would slip past the sweep above because the sweep tolerates the null
 * case gracefully.
 * @type {Record<number, string>}
 */
const DRIVER = {
  33: 'jolt',    // px — bands with zero shift are invisible
  34: 'shift',   // px — zero shift collapses R and cyan onto the original
  35: 'density', // ratio — density=0 rounds to 1 block but the sweep can't guarantee more
  36: 'roll',    // px — roll=0 makes both wrap blits no-ops
  37: 'reach',   // fraction — reach=0 mirrors a zero-width strip
  38: 'shear',   // px — alternating shift collapses to no-op at 0
  39: 'fade',    // alpha per echo — at 0 every echo composites invisibly
  40: 'reach',   // fraction — reach=0 makes dest height equal src, no smear
  41: 'radius',  // px — radius=0 blits onto itself, difference→black, screen→~original
  42: 'strength',// alpha per pass — at 0 every pass composites invisibly
}

suite('layers — glitch min-bound visibility floors are guarded (FR-6 AC regression)', () => {
  for (const mod of glitchLayers) {
    const driverName = DRIVER[mod.meta.id]
    test(`type ${mod.meta.id} ${mod.meta.name}: driver "${driverName}" has a strictly positive min`, () => {
      assert(driverName !== undefined, `no driver param mapped for glitch type ${mod.meta.id}`)
      const decl = mod.params.find((p) => p.name === driverName)
      assert(decl !== undefined, `type ${mod.meta.id}: no "${driverName}" param`)
      assertEq(decl.kind, 'A', `type ${mod.meta.id}: "${driverName}" must be animatable`)
      // Strictly > 0 — the "renders nothing at every bound" AC needs
      // headroom, not merely non-negativity.
      assert(
        decl.min > 0,
        `type ${mod.meta.id}: "${driverName}".min ${decl.min} must be > 0 to guarantee visible motion`,
      )
    })
  }
})

suite('layers — glitch determinism (FR-4: same seed, same frame → same pixels)', () => {
  for (const mod of glitchLayers) {
    test(`type ${mod.meta.id} ${mod.meta.name}: base + glitch is bit-for-bit stable across paints`, () => {
      // prepare's fixed rng consumption + resolve's pure `findValue` +
      // painter's identity-transform contract combine to make this exact.
      const params = pinnedParams(mod, 'mid')
      const a = new Uint8ClampedArray(paintComposed(mod.meta.id, params))
      const b = new Uint8ClampedArray(paintComposed(mod.meta.id, params))
      assertEq(a.length, b.length, 'read-back length changed between paints')
      // A stride sample is enough — a determinism regression alters
      // pixels near-uniformly (rng offset), not just at a few points.
      for (let i = 0; i < a.length; i += 4 * 61) {
        assertEq(a[i], b[i], `red channel drift at byte ${i}`)
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
