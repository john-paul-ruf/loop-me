// @ts-check
/**
 * Guarded `localStorage` wrapper (architecture §1 Persistence, §12.2, FR-18).
 *
 * Every read and write in `store/*` funnels through this module, and this
 * module **never throws** — private browsing, a blocked origin, or a full
 * quota degrade the app, never crash it (FR-18: "With local storage blocked,
 * the app loads, renders, randomizes, and shares normally").
 *
 * Availability is decided by a probe at module load: write a canary, read it
 * back, delete it. On failure the backend degrades to an in-memory Map —
 * reads and writes keep working for the session, nothing persists, and
 * `STORAGE_UNAVAILABLE` is reported once so the UI can disable Save with an
 * explanation. A write that fails on an otherwise-working backend (quota)
 * reports `STORAGE_QUOTA` and returns `false` — an explicit signal, never a
 * silent failure (FR-14).
 *
 * This module also owns the keyspace (`specs/database.md`): four namespaced
 * keys, one owning module each, no shared writers. `KEYS.version` is the
 * storage-blob version — distinct from `SCHEMA_VERSION`, which versions the
 * seed wire format. No migrations exist; readers are forward-tolerant
 * (validate + repair + skip) rather than migrated.
 *
 * DAG: `store/*` depends on `core/*` and `util/*` only (architecture §3/§4).
 * This file imports `core/errors.js` and nothing else.
 */

import { report, STORAGE_UNAVAILABLE, STORAGE_QUOTA } from '../core/errors.js'

/**
 * The subset of the Storage interface this module needs. Letting tests pass
 * a stub is what makes "with `localStorage` stubbed to throw, every store
 * call still returns a sane value" (the C4 exit check) provable in a browser
 * whose real storage works fine.
 *
 * @typedef {object} StorageLike
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

// ---------------------------------------------------------------------------
// Keyspace (specs/database.md)
// ---------------------------------------------------------------------------

/**
 * The four keys, namespaced under `loopme:`. One owning module each:
 * `version` and the canary belong to this file; `prefs`, `gallery`, and
 * `schemes` belong to their namesake modules. No shared writers.
 */
export const KEYS = Object.freeze({
  version: 'loopme:v',
  prefs: 'loopme:prefs',
  gallery: 'loopme:gallery',
  schemes: 'loopme:schemes',
})

/**
 * Storage-blob version, written to `KEYS.version` on first successful
 * install. Bumping it means a migration exists; none do. Distinct from the
 * seed wire format's `SCHEMA_VERSION` (`src/version.js`) on purpose — the two
 * evolve independently.
 */
export const STORE_VERSION = 1

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

/**
 * An in-memory stand-in with Storage semantics. Values survive the session,
 * not a reload — which is exactly the FR-0 failure direction: a device that
 * cannot persist "don't show this again" sees the splash every load.
 *
 * @returns {StorageLike}
 */
function memoryBackend() {
  /** @type {Map<string, string>} */
  const m = new Map()
  return {
    getItem(key) {
      const v = m.get(key)
      return v === undefined ? null : v
    },
    setItem(key, value) {
      m.set(key, String(value))
    },
    removeItem(key) {
      m.delete(key)
    },
  }
}

/** @type {StorageLike} */
let backend = memoryBackend()

/** Whether the real (persistent) backend is in use. */
let available = false

/**
 * Write + read + delete a canary. Any throw, and any read that does not
 * echo the write, fails the probe.
 *
 * @param {StorageLike} storage
 * @returns {boolean}
 */
function probe(storage) {
  const canary = 'loopme:canary'
  try {
    storage.setItem(canary, '1')
    const ok = storage.getItem(canary) === '1'
    storage.removeItem(canary)
    return ok
  } catch {
    return false
  }
}

/**
 * Probe `storage` and install it as the backend; on failure (or `null`),
 * install a fresh in-memory fallback and report `STORAGE_UNAVAILABLE`.
 *
 * Called once at module load with the real `localStorage`. Also the test
 * seam: `tests/store.test.js` installs Map-backed and throwing stubs to
 * prove the degradation paths without touching the user's real storage.
 * "Reported once" is once per install — in production there is exactly one.
 *
 * @param {StorageLike | null} storage
 * @returns {boolean} The new availability.
 */
export function installBackend(storage) {
  if (storage !== null && probe(storage)) {
    backend = storage
    available = true
    ensureVersion()
  } else {
    backend = memoryBackend()
    available = false
    report(STORAGE_UNAVAILABLE, { probed: storage !== null })
  }
  return available
}

/** Write `STORE_VERSION` if no version marker exists. Never overwrites —
 *  a *newer* marker means a future app wrote here, and its data is handled
 *  by forward-tolerant reads, not destroyed by an old marker. */
function ensureVersion() {
  if (get(KEYS.version) === null) set(KEYS.version, String(STORE_VERSION))
}

/**
 * The stored version marker, or `null` if absent/unreadable.
 * @returns {number | null}
 */
export function storedVersion() {
  const raw = get(KEYS.version)
  if (raw === null) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Is the persistent backend in use? `false` means the in-memory fallback.
 * `prefs.js` leans on this for the FR-0 rule; the UI uses it to disable Save.
 *
 * @returns {boolean}
 */
export function isAvailable() {
  return available
}

// ---------------------------------------------------------------------------
// Fenced primitives
// ---------------------------------------------------------------------------

/**
 * Read a raw string. Never throws; failure reads as absence.
 *
 * @param {string} key
 * @returns {string | null}
 */
export function get(key) {
  try {
    return backend.getItem(key)
  } catch {
    return null
  }
}

/**
 * Write a raw string. A throw — quota, in practice, since the backend passed
 * the probe — reports `STORAGE_QUOTA` and returns `false` (FR-14: "quota
 * exhaustion produces a clear message, not a silent failure").
 *
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function set(key, value) {
  try {
    backend.setItem(key, value)
    return true
  } catch {
    report(STORAGE_QUOTA, { key })
    return false
  }
}

/**
 * Delete a key. Never throws.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function remove(key) {
  try {
    backend.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * Read and parse a JSON blob. A missing key, an unreadable backend, and a
 * malformed blob are indistinguishable to the caller — all `null` — because
 * every caller's recovery is the same: fall back to the empty shape and let
 * the next write repair the record.
 *
 * @param {string} key
 * @returns {unknown} Parsed value, or `null`.
 */
export function getJson(key) {
  const raw = get(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Serialize and write a JSON blob.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean}
 */
export function setJson(key, value) {
  /** @type {string | undefined} */
  let raw
  try {
    raw = JSON.stringify(value)
  } catch {
    return false
  }
  // JSON.stringify(undefined) returns undefined, not a string.
  if (typeof raw !== 'string') return false
  return set(key, raw)
}

// ---------------------------------------------------------------------------
// Module load: probe the real localStorage
// ---------------------------------------------------------------------------

/**
 * Even *touching* `globalThis.localStorage` can throw under some privacy
 * settings (SecurityError on access, not on use) — hence the fence around the
 * property read itself, separate from the probe.
 *
 * @returns {StorageLike | null}
 */
function detectLocalStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

installBackend(detectLocalStorage())
