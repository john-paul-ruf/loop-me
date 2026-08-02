// @ts-check
/**
 * The frame clock — the requestAnimationFrame loop (architecture §6.2).
 *
 * `currentFrame` is **fractional and derived from wall-clock time**, never
 * incremented (FR-1). This makes playback independent of display refresh rate
 * and immune to dropped frames: a stutter loses smoothness, never sync.
 *
 * Pause cancels the rAF handle entirely (FR-17: "a paused page consumes
 * negligible CPU"). Resume folds the paused interval into `pausedAccum` so the
 * loop continues from where it stopped.
 *
 * The epoch is reset only on duration change (FR-2: re-render from frame 0)
 * and on composition load. A parameter edit does not touch it (FR-10: live
 * edits preserve playback position).
 *
 * ## Why the clock holds no painter reference
 *
 * Architecture §6.4 has the clock call `prepare.flushDirty()`, `painter.paint()`,
 * and `governor.sample()`. But §6.6 says "the governor has no reference to the
 * painter and cannot call into it." The same isolation applies here: the clock
 * is the rAF *driver*, but it calls its collaborators through injected
 * callbacks so that `core/clock.js` stays a leaf in the DAG (architecture §4
 * rule 1: `core/*` imports only `util/*`).
 *
 * `main.js` (F1) wires the callbacks at boot via `configure()`.
 *
 * This module imports `core/state.js` and `core/errors.js` only.
 */

import { state, publish, TOPICS } from './state.js'

/**
 * @typedef {import('../model/params.js').Composition} Composition
 */

// ---------------------------------------------------------------------------
// Injected callbacks
// ---------------------------------------------------------------------------

/** @type {(() => void) | null} */
let flushDirtyFn = null
/** @type {((frame: number, totalFrames: number) => void) | null} */
let paintFn = null
/** @type {((now: number) => void) | null} */
let governorSampleFn = null
/** @type {(() => number) | null} */
let getTotalFramesFn = null

/**
 * Inject the render collaborators. Called once at boot from `main.js`.
 *
 * @param {{
 *   flushDirty: () => void,
 *   paint: (frame: number, totalFrames: number) => void,
 *   governorSample: (now: number) => void,
 *   getTotalFrames: () => number,
 * }} callbacks
 */
export function configure(callbacks) {
  flushDirtyFn = callbacks.flushDirty
  paintFn = callbacks.paint
  governorSampleFn = callbacks.governorSample
  getTotalFramesFn = callbacks.getTotalFrames
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The rAF handle, or 0 when not running. */
let rafHandle = 0

/** Wall-clock time (ms) when the current epoch started. */
let epoch = 0

/** Accumulated paused time (ms) so the loop continues from where it stopped. */
let pausedAccum = 0

/** Wall-clock time (ms) when the pause started. */
let pausedAt = 0

// ---------------------------------------------------------------------------
// Frame subscribers — the live tick rides here (architecture §6.2)
// ---------------------------------------------------------------------------

/** @type {Set<(frame: number, totalFrames: number) => void>} */
const frameSubs = new Set()

/**
 * Subscribe to the per-frame callback. The live tick (Designer §0) writes
 * one CSS custom property per visible band from here — no separate timer.
 *
 * @param {(frame: number, totalFrames: number) => void} fn
 * @returns {() => void}
 */
export function onFrame(fn) {
  frameSubs.add(fn)
  return () => {
    frameSubs.delete(fn)
  }
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/**
 * One rAF callback. Computes the fractional current frame from wall-clock time,
 * flushes dirty prepare caches, paints, samples the governor, and notifies
 * frame subscribers.
 *
 * @param {number} now - `performance.now()` value from rAF.
 */
function tick(now) {
  if (!state.playing) {
    rafHandle = 0
    return
  }

  const totalFrames = getTotalFramesFn ? getTotalFramesFn() : 0
  if (totalFrames <= 0) {
    // No composition loaded yet — should not happen, but guard anyway.
    rafHandle = requestAnimationFrame(tick)
    return
  }

  const elapsedMs = now - epoch - pausedAccum
  // Derive the fractional frame from elapsed time (FR-1).
  // currentFrame = ((elapsed % duration) / duration) × totalFrames
  // where duration = totalFrames / 60 seconds = totalFrames × 1000/60 ms.
  const durationMs = (totalFrames / 60) * 1000
  const currentFrame = ((elapsedMs % durationMs) / durationMs) * totalFrames

  if (flushDirtyFn) flushDirtyFn()
  if (paintFn) paintFn(currentFrame, totalFrames)
  if (governorSampleFn) governorSampleFn(now)

  for (const fn of frameSubs) {
    try {
      fn(currentFrame, totalFrames)
    } catch {
      // A subscriber that throws must not stop the loop.
    }
  }

  rafHandle = requestAnimationFrame(tick)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the clock. Sets `playing = true`, resets the epoch to now, and kicks
 * the rAF loop. **Exposes no auto-start** — the boot sequence calls this
 * explicitly at step 8 (architecture §7).
 *
 * If already playing, this is a no-op.
 */
export function start() {
  if (state.playing) return
  state.playing = true
  epoch = performance.now()
  pausedAccum = 0
  publish(TOPICS.PLAYBACK)
  rafHandle = requestAnimationFrame(tick)
}

/**
 * Pause the clock. Cancels the rAF handle entirely (FR-17). Records the pause
 * time so `resume` can fold the gap into `pausedAccum`.
 *
 * If already paused, this is a no-op.
 */
export function pause() {
  if (!state.playing) return
  state.playing = false
  pausedAt = performance.now()
  if (rafHandle !== 0) {
    cancelAnimationFrame(rafHandle)
    rafHandle = 0
  }
  publish(TOPICS.PLAYBACK)
}

/**
 * Resume after a pause. Folds the paused interval into `pausedAccum` so the
 * loop continues from where it stopped. Starts the rAF loop.
 *
 * If already playing, this is a no-op.
 */
export function resume() {
  if (state.playing) return
  state.playing = true
  // Fold the paused interval into pausedAccum
  if (pausedAt > 0) {
    pausedAccum += performance.now() - pausedAt
    pausedAt = 0
  }
  publish(TOPICS.PLAYBACK)
  rafHandle = requestAnimationFrame(tick)
}

/**
 * Toggle play/pause.
 */
export function toggle() {
  if (state.playing) pause()
  else resume()
}

/**
 * Reset the epoch to now. Called on duration change (FR-2: re-render from
 * frame 0) and on composition load. Does not start or stop the loop — if it
 * is running, the next tick picks up the new epoch; if it is paused, the next
 * resume starts from frame 0.
 */
export function resetEpoch() {
  epoch = performance.now()
  pausedAccum = 0
  pausedAt = 0
}

/**
 * Paint a single frame at a specific frame number without starting the loop.
 * Used by the boot sequence (architecture §7 step 8: `painter.paint(0,
 * totalFrames)` is the first pixel ever drawn) and by view-only paused mode.
 *
 * This is a synchronous one-shot paint — it does not schedule rAF.
 *
 * @param {number} frame
 */
export function paintOne(frame) {
  const totalFrames = getTotalFramesFn ? getTotalFramesFn() : 0
  if (totalFrames <= 0) return
  if (flushDirtyFn) flushDirtyFn()
  if (paintFn) paintFn(frame, totalFrames)
}

/**
 * Is the clock currently running?
 * @returns {boolean}
 */
export function isPlaying() {
  return state.playing
}

/**
 * Compute the current fractional frame from wall-clock time without painting.
 * Useful for tests and for the tick control's position indicator.
 *
 * @returns {number}
 */
export function currentFrame() {
  const totalFrames = getTotalFramesFn ? getTotalFramesFn() : 0
  if (totalFrames <= 0) return 0
  const durationMs = (totalFrames / 60) * 1000
  const elapsedMs = performance.now() - epoch - pausedAccum
  return ((elapsedMs % durationMs) / durationMs) * totalFrames
}