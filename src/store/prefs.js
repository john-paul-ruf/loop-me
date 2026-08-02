// @ts-check
/**
 * Device-local preferences (FR-0, FR-17; architecture §7 step 3).
 *
 * One blob under `KEYS.prefs`, two booleans. Both default `false`, and both
 * *fail* toward `false` — which is the safe direction for each: no splash
 * suppression means the photosensitivity warning shows; no motion opt-in
 * means reduced-motion users stay paused.
 *
 * **The FR-0 rule this module owns:** `get('suppressSplash')` returns `false`
 * whenever the persistent backend is unavailable — not merely "defaults to
 * false", but false *regardless of what the in-memory fallback holds*.
 * Suppression is a per-device promise ("on this device only"), and a device
 * that cannot persist the preference has never really made it. The failure
 * direction is toward the warning, never away from it (architecture §7).
 *
 * The stored blob is untrusted on read (it is user-editable via devtools and
 * survivable across app versions): anything that is not a boolean falls back
 * to the default, silently (FR-18 "recoverable inconsistencies repaired
 * silently").
 */

import { KEYS, getJson, setJson, isAvailable } from './local.js'

/**
 * Every preference and its default. Adding a preference means adding a line
 * here — `get`/`set` and the read-repair walk this object, nothing else.
 */
export const PREF_DEFAULTS = Object.freeze({
  /** FR-0: "Don't show this again on this device". */
  suppressSplash: false,
  /** FR-17: a reduced-motion user's explicit opt-in to autoplay. */
  reducedMotionOptIn: false,
})

/** @typedef {keyof typeof PREF_DEFAULTS} PrefName */

/**
 * Read the whole blob, repairing to defaults field-by-field.
 *
 * @returns {{ suppressSplash: boolean, reducedMotionOptIn: boolean }}
 */
function readAll() {
  const out = {
    suppressSplash: PREF_DEFAULTS.suppressSplash,
    reducedMotionOptIn: PREF_DEFAULTS.reducedMotionOptIn,
  }
  const raw = getJson(KEYS.prefs)
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const o = /** @type {Record<string, unknown>} */ (raw)
    if (typeof o.suppressSplash === 'boolean') out.suppressSplash = o.suppressSplash
    if (typeof o.reducedMotionOptIn === 'boolean') out.reducedMotionOptIn = o.reducedMotionOptIn
  }
  return out
}

/**
 * Read one preference. Never throws.
 *
 * @param {PrefName} name
 * @returns {boolean}
 */
export function get(name) {
  // The FR-0 rule: an unavailable backend means suppression is off, period —
  // even if a set() earlier this session landed in the memory fallback.
  if (name === 'suppressSplash' && !isAvailable()) return false
  return readAll()[name]
}

/**
 * Write one preference, preserving the others. Coerces to a strict boolean —
 * the blob never stores anything else.
 *
 * @param {PrefName} name
 * @param {boolean} value
 * @returns {boolean} Whether the write persisted.
 */
export function set(name, value) {
  const all = readAll()
  all[name] = value === true
  return setJson(KEYS.prefs, all)
}
