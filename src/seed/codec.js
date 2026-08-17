// @ts-check
/**
 * The seed codec (FR-12, FR-13, architecture §9).
 *
 * A seed is `<version><flag><payload>`: one version character, `z` (deflated)
 * or `p` (plain), then unpadded base64url. The payload is JSON of a
 * **positional array** — no object keys — whose field order is derived from
 * each layer type's param declarations (§5.2), so the codec never hard-codes
 * a layer's shape.
 *
 * §9.2 extension — the top-level array has an optional fifth element
 * `arr[4]`: an integer hidden-layer bitmask, bit *w* set = wire layer *w* is
 * hidden. Emitted only when non-zero, so an all-visible composition encodes
 * byte-identically to a pre-visibility build (§9.5 forward-tolerance rule).
 * Old builds read indices 0–3 and ignore it; missing/malformed decodes as 0.
 *
 * Forward tolerance (§9.5) is split across two modules on purpose:
 *   - *structure* tolerance lives here (unknown trailing elements ignored,
 *     missing trailing filled, unknown layer type skipped with a warning,
 *     unknown version rejected — the one hard failure);
 *   - *value* repair is `model/composition.js`'s `clampComposition`, the
 *     single untrusted-input pass — this codec never re-implements a clamp.
 *
 * Error posture: `decode()` **reports** every failure on the channel (so the
 * FR-18 banner works no matter who called) and then **throws `AppError`** so
 * the caller knows to fall back to randomize (architecture §7 boot step 4).
 * `fromArray()` throws without reporting; `decode()` reports on its behalf —
 * one report per failure, never two.
 *
 * Imports: `version.js`, `core/errors.js`, `model/*` (registry, composition,
 * schemes, params), `util/*`, and the sibling `base64url.js` / `deflate.js`.
 * `seed` sits below `model` in the DAG (§4) — all edges point the right way.
 */

import { SCHEMA_VERSION } from '../version.js'
import {
  AppError,
  report,
  SEED_VERSION,
  SEED_MALFORMED,
  SEED_TRUNCATED,
  SEED_TOO_LONG,
  LAYER_UNKNOWN_TYPE,
} from '../core/errors.js'
import { get as getLayer } from '../model/registry.js'
import { clampComposition } from '../model/composition.js'
import { normalizeScheme, BUILTINS } from '../model/schemes.js'
import { isAnimatable, enumIndex, enumValue } from '../model/params.js'
import { qArray } from '../util/quantize.js'
import { clampInt } from '../util/clamp.js'
import { bytesToB64url, b64urlToBytes } from './base64url.js'
import { canDeflate, deflate, inflate } from './deflate.js'

/**
 * @typedef {import('../model/params.js').Composition} Composition
 * @typedef {import('../model/params.js').Layer} Layer
 * @typedef {import('../model/params.js').AnimValue} AnimValue
 * @typedef {import('../model/params.js').Scheme} Scheme
 * @typedef {import('../model/params.js').ParamValue} ParamValue
 */

/** Encode warns above this many characters (FR-12, architecture §9.4). */
export const SEED_HARD_WARN = 4000

// ---------------------------------------------------------------------------
// toArray — Composition → positional array (architecture §9.2)
// ---------------------------------------------------------------------------

/**
 * Strip the in-memory `#` from one bucket for the wire.
 *
 * @param {readonly string[]} bucket
 * @returns {string[]}
 */
function bucketToWire(bucket) {
  return bucket.map((c) => (c.startsWith('#') ? c.slice(1) : c))
}

/**
 * One `AnimValue` → the wire 4-tuple `[min, max, times, algorithmId]`.
 *
 * @param {AnimValue} a
 * @returns {number[]}
 */
function animToWire(a) {
  return [a.min, a.max, a.times, a.algorithm]
}

/**
 * Composition → the quantized pre-encoding array
 * `[ schemaVersion, durationId, scheme, [ layer… ] ]`.
 *
 * A layer whose type is not registered cannot be flattened (its param order
 * is unknowable) — it is skipped with a `LAYER_UNKNOWN_TYPE` report. That is
 * unreachable for any composition that went through `clampComposition`, but
 * encode is a public API and refusing to emit garbage beats trusting every
 * caller forever.
 *
 * @param {Composition} c
 * @returns {unknown[]}
 */
export function toArray(c) {
  /** @type {unknown} */
  let schemeWire
  if (typeof c.scheme === 'number') {
    schemeWire = c.scheme
  } else {
    schemeWire = [
      c.scheme.name,
      bucketToWire(c.scheme.colors),
      bucketToWire(c.scheme.neutrals),
      bucketToWire(c.scheme.backgrounds),
    ]
  }

  /** @type {unknown[]} */
  const layers = []
  let hiddenMask = 0
  for (const layer of c.layers) {
    const mod = getLayer(layer.type)
    if (mod === null) {
      report(LAYER_UNKNOWN_TYPE, { typeId: layer.type, at: 'encode' })
      continue
    }
    // Mask against the EMITTED wire index — an unknown-type layer is skipped
    // above, and its bit must be skipped with it (§9.2 extension).
    if (layer.visible === false) hiddenMask |= (1 << layers.length)
    /** @type {unknown[]} */
    const wire = [layer.type, layer.blend, layer.rngSeed, layer.color, animToWire(layer.opacity)]
    for (const decl of mod.params) {
      const v = layer.params[decl.name]
      if (isAnimatable(decl)) {
        wire.push(animToWire(/** @type {AnimValue} */ (v)))
      } else if (decl.kind === 'enum') {
        wire.push(enumIndex(decl, /** @type {string|number} */ (v)))
      } else {
        wire.push(v)
      }
    }
    layers.push(wire)
  }

  /** @type {unknown[]} */
  const out = [SCHEMA_VERSION, c.durationId, schemeWire, layers]
  // §9.2 extension: hidden-layer bitmask emitted only when non-zero so an
  // all-visible composition encodes byte-identically to a pre-visibility
  // build. Old builds read indices 0–3 and ignore this (§9.5).
  if (hiddenMask !== 0) out.push(hiddenMask)
  return qArray(out)
}

// ---------------------------------------------------------------------------
// fromArray — positional array → Composition (architecture §9.5)
// ---------------------------------------------------------------------------

/**
 * Wire value → `AnimValue`-shaped object, structurally only.
 *
 * No validation here: `clampComposition` is the value-repair pass, and it
 * already coerces a missing field, a non-number, or an out-of-bounds value.
 * A non-array wire value passes through raw for the same reason — the clamp
 * coerces non-objects to the declared default.
 *
 * @param {unknown} v
 * @returns {unknown}
 */
function wireToAnim(v) {
  if (!Array.isArray(v)) return v
  return { min: v[0], max: v[1], times: v[2], algorithm: v[3] }
}

/**
 * Positional array → repaired `Composition`.
 *
 * Throws `AppError` (`SEED_VERSION` for an unrecognized version — the only
 * hard failure — or `SEED_TRUNCATED` when the shape decoded but the content
 * is missing). Reports `LAYER_UNKNOWN_TYPE` for each skipped layer and keeps
 * going (§9.5). Everything that survives is passed through
 * `clampComposition`, so the return value is always renderable.
 *
 * @param {unknown} arr
 * @returns {Composition}
 */
export function fromArray(arr) {
  if (!Array.isArray(arr) || arr.length < 4) {
    throw new AppError(SEED_TRUNCATED, 'seed array is not [version, duration, scheme, layers]')
  }

  const version = arr[0]
  if (String(version) !== SCHEMA_VERSION) {
    throw new AppError(SEED_VERSION, `unrecognized seed version "${String(version)}"`, {
      version: String(version),
      expected: SCHEMA_VERSION,
    })
  }

  // Scheme: built-in index (clamped), embedded custom array, or repaired to 0.
  /** @type {number|Scheme} */
  let scheme
  const rawScheme = arr[2]
  if (typeof rawScheme === 'number') {
    scheme = clampInt(rawScheme, 0, BUILTINS.length - 1)
  } else if (Array.isArray(rawScheme)) {
    scheme = normalizeScheme({
      id: 'custom',
      name: rawScheme[0],
      colors: rawScheme[1],
      neutrals: rawScheme[2],
      backgrounds: rawScheme[3],
    })
  } else {
    scheme = 0
  }

  const rawLayers = arr[3]
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    throw new AppError(SEED_TRUNCATED, 'seed carries no layers')
  }

  // §9.2 extension: optional arr[4] = hidden-layer bitmask, bit w = wire
  // layer w. Absent or malformed decodes as 0 (all visible) — the §9.5
  // failure direction (renders the author's full art).
  const rawMask = arr[4]
  const hiddenMask = typeof rawMask === 'number' && Number.isInteger(rawMask) && rawMask > 0
    ? rawMask
    : 0

  /** @type {Layer[]} */
  const layers = []
  for (let w = 0; w < rawLayers.length; w++) {
    const entry = rawLayers[w]
    if (!Array.isArray(entry)) continue // structural noise — nothing to salvage

    const typeId = entry[0]
    const mod = typeof typeId === 'number' ? getLayer(typeId) : null
    if (mod === null) {
      // Unknown layer type: skip it, warn, render the rest (§9.5, FR-18).
      report(LAYER_UNKNOWN_TYPE, { typeId })
      continue
    }

    /** @type {Record<string, ParamValue>} */
    const params = {}
    for (let i = 0; i < mod.params.length; i++) {
      const decl = mod.params[i]
      const v = entry[5 + i] // undefined when missing trailing → clamp fills default
      if (v === undefined) continue
      if (isAnimatable(decl)) {
        params[decl.name] = /** @type {ParamValue} */ (wireToAnim(v))
      } else if (decl.kind === 'enum' && typeof v === 'number') {
        params[decl.name] = enumValue(decl, v)
      } else {
        params[decl.name] = /** @type {ParamValue} */ (v)
      }
    }
    // Elements past 5 + params.length are unknown trailing data from a newer
    // build of this layer — ignored by construction of the loop above.

    layers.push(/** @type {Layer} */ ({
      type: typeId,
      blend: entry[1],
      rngSeed: entry[2],
      color: entry[3],
      opacity: wireToAnim(entry[4]),
      visible: (hiddenMask & (1 << w)) === 0,
      params,
    }))
  }

  if (layers.length === 0) {
    // Every layer was unknown or noise. The individual warnings are already
    // reported; the composition itself has no renderable content, which is
    // the "shape decoded but the content is missing" failure.
    throw new AppError(SEED_TRUNCATED, 'no renderable layers in seed')
  }

  /** @type {Composition} */
  const c = { durationId: /** @type {number} */ (arr[1]), scheme, layers }
  clampComposition(c)
  return c
}

// ---------------------------------------------------------------------------
// encode / decode — the async pipeline (architecture §9.4)
// ---------------------------------------------------------------------------

/**
 * Report a decode failure and throw it. One call site per failure keeps the
 * report-then-throw contract impossible to half-follow.
 *
 * @param {string} code
 * @param {string} message
 * @param {unknown} [detail]
 * @returns {never}
 */
function fail(code, message, detail) {
  report(code, detail === undefined ? message : detail)
  throw new AppError(code, message, detail)
}

/**
 * Composition → seed string `"1z…"` / `"1p…"`.
 *
 * Uses the `z` path when the engine can deflate, `p` otherwise; `compress:
 * false` forces `p` (this is also how the passthrough path stays testable on
 * a deflate-capable engine). A probe that passed but a stream that throws
 * anyway falls back to `p` rather than failing the share. Reports
 * `SEED_TOO_LONG` above 4,000 characters — sharing is warned about, never
 * blocked (§12.2).
 *
 * @param {Composition} c
 * @param {{ compress?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function encode(c, opts) {
  const json = JSON.stringify(toArray(c))
  const bytes = new TextEncoder().encode(json)

  /** @type {string} */
  let seed
  if (canDeflate() && opts?.compress !== false) {
    try {
      seed = SCHEMA_VERSION + 'z' + bytesToB64url(await deflate(bytes))
    } catch {
      seed = SCHEMA_VERSION + 'p' + bytesToB64url(bytes)
    }
  } else {
    seed = SCHEMA_VERSION + 'p' + bytesToB64url(bytes)
  }

  if (seed.length > SEED_HARD_WARN) {
    report(SEED_TOO_LONG, { length: seed.length, limit: SEED_HARD_WARN })
  }
  return seed
}

/**
 * Seed string → repaired `Composition`.
 *
 * Accepts surrounding whitespace (the Paste Seed path hands strings straight
 * in). Every failure is reported on the channel *and* thrown as `AppError`:
 * `SEED_VERSION` for an unrecognized version, `SEED_TRUNCATED` for a shape
 * with no content, `SEED_MALFORMED` for everything the wire can mangle
 * (alphabet, inflate, JSON, structure). The caller's recovery is uniform —
 * catch, fall through to randomize (architecture §7 step 4).
 *
 * @param {string} seedString
 * @returns {Promise<Composition>}
 */
export async function decode(seedString) {
  const s = typeof seedString === 'string' ? seedString.trim() : ''
  if (s.length < 3) {
    fail(SEED_MALFORMED, 'seed is empty or too short to carry a payload', { length: s.length })
  }

  if (s[0] !== SCHEMA_VERSION) {
    fail(SEED_VERSION, `unrecognized seed version "${s[0]}"`, {
      version: s[0],
      expected: SCHEMA_VERSION,
    })
  }

  const flag = s[1]
  if (flag !== 'z' && flag !== 'p') {
    fail(SEED_MALFORMED, `unrecognized compression flag "${flag}"`, { flag })
  }

  /** @type {Uint8Array} */
  let bytes
  try {
    bytes = b64urlToBytes(s.slice(2))
  } catch {
    fail(SEED_MALFORMED, 'seed payload is not base64url', { stage: 'base64url' })
  }

  if (flag === 'z') {
    try {
      bytes = await inflate(bytes)
    } catch {
      // Corrupted stream, truncated stream, or an engine with no
      // DecompressionStream — all indistinguishable to the user, all the
      // same recovery.
      fail(SEED_MALFORMED, 'seed payload failed to decompress', { stage: 'inflate' })
    }
  }

  /** @type {unknown} */
  let arr
  try {
    arr = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    fail(SEED_MALFORMED, 'seed payload is not valid JSON', { stage: 'json' })
  }

  try {
    return fromArray(arr)
  } catch (e) {
    if (e instanceof AppError) {
      // fromArray throws without reporting; decode owns the report so there
      // is exactly one per failure regardless of entry point.
      report(e.code, e.detail ?? e.message)
      throw e
    }
    fail(SEED_MALFORMED, 'seed structure could not be read', { stage: 'fromArray' })
  }
}
