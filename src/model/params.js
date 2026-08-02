// @ts-check
/**
 * The parameter declaration DSL, and the shared JSDoc type vocabulary.
 *
 * This is the spine of the architecture (§5). A layer declares its parameters
 * *as data*, and four subsystems walk that same declaration rather than
 * duplicating knowledge of it:
 *
 *   seed/codec.js        field order and arity
 *   model/composition.js defaults, and the clamp pass that repairs seeds
 *   model/randomize.js   the sample space
 *   render/resolve.js    which params run through findValue, which pass through
 *   render/prepare.js    the static/animatable split IS the cache boundary
 *   ui/panels/layer-editor.js  one band per A param, one control per S param
 *
 * One declaration, five consumers, zero duplication. That is what makes
 * "a seventeenth layer type touches only its own file plus one registry line"
 * literally true (architecture §5.3).
 *
 * Descriptors are frozen at declaration. A layer module's `params` array is
 * evaluated once at import and read forever after — nothing may mutate a
 * bound, least of all the UI that renders it.
 *
 * This module imports nothing. It is a leaf of the dependency DAG.
 */

// ---------------------------------------------------------------------------
// Shared type vocabulary
//
// These typedefs are consumed across model/, render/, seed/, and ui/ via
// `import('../model/params.js').Composition` and friends. They live here
// because `params` is the one declaration every other subsystem already
// imports — putting them anywhere else would add an import edge for types
// alone.
// ---------------------------------------------------------------------------

/**
 * @typedef {'A'|'int'|'num'|'bool'|'enum'} ParamKind
 * `A` is animatable — four stored values resolved per frame through FR-3.
 * The other four are static — one stored value, constant across the loop.
 */

/**
 * An animatable parameter's stored value. Encoded as the positional 4-tuple
 * `[min, max, times, algorithmId]` (architecture §9.2).
 *
 * @typedef {object} AnimValue
 * @property {number} min       Lower travel bound; within the declared bounds.
 * @property {number} max       Upper travel bound; >= min, within the declared bounds.
 * @property {number} times     Cycles per loop, integer, TIMES_MIN..TIMES_MAX (FR-11).
 * @property {number} algorithm Stable algorithm ID (core/algorithms.js, architecture §8.1).
 */

/** Anything a parameter can hold. @typedef {number|boolean|string|AnimValue} ParamValue */

/**
 * Options accepted by every declaration builder.
 *
 * @typedef {object} ParamOpts
 * @property {string} [label]   UI label. Defaults to a humanized `name`.
 * @property {string} [unit]    Suffix printed after the value, e.g. `'°'`.
 * @property {number} [step]    UI increment. Defaults per kind; see `defaultStep`.
 * @property {boolean} [wrap]   Angular: 360 and 0 are adjacent. `A` params only.
 * @property {ParamValue|Partial<AnimValue>} [default]
 *   Value used when a decoded seed is missing this trailing element
 *   (architecture §9.5). For an `A` param this is a *partial* AnimValue merged
 *   over the full declared range.
 */

/**
 * A frozen parameter declaration.
 *
 * @typedef {object} ParamDecl
 * @property {ParamKind} kind
 * @property {string} name      Identifier. Also the key in `Layer.params` and in a resolved slot.
 * @property {number} min       Hard lower bound. For `enum`, 0. For `bool`, 0.
 * @property {number} max       Hard upper bound. For `enum`, values.length - 1. For `bool`, 1.
 * @property {readonly (string|number)[] | null} values  `enum` members, else null.
 * @property {string} label
 * @property {string} unit
 * @property {number} step
 * @property {boolean} wrap
 * @property {ParamValue} default
 */

/**
 * A layer type's static metadata (architecture §5.1).
 *
 * @typedef {object} LayerMeta
 * @property {number} id        Stable, append-only, never reused (architecture §8.2).
 * @property {string} name      Catalog name, e.g. 'Arc Gates'.
 * @property {'primary'|'secondary'|'overlay'} role
 * @property {string} blurb     One line, shown on the type card in add-layer.
 * @property {{pathOps: number, drawCalls: number}} worstCase  Must match architecture §10.2.
 * @property {boolean} fullCanvasOpaque  Consumed by the randomizer's taste rules (§8.5).
 */

/**
 * One layer instance. The envelope fields (`type`, `blend`, `rngSeed`,
 * `color`, `opacity`) are common to every layer type and are declared in
 * model/composition.js, not in any layer's `params` (architecture §5.4).
 *
 * `params` is keyed by declaration *name* in memory and flattened to
 * *positional* order only at the codec boundary (architecture §9.2). Keying by
 * name is what lets the editor and the resolver address a parameter without
 * carrying an index around.
 *
 * @typedef {object} Layer
 * @property {number} type      Layer type ID; resolved through model/registry.js.
 * @property {number} blend     Blend mode ID 0–6 (architecture §8.3).
 * @property {number} rngSeed   uint32; drives every position derived at render time (FR-4).
 * @property {string} color     Colour ref: `'c3'` | `'n1'` | `'b0'` | `'FF2E88'` (architecture §9.2).
 * @property {AnimValue} opacity  Envelope opacity, A 0.05–1.0 (FR-5).
 * @property {Record<string, ParamValue>} params
 * @property {boolean} [errored]  Set by the painter's per-layer fence; skips the layer (FR-18).
 */

/**
 * A named palette. Every bucket holds 1–8 six-digit hex colours *without* the
 * leading `#` on the wire (FR-12); in memory they carry it.
 *
 * @typedef {object} Scheme
 * @property {string} id
 * @property {string} name
 * @property {string[]} colors
 * @property {string[]} neutrals
 * @property {string[]} backgrounds
 */

/**
 * A scheme resolved against a specific layer stack. Rebuilt whenever the
 * scheme or any layer's colour ref or rngSeed changes — never per frame.
 *
 * @typedef {object} Palette
 * @property {string} background            Canvas fill and letterbox colour (FR-1).
 * @property {readonly string[]} layerColors  Index-aligned with `Composition.layers`.
 * @property {Scheme} scheme
 */

/**
 * The whole piece. This is what a seed encodes, and nothing else.
 *
 * @typedef {object} Composition
 * @property {number} durationId  0 = 5s · 1 = 15s · 2 = 30s (FR-2).
 * @property {number|Scheme} scheme  Built-in index 0–3, or a fully embedded custom scheme (FR-8).
 * @property {Layer[]} layers     1–5, index 0 drawn first (FR-5).
 */

/**
 * A layer's prepare cache. Deliberately untyped: each layer module narrows it
 * with its own local typedef, because the contents are private to that layer
 * (a Path2D here, a CanvasPattern there). Nothing outside the owning layer
 * reads a field of it.
 *
 * @typedef {any} Prepared
 */

/**
 * One frame's resolved parameter values for one layer — a preallocated object,
 * refilled in place every frame by render/resolve.js. Layer code reads
 * `resolved.arcSpan` and gets a number; it never sees an AnimValue.
 *
 * @typedef {Record<string, number|boolean|string>} Resolved
 */

/**
 * Mints a detached scratch canvas at prepare time. Injected by
 * render/prepare.js as the reserved `statics.scratch` key, because layers may
 * not import render/* (architecture §4 rule 2) yet the overlay role needs a
 * context to build gradients, patterns and noise tiles against (§6.5 bans
 * creating them in `draw`).
 *
 * @typedef {(w: number, h: number) => HTMLCanvasElement} ScratchFactory
 */

/**
 * What a layer's `prepare(statics, …)` receives: every **S** param by name,
 * plus two reserved keys — `color` (the layer's resolved `#RRGGBB`) and
 * `scratch` (a ScratchFactory). Reserved names are enforced by
 * model/registry.js's validation, so a declared param can never collide.
 *
 * @typedef {Record<string, number|boolean|string|ScratchFactory>} Statics
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cycles-per-loop bounds for every animatable parameter (FR-6, FR-11). */
export const TIMES_MIN = 1
/** @see TIMES_MIN */
export const TIMES_MAX = 8

/**
 * Algorithm assigned when nothing says otherwise: `0 journeySin`
 * (architecture §8.1). The calmest curve in the library, and the safest thing
 * to repair a truncated seed with.
 */
export const DEFAULT_ALGORITHM = 0

/** Every legal `ParamDecl.kind`. Consumed by model/registry.js's validation. */
export const PARAM_KINDS = Object.freeze(
  /** @type {readonly ParamKind[]} */ (['A', 'int', 'num', 'bool', 'enum']),
)

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * `'rayCount'` → `'Ray count'`.
 *
 * Deliberately naive. A name the heuristic mangles — `angleA` becomes
 * `'Angle a'` — is fixed by passing `{ label: 'Angle A' }` at the declaration
 * site, which is one word in the file that already owns the parameter.
 *
 * @param {string} name
 * @returns {string}
 */
function humanize(name) {
  const spaced = name.replace(/([A-Z])/g, ' $1').toLowerCase().trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The UI increment when a declaration does not state one.
 *
 * The `A` rule reads as a heuristic and is one: a span of 20 or more units is
 * a pixel/degree/count range where whole steps are right (`thickness` 1–24,
 * `rotation` 0–360, `sweep` 90–1440), and anything tighter is a normalized
 * ratio where they are useless (`opacity` 0.05–1.0, `tightness` 0.05–1.0,
 * `cellScale` 0.1–1.0). It classifies every animatable parameter in FR-6
 * correctly. It is also only ever a *hint to the UI* — bounds enforcement is
 * `min`/`max`, and storage precision is the codec's 3dp quantization — so a
 * misclassification costs a slightly coarse slider and nothing else.
 *
 * @param {ParamKind} kind
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function defaultStep(kind, min, max) {
  if (kind === 'int' || kind === 'bool' || kind === 'enum') return 1
  if (kind === 'A') return max - min >= 20 ? 1 : 0.01
  return 0.01
}

/**
 * Build and validate an `A` param's default AnimValue.
 *
 * Out-of-bounds input here throws rather than clamping: a *declaration* is
 * author-written source, so a bad one is a programmer error and should fail at
 * import, loudly. Clamping belongs to the decoder, where the input is
 * untrusted (architecture §9.5).
 *
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {ParamValue|Partial<AnimValue>|undefined} given
 * @returns {AnimValue}
 */
function animDefault(name, min, max, given) {
  const v = { min, max, times: TIMES_MIN, algorithm: DEFAULT_ALGORITHM }
  if (given !== undefined) {
    if (typeof given !== 'object' || given === null) {
      throw new Error(`param "${name}": an animatable default must be an object, got ${typeof given}`)
    }
    const g = /** @type {Partial<AnimValue>} */ (given)
    if (g.min !== undefined) v.min = g.min
    if (g.max !== undefined) v.max = g.max
    if (g.times !== undefined) v.times = g.times
    if (g.algorithm !== undefined) v.algorithm = g.algorithm
  }
  if (!Number.isFinite(v.min) || v.min < min || v.min > max) {
    throw new Error(`param "${name}": default min ${v.min} is outside [${min}, ${max}]`)
  }
  if (!Number.isFinite(v.max) || v.max < min || v.max > max) {
    throw new Error(`param "${name}": default max ${v.max} is outside [${min}, ${max}]`)
  }
  if (v.max < v.min) {
    throw new Error(`param "${name}": default max ${v.max} is below default min ${v.min}`)
  }
  if (!Number.isInteger(v.times) || v.times < TIMES_MIN || v.times > TIMES_MAX) {
    throw new Error(`param "${name}": default times ${v.times} is not an integer in [${TIMES_MIN}, ${TIMES_MAX}]`)
  }
  if (!Number.isInteger(v.algorithm) || v.algorithm < 0) {
    throw new Error(`param "${name}": default algorithm ${v.algorithm} is not a non-negative integer`)
  }
  return Object.freeze(v)
}

/**
 * Validate a static param's default. Same throw-not-clamp reasoning as
 * `animDefault`.
 *
 * @param {ParamKind} kind
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {readonly (string|number)[] | null} values
 * @param {ParamValue|Partial<AnimValue>|undefined} given
 * @returns {ParamValue}
 */
function staticDefault(kind, name, min, max, values, given) {
  if (kind === 'bool') {
    if (given === undefined) return false
    if (typeof given !== 'boolean') {
      throw new Error(`param "${name}": default must be a boolean, got ${typeof given}`)
    }
    return given
  }
  if (kind === 'enum') {
    const vs = /** @type {readonly (string|number)[]} */ (values)
    if (given === undefined) return vs[0]
    if (typeof given !== 'string' && typeof given !== 'number') {
      throw new Error(`param "${name}": default must be one of its enum values`)
    }
    if (!vs.includes(given)) {
      throw new Error(`param "${name}": default ${String(given)} is not one of [${vs.join(', ')}]`)
    }
    return given
  }
  if (given === undefined) return min
  if (typeof given !== 'number' || !Number.isFinite(given)) {
    throw new Error(`param "${name}": default must be a finite number`)
  }
  if (given < min || given > max) {
    throw new Error(`param "${name}": default ${given} is outside [${min}, ${max}]`)
  }
  if (kind === 'int' && !Number.isInteger(given)) {
    throw new Error(`param "${name}": default ${given} is not an integer`)
  }
  return given
}

/**
 * The one construction path. Every builder below funnels through it, so every
 * declaration is validated and frozen identically.
 *
 * @param {ParamKind} kind
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {readonly (string|number)[] | null} values
 * @param {ParamOpts} opts
 * @returns {ParamDecl}
 */
function declare(kind, name, min, max, values, opts) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('param declaration requires a non-empty name')
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(`param "${name}": bounds must be finite, got [${min}, ${max}]`)
  }
  if (max < min) {
    throw new Error(`param "${name}": max ${max} is below min ${min}`)
  }
  const wrap = opts.wrap === true
  if (wrap && kind !== 'A') {
    throw new Error(`param "${name}": wrap applies to animatable params only`)
  }
  const step = opts.step === undefined ? defaultStep(kind, min, max) : opts.step
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error(`param "${name}": step must be a positive finite number, got ${step}`)
  }
  return Object.freeze({
    kind,
    name,
    min,
    max,
    values: values === null ? null : Object.freeze(values.slice()),
    label: opts.label ?? humanize(name),
    unit: opts.unit ?? '',
    step,
    wrap,
    default: kind === 'A'
      ? animDefault(name, min, max, opts.default)
      : staticDefault(kind, name, min, max, values, opts.default),
  })
}

// ---------------------------------------------------------------------------
// The DSL (architecture §5.4)
// ---------------------------------------------------------------------------

/**
 * Declare an **animatable** parameter: stored as `{min, max, times, algorithm}`
 * and resolved per frame through `core/value.js` (FR-3).
 *
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {ParamOpts} [opts]
 * @returns {ParamDecl}
 */
export function A(name, min, max, opts = {}) {
  return declare('A', name, min, max, null, opts)
}

/**
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {ParamOpts} [opts]
 * @returns {ParamDecl}
 */
function sInt(name, min, max, opts = {}) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new Error(`param "${name}": integer bounds must be integers, got [${min}, ${max}]`)
  }
  return declare('int', name, min, max, null, opts)
}

/**
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {ParamOpts} [opts]
 * @returns {ParamDecl}
 */
function sNum(name, min, max, opts = {}) {
  return declare('num', name, min, max, null, opts)
}

/**
 * @param {string} name
 * @param {ParamOpts} [opts]
 * @returns {ParamDecl}
 */
function sBool(name, opts = {}) {
  return declare('bool', name, 0, 1, null, opts)
}

/**
 * A small closed set. Encoded as an index (architecture §9.2), held in memory
 * as the value itself — so `draw` reads `resolved.mode === 'radial'` rather
 * than decoding an index it would have to know the order of.
 *
 * @param {string} name
 * @param {readonly (string|number)[]} values
 * @param {ParamOpts} [opts]
 * @returns {ParamDecl}
 */
function sEnum(name, values, opts = {}) {
  // Widened to `unknown` before the guard on purpose: narrowing a
  // `readonly T[]` parameter with Array.isArray is a known rough edge in the
  // checker, and this keeps `values` at its declared type below.
  const probe = /** @type {unknown} */ (values)
  if (!Array.isArray(probe) || probe.length === 0) {
    throw new Error(`param "${name}": an enum needs at least one value`)
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`param "${name}": enum values must be unique`)
  }
  return declare('enum', name, 0, values.length - 1, values, opts)
}

/** Static parameter builders — one stored value, constant across the loop. */
export const S = Object.freeze({
  int: sInt,
  num: sNum,
  bool: sBool,
  enum: sEnum,
})

// ---------------------------------------------------------------------------
// Helpers every consumer of a declaration needs
// ---------------------------------------------------------------------------

/**
 * Is this parameter resolved per frame, or passed straight through?
 *
 * This predicate is also the prepare-cache invalidation boundary
 * (architecture §6.3): a static param can change cached geometry, an
 * animatable one cannot, by definition.
 *
 * @param {ParamDecl} decl
 * @returns {boolean}
 */
export function isAnimatable(decl) {
  return decl.kind === 'A'
}

/**
 * A **fresh, mutable** default value for a declaration.
 *
 * The declaration's own `default` is frozen and shared by every layer instance
 * of that type, so handing it out directly would let one layer's edit reach
 * into every other. Callers get a copy.
 *
 * @param {ParamDecl} decl
 * @returns {ParamValue}
 */
export function defaultOf(decl) {
  if (decl.kind === 'A') {
    const a = /** @type {AnimValue} */ (decl.default)
    return { min: a.min, max: a.max, times: a.times, algorithm: a.algorithm }
  }
  return /** @type {number|boolean|string} */ (decl.default)
}

/**
 * Enum value → wire index. An unrecognized value yields `0` rather than
 * throwing: this runs on the encode side of data that may have been repaired
 * on the way in, and a bad enum is a recoverable inconsistency (FR-18).
 *
 * @param {ParamDecl} decl
 * @param {string|number} value
 * @returns {number}
 */
export function enumIndex(decl, value) {
  const vs = decl.values
  if (vs === null) throw new Error(`param "${decl.name}" is not an enum`)
  const i = vs.indexOf(value)
  return i < 0 ? 0 : i
}

/**
 * Wire index → enum value. Out-of-range yields the first member — the clamp
 * half of the same forward-tolerance rule (architecture §9.5).
 *
 * @param {ParamDecl} decl
 * @param {number} index
 * @returns {string|number}
 */
export function enumValue(decl, index) {
  const vs = decl.values
  if (vs === null) throw new Error(`param "${decl.name}" is not an enum`)
  if (!Number.isInteger(index) || index < 0 || index >= vs.length) return vs[0]
  return vs[index]
}
