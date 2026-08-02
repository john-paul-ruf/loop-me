// @ts-check
/**
 * The performance governor (architecture §6.6, FR-15).
 *
 * Rolling window of 90 frame intervals in a preallocated Float64Array; the
 * median is computed once per *completed* window — never per frame — by
 * copying into a second preallocated buffer and running an in-place
 * quickselect. Per-frame cost is one subtraction and one store.
 *
 * Enter WARN: median > 20 ms across two consecutive windows. Leave: < 18 ms
 * across two. The hysteresis gap keeps a GC pause or tab refocus from
 * flapping the banner. `warmupSkip = 60` on any composition change (FR-15).
 *
 * **This module holds no reference to the painter and cannot call into it**
 * (§6.6) — it imports `core/state.js` and nothing else. Warning is a fact
 * published on the `governor` topic; rendering never changes.
 */

import { state, publish, TOPICS } from '../core/state.js'

const WINDOW = 90
const ENTER_MS = 20
const LEAVE_MS = 18
const WARMUP = 60
const CONSECUTIVE = 2

const samples = new Float64Array(WINDOW)
const scratch = new Float64Array(WINDOW)

let fill = 0
let lastNow = -1
let warmupSkip = WARMUP
let hotWindows = 0
let coolWindows = 0

/**
 * Reset for a composition change: skip the next 60 samples and start a fresh
 * window. The warned *state* is deliberately kept — leaving WARN requires two
 * consecutive cool windows of evidence, not a mere edit (FR-15 hysteresis).
 */
export function reset() {
  fill = 0
  lastNow = -1
  warmupSkip = WARMUP
  hotWindows = 0
  coolWindows = 0
}

/**
 * Record one frame timestamp. Called once per rAF tick by the clock's
 * injected callback (§6.2).
 *
 * @param {number} now `performance.now()` from rAF.
 */
export function sample(now) {
  if (lastNow < 0) {
    lastNow = now
    return
  }
  const dt = now - lastNow
  lastNow = now

  if (warmupSkip > 0) {
    warmupSkip--
    return
  }

  samples[fill] = dt
  fill++
  if (fill < WINDOW) return
  fill = 0

  scratch.set(samples)
  const med = median(scratch)

  if (med > ENTER_MS) {
    hotWindows++
    coolWindows = 0
  } else if (med < LEAVE_MS) {
    coolWindows++
    hotWindows = 0
  } else {
    // The hysteresis dead band: evidence for neither transition.
    hotWindows = 0
    coolWindows = 0
  }

  if (!state.governorWarned && hotWindows >= CONSECUTIVE) {
    state.governorWarned = true
    publish(TOPICS.GOVERNOR, true, Math.round(1000 / med))
  } else if (state.governorWarned && coolWindows >= CONSECUTIVE) {
    state.governorWarned = false
    publish(TOPICS.GOVERNOR, false, Math.round(1000 / med))
  }
}

/** @returns {boolean} */
export function isWarned() {
  return state.governorWarned
}

/**
 * Median of a Float64Array by in-place quickselect. Mutates `a` (always the
 * scratch buffer). Median-of-three pivot — deterministic, no `Math.random`,
 * and safe against the sorted-input worst case a steady frame rate produces.
 *
 * @param {Float64Array} a
 * @returns {number}
 */
function median(a) {
  const k = a.length >> 1 // upper median for even length; a 45th-of-90 vs
  let lo = 0              // 46th distinction is well inside the hysteresis gap
  let hi = a.length - 1
  while (lo < hi) {
    // Median-of-three pivot into a[lo]
    const mid = (lo + hi) >> 1
    if (a[mid] < a[lo]) swap(a, lo, mid)
    if (a[hi] < a[lo]) swap(a, lo, hi)
    if (a[hi] < a[mid]) swap(a, mid, hi)
    const pivot = a[mid]

    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i] < pivot) i++
      while (a[j] > pivot) j--
      if (i <= j) {
        swap(a, i, j)
        i++
        j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return a[k]
}

/**
 * @param {Float64Array} a
 * @param {number} i
 * @param {number} j
 */
function swap(a, i, j) {
  const t = a[i]
  a[i] = a[j]
  a[j] = t
}
