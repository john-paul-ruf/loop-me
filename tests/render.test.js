// @ts-check
/**
 * D1 — render pipeline contract tests: resolve, prepare, painter, governor,
 * canvas. First pixels: paints a real Ray Rings frame into a detached canvas
 * and reads it back.
 *
 * Determinism trick used throughout: an AnimValue pinned to `min === max`
 * makes `findValue` return exactly `min` at every frame, so pixel assertions
 * do not depend on any curve's shape or phase.
 */

import { suite, test, assert, assertEq } from './harness.js'
import { init as canvasInit, setStageBackground, WIDTH, HEIGHT } from '../src/render/canvas.js'
import { setTarget, paint } from '../src/render/painter.js'
import { slotsFor, resolveLayer } from '../src/render/resolve.js'
import { prewarm, flushDirty, getPrepared } from '../src/render/prepare.js'
import { sample, reset as governorReset, isWarned } from '../src/render/governor.js'
import { state, publish, subscribe, TOPICS } from '../src/core/state.js'
import { onReport, LAYER_DRAW_FAILED } from '../src/core/errors.js'
import { register } from '../src/model/registry.js'
import { buildPalette } from '../src/model/schemes.js'
import { createLayer } from '../src/model/composition.js'
import { A, S } from '../src/model/params.js'

/** @typedef {import('../src/model/params.js').Layer} Layer */
/** @typedef {import('../src/model/params.js').Composition} Composition */
/** @typedef {import('../src/model/params.js').AnimValue} AnimValue */

// Drain any reports left pending by earlier suites, so this suite's captures
// start clean (the replay buffer delivers to the first listener).
onReport(() => {})()

// ---------------------------------------------------------------------------
// Synthetic layer types (IDs ≥ 900 are the test convention). try/catch so a
// hot-reloaded page does not die on duplicate registration.
// ---------------------------------------------------------------------------

let throwingDrawCalls = 0
try {
  register({
    meta: { id: 990, name: 'Throwing Draw', role: 'overlay', blurb: 'test', worstCase: { pathOps: 1, drawCalls: 1 }, fullCanvasOpaque: false },
    params: [S.int('n', 0, 10)],
    prepare: () => ({}),
    draw: () => {
      throwingDrawCalls++
      throw new Error('deliberate draw failure')
    },
  })
} catch { /* already registered */ }

try {
  register({
    meta: { id: 991, name: 'Throwing Prepare', role: 'overlay', blurb: 'test', worstCase: { pathOps: 1, drawCalls: 1 }, fullCanvasOpaque: false },
    params: [S.int('n', 0, 10)],
    prepare: () => {
      throw new Error('deliberate prepare failure')
    },
    draw: () => {},
  })
} catch { /* already registered */ }

try {
  register({
    // The Flag 4 shape: a layer-local param NAMED `opacity`, like Scan Lines
    // and Grain in FR-6. Its resolved value must not be confused with the
    // envelope's.
    meta: { id: 992, name: 'Local Opacity', role: 'overlay', blurb: 'test', worstCase: { pathOps: 1, drawCalls: 1 }, fullCanvasOpaque: false },
    params: [A('opacity', 0.02, 0.6)],
    prepare: () => ({}),
    draw: () => {},
  })
} catch { /* already registered */ }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {number} v
 * @returns {AnimValue}
 */
function pin(v) {
  return { min: v, max: v, times: 1, algorithm: 0 }
}

/**
 * A fully pinned, deterministic Ray Rings layer: 24 rays, ray 0 along +x from
 * the centre, so the pixel at (700, 960) sits mid-stroke.
 *
 * @returns {Layer}
 */
function rayLayer() {
  return {
    type: 1,
    blend: 0,
    rngSeed: 1,
    color: 'c0',
    opacity: pin(1),
    params: {
      rayCount: 24,
      innerRadius: pin(100),
      length: pin(400),
      thickness: pin(12),
      rotation: pin(0),
      taper: false,
    },
    errored: false,
  }
}

/**
 * Install a composition into state and prewarm its caches.
 * @param {Layer[]} layers
 * @returns {Composition}
 */
function load(layers) {
  /** @type {Composition} */
  const c = { durationId: 1, scheme: 0, layers }
  state.composition = c
  state.palette = buildPalette(c.scheme, c.layers)
  state.dirty = layers.map(() => false)
  prewarm()
  return c
}

/**
 * A fresh detached 1080×1920 canvas installed as the painter's target.
 * @returns {CanvasRenderingContext2D}
 */
function freshTarget() {
  const cv = document.createElement('canvas')
  cv.width = WIDTH
  cv.height = HEIGHT
  const cx = cv.getContext('2d')
  assert(cx !== null, 'detached canvas must yield a 2d context')
  setTarget(cx)
  return cx
}

/**
 * @param {CanvasRenderingContext2D} cx
 * @param {number} x
 * @param {number} y
 * @returns {Uint8ClampedArray}
 */
function px(cx, x, y) {
  return cx.getImageData(x, y, 1, 1).data
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} [tol]
 * @returns {boolean}
 */
function near(actual, expected, tol = 8) {
  return Math.abs(actual - expected) <= tol
}

const TOTAL = 900 // 15 s duration

// ---------------------------------------------------------------------------

suite('render/resolve', () => {
  test('A params resolve through findValue, S params pass through', () => {
    const layer = rayLayer()
    /** @type {import('../src/model/params.js').Resolved} */
    const slot = {}
    const alpha = resolveLayer(layer, 0, TOTAL, slot)
    assertEq(slot.rayCount, 24, 'S int passes through')
    assertEq(slot.taper, false, 'S bool passes through')
    assertEq(slot.innerRadius, 100, 'pinned A resolves to its min')
    assertEq(slot.length, 400, 'pinned A resolves to its min')
    assertEq(alpha, 1, 'pinned envelope opacity returns 1')
  })

  test('a sweeping A param stays inside its stored bounds at every frame', () => {
    const layer = rayLayer()
    layer.params.innerRadius = { min: 100, max: 400, times: 3, algorithm: 7 }
    /** @type {import('../src/model/params.js').Resolved} */
    const slot = {}
    for (let f = 0; f <= TOTAL; f += 0.5) {
      resolveLayer(layer, f, TOTAL, slot)
      const v = /** @type {number} */ (slot.innerRadius)
      assert(v >= 100 && v <= 400, `frame ${f}: ${v} escaped [100, 400]`)
    }
  })

  test('Flag 4: a layer-local `opacity` param never collides with the envelope', () => {
    /** @type {Layer} */
    const layer = {
      type: 992,
      blend: 0,
      rngSeed: 1,
      color: 'c0',
      opacity: pin(1),
      params: { opacity: pin(0.5) },
      errored: false,
    }
    /** @type {import('../src/model/params.js').Resolved} */
    const slot = {}
    const alpha = resolveLayer(layer, 0, TOTAL, slot)
    assertEq(slot.opacity, 0.5, 'the slot holds the LAYER param')
    assertEq(alpha, 1, 'the return value holds the ENVELOPE opacity')
  })

  test('unknown layer type resolves to alpha 0 and leaves the slot untouched', () => {
    const layer = rayLayer()
    layer.type = 9999
    /** @type {import('../src/model/params.js').Resolved} */
    const slot = {}
    const alpha = resolveLayer(layer, 0, TOTAL, slot)
    assertEq(alpha, 0, 'unknown type yields 0')
    assertEq(Object.keys(slot).length, 0, 'slot untouched')
  })

  test('slotsFor reuses the same array and objects across frames', () => {
    const c = load([rayLayer(), rayLayer()])
    const a = slotsFor(c)
    const b = slotsFor(c)
    assert(a === b, 'same array back')
    assert(a[0] === b[0] && a[1] === b[1], 'same slot objects back')
    c.layers.pop()
    const d = slotsFor(c)
    assertEq(d.length, 1, 'resized when the layer count changes')
  })
})

suite('render/prepare', () => {
  test('prewarm builds a prepared object per layer from static params', () => {
    load([rayLayer()])
    const p = getPrepared(0)
    assert(p !== null, 'prepared exists')
    assertEq(p.count, 24, 'geometry derives from the static rayCount')
    assertEq(p.color, '#FF2E88', 'resolved colour string is cached (Neon Night c0)')
  })

  test('flushDirty rebuilds only dirty indices, atomically by reference swap', () => {
    const c = load([rayLayer(), rayLayer()])
    const before0 = getPrepared(0)
    const before1 = getPrepared(1)
    c.layers[0].params.rayCount = 30
    state.dirty[0] = true
    flushDirty()
    const after0 = getPrepared(0)
    assert(after0 !== before0, 'dirty index got a fresh object')
    assertEq(after0.count, 30, 'rebuild saw the new static value')
    assert(getPrepared(1) === before1, 'clean index untouched')
    assertEq(state.dirty[0], false, 'flag cleared')
  })

  test('a throwing prepare fences the layer and reports, never throws', () => {
    /** @type {import('../src/core/errors.js').ErrorReport[]} */
    const seen = []
    const un = onReport((r) => { seen.push(r) })
    /** @type {Layer} */
    const bad = {
      type: 991, blend: 0, rngSeed: 1, color: 'c0',
      opacity: pin(1), params: { n: 1 }, errored: false,
    }
    load([bad])
    un()
    assertEq(bad.errored, true, 'layer fenced')
    assertEq(getPrepared(0), null, 'no prepared object')
    assert(
      seen.some((r) => r.code === LAYER_DRAW_FAILED),
      'LAYER_DRAW_FAILED reported from the prepare fence',
    )
  })
})

suite('render/painter', () => {
  test('paints a visible Ray Rings frame — first pixels', () => {
    const cx = freshTarget()
    load([rayLayer()])
    paint(0, TOTAL)

    const bg = px(cx, 5, 5)
    assert(near(bg[0], 0x07) && near(bg[1], 0x06) && near(bg[2], 0x0D), `corner is the scheme background, got ${bg[0]},${bg[1]},${bg[2]}`)

    const ray = px(cx, 700, 960)
    assert(near(ray[0], 0xFF) && near(ray[1], 0x2E) && near(ray[2], 0x88), `mid-stroke pixel is the layer colour, got ${ray[0]},${ray[1]},${ray[2]}`)
  })

  test('tapered variant also renders non-blank', () => {
    const cx = freshTarget()
    const layer = rayLayer()
    layer.params.taper = true
    layer.params.thickness = pin(24)
    load([layer])
    paint(0, TOTAL)
    const p = px(cx, 650, 960) // near the wide base of the +x ray
    assert(!near(p[0], 0x07, 4) || !near(p[2], 0x0D, 4), 'tapered ray painted over the background')
  })

  test('envelope opacity drives globalAlpha via the resolve return value', () => {
    const cx = freshTarget()
    const layer = rayLayer()
    layer.opacity = pin(0.25)
    load([layer])
    paint(0, TOTAL)
    const p = px(cx, 700, 960)
    // 0.25·FF2E88 over 07060D: r ≈ 0.25·255 + 0.75·7 ≈ 69
    assert(near(p[0], 69, 12), `alpha-composited red ≈ 69, got ${p[0]}`)
    assert(p[0] < 120, 'nowhere near the full-opacity colour')
  })

  test('composite, alpha and transform are reset after every paint', () => {
    const cx = freshTarget()
    const layer = rayLayer()
    layer.blend = 1 // additive
    layer.opacity = pin(0.5)
    load([layer])
    paint(0, TOTAL)
    assertEq(cx.globalAlpha, 1, 'alpha reset')
    assertEq(cx.globalCompositeOperation, 'source-over', 'composite reset')
    assert(cx.getTransform().isIdentity, 'transform reset')
  })

  test('a throwing draw is fenced: reported, marked, loop survives, rest paints', () => {
    const cx = freshTarget()
    /** @type {import('../src/core/errors.js').ErrorReport[]} */
    const seen = []
    const un = onReport((r) => { seen.push(r) })
    /** @type {Layer} */
    const bad = {
      type: 990, blend: 0, rngSeed: 1, color: 'c0',
      opacity: pin(1), params: { n: 1 }, errored: false,
    }
    load([rayLayer(), bad])
    throwingDrawCalls = 0
    paint(0, TOTAL)
    un()

    assertEq(bad.errored, true, 'throwing layer marked errored')
    assert(seen.some((r) => r.code === LAYER_DRAW_FAILED), 'failure reported')
    const ray = px(cx, 700, 960)
    assert(near(ray[0], 0xFF), 'the healthy layer still painted')
    assertEq(cx.globalAlpha, 1, 'state reset survived the throw (finally path)')

    paint(1, TOTAL)
    assertEq(throwingDrawCalls, 1, 'an errored layer is skipped on later frames')
  })

  test('a default createLayer(1) composition renders non-blank', () => {
    const cx = freshTarget()
    const layer = createLayer(1)
    assert(layer !== null, 'type 1 is registered')
    load([layer])
    paint(0, TOTAL)
    // The default declaration guarantees the radius band [r0, r0+len] contains
    // 250 at every frame (r0 ≤ 140, r0+len ≥ 260), so a circle of radius 250
    // crosses all 24 rays regardless of the boot-time rotation value — a
    // single row would be rotation-fragile. Sample it densely enough (2048
    // points ≈ 0.77 px spacing) that a 2 px-wide ray cannot slip between
    // samples. One getImageData call; indexed reads after.
    const img = cx.getImageData(0, 0, WIDTH, HEIGHT).data
    let hits = 0
    const N = 2048
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * Math.PI
      const x = Math.round(540 + 250 * Math.cos(a))
      const y = Math.round(960 + 250 * Math.sin(a))
      if (img[(y * WIDTH + x) * 4] - 0x07 > 8) hits++ // red channel discriminates
    }
    assert(hits > 0, 'the r=250 circle crosses at least one default ray')
  })
})

suite('render/governor', () => {
  /**
   * Feed `count` intervals of `ms` to the governor from time `t`.
   * @param {number} t
   * @param {number} count
   * @param {number} ms
   * @returns {number} the advanced timestamp
   */
  function feed(t, count, ms) {
    for (let i = 0; i < count; i++) {
      t += ms
      sample(t)
    }
    return t
  }

  test('two consecutive slow windows enter WARN; two fast ones leave it', () => {
    /** @type {boolean[]} */
    const events = []
    const un = subscribe(TOPICS.GOVERNOR, (/** @type {unknown} */ warned) => {
      events.push(warned === true)
    })
    governorReset()
    state.governorWarned = false

    let t = 0
    sample(t)                 // primes lastNow
    t = feed(t, 60, 40)       // warm-up: skipped entirely
    t = feed(t, 90, 40)       // window 1 hot
    assertEq(isWarned(), false, 'one hot window is not enough')
    t = feed(t, 90, 40)       // window 2 hot
    assertEq(isWarned(), true, 'two consecutive hot windows warn')

    t = feed(t, 90, 15)       // window 3 cool
    assertEq(isWarned(), true, 'one cool window is not enough')
    t = feed(t, 90, 15)       // window 4 cool
    assertEq(isWarned(), false, 'two consecutive cool windows clear')

    un()
    assertEq(events.length, 2, 'exactly two governor publishes')
    assertEq(events[0], true, 'first publish: entering WARN')
    assertEq(events[1], false, 'second publish: leaving WARN')
    state.governorWarned = false
  })

  test('a single spike inside a healthy window does not trip the median', () => {
    governorReset()
    state.governorWarned = false
    let t = 0
    sample(t)
    t = feed(t, 60, 16)       // warm-up
    t = feed(t, 89, 16)
    t = feed(t, 1, 200)       // one dropped-frame spike completes window 1
    t = feed(t, 90, 16)       // window 2
    assertEq(isWarned(), false, 'median absorbs a single GC pause / refocus')
  })

  test('the dead band between 30 and 34 ms changes nothing', () => {
    governorReset()
    state.governorWarned = false
    let t = 0
    sample(t)
    t = feed(t, 60, 32)
    t = feed(t, 360, 32)      // four full windows in the dead band
    assertEq(isWarned(), false, 'dead-band windows never enter WARN')
    state.governorWarned = false
  })

  test('warm-up skips exactly 60 samples after reset', () => {
    governorReset()
    state.governorWarned = false
    let t = 0
    sample(t)
    // 60 warm-up + 89 window samples at a hot pace: window must NOT complete
    t = feed(t, 149, 40)
    t = feed(t, 90, 40)       // completes window 1
    assertEq(isWarned(), false, 'still only one completed hot window')
    t = feed(t, 90, 40)       // window 2
    assertEq(isWarned(), true, 'warms after the second — 60 samples were skipped')
    governorReset()
    state.governorWarned = false
  })
})

suite('render/canvas', () => {
  test('init pins the backing store to exactly 1080×1920, once', () => {
    const cv = document.createElement('canvas')
    cv.width = 300
    cv.height = 200
    const stage = document.createElement('div')
    const cx = canvasInit({ canvas: cv, stage })
    assert(cx !== null, 'context acquired')
    assertEq(cv.width, WIDTH, 'width forced to 1080')
    assertEq(cv.height, HEIGHT, 'height forced to 1920')
  })

  test('setStageBackground writes the --stage-bg custom property', () => {
    const cv = document.createElement('canvas')
    const stage = document.createElement('div')
    canvasInit({ canvas: cv, stage })
    setStageBackground('#123456')
    assertEq(stage.style.getPropertyValue('--stage-bg'), '#123456')
  })

  test('the stage background tracks the palette on composition publishes', () => {
    const cv = document.createElement('canvas')
    const stage = document.createElement('div')
    canvasInit({ canvas: cv, stage })
    load([rayLayer()]) // Neon Night → background #07060D
    publish(TOPICS.COMPOSITION)
    assertEq(stage.style.getPropertyValue('--stage-bg'), '#07060D')
  })
})
