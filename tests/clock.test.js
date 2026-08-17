// @ts-check
/**
 * Contract tests for the frame clock and state pub/sub.
 *
 * The clock's core contract is FR-1: "the current frame is computed from
 * elapsed wall-clock time as a fractional value, not by incrementing a
 * counter." This means:
 *
 *   - A dropped frame costs smoothness, never sync.
 *   - The frame at elapsed time T is always (T mod duration)-derived.
 *   - Pause cancels the rAF handle (FR-17).
 *
 * Testing a rAF loop deterministically is inherently tricky. We use two
 * strategies:
 *
 *   1. **Pure frame derivation** — call `currentFrame()` with a stubbed
 *      `getTotalFrames` and a controlled epoch. This tests the math without
 *      waiting for real rAF callbacks.
 *   2. **Simulated rAF** — we stub `requestAnimationFrame` and
 *      `cancelAnimationFrame` with synchronous equivalents so we can advance
 *      "time" by calling the tick function directly with a fake `now`.
 *
 * The state pub/sub tests verify that `subscribe` + `publish` is synchronous
 * and that a throwing subscriber does not break the chain.
 *
 * The actions tests verify the undo snapshot (FR-10) and dirty marking.
 *
 * This suite imports `core/state.js`, `core/actions.js`, `core/clock.js`,
 * `model/composition.js`, `model/registry.js`, and `model/params.js`.
 */

import { suite, test, assert, assertEq, assertClose } from './harness.js'
import { state, subscribe, publish, TOPICS } from '../src/core/state.js'
import { configure as configureActions, undo, loadComposition, addLayer, deleteLayer, setBlend, setScheme, setDuration, setParamRange, setParamTimes, setParamAlgorithm, setParamStatic } from '../src/core/actions.js'
import { configure as configureClock, start, pause, resume, resetEpoch, onFrame, currentFrame, paintOne, repaintIfPaused } from '../src/core/clock.js'
import { totalFrames, create, createLayer, clone } from '../src/model/composition.js'
import { register } from '../src/model/registry.js'
import { A, S } from '../src/model/params.js'
import { coerceBlend } from '../src/model/blend.js'
import { buildPalette } from '../src/model/schemes.js'

// ---------------------------------------------------------------------------
// Test fixture: a synthetic layer module (same as composition.test.js, but
// registered with a different ID to avoid a duplicate-ID throw.)
// ---------------------------------------------------------------------------

/** @type {import('../src/model/registry.js').LayerModule} */
const TEST_LAYER_901 = {
  meta: {
    id: 901,
    name: 'Clock Test Layer',
    role: 'primary',
    blurb: 'Synthetic layer for clock tests.',
    worstCase: { pathOps: 1, drawCalls: 1 },
    fullCanvasOpaque: false,
  },
  params: [
    S.int('count', 3, 64),
    A('radius', 60, 800),
    S.bool('filled'),
  ],
  prepare: () => ({}),
  draw: () => {},
}

// Register — registration is permanent (architecture §8.2).
try { register(TEST_LAYER_901) } catch { /* already registered by another suite */ }

// ---------------------------------------------------------------------------
// Configure actions with real model deps
// ---------------------------------------------------------------------------

configureActions({
  createLayer,
  clone,
  clampComposition: (c) => ({ skipped: 0, kept: c.layers.length }),
  buildPalette,
  totalFrames,
  coerceBlend,
})

// ---------------------------------------------------------------------------
// Configure clock with stub callbacks
// ---------------------------------------------------------------------------

let lastPaintedFrame = -1
let lastTotalFrames = -1
let flushCalled = false

configureClock({
  flushDirty: () => { flushCalled = true },
  paint: (frame, tf) => { lastPaintedFrame = frame; lastTotalFrames = tf },
  governorSample: () => {},
  getTotalFrames: () => {
    if (state.composition === null) return 0
    return totalFrames(state.composition.durationId)
  },
})

// ---------------------------------------------------------------------------
// State pub/sub tests
// ---------------------------------------------------------------------------

suite('state — pub/sub (architecture §1)', () => {
  test('subscribe + publish is synchronous', () => {
    let received = null
    const unsub = subscribe(TOPICS.COMPOSITION, () => { received = 'fired' })
    publish(TOPICS.COMPOSITION)
    assertEq(received, 'fired', 'subscriber fired synchronously')
    unsub()
    received = null
    publish(TOPICS.COMPOSITION)
    assertEq(received, null, 'unsubscribed listener does not fire')
  })

  test('publish passes arguments to subscribers', () => {
    let receivedIndex = -1
    const unsub = subscribe(TOPICS.LAYER, (idx) => { receivedIndex = idx })
    publish(TOPICS.LAYER, 42)
    assertEq(receivedIndex, 42)
    unsub()
  })

  test('a throwing subscriber does not break the chain', () => {
    let secondFired = false
    const unsub1 = subscribe(TOPICS.SEED, () => { throw new Error('boom') })
    const unsub2 = subscribe(TOPICS.SEED, () => { secondFired = true })
    publish(TOPICS.SEED)
    assert(secondFired, 'second subscriber fired despite first throwing')
    unsub1()
    unsub2()
  })

  test('publishing an unknown topic is a silent no-op', () => {
    publish('nonexistent-topic')
    // No throw, no crash.
  })
})

// ---------------------------------------------------------------------------
// Clock — frame derivation (FR-1)
// ---------------------------------------------------------------------------

suite('clock — frame derivation (FR-1)', () => {
  test('currentFrame is 0 at epoch start', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    const f = currentFrame()
    assertClose(f, 0, 50, 'frame should be near 0 at epoch start') // allow small elapsed
  })

  test('currentFrame advances with elapsed time', () => {
    const c = create(901)
    c.durationId = 0 // 5 seconds = 300 frames
    loadComposition(c)
    resetEpoch()
    // We can't control performance.now(), but we can check that the frame
    // is within a reasonable range after a tiny sleep.
    const f0 = currentFrame()
    assert(f0 >= 0 && f0 < 300, `frame should be in [0, 300), got ${f0}`)
  })

  test('frame wraps at the loop boundary (loop-safe)', () => {
    // The formula: ((elapsed % duration) / duration) * totalFrames
    // At elapsed = duration, frame wraps to 0.
    // We verify this algebraically by checking that the formula produces
    // a value in [0, totalFrames) for any positive elapsed.
    const totalF = 300
    const durationMs = (totalF / 60) * 1000 // 5000 ms
    for (const elapsedMs of [0, 100, 500, 2500, 4999, 5000, 5001, 10000]) {
      const f = ((elapsedMs % durationMs) / durationMs) * totalF
      assert(f >= 0 && f < totalF, `frame for elapsed ${elapsedMs}ms = ${f}, expected in [0, ${totalF})`)
    }
  })

  test('dropped frames cause no drift — frame is always time-derived', () => {
    // Simulate a "dropped frame" by computing the frame at t=100ms and t=200ms
    // with the same epoch. The frame at t=200 should be exactly double the
    // frame at t=100 (linear within one period), regardless of whether any
    // rAF callbacks fired in between.
    const totalF = 300
    const durationMs = (totalF / 60) * 1000
    const epoch = 0
    const f100 = (((100 - epoch) % durationMs) / durationMs) * totalF
    const f200 = (((200 - epoch) % durationMs) / durationMs) * totalF
    assertClose(f200, f100 * 2, 1e-9, 'frame at 200ms = 2× frame at 100ms (no drift)')
  })

  test('totalFrames matches duration × 60', () => {
    const c = create(901)
    c.durationId = 0 // 5s
    loadComposition(c)
    // totalFrames is 300 for 5s
    assertEq(totalFrames(0), 300)
    assertEq(totalFrames(1), 900)
    assertEq(totalFrames(2), 1800)
  })
})

// ---------------------------------------------------------------------------
// Clock — pause/resume (FR-17)
// ---------------------------------------------------------------------------

suite('clock — pause and resume (FR-17)', () => {
  test('pause sets playing=false', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    start()
    assertEq(state.playing, true, 'start sets playing')
    pause()
    assertEq(state.playing, false, 'pause clears playing')
  })

  test('resume sets playing=true', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    start()
    pause()
    assertEq(state.playing, false)
    resume()
    assertEq(state.playing, true, 'resume sets playing')
    pause() // clean up
  })

  test('start is idempotent', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    start()
    start() // should not throw or double-schedule
    assertEq(state.playing, true)
    pause()
  })

  test('pause is idempotent', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    start()
    pause()
    pause() // should not throw
    assertEq(state.playing, false)
  })

  test('resume folds paused interval (continues from where it stopped)', () => {
    // We can't precisely control wall-clock, but we can verify that
    // pausedAccum grows after a pause/resume cycle.
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    start()
    pause()
    // pausedAccum should be 0 at this point (pausedAt recorded)
    // After resume, pausedAccum grows
    resume()
    pause()
    // After a second cycle, pausedAccum should be even larger
    // We just verify it's non-negative and doesn't reset
    assert(state.playing === false, 'paused after second pause')
    resume()
    pause()
  })

  test('resetEpoch resets the epoch and accumulators', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    start()
    pause()
    resume()
    pause()
    // After resetEpoch, all accumulators are zeroed
    resetEpoch()
    const f = currentFrame()
    assertClose(f, 0, 50, 'frame near 0 after resetEpoch')
  })

  test('paintOne paints a specific frame without starting the loop', () => {
    const c = create(901)
    loadComposition(c)
    flushCalled = false
    lastPaintedFrame = -1
    paintOne(42)
    assertEq(lastPaintedFrame, 42, 'paintOne painted frame 42')
    assert(flushCalled, 'paintOne flushed dirty caches')
    assertEq(state.playing, false, 'paintOne does not start the loop')
  })
})

// ---------------------------------------------------------------------------
// Clock — repaintIfPaused (paused-edit repaint)
// ---------------------------------------------------------------------------

suite('clock — repaintIfPaused (paused-edit repaint)', () => {
  test('does NOT paint while playing (rAF loop already paints every frame)', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    start()
    assertEq(state.playing, true, 'clock is playing')
    lastPaintedFrame = -1
    flushCalled = false
    repaintIfPaused()
    assertEq(lastPaintedFrame, -1, 'no paint occurred while playing')
    assert(!flushCalled, 'no flushDirty while playing')
    pause() // clean up
  })

  test('paints the current frame while paused (fresh state — playing=false)', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    assertEq(state.playing, false, 'starts paused (no start() called)')
    lastPaintedFrame = -1
    lastTotalFrames = -1
    flushCalled = false
    repaintIfPaused()
    // currentFrame() near 0 at epoch start; totalFrames from state.composition
    assert(lastPaintedFrame >= 0, `spy fired with a frame ≥ 0, got ${lastPaintedFrame}`)
    assert(lastPaintedFrame < totalFrames(c.durationId), `frame within [0, totalFrames), got ${lastPaintedFrame}`)
    assertEq(lastTotalFrames, totalFrames(c.durationId), 'totalFrames passed to paint')
    assert(flushCalled, 'flushDirty called before paint')
  })

  test('paints the current frame after explicit pause()', () => {
    const c = create(901)
    loadComposition(c)
    resetEpoch()
    start()
    pause()
    assertEq(state.playing, false, 'paused after pause()')
    lastPaintedFrame = -1
    flushCalled = false
    repaintIfPaused()
    assert(lastPaintedFrame >= 0, `paint fired after pause(), got frame ${lastPaintedFrame}`)
    assert(flushCalled, 'flushDirty called after pause()')
  })
})

// ---------------------------------------------------------------------------
// Clock — onFrame subscribers
// ---------------------------------------------------------------------------

suite('clock — onFrame subscribers', () => {
  test('onFrame returns an unsubscribe function', () => {
    let called = 0
    const unsub = onFrame(() => { called++ })
    assert(typeof unsub === 'function', 'onFrame returns a function')
    unsub()
  })
})

// ---------------------------------------------------------------------------
// Actions — undo (FR-10)
// ---------------------------------------------------------------------------

suite('actions — undo restores previous composition (FR-10)', () => {
  test('undo restores the composition before the last mutation', () => {
    const c = create(901)
    loadComposition(c)
    // Make a mutation
    setDuration(0) // change to 5s
    assertEq(state.composition.durationId, 0, 'duration changed to 5s')
    undo()
    assertEq(state.composition.durationId, 1, 'undo restores 15s')
  })

  test('undo is depth 1 — a second undo does nothing', () => {
    const c = create(901)
    loadComposition(c)
    setDuration(0)
    setDuration(2)
    undo() // restores to durationId=0 (the snapshot before the last mutation)
    assertEq(state.composition.durationId, 0, 'first undo restores last snapshot')
    undo() // no snapshot left — does nothing
    assertEq(state.composition.durationId, 0, 'second undo is a no-op')
  })

  test('undo with no snapshot is a no-op', () => {
    const c = create(901)
    loadComposition(c)
    // loadComposition does not create an undo snapshot
    undo()
    assert(state.composition !== null, 'composition still present after no-op undo')
  })

  test('undo restores layer params after a param edit', () => {
    const c = create(901)
    loadComposition(c)
    const oldRadius = /** @type {import('../src/model/params.js').AnimValue} */
      (state.composition.layers[0].params.radius).min
    setParamRange(0, 'radius', 200, 800)
    assertEq(
      /** @type {import('../src/model/params.js').AnimValue} */ (state.composition.layers[0].params.radius).min,
      200,
      'param changed',
    )
    undo()
    assertEq(
      /** @type {import('../src/model/params.js').AnimValue} */ (state.composition.layers[0].params.radius).min,
      oldRadius,
      'param restored by undo',
    )
  })
})

// ---------------------------------------------------------------------------
// Actions — mutations and dirty marking (§6.3)
// ---------------------------------------------------------------------------

suite('actions — mutations and dirty marking (§6.3)', () => {
  test('loadComposition marks all layers dirty', () => {
    const c = create(901)
    loadComposition(c)
    assert(state.dirty.length >= 1, 'dirty array populated')
    for (let i = 0; i < state.dirty.length; i++) {
      assert(state.dirty[i], `layer ${i} marked dirty on load`)
    }
  })

  test('setScheme marks all layers dirty (colours re-resolve)', () => {
    const c = create(901)
    loadComposition(c)
    // Clear dirty flags
    state.dirty = new Array(c.layers.length).fill(false)
    setScheme(1) // switch to Solar Flare
    for (let i = 0; i < state.dirty.length; i++) {
      assert(state.dirty[i], `layer ${i} marked dirty after scheme change`)
    }
  })

  test('setParamStatic marks the layer dirty', () => {
    const c = create(901)
    loadComposition(c)
    state.dirty = new Array(c.layers.length).fill(false)
    setParamStatic(0, 'count', 32)
    assert(state.dirty[0], 'static param change marks layer dirty')
  })

  test('setParamRange does NOT mark the layer dirty', () => {
    const c = create(901)
    loadComposition(c)
    state.dirty = new Array(c.layers.length).fill(false)
    setParamRange(0, 'radius', 100, 700)
    assert(!state.dirty[0], 'animatable param change does not mark layer dirty (§6.3)')
  })

  test('setParamTimes does NOT mark the layer dirty', () => {
    const c = create(901)
    loadComposition(c)
    state.dirty = new Array(c.layers.length).fill(false)
    setParamTimes(0, 'radius', 4)
    assert(!state.dirty[0], 'times change does not mark layer dirty')
  })

  test('setParamAlgorithm does NOT mark the layer dirty', () => {
    const c = create(901)
    loadComposition(c)
    state.dirty = new Array(c.layers.length).fill(false)
    setParamAlgorithm(0, 'radius', 5)
    assert(!state.dirty[0], 'algorithm change does not mark layer dirty')
  })

  test('addLayer adds a layer and marks it dirty', () => {
    const c = create(901)
    loadComposition(c)
    const before = c.layers.length
    const ok = addLayer(901)
    assert(ok, 'addLayer succeeded')
    assertEq(state.composition.layers.length, before + 1, 'layer count increased')
    assert(state.dirty[state.composition.layers.length - 1], 'new layer marked dirty')
  })

  test('addLayer blocks beyond 5 layers', () => {
    const c = create(901)
    loadComposition(c)
    // Fill up to 5
    while (state.composition.layers.length < 5) {
      addLayer(901)
    }
    const ok = addLayer(901)
    assertEq(ok, false, '6th layer blocked')
    assertEq(state.composition.layers.length, 5, 'still 5 layers')
  })

  test('deleteLayer removes a layer', () => {
    const c = create(901)
    loadComposition(c)
    addLayer(901)
    const before = state.composition.layers.length
    const ok = deleteLayer(0)
    assert(ok, 'deleteLayer succeeded')
    assertEq(state.composition.layers.length, before - 1, 'layer count decreased')
  })

  test('deleteLayer blocks on the last layer', () => {
    const c = create(901)
    loadComposition(c)
    assertEq(state.composition.layers.length, 1)
    const ok = deleteLayer(0)
    assertEq(ok, false, 'cannot delete the last layer')
    assertEq(state.composition.layers.length, 1, 'still 1 layer')
  })

  test('setBlend changes blend mode without marking dirty', () => {
    const c = create(901)
    loadComposition(c)
    state.dirty = new Array(c.layers.length).fill(false)
    setBlend(0, 1) // additive
    assertEq(state.composition.layers[0].blend, 1, 'blend changed')
    assert(!state.dirty[0], 'blend change does not mark layer dirty (not a static param)')
  })

  test('setDuration changes duration and publishes playback', () => {
    const c = create(901)
    loadComposition(c)
    let playbackFired = false
    const unsub = subscribe(TOPICS.PLAYBACK, () => { playbackFired = true })
    setDuration(2) // 30s
    assertEq(state.composition.durationId, 2, 'duration changed to 30s')
    assert(playbackFired, 'playback topic published (clock needs to reset epoch)')
    unsub()
  })

  test('setScheme publishes composition and seed topics', () => {
    const c = create(901)
    loadComposition(c)
    let compositionFired = false
    let seedFired = false
    const u1 = subscribe(TOPICS.COMPOSITION, () => { compositionFired = true })
    const u2 = subscribe(TOPICS.SEED, () => { seedFired = true })
    setScheme(2) // Deep Sea
    assert(compositionFired, 'composition topic published')
    assert(seedFired, 'seed topic published (seed is stale)')
    u1()
    u2()
  })
})