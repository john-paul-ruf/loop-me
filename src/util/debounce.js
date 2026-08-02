// @ts-check
/**
 * Trailing-edge debounce with a cancellable handle.
 *
 * The one caller that matters is the hash writer (architecture §9.6): 250 ms
 * of idle after the last mutation, then encode, then `history.replaceState`.
 * A slider drag fires dozens of mutations a second and must produce exactly
 * one history write, not dozens.
 */

/**
 * @typedef {object} DebouncedExtras
 * @property {() => void} cancel Drop any pending call. Safe to call at any time.
 * @property {() => void} flush  Run any pending call immediately.
 * @property {() => boolean} pending Whether a call is currently scheduled.
 */

/**
 * @typedef {((...args: any[]) => void) & DebouncedExtras} Debounced
 */

/**
 * @param {(...args: any[]) => void} fn The function to debounce.
 * @param {number} ms Idle milliseconds before `fn` runs.
 * @returns {Debounced}
 */
export function debounce(fn, ms) {
  /** @type {number} */
  let timer = 0
  /** @type {any[] | null} */
  let queued = null

  const invoke = () => {
    timer = 0
    const args = queued
    queued = null
    if (args !== null) fn(...args)
  }

  /** @type {any} */
  const wrapped = (/** @type {any[]} */ ...args) => {
    queued = args
    if (timer !== 0) clearTimeout(timer)
    timer = setTimeout(invoke, ms)
  }

  wrapped.cancel = () => {
    if (timer !== 0) clearTimeout(timer)
    timer = 0
    queued = null
  }

  wrapped.flush = () => {
    if (timer === 0) return
    clearTimeout(timer)
    invoke()
  }

  wrapped.pending = () => timer !== 0

  return /** @type {Debounced} */ (wrapped)
}
