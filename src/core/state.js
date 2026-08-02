// @ts-check
/**
 * The single plain state object and topic-scoped pub/sub (architecture §1).
 *
 * One plain object holds everything: the current composition, the resolved
 * palette, the playback flag, the governor warning flag, per-layer dirty
 * markers for the prepare cache, and the undo snapshot.
 *
 * Six named topics carry change notifications to views:
 *
 *   composition — the whole composition changed (duration, scheme, layers)
 *   layer       — a specific layer's params or envelope changed (passes index)
 *   playback    — play/pause state or duration changed (clock needs resetEpoch)
 *   governor    — the performance governor entered or left the warning state
 *   seed        — the seed string is stale and needs re-encoding
 *   library     — the gallery or custom-scheme store changed
 *
 * Publishing is synchronous (architecture §1). A subscriber that throws is
 * caught and contained — it must not stop the notification chain, because the
 * subscriber that needs the notification might not be the one that threw.
 *
 * This module imports nothing at runtime. It is a leaf of the dependency DAG
 * (architecture §4 rule 1).
 */

/** @typedef {import('../model/params.js').Composition} Composition */
/** @typedef {import('../model/params.js').Palette} Palette */

/**
 * The six pub/sub topics. Frozen so a typo at a call site is a silent no-op
 * rather than aphantom notification that nobody receives.
 */
export const TOPICS = Object.freeze({
  COMPOSITION: 'composition',
  LAYER: 'layer',
  PLAYBACK: 'playback',
  GOVERNOR: 'governor',
  SEED: 'seed',
  LIBRARY: 'library',
})

/**
 * The single state object. Mutated only by `core/actions.js`; views read it
 * fresh on each notification (architecture §1: "imperative views + targeted
 * DOM patching"). Exported as `const` so the binding cannot be replaced;
 * properties are intentionally mutable.
 */
export const state = {
  /** @type {Composition | null} */
  composition: null,
  /** @type {Palette | null} */
  palette: null,
  /** Whether the clock is currently playing. Mirrored by `clock.js`. */
  playing: false,
  /** Whether the performance governor is in the warning state (FR-15). */
  governorWarned: false,
  /** Per-layer-index dirty flags for the prepare cache (§6.3). */
  /** @type {boolean[]} */
  dirty: [],
  /** The previous composition for undo (depth 1, FR-10). */
  /** @type {Composition | null} */
  undoSnapshot: null,
}

// ---------------------------------------------------------------------------
// Pub/sub
// ---------------------------------------------------------------------------

/** @type {Map<string, Set<(...args: unknown[]) => void>>} */
const subs = new Map()

/**
 * Subscribe to a topic. Returns an unsubscribe function.
 *
 * @param {string} topic
 * @param {(...args: unknown[]) => void} fn
 * @returns {() => void}
 */
export function subscribe(topic, fn) {
  let set = subs.get(topic)
  if (set === undefined) {
    set = new Set()
    subs.set(topic, set)
  }
  set.add(fn)
  return () => {
    set.delete(fn)
  }
}

/**
 * Publish to a topic synchronously. Extra arguments are passed to subscribers.
 * A subscriber that throws is caught — the notification chain must not break.
 *
 * @param {string} topic
 * @param {...unknown} args
 */
export function publish(topic, ...args) {
  const set = subs.get(topic)
  if (set === undefined) return
  for (const fn of set) {
    try {
      fn(...args)
    } catch {
      // A subscriber error must not stop the notification chain.
    }
  }
}