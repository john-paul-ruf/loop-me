// @ts-check
/**
 * Colour schemes and scheme-reference resolution (FR-7, architecture §9.2).
 *
 * A scheme is a named palette split into three buckets — **colour**, **neutral**,
 * **background** — each holding 1–8 hex colours. Eight ship built-in (FR-7,
 * grown from four by omni-wave S05); users can author custom ones that travel
 * embedded inside a seed (FR-8).
 *
 * A layer's `color` field is a **scheme reference**: either a bucket letter
 * plus a selector (`"c3"` → `colours[3 % colours.length]`), or a pinned 6-char
 * hex literal (`"FF2E88"`) that survives scheme changes untouched. The two
 * forms are distinguished by shape — length 6 and all-hex ⇒ pinned, anything
 * else ⇒ bucket ref (architecture §9.2).
 *
 * ## Why resolution is deterministic
 *
 * Architecture §9.2 pins the rule: `bucket[selector % bucket.length]`. No PRNG
 * participates in resolution. The selector *is* the deterministic index; it was
 * chosen by the randomizer (which does use the PRNG) and stored in the seed.
 * Resolution at render time is a pure function of (scheme, ref) — which is what
 * makes "changing scheme re-resolves every layer's colours without altering any
 * other parameter" (FR-7) fall out for free, and what makes a pinned colour
 * survive a scheme change untouched.
 *
 * Imports `util/clamp.js` only.
 */

import { clamp } from '../util/clamp.js'

/**
 * @typedef {import('./params.js').Scheme} Scheme
 * @typedef {import('./params.js').Layer} Layer
 * @typedef {import('./params.js').Palette} Palette
 */

// ---------------------------------------------------------------------------
// Built-in schemes (FR-7)
//
// Colours are stored WITH the leading `#` in memory (per the Scheme typedef:
// "in memory they carry it"). The wire format omits `#`; the codec handles
// the conversion at the `toArray` / `fromArray` boundary.
// ---------------------------------------------------------------------------

/** @type {Scheme} */
const NEON_NIGHT = Object.freeze({
  id: 'builtin-0',
  name: 'Neon Night',
  colors: Object.freeze(['#FF2E88', '#00E5FF', '#7C4DFF', '#00FFA3', '#FFD400']),
  neutrals: Object.freeze(['#FFFFFF', '#B0B6C0', '#2A2E37']),
  backgrounds: Object.freeze(['#07060D', '#120B1F']),
})

/** @type {Scheme} */
const SOLAR_FLARE = Object.freeze({
  id: 'builtin-1',
  name: 'Solar Flare',
  colors: Object.freeze(['#FF6B00', '#FFB300', '#E4002B', '#FFE066', '#FF3D57']),
  neutrals: Object.freeze(['#F5EFE0', '#8A7F6B', '#241C12']),
  backgrounds: Object.freeze(['#120A05', '#1E0D06']),
})

/** @type {Scheme} */
const DEEP_SEA = Object.freeze({
  id: 'builtin-2',
  name: 'Deep Sea',
  colors: Object.freeze(['#00C2A8', '#2E7DFF', '#5EEAD4', '#0E7490', '#A5F3FC']),
  neutrals: Object.freeze(['#E8F1F5', '#64748B', '#111C26']),
  backgrounds: Object.freeze(['#03080E', '#061826']),
})

/** @type {Scheme} */
const BONE_AND_INK = Object.freeze({
  id: 'builtin-3',
  name: 'Bone & Ink',
  colors: Object.freeze(['#C0492B', '#8C6A3F', '#3F5E5A', '#A8452C']),
  neutrals: Object.freeze(['#EDE6D8', '#9A9287', '#3A3733', '#141312']),
  backgrounds: Object.freeze(['#0E0D0C', '#EDE6D8']),
})

// omni-wave S05 — four appended built-ins (4–7). Append-only: existing indices
// 0–3 unchanged, so pre-omni seeds carrying scheme 0–3 render pixel-identical.
// Inner Object.freeze wrapper cast to Scheme so readonly bucket arrays satisfy
// the mutable-string[] slots in the typedef without adding NEW typecheck errors
// (the 5 pre-existing TS2322 hits on NEON_NIGHT..BONE_AND_INK + normalizeScheme
// are the baseline; append-only schemes must not grow that count).

const VAPORWAVE = /** @type {Scheme} */ (Object.freeze({
  id: 'builtin-4',
  name: 'Vaporwave',
  colors: Object.freeze(['#FF71CE', '#01CDFE', '#05FFA1', '#B967FF', '#FFFB96']),
  neutrals: Object.freeze(['#F8F8FF', '#9BA0C0', '#2E2A4A']),
  backgrounds: Object.freeze(['#170F2E', '#0D0A1E']),
}))

const CRT_PHOSPHOR = /** @type {Scheme} */ (Object.freeze({
  id: 'builtin-5',
  name: 'CRT Phosphor',
  colors: Object.freeze(['#33FF66', '#A8FF60', '#FFB000', '#00D8FF']),
  neutrals: Object.freeze(['#D8FFE0', '#6FA07C', '#16301E']),
  backgrounds: Object.freeze(['#020A04', '#061206']),
}))

const RISO_PRINT = /** @type {Scheme} */ (Object.freeze({
  id: 'builtin-6',
  name: 'Riso Print',
  colors: Object.freeze(['#FF48B0', '#0078BF', '#FF6C2F', '#FFE800', '#00A95C']),
  neutrals: Object.freeze(['#FFF9F0', '#C7BEB2', '#3A3633']),
  backgrounds: Object.freeze(['#F4EFE6', '#EDE4D4']),
}))

const INFRARED = /** @type {Scheme} */ (Object.freeze({
  id: 'builtin-7',
  name: 'Infrared',
  colors: Object.freeze(['#3D0F5E', '#B3005E', '#FF3D00', '#FF9E00', '#FFE28A']),
  neutrals: Object.freeze(['#FFF3E0', '#A88C9E', '#2B1B33']),
  backgrounds: Object.freeze(['#0C0514', '#180A26']),
}))

/**
 * The eight built-in schemes, in the exact order FR-7 lists them (extended by
 * omni-wave S05 with builtin-4…builtin-7).
 *
 * A composition's `scheme` field stores either an index into this array (0–7)
 * or a full embedded `Scheme` object for a custom palette (FR-8). The index is
 * what the seed carries for built-ins; it is **not** an append-only ID — adding
 * a ninth built-in is a schema-visible change but does not break old seeds,
 * because an out-of-range index clamps to the last available built-in (FR-18).
 *
 * Riso Print (builtin-6) is the first light-background built-in — its papers
 * are legible against the app chrome, but consumers rendering role dots or
 * splash text over the raw scheme background must use one of its neutrals for
 * ink, not assume a dark backdrop.
 *
 * @type {readonly Scheme[]}
 */
export const BUILTINS = Object.freeze([
  NEON_NIGHT, SOLAR_FLARE, DEEP_SEA, BONE_AND_INK,
  VAPORWAVE, CRT_PHOSPHOR, RISO_PRINT, INFRARED,
])

// ---------------------------------------------------------------------------
// Colour-ref parsing
// ---------------------------------------------------------------------------

/** Six hexadecimal characters, case-insensitive. */
const HEX_RE = /^[0-9A-Fa-f]{6}$/

/** First character → bucket property name on a Scheme. */
const BUCKET_MAP = Object.freeze(
  /** @type {Record<string, 'colors'|'neutrals'|'backgrounds'>} */ ({
    c: 'colors',
    n: 'neutrals',
    b: 'backgrounds',
  }),
)

// ---------------------------------------------------------------------------
// Scheme normalisation (for custom schemes arriving from a decoded seed)
// ---------------------------------------------------------------------------

/**
 * Normalise a single colour to `#RRGGBB` form.
 *
 * Wire colours are 6 hex chars without `#`; in-memory colours carry it. An
 * invalid colour (not 6 hex digits) is replaced with `#000000` rather than
 * propagating garbage to the canvas — FR-18's "recoverable inconsistencies
 * repaired silently".
 *
 * @param {unknown} c
 * @returns {string}
 */
function normalizeColor(c) {
  if (typeof c !== 'string') return '#000000'
  const hex = c.startsWith('#') ? c.slice(1) : c
  if (HEX_RE.test(hex)) return '#' + hex.toUpperCase()
  return '#000000'
}

/**
 * Parse a user-typed hex colour to canonical `#RRGGBB`, or `null` if invalid.
 *
 * Forgiving: optional leading `#`, any case, and 3-digit shorthand
 * (`abc` → `AABBCC`). **No alpha** — 8-digit input is rejected, because the
 * seed's pinned-literal rule (`resolveRef`) and the RGB-parsing painters
 * (`grain.js`/`vignette-wash.js`/`fuzz-flare.js`) assume exactly 6 hex digits
 * (transparency is the opacity band, not colour alpha). Reuses `HEX_RE` so
 * validation matches `normalizeColor`/`isValidScheme` exactly (one contract).
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function parseHexColor(raw) {
  if (typeof raw !== 'string') return null
  let hex = raw.trim()
  if (hex.startsWith('#')) hex = hex.slice(1)
  if (/^[0-9A-Fa-f]{3}$/.test(hex)) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  if (!HEX_RE.test(hex)) return null
  return '#' + hex.toUpperCase()
}

/**
 * Normalise a bucket: 1–8 entries, each a valid `#RRGGBB` string.
 *
 * @param {unknown} arr
 * @param {string} fallback
 * @returns {readonly string[]}
 */
function normalizeBucket(arr, fallback) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return Object.freeze([fallback])
  }
  const normalized = arr.slice(0, 8).map(normalizeColor)
  return Object.freeze(normalized.length > 0 ? normalized : [fallback])
}

/**
 * Normalise a custom scheme object arriving from a decoded seed.
 *
 * Wire colours lack the leading `#`; this adds them. Buckets are clamped to
 * 1–8 entries with a sensible fallback if empty or missing. The result is a
 * frozen `Scheme` ready for resolution.
 *
 * @param {unknown} s
 * @returns {Scheme}
 */
export function normalizeScheme(s) {
  if (typeof s !== 'object' || s === null) {
    return BUILTINS[0]
  }
  const o = /** @type {Record<string, unknown>} */ (s)
  return Object.freeze({
    id: typeof o.id === 'string' && o.id.length > 0 ? o.id : 'custom',
    name: typeof o.name === 'string' && o.name.length > 0 ? o.name : 'Custom',
    colors: normalizeBucket(o.colors, '#FF2E88'),
    neutrals: normalizeBucket(o.neutrals, '#FFFFFF'),
    backgrounds: normalizeBucket(o.backgrounds, '#000000'),
  })
}

// ---------------------------------------------------------------------------
// Scheme resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a `number|Scheme` to a `Scheme`.
 *
 * A number is a built-in index (clamped to `[0, BUILTINS.length - 1]`). An
 * object is a custom scheme, normalised in place. Anything else falls back to
 * the first built-in — FR-18's failure-toward-something-renderable.
 *
 * @param {unknown} schemeOrIndex
 * @returns {Scheme}
 */
function resolveScheme(schemeOrIndex) {
  if (typeof schemeOrIndex === 'number') {
    return BUILTINS[clamp(schemeOrIndex, 0, BUILTINS.length - 1)]
  }
  return normalizeScheme(schemeOrIndex)
}

/**
 * Resolve a colour reference to a `#RRGGBB` string.
 *
 * **Pinned literal**: 6 characters, all hex → `'#' + ref.toUpperCase()`.
 * Survives scheme changes untouched (FR-7 AC: "A pinned color survives a
 * scheme change unchanged").
 *
 * **Bucket ref**: first char `c`/`n`/`b` selects the bucket; the remaining
 * digits are the selector. Resolution is `bucket[selector % bucket.length]`
 * (architecture §9.2). This is what makes "changing scheme re-resolves every
 * layer's colours without altering any other parameter" (FR-7) fall out: the
 * ref stays the same, only the bucket contents change.
 *
 * An unrecognised ref falls back to the first colour in the colour bucket — a
 * decode repair, not a crash (FR-18).
 *
 * @param {Scheme} scheme
 * @param {string} ref
 * @returns {string}
 */
export function resolveRef(scheme, ref) {
  if (typeof ref !== 'string' || ref.length === 0) {
    return scheme.colors[0]
  }

  // Pinned hex: exactly 6 characters, all hexadecimal. Note that `b` is a hex
  // digit, so `"b12345"` is ambiguous — the architecture resolves this in
  // favour of pinned. A bucket-`b` ref with a 5-digit selector is unrealistic
  // (selectors are small integers, typically 0–7), so the collision is
  // accepted per the spec.
  if (ref.length === 6 && HEX_RE.test(ref)) {
    return '#' + ref.toUpperCase()
  }

  // Bucket ref: first char names the bucket, rest is the selector.
  const bucketName = BUCKET_MAP[ref[0]]
  if (bucketName === undefined) {
    return scheme.colors[0]
  }
  const arr = scheme[bucketName]
  const selector = parseInt(ref.slice(1), 10)
  const idx = Number.isFinite(selector) && selector >= 0 ? selector : 0
  return arr[idx % arr.length]
}

/**
 * Build a resolved `Palette` from the composition's scheme and its layers.
 *
 * `layerColors[i]` is the resolved colour for `layers[i]`, index-aligned. The
 * background is the first entry in the scheme's background bucket. The result
 * is frozen — it is a snapshot of the resolved colours for one scheme + layer
 * stack, rebuilt when either changes, never mutated per frame.
 *
 * @param {number|Scheme} schemeOrIndex
 * @param {readonly Layer[]} layers
 * @returns {Palette}
 */
export function buildPalette(schemeOrIndex, layers) {
  const scheme = resolveScheme(schemeOrIndex)
  /** @type {string[]} */
  const layerColors = new Array(layers.length)
  for (let i = 0; i < layers.length; i++) {
    layerColors[i] = resolveRef(scheme, layers[i].color)
  }
  return Object.freeze({
    background: scheme.backgrounds[0],
    layerColors: Object.freeze(layerColors),
    scheme,
  })
}

/**
 * The canvas background colour for a scheme (FR-1, FR-5).
 *
 * The first entry in the background bucket. This is also what the letterbox
 * bars are filled with (FR-1: "Letterbox bars use the active scheme's
 * background color").
 *
 * @param {number|Scheme} schemeOrIndex
 * @returns {string}
 */
export function background(schemeOrIndex) {
  return resolveScheme(schemeOrIndex).backgrounds[0]
}

/**
 * Is this scheme object structurally valid? Used by `composition.validate`.
 *
 * Checks: non-empty name, three buckets each with 1–8 valid hex entries.
 *
 * @param {unknown} s
 * @returns {boolean}
 */
export function isValidScheme(s) {
  if (typeof s !== 'object' || s === null) return false
  const o = /** @type {Record<string, unknown>} */ (s)
  if (typeof o.name !== 'string' || o.name.length === 0) return false
  for (const key of ['colors', 'neutrals', 'backgrounds']) {
    const arr = o[key]
    if (!Array.isArray(arr) || arr.length < 1 || arr.length > 8) return false
    for (const c of arr) {
      if (typeof c !== 'string') return false
      const hex = c.startsWith('#') ? c.slice(1) : c
      if (!HEX_RE.test(hex)) return false
    }
  }
  return true
}