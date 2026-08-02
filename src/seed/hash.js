// @ts-check
/**
 * The hash fragment — reader and debounced writer (FR-13, architecture §9.6).
 *
 * The seed lives at `…/loop-me/#s=<seed>` and is never sent to a server (a
 * fragment never leaves the browser). Reading happens once at boot and again
 * on Paste Seed; writing is a debounced async task — 250 ms of idle after the
 * last mutation, then encode, then **`history.replaceState`, never
 * `pushState`**, so a slider drag produces one history entry's worth of
 * nothing instead of forty Back-button stops.
 *
 * This module does not import the codec. The writer takes an async
 * `getSeed` callback (F1 wires it to `encode(state.composition)`), which
 * keeps `hash.js` free of any knowledge of what a seed contains and makes
 * the writer testable without `CompressionStream`. No side effects at
 * import: reading `location` happens inside the functions, never at load.
 *
 * Imports `util/debounce.js` only.
 */

import { debounce } from '../util/debounce.js'

/** Idle milliseconds between the last mutation and the encode (FR-13). */
export const WRITE_DELAY_MS = 250

/** The fragment key. `#s=<seed>`. */
const PREFIX = '#s='

/**
 * Extract a seed from pasted text: a bare seed, a full URL, or either with
 * surrounding whitespace (FR-13 Paste Seed; architecture §9.6).
 *
 * If `#s=` appears, everything after its **last** occurrence is the seed —
 * the last one wins because that is the fragment the browser would actually
 * navigate to. Otherwise the trimmed text itself is assumed to be a bare
 * seed. No version or alphabet validation happens here: a pasted `"2z…"`
 * must reach `decode()` so the user gets the banner that *names* the version
 * mismatch, not a silent nothing.
 *
 * @param {string} text
 * @returns {string|null} The candidate seed, or `null` for empty input.
 */
export function parseSeed(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const at = trimmed.lastIndexOf(PREFIX)
  const candidate = at >= 0 ? trimmed.slice(at + PREFIX.length).trim() : trimmed
  return candidate.length === 0 ? null : candidate
}

/**
 * Read the seed from `location.hash` at boot (architecture §7 step 2).
 *
 * @returns {string|null} The seed, or `null` when the hash carries none.
 */
export function readSeedFromLocation() {
  return parseSeed(location.hash)
}

/**
 * @typedef {object} HashWriter
 * @property {() => void} notify   Call on every seed-affecting mutation.
 * @property {() => void} cancel   Drop any pending write.
 * @property {() => boolean} pending Whether a write is scheduled or in flight.
 */

/**
 * Create the debounced hash writer.
 *
 * `notify()` is cheap and called on every mutation; the expensive part —
 * encode + `replaceState` — runs once per idle gap. Because the encode is
 * async, two writes can theoretically race; a sequence counter lets only the
 * **latest** result land, so a slow early encode can never overwrite a fast
 * later one with a stale seed. An encode that rejects is swallowed: the hash
 * simply keeps its previous value, and the seed field's own error surface
 * (not the URL bar) is where encode problems belong.
 *
 * @param {() => Promise<string>} getSeed  Async producer of the current seed.
 * @param {{ delayMs?: number, apply?: (seed: string) => void }} [opts]
 *   `apply` defaults to `history.replaceState`; tests inject a recorder so
 *   running the suite does not rewrite the test page's own URL.
 * @returns {HashWriter}
 */
export function createHashWriter(getSeed, opts) {
  const delayMs = opts?.delayMs ?? WRITE_DELAY_MS
  const apply = opts?.apply ?? defaultApply
  let seq = 0
  let inFlight = 0

  const debounced = debounce(() => {
    const mySeq = ++seq
    inFlight++
    getSeed()
      .then((seed) => {
        if (mySeq === seq) apply(seed)
      })
      .catch(() => {
        // Encode failed — keep the previous hash. Reported elsewhere.
      })
      .finally(() => {
        inFlight--
      })
  }, delayMs)

  return {
    notify: () => { debounced() },
    cancel: () => { debounced.cancel() },
    pending: () => debounced.pending() || inFlight > 0,
  }
}

/**
 * The production `apply`: rewrite the fragment in place. `replaceState`
 * (never `pushState`) is the entire FR-13 history story.
 *
 * @param {string} seed
 */
function defaultApply(seed) {
  history.replaceState(null, '', PREFIX + seed)
}
