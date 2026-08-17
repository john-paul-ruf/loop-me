// @ts-check
/**
 * The composition model (architecture §5.4, FR-2, FR-5, FR-6, FR-12, FR-18).
 *
 * A composition is the whole piece: a duration, a scheme, and 1–5 layers.
 * This module owns the **layer envelope** — the fields common to every layer
 * type (`type`, `blend`, `rngSeed`, `color`, `opacity`, `visible`) — and the
 * lifecycle functions: `create`, `clone`, `defaults`, `validate`, `clamp`.
 *
 * `clamp` is the repair pass for decoded seeds (FR-12, FR-18). It is the only
 * place that treats parameter values as untrusted input: everything that
 * arrives from a seed goes through it before anything renders.
 *
 * Imports `model/params.js`, `model/blend.js`, `model/registry.js`,
 * `model/schemes.js`, and `util/clamp.js`.
 *
 * This is a `model` module — it depends on `core` (through `registry`, which
 * imports `params`) and `util`, and nothing else (architecture §4).
 */

import { clamp as clampNum, clampInt } from '../util/clamp.js'
import {
  A,
  TIMES_MIN,
  TIMES_MAX,
  DEFAULT_ALGORITHM,
  isAnimatable,
  defaultOf,
} from './params.js'
import { coerceBlend, BLEND_COUNT } from './blend.js'
import { get as getLayer, has as hasLayer } from './registry.js'
import { isValidScheme, BUILTINS } from './schemes.js'

/**
 * @typedef {import('./params.js').Composition} Composition
 * @typedef {import('./params.js').Layer} Layer
 * @typedef {import('./params.js').AnimValue} AnimValue
 * @typedef {import('./params.js').ParamDecl} ParamDecl
 * @typedef {import('./params.js').ParamValue} ParamValue
 */

// ---------------------------------------------------------------------------
// Durations (FR-2)
// ---------------------------------------------------------------------------

/**
 * The three loop durations in seconds. The index (0/1/2) is what the seed
 * stores; the value is what the clock needs. Append-only in practice — adding
 * a fourth does not break old seeds (an out-of-range index clamps to the
 * last available duration), but it is a user-visible change so it does not
 * happen silently.
 *
 * @type {readonly number[]}
 */
export const DURATIONS = Object.freeze([5, 15, 30])

/**
 * Total frames for a given duration ID.
 *
 * `duration × 60` — 300, 900, or 1800. Out-of-range `durationId` clamps to
 * the last available duration, same forward-tolerance rule as everywhere else.
 *
 * @param {number} durationId
 * @returns {number}
 */
export function totalFrames(durationId) {
  const i = clampInt(durationId, 0, DURATIONS.length - 1)
  return DURATIONS[i] * 60
}

// ---------------------------------------------------------------------------
// The layer envelope
//
// `type`, `blend`, `rngSeed`, `color`, `opacity`, and `visible` are common to
// every layer type (architecture §5.4). They occupy fixed leading positions in
// the seed (§9.2) and are declared here, not in any layer's `params`.
// `visible` rides as the optional top-level hidden bitmask (§9.2 extension).
// ---------------------------------------------------------------------------

/**
 * The opacity envelope parameter declaration. `A` 0.05–1.0, same as FR-6's
 * "Common to every layer type". This is the envelope's own `opacity`, distinct
 * from any layer-local `opacity` that FR-6 also declares on Scan Lines and
 * Grain — see **Flag 4** in the build plan.
 *
 * @type {ParamDecl}
 */
export const OPACITY_DECL = A('opacity', 0.05, 1.0)

/**
 * The default opacity AnimValue for a fresh layer: travels the full range
 * 0.05–1.0, once, on `journeySin`.
 *
 * @returns {AnimValue}
 */
function defaultOpacity() {
  return /** @type {AnimValue} */ (defaultOf(OPACITY_DECL))
}

// ---------------------------------------------------------------------------
// Layer creation
// ---------------------------------------------------------------------------

/**
 * Create a layer of the given type with default envelope and default params.
 *
 * Every declared parameter gets `defaultOf(decl)` — a fresh mutable copy, so
 * two layers of the same type do not share one default object. The envelope
 * fields get sensible defaults: normal blend, a random seed of 0 (the caller
 * replaces this), `color` picking the first colour bucket at index 0, and the
 * default opacity.
 *
 * If `typeId` is unknown (a layer type this build has never heard of), returns
 * `null` — the caller (the codec's `fromArray`) skips and warns (FR-18).
 *
 * @param {number} typeId
 * @returns {Layer|null}
 */
export function createLayer(typeId) {
  const mod = getLayer(typeId)
  if (mod === null) return null

  /** @type {Record<string, ParamValue>} */
  const params = {}
  for (const decl of mod.params) {
    params[decl.name] = defaultOf(decl)
  }

  return {
    type: mod.meta.id,
    blend: 0,
    rngSeed: 0,
    color: 'c0',
    opacity: defaultOpacity(),
    visible: true,
    params,
    errored: false,
  }
}

// ---------------------------------------------------------------------------
// Composition creation
// ---------------------------------------------------------------------------

/**
 * Create a composition with default settings: 15 s duration, first built-in
 * scheme, and one default layer of the given type.
 *
 * @param {number} [typeId]
 * @returns {Composition}
 */
export function create(typeId = 1) {
  const layer = createLayer(typeId)
  if (layer === null) {
    // typeId unknown — use type 1 (Ray Rings) as the ultimate fallback. This
    // only happens if the registry is empty (pre-D1) or the ID is genuinely
    // invalid; in both cases something is wrong and type 1 is the safest
    // known-good default.
    const fallback = createLayer(1)
    if (fallback === null) {
      throw new Error('composition.create: no layer types are registered')
    }
    return { durationId: 1, scheme: 0, layers: [fallback] }
  }
  return { durationId: 1, scheme: 0, layers: [layer] }
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

/**
 * Deep-clone a composition. `structuredClone` is the mechanism (architecture
 * §1): it copies plain objects, arrays, and nested structures in one call and
 * is available across the platform floor.
 *
 * The clone is independent: mutating it cannot reach the original. This is
 * what the undo snapshot relies on (architecture §1, "undo depth 1").
 *
 * @param {Composition} c
 * @returns {Composition}
 */
export function clone(c) {
  // `structuredClone` is ES2022 and available on every target browser. It
  // deep-copies the plain-object composition tree — layers, params, AnimValues,
  // embedded custom scheme — without touching the DOM or any prototype chain.
  return /** @type {Composition} */ (structuredClone(c))
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Create a layer of `typeId` with default params — a convenience wrapper for
 * `createLayer`. Exported because the add-layer picker (F3) and the randomizer
 * (D5) both need it.
 *
 * @param {number} typeId
 * @returns {Layer|null}
 */
export function defaults(typeId) {
  return createLayer(typeId)
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Is this composition structurally valid?
 *
 * Checks: `durationId` in range, `scheme` is a number (built-in) or a valid
 * `Scheme` object, 1–5 layers, every layer's `type` is registered, every
 * parameter is within declared bounds, `rngSeed` is a uint32, `color` is a
 * string, `opacity` is a valid `AnimValue` within 0.05–1.0.
 *
 * Used by the UI to decide whether to offer Save, and by the codec's test
 * suite as a post-condition of `fromArray`. Does not mutate — that is `clamp`'s
 * job. Does not throw — returns a boolean so the caller can decide what to do.
 *
 * @param {Composition} c
 * @returns {boolean}
 */
export function validate(c) {
  if (typeof c !== 'object' || c === null) return false

  // Duration
  if (!Number.isInteger(c.durationId) || c.durationId < 0 || c.durationId >= DURATIONS.length) return false

  // Scheme — the numeric branch is a built-in index; bound tracks BUILTINS.length
  // (omni-wave S05 grew it from 4 → 8). The Scheme-object branch is for custom
  // palettes and is validated structurally by isValidScheme.
  if (typeof c.scheme === 'number') {
    if (c.scheme < 0 || c.scheme >= BUILTINS.length) return false
  } else if (!isValidScheme(c.scheme)) {
    return false
  }

  // Layers
  if (!Array.isArray(c.layers) || c.layers.length < 1 || c.layers.length > 5) return false

  for (const layer of c.layers) {
    if (typeof layer !== 'object' || layer === null) return false
    if (!hasLayer(layer.type)) return false
    if (!Number.isInteger(layer.blend) || layer.blend < 0 || layer.blend >= BLEND_COUNT) return false
    if (!Number.isInteger(layer.rngSeed) || layer.rngSeed < 0 || layer.rngSeed > 0xFFFFFFFF) return false
    if (typeof layer.color !== 'string' || layer.color.length === 0) return false
    if (layer.visible !== undefined && typeof layer.visible !== 'boolean') return false

    // Opacity envelope
    const op = layer.opacity
    if (typeof op !== 'object' || op === null) return false
    if (!Number.isFinite(op.min) || op.min < 0.05 || op.min > 1.0) return false
    if (!Number.isFinite(op.max) || op.max < 0.05 || op.max > 1.0) return false
    if (op.max < op.min) return false
    if (!Number.isInteger(op.times) || op.times < TIMES_MIN || op.times > TIMES_MAX) return false
    if (!Number.isInteger(op.algorithm) || op.algorithm < 0) return false

    // Layer params
    const mod = getLayer(layer.type)
    if (mod === null) return false // redundant with hasLayer above but tsc can't see through
    if (typeof layer.params !== 'object' || layer.params === null) return false

    for (const decl of mod.params) {
      const v = layer.params[decl.name]
      if (v === undefined) return false
      if (isAnimatable(decl)) {
        const av = /** @type {AnimValue} */ (/** @type {unknown} */ (v))
        if (typeof av !== 'object' || av === null) return false
        if (!Number.isFinite(av.min) || av.min < decl.min || av.min > decl.max) return false
        if (!Number.isFinite(av.max) || av.max < decl.min || av.max > decl.max) return false
        if (av.max < av.min) return false
        if (!Number.isInteger(av.times) || av.times < TIMES_MIN || av.times > TIMES_MAX) return false
        if (!Number.isInteger(av.algorithm) || av.algorithm < 0) return false
      } else if (decl.kind === 'int') {
        if (!Number.isInteger(v) || v < decl.min || v > decl.max) return false
      } else if (decl.kind === 'num') {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < decl.min || v > decl.max) return false
      } else if (decl.kind === 'bool') {
        if (typeof v !== 'boolean') return false
      } else if (decl.kind === 'enum') {
        if (decl.values === null) return false
        if (!decl.values.includes(/** @type {string|number} */ (v))) return false
      }
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Clamp — the repair pass for decoded seeds (FR-12, FR-18)
//
// This is the single place that treats parameter values as untrusted input.
// Every number that arrived from a seed goes through it. It mutates the
// composition in place and returns the number of repairs made, so the caller
// can report if desired.
// ---------------------------------------------------------------------------

/**
 * Clamp a single layer's parameters against its registered declaration.
 *
 * Mutates `layer.params` in place. Missing trailing params get fresh defaults
 * (architecture §9.5). Out-of-range values clamp. Unknown blend clamps to
 * normal. `rngSeed` is coerced to a uint32. `color` falls back to `'c0'` if not
 * a string. `opacity` is repaired. `visible` is materialized to a real boolean
 * — absent (pre-visibility seeds) becomes `true`. `errored` is reset to
 * `false` — a layer that was fenced by the painter should get a fresh chance
 * after a decode.
 *
 * If `layer.type` is unknown, returns `false` — the caller should skip and
 * warn (FR-18: "Unknown layer type ID in a seed skips that layer and warns").
 *
 * @param {Layer} layer
 * @returns {boolean} `true` if the layer is usable (type known), `false` to skip.
 */
export function clampLayer(layer) {
  // Envelope: blend
  layer.blend = coerceBlend(layer.blend)

  // Envelope: rngSeed — coerce to uint32
  if (typeof layer.rngSeed !== 'number' || !Number.isFinite(layer.rngSeed)) {
    layer.rngSeed = 0
  }
  layer.rngSeed = Math.floor(layer.rngSeed) >>> 0

  // Envelope: color
  if (typeof layer.color !== 'string' || layer.color.length === 0) {
    layer.color = 'c0'
  }

  // Envelope: visible — absent means visible (pre-visibility seeds).
  // Materialized to a real boolean so encode and the UI read one shape.
  layer.visible = layer.visible !== false

  // Envelope: opacity
  layer.opacity = clampAnimValue(layer.opacity, OPACITY_DECL)
  // Opacity min/max are within [0.05, 1.0], but max must be >= min
  if (layer.opacity.max < layer.opacity.min) {
    const tmp = layer.opacity.min
    layer.opacity.min = layer.opacity.max
    layer.opacity.max = tmp
  }

  // Envelope: errored — reset on decode so a fenced layer gets a fresh chance
  layer.errored = false

  // Layer type — if unknown, skip
  const mod = getLayer(layer.type)
  if (mod === null) return false

  // Layer params
  if (typeof layer.params !== 'object' || layer.params === null) {
    layer.params = {}
  }

  for (const decl of mod.params) {
    const existing = layer.params[decl.name]
    if (existing === undefined) {
      // Missing trailing param: fill from the declaration's default
      layer.params[decl.name] = defaultOf(decl)
      continue
    }

    if (isAnimatable(decl)) {
      layer.params[decl.name] = clampAnimValue(existing, decl)
    } else if (decl.kind === 'int') {
      layer.params[decl.name] = clampInt(
        typeof existing === 'number' ? existing : decl.min,
        decl.min, decl.max,
      )
    } else if (decl.kind === 'num') {
      layer.params[decl.name] = clampNum(
        typeof existing === 'number' ? existing : decl.min,
        decl.min, decl.max,
      )
    } else if (decl.kind === 'bool') {
      layer.params[decl.name] = typeof existing === 'boolean' ? existing : false
    } else if (decl.kind === 'enum') {
      const vs = decl.values
      if (vs === null) {
        layer.params[decl.name] = decl.min
      } else if (vs.includes(/** @type {string|number} */ (existing))) {
        layer.params[decl.name] = existing
      } else {
        // Out-of-range enum: if it's a number, clamp to the index space
        if (typeof existing === 'number') {
          const idx = clampInt(existing, 0, vs.length - 1)
          layer.params[decl.name] = vs[idx]
        } else {
          layer.params[decl.name] = vs[0]
        }
      }
    }
  }

  return true
}

/**
 * Clamp/repair an `AnimValue` against its declared bounds.
 *
 * Coerces non-objects to a fresh default. Clamps `min`/`max` to `[decl.min,
 * decl.max]`, swaps if inverted. Rounds `times` to the nearest integer and
 * clamps to `[TIMES_MIN, TIMES_MAX]`. Coerces `algorithm` to a non-negative
 * integer, falling back to `DEFAULT_ALGORITHM` if out of range.
 *
 * This is also where FR-6's "integer 1–8" for `times` is actually enforced —
 * `core/value.js` deliberately does not round, so a fractional `times` closes
 * the loop but leaves a visible seam (C1's documented decision).
 *
 * @param {unknown} v
 * @param {ParamDecl} decl
 * @returns {AnimValue}
 */
function clampAnimValue(v, decl) {
  if (typeof v !== 'object' || v === null) {
    return /** @type {AnimValue} */ (defaultOf(decl))
  }
  const o = /** @type {Partial<AnimValue>} */ (/** @type {unknown} */ (v))

  let min = typeof o.min === 'number' && Number.isFinite(o.min) ? o.min : decl.min
  let max = typeof o.max === 'number' && Number.isFinite(o.max) ? o.max : decl.max
  min = clampNum(min, decl.min, decl.max)
  max = clampNum(max, decl.min, decl.max)
  if (max < min) {
    // Inverted: swap rather than collapsing to a point
    const tmp = min
    min = max
    max = tmp
  }

  let times = typeof o.times === 'number' && Number.isFinite(o.times) ? o.times : TIMES_MIN
  // Round to nearest integer (this is the seam-repair from C1's note)
  times = Math.round(times)
  times = clampInt(times, TIMES_MIN, TIMES_MAX)

  let algorithm = typeof o.algorithm === 'number' && Number.isInteger(o.algorithm) ? o.algorithm : DEFAULT_ALGORITHM
  if (algorithm < 0) algorithm = DEFAULT_ALGORITHM

  return { min, max, times, algorithm }
}

/**
 * Clamp/repair an entire composition in place.
 *
 * `durationId` clamps to `[0, DURATIONS.length - 1]`. `scheme` is left as-is
 * if it is a number (built-in index) or a valid-looking object (custom);
 * invalid custom schemes are normalised by `normalizeScheme`. Layers with
 * unknown types are removed (and counted in `skipped`). Remaining layers are
 * clamped.
 *
 * Returns `{ repairs, skipped }` where `repairs` counts layers that were
 * actually repaired (had at least one out-of-bounds or missing value) and
 * `skipped` counts layers removed for unknown type. The caller can use these
 * to decide whether to report `LAYER_UNKNOWN_TYPE` (architecture §9.5).
 *
 * @param {Composition} c
 * @returns {{ skipped: number, kept: number }}
 */
export function clampComposition(c) {
  // Duration
  if (!Number.isInteger(c.durationId) || c.durationId < 0 || c.durationId >= DURATIONS.length) {
    c.durationId = clampInt(
      typeof c.durationId === 'number' ? c.durationId : 1,
      0, DURATIONS.length - 1,
    )
  }

  // Scheme: if it's not a number and not a valid scheme, normalise
  if (typeof c.scheme !== 'number') {
    if (!isValidScheme(c.scheme)) {
      // A custom scheme that arrived malformed — normalise it rather than
      // discarding it, because the sender's colours are in there somewhere
      // and FR-8 says the recipient sees the author's exact colours.
      c.scheme = 0
    }
  }

  // Layers: clamp each, remove unknown types
  if (!Array.isArray(c.layers) || c.layers.length === 0) {
    // A composition with no layers is invalid; replace with a default
    const layer = createLayer(1)
    if (layer !== null) {
      c.layers = [layer]
    }
    return { skipped: 0, kept: 1 }
  }

  /** @type {Layer[]} */
  const kept = []
  let skipped = 0
  for (const layer of c.layers) {
    if (typeof layer !== 'object' || layer === null) {
      skipped++
      continue
    }
    const usable = clampLayer(layer)
    if (usable) {
      kept.push(layer)
    } else {
      skipped++
    }
  }

  // Ensure at least one layer (FR-5: "1 to 5 layers")
  if (kept.length === 0) {
    const fallback = createLayer(1)
    if (fallback !== null) kept.push(fallback)
  }

  // Enforce 5-layer cap
  if (kept.length > 5) {
    kept.length = 5
  }

  c.layers = kept
  return { skipped, kept: kept.length }
}