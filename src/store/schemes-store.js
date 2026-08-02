// @ts-check
/**
 * Custom scheme CRUD (FR-8; specs/database.md).
 *
 * One JSON array under `KEYS.schemes`. A stored scheme is
 * `{ id, name, colors, neutrals, backgrounds }`, every bucket 1–8 colours in
 * `#RRGGBB` uppercase — **deliberately the exact in-memory shape
 * `model/schemes.js` uses**, so a stored scheme passes `isValidScheme` and
 * flows into `buildPalette` with no conversion layer. The store cannot
 * *import* the model to guarantee that (architecture §4: `store` depends on
 * `core` only), so the shape agreement is pinned by `tests/store.test.js`
 * cross-checking a created scheme against `isValidScheme` instead.
 *
 * Validation posture differs by direction, matching the project's
 * errors-are-data rule:
 *
 * - **Writes** (`create`/`update`) are author input from the UI — invalid
 *   input is *rejected* (`null`), because FR-8 says a bucket outside 1–8 or
 *   an empty name must be refused, not repaired behind the user's back.
 * - **Reads** are semi-trusted stored data — a malformed record is *skipped*,
 *   and one bad record never discards the library (FR-18).
 *
 * Deleting a scheme can never break a saved gallery entry: entries carry the
 * colours embedded in their seed and never reference a scheme by id
 * (database.md Integrity, FR-8 AC).
 */

import { KEYS, getJson, setJson } from './local.js'

/**
 * @typedef {object} StoredScheme
 * @property {string} id            Unique, opaque, `s`-prefixed.
 * @property {string} name          Non-empty, trimmed.
 * @property {string[]} colors      1–8 × `#RRGGBB` (vivid).
 * @property {string[]} neutrals    1–8 × `#RRGGBB`.
 * @property {string[]} backgrounds 1–8 × `#RRGGBB`.
 */

/** Bucket size bounds (FR-8: "Each bucket accepts 1–8 colors"). */
export const BUCKET_MIN = 1
export const BUCKET_MAX = 8

/** Six hexadecimal characters, case-insensitive. */
const HEX_RE = /^[0-9A-Fa-f]{6}$/

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * `'#ff2e88'` / `'FF2E88'` → `'#FF2E88'`; anything else → `null`.
 * Same normal form as `model/schemes.js` — see the module note.
 *
 * @param {unknown} c
 * @returns {string | null}
 */
function normalizeColor(c) {
  if (typeof c !== 'string') return null
  const hex = c.startsWith('#') ? c.slice(1) : c
  return HEX_RE.test(hex) ? '#' + hex.toUpperCase() : null
}

/**
 * A whole bucket, or `null` if the length is outside 1–8 or any colour is
 * invalid. All-or-nothing: a bucket with one bad colour is a rejected write,
 * not a silently shorter bucket.
 *
 * @param {unknown} arr
 * @returns {string[] | null}
 */
function normalizeBucket(arr) {
  if (!Array.isArray(arr)) return null
  if (arr.length < BUCKET_MIN || arr.length > BUCKET_MAX) return null
  /** @type {string[]} */
  const out = []
  for (const c of arr) {
    const n = normalizeColor(c)
    if (n === null) return null
    out.push(n)
  }
  return out
}

/**
 * Read-path repair: a stored record either normalises completely or is
 * skipped. (No field-level repair here — unlike a gallery entry, a scheme
 * with a missing bucket has no harmless default; inventing colours would
 * repaint the user's palette, which is the one thing FR-8 exists to prevent.)
 *
 * @param {unknown} v
 * @returns {StoredScheme | null}
 */
function normalizeStored(v) {
  if (typeof v !== 'object' || v === null) return null
  const o = /** @type {Record<string, unknown>} */ (v)
  if (typeof o.id !== 'string' || o.id.length === 0) return null
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name.length === 0) return null
  const colors = normalizeBucket(o.colors)
  const neutrals = normalizeBucket(o.neutrals)
  const backgrounds = normalizeBucket(o.backgrounds)
  if (colors === null || neutrals === null || backgrounds === null) return null
  return { id: o.id, name, colors, neutrals, backgrounds }
}

/** @returns {StoredScheme[]} Storage order (creation order). */
function readAll() {
  const raw = getJson(KEYS.schemes)
  if (!Array.isArray(raw)) return []
  /** @type {StoredScheme[]} */
  const out = []
  for (const v of raw) {
    const s = normalizeStored(v)
    if (s !== null) out.push(s)
  }
  return out
}

/**
 * @param {StoredScheme[]} schemes
 * @returns {boolean}
 */
function writeAll(schemes) {
  return setJson(KEYS.schemes, schemes)
}

/** Same-millisecond disambiguator; see gallery.js. */
let seq = 0

/**
 * @param {number} now
 * @returns {string}
 */
function makeId(now) {
  seq += 1
  return 's' + now.toString(36) + '-' + seq.toString(36)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** @returns {StoredScheme[]} All custom schemes, creation order. */
export function list() {
  return readAll()
}

/**
 * @param {string} id
 * @returns {StoredScheme | null}
 */
export function get(id) {
  const s = readAll().find((x) => x.id === id)
  return s === undefined ? null : s
}

/**
 * Create a scheme (FR-8). Also the landing point for a recipient's explicit
 * "Save this scheme" on an embedded custom scheme — the model's in-memory
 * `Scheme` shape is accepted as-is (its `id` field, if any, is ignored; the
 * store issues its own).
 *
 * @param {{ name?: unknown, colors?: unknown, neutrals?: unknown, backgrounds?: unknown }} fields
 * @returns {StoredScheme | null} `null` when invalid or the write failed.
 */
export function create(fields) {
  if (typeof fields !== 'object' || fields === null) return null
  const name = typeof fields.name === 'string' ? fields.name.trim() : ''
  if (name.length === 0) return null
  const colors = normalizeBucket(fields.colors)
  const neutrals = normalizeBucket(fields.neutrals)
  const backgrounds = normalizeBucket(fields.backgrounds)
  if (colors === null || neutrals === null || backgrounds === null) return null
  /** @type {StoredScheme} */
  const scheme = { id: makeId(Date.now()), name, colors, neutrals, backgrounds }
  const all = readAll()
  all.push(scheme)
  return writeAll(all) ? scheme : null
}

/**
 * Update a scheme in place. Omitted fields keep their current value; a
 * *present but invalid* field rejects the whole update — partial application
 * of a half-valid edit would leave the library in a state the user never
 * authored.
 *
 * @param {string} id
 * @param {{ name?: unknown, colors?: unknown, neutrals?: unknown, backgrounds?: unknown }} fields
 * @returns {StoredScheme | null} The updated scheme, or `null`.
 */
export function update(id, fields) {
  if (typeof fields !== 'object' || fields === null) return null
  const all = readAll()
  const idx = all.findIndex((x) => x.id === id)
  if (idx === -1) return null
  const cur = all[idx]

  let name = cur.name
  if (fields.name !== undefined) {
    name = typeof fields.name === 'string' ? fields.name.trim() : ''
    if (name.length === 0) return null
  }
  const colors = fields.colors === undefined ? cur.colors : normalizeBucket(fields.colors)
  const neutrals = fields.neutrals === undefined ? cur.neutrals : normalizeBucket(fields.neutrals)
  const backgrounds =
    fields.backgrounds === undefined ? cur.backgrounds : normalizeBucket(fields.backgrounds)
  if (colors === null || neutrals === null || backgrounds === null) return null

  /** @type {StoredScheme} */
  const next = { id: cur.id, name, colors, neutrals, backgrounds }
  all[idx] = next
  return writeAll(all) ? next : null
}

/**
 * Delete a scheme (FR-8). Saved gallery entries are unaffected by
 * construction — see the module note.
 *
 * @param {string} id
 * @returns {boolean} `false` when no such scheme, or the write failed.
 */
export function remove(id) {
  const all = readAll()
  const next = all.filter((x) => x.id !== id)
  if (next.length === all.length) return false
  return writeAll(next)
}
