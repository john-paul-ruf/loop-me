// @ts-check
/**
 * The local gallery of saved seeds (FR-14; specs/database.md).
 *
 * One JSON array under `KEYS.gallery`. An entry is
 * `{ id, seed, description, durationId, createdAt }` — `durationId` is stored
 * *alongside* the seed so the gallery can list durations without decoding
 * anything (FR-14: rows render from stored fields alone; nothing decodes a
 * seed until Load). Entries never reference a scheme by ID: the seed carries
 * embedded colours, which is what makes "deleting a custom scheme doesn't
 * break a saved entry" true structurally (FR-8 AC, database.md Integrity).
 *
 * Reads are forward-tolerant, mirroring the codec's posture (architecture
 * §9.5): a malformed entry is **skipped**, a repairable field is **clamped**,
 * and one bad record can never discard the rest of the gallery. Writes go
 * through `local.js`, so quota failure reports `STORAGE_QUOTA` and surfaces
 * as a `false`/`null` return — never a throw, never silence.
 *
 * Capacity: no hard cap. FR-14 requires *at least* 200 entries; the budget
 * (database.md: 200 × ~1.5 KB ≈ 300 KB against a ~5 MB origin quota) leaves
 * an order of magnitude of headroom, and the honest limit is the quota
 * itself, which already has an explicit failure path.
 */

import { KEYS, getJson, setJson } from './local.js'
import { clampInt } from '../util/clamp.js'

/**
 * @typedef {object} GalleryEntry
 * @property {string} id          Unique, opaque. Never derived from the seed.
 * @property {string} seed        The full seed string, exactly as encoded.
 * @property {string} description User-written; `''` when none (FR-14: optional).
 * @property {number} durationId  0 = 5s · 1 = 15s · 2 = 30s.
 * @property {number} createdAt   Epoch milliseconds.
 */

/** Export-blob format marker, so import can tell a gallery file from noise. */
export const EXPORT_FORMAT = 'loopme-gallery'
/** Export-blob version. Bump only with a documented migration. */
export const EXPORT_VERSION = 1

// ---------------------------------------------------------------------------
// Entry construction and repair
// ---------------------------------------------------------------------------

/** Monotonic per-session counter, so two saves in the same millisecond still
 *  get distinct ids. Cross-session uniqueness comes from the timestamp. */
let seq = 0

/** Last issued creation timestamp. */
let lastStamp = 0

/**
 * A strictly increasing creation timestamp. `Date.now()` normally, bumped by
 * 1 ms when two saves land in the same millisecond. Without this, same-ms
 * entries tie on `createdAt`, and after an export → import cycle (which
 * rewrites storage in *newest-first* blob order) the insertion-order
 * tie-break in `sortNewestFirst` would invert them — `list()` would return
 * a tied pair oldest-first on the importing device. Strict monotonicity
 * makes ordering a property of the data, not of storage order.
 *
 * @returns {number}
 */
function stamp() {
  const now = Date.now()
  lastStamp = now > lastStamp ? now : lastStamp + 1
  return lastStamp
}

/**
 * @param {number} createdAt
 * @returns {string}
 */
function makeId(createdAt) {
  seq += 1
  return 'g' + createdAt.toString(36) + '-' + seq.toString(36)
}

/**
 * Validate and repair one stored (or imported) entry.
 *
 * Skip-vs-clamp line: `id` and `seed` are the identity and the payload —
 * without either the entry is meaningless, so a missing/empty one is a skip.
 * `description`, `durationId`, `createdAt` are display metadata — repairable
 * to a harmless default.
 *
 * @param {unknown} v
 * @returns {GalleryEntry | null}
 */
function normalizeEntry(v) {
  if (typeof v !== 'object' || v === null) return null
  const o = /** @type {Record<string, unknown>} */ (v)
  if (typeof o.id !== 'string' || o.id.length === 0) return null
  if (typeof o.seed !== 'string' || o.seed.length === 0) return null
  const createdAt =
    typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) && o.createdAt >= 0
      ? Math.floor(o.createdAt)
      : 0
  return {
    id: o.id,
    seed: o.seed,
    description: typeof o.description === 'string' ? o.description : '',
    durationId: clampInt(typeof o.durationId === 'number' ? o.durationId : 0, 0, 2),
    createdAt,
  }
}

/** @returns {GalleryEntry[]} Validated entries, storage order (oldest first). */
function readAll() {
  const raw = getJson(KEYS.gallery)
  if (!Array.isArray(raw)) return []
  /** @type {GalleryEntry[]} */
  const out = []
  for (const v of raw) {
    const e = normalizeEntry(v)
    if (e !== null) out.push(e)
  }
  return out
}

/**
 * @param {GalleryEntry[]} entries
 * @returns {boolean}
 */
function writeAll(entries) {
  return setJson(KEYS.gallery, entries)
}

/**
 * Newest first (FR-14). `stamp()` makes locally-saved entries strictly
 * ordered by `createdAt`; ties can still arrive via an imported blob with
 * hand-equal timestamps. For those, the array is reversed *before* the
 * stable sort, so equal keys stay in reverse-insertion order — deterministic,
 * without a comparator tie-break on the base-36 id (which would order
 * `'10' < '2'` lexically and get it wrong).
 *
 * @param {GalleryEntry[]} entries
 * @returns {GalleryEntry[]}
 */
function sortNewestFirst(entries) {
  const rev = entries.slice().reverse()
  rev.sort((a, b) => b.createdAt - a.createdAt)
  return rev
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** @returns {GalleryEntry[]} All entries, newest first. */
export function list() {
  return sortNewestFirst(readAll())
}

/** @returns {number} */
export function count() {
  return readAll().length
}

/**
 * Save the current seed (FR-14). Returns the stored entry, or `null` when the
 * write failed — in which case `STORAGE_QUOTA` or `STORAGE_UNAVAILABLE` has
 * already been reported by the layer below; the caller only needs the null.
 *
 * @param {string} seed
 * @param {string} [description]
 * @param {number} [durationId]
 * @returns {GalleryEntry | null}
 */
export function save(seed, description, durationId) {
  if (typeof seed !== 'string' || seed.length === 0) return null
  const createdAt = stamp()
  /** @type {GalleryEntry} */
  const entry = {
    id: makeId(createdAt),
    seed,
    description: typeof description === 'string' ? description : '',
    durationId: clampInt(typeof durationId === 'number' ? durationId : 0, 0, 2),
    createdAt,
  }
  const entries = readAll()
  entries.push(entry)
  return writeAll(entries) ? entry : null
}

/**
 * Edit an entry's description (FR-14 Rename/Edit description).
 *
 * @param {string} id
 * @param {string} description `''` clears it.
 * @returns {boolean}
 */
export function rename(id, description) {
  const entries = readAll()
  const e = entries.find((x) => x.id === id)
  if (e === undefined) return false
  e.description = typeof description === 'string' ? description : ''
  return writeAll(entries)
}

/**
 * Delete an entry. (Confirmation is the UI's job — FR-14's inline confirm
 * lives in `ui/panels/gallery.js`, not here.)
 *
 * @param {string} id
 * @returns {boolean} `false` when no such entry, or the write failed.
 */
export function remove(id) {
  const entries = readAll()
  const next = entries.filter((x) => x.id !== id)
  if (next.length === entries.length) return false
  return writeAll(next)
}

/**
 * The whole gallery as a JSON string (FR-14 export). A text blob of seeds —
 * explicitly not an art export.
 *
 * @returns {string}
 */
export function exportJson() {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    entries: sortNewestFirst(readAll()),
  })
}

/**
 * Import a gallery blob (FR-14). Accepts the export shape or a bare entry
 * array. Each entry is validated and clamped individually; a malformed one is
 * skipped and counted, never allowed to abort the rest. Entries whose id
 * already exists are skipped, which makes re-importing a backup idempotent.
 *
 * @param {string} text
 * @returns {{ imported: number, skipped: number } | null}
 *   `null` when the text is not a gallery blob at all, or the final write
 *   failed (the storage layer has already reported why).
 */
export function importJson(text) {
  if (typeof text !== 'string') return null
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  /** @type {unknown[]} */
  let rawEntries
  if (Array.isArray(parsed)) {
    rawEntries = parsed
  } else if (typeof parsed === 'object' && parsed !== null) {
    const entries = /** @type {Record<string, unknown>} */ (parsed).entries
    if (!Array.isArray(entries)) return null
    rawEntries = entries
  } else {
    return null
  }

  const existing = readAll()
  const ids = new Set(existing.map((e) => e.id))
  let imported = 0
  let skipped = 0
  for (const v of rawEntries) {
    const e = normalizeEntry(v)
    if (e === null || ids.has(e.id)) {
      skipped += 1
      continue
    }
    ids.add(e.id)
    existing.push(e)
    imported += 1
  }

  if (imported > 0 && !writeAll(existing)) return null
  return { imported, skipped }
}
