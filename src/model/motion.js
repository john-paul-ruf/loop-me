// @ts-check
/**
 * Motion characters and algorithm-pool assignment (FR-11, architecture §8.4).
 *
 * A **motion character** is a named preset — Calm, Breathing, Pulse, Tidal,
 * Heartbeat, Chaotic — that maps to a curated subset of the 20 algorithms.
 * Selecting a character **deterministically assigns** algorithms from that pool
 * to the layer's animatable parameters, drawing from the layer's PRNG in fixed
 * declaration order (FR-11).
 *
 * The seed stores only the resolved per-parameter values — never the character
 * name — so a hand-tuned layer and a character-generated layer are
 * indistinguishable to the decoder (FR-11).
 *
 * ## The six pools
 *
 * From Designer §6 and architecture §8.4. Every one of the 20 algorithm IDs
 * belongs to at least one pool — a test asserts this (FR-11 AC).
 *
 * | Character  | Pool (algorithm IDs) |
 * |------------|----------------------|
 * | Calm       | 0, 1, 4, 18          |
 * | Breathing  | 9, 3, 5, 2           |
 * | Pulse      | 10, 6, 11, 15        |
 * | Tidal      | 18, 13, 17, 16       |
 * | Heartbeat  | 12, 6, 8, 7          |
 * | Chaotic    | 14, 19, 8, 13, 11    |
 *
 * Pools are **not** append-only — they are not stored in the seed, so they are
 * freely revisable (architecture §8.4). They are frozen at module load for the
 * same reason every other table is: a caller that mutates one would silently
 * change the assignment for every new layer.
 *
 * Imports `core/algorithms.js`, `core/rng.js`, and `model/registry.js`.
 *
 * This is a `model` module — it depends on `core` and `model` (architecture §4).
 */

import { pick, intRange } from '../core/rng.js'
import { get as getLayerModule } from './registry.js'

/**
 * @typedef {import('./params.js').Layer} Layer
 * @typedef {import('./params.js').AnimValue} AnimValue
 * @typedef {import('./params.js').ParamDecl} ParamDecl
 */

// ---------------------------------------------------------------------------
// The six character pools (architecture §8.4, Designer §6)
// ---------------------------------------------------------------------------

/** @type {readonly number[]} */
const CALM_POOL = Object.freeze([0, 1, 4, 18])
/** @type {readonly number[]} */
const BREATHING_POOL = Object.freeze([9, 3, 5, 2])
/** @type {readonly number[]} */
const PULSE_POOL = Object.freeze([10, 6, 11, 15])
/** @type {readonly number[]} */
const TIDAL_POOL = Object.freeze([18, 13, 17, 16])
/** @type {readonly number[]} */
const HEARTBEAT_POOL = Object.freeze([12, 6, 8, 7])
/** @type {readonly number[]} */
const CHAOTIC_POOL = Object.freeze([14, 19, 8, 13, 11])

/**
 * The six motion characters and their algorithm pools.
 *
 * @typedef {object} CharacterDef
 * @property {string} name
 * @property {readonly number[]} pool
 */

/** @type {readonly CharacterDef[]} */
export const CHARACTERS = Object.freeze([
  Object.freeze({ name: 'Calm', pool: CALM_POOL }),
  Object.freeze({ name: 'Breathing', pool: BREATHING_POOL }),
  Object.freeze({ name: 'Pulse', pool: PULSE_POOL }),
  Object.freeze({ name: 'Tidal', pool: TIDAL_POOL }),
  Object.freeze({ name: 'Heartbeat', pool: HEARTBEAT_POOL }),
  Object.freeze({ name: 'Chaotic', pool: CHAOTIC_POOL }),
])

/** How many characters exist. @type {number} */
export const CHARACTER_COUNT = CHARACTERS.length

/**
 * Every algorithm ID across all pools. Asserted by the test suite to be
 * exactly the full set 0..19 (FR-11 AC). Computed once at module load.
 *
 * @type {readonly number[]}
 */
export const ALL_POOL_IDS = Object.freeze(
  Array.from(new Set(CHARACTERS.flatMap((c) => c.pool))).sort((a, b) => a - b),
)

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Get the declared params for a layer's type, or `null` if the type is unknown.
 *
 * @param {Layer} layer
 * @returns {readonly ParamDecl[] | null}
 */
function paramsOf(layer) {
  const mod = getLayerModule(layer.type)
  return mod === null ? null : mod.params
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a character definition by name (case-insensitive), or `null` if unknown.
 *
 * @param {string} name
 * @returns {CharacterDef|null}
 */
export function getCharacter(name) {
  if (typeof name !== 'string') return null
  const lower = name.toLowerCase()
  for (const c of CHARACTERS) {
    if (c.name.toLowerCase() === lower) return c
  }
  return null
}

/**
 * Get a character definition by index (0-based), or `null` if out of range.
 *
 * @param {number} i
 * @returns {CharacterDef|null}
 */
export function characterByIndex(i) {
  if (!Number.isInteger(i) || i < 0 || i >= CHARACTER_COUNT) return null
  return CHARACTERS[i]
}

/**
 * Assign algorithms from a character's pool to a layer's animatable parameters.
 *
 * Walks the layer's **A** params in declaration order (looked up from the
 * registry by `layer.type`), drawing an algorithm ID from the pool with the
 * layer's PRNG for each one. The consumption order is fixed: `pick(rng, pool)`
 * once per animatable param, in the order the layer module declares them. This
 * is the contract — adding a draw between existing ones would change every
 * assignment after it (architecture §8, FR-4).
 *
 * Also sets a `times` value for each animatable param, drawn from `[1, 4]` via
 * `intRange(rng, 1, 4)`. The range is deliberately conservative — high `times`
 * on a fresh assignment produces busy motion, and the Speed control (which
 * scales `times`) is the user's way to push it further.
 *
 * The PRNG is constructed by the caller from `layer.rngSeed` so the assignment
 * is deterministic for a given layer. This function only draws from it.
 *
 * If the layer's type is unknown (not registered), the function is a no-op —
 * it cannot walk params it does not know about.
 *
 * @param {Layer} layer
 * @param {CharacterDef} character
 * @param {() => number} rng
 * @returns {void}
 */
export function assign(layer, character, rng) {
  const params = paramsOf(layer)
  if (params === null) return
  for (const decl of params) {
    if (decl.kind !== 'A') continue
    const av = /** @type {AnimValue} */ (layer.params[decl.name])
    if (typeof av !== 'object' || av === null) continue
    av.algorithm = pick(rng, character.pool)
    av.times = intRange(rng, 1, 4)
  }
}

/**
 * Scale every animatable parameter's `times` by a factor, clamped to 1–8.
 *
 * FR-11: "A Speed control scales the `times` value across all of that layer's
 * animatable parameters (proposed range ×0.25 – ×3, clamped so each resulting
 * `times` stays within 1–8)."
 *
 * `factor` is clamped to `[0.25, 3]` before applying — an out-of-range factor
 * from a repaired seed or a UI bug should not produce `times` outside `[1, 8]`.
 *
 * @param {Layer} layer
 * @param {number} factor
 * @returns {void}
 */
export function speed(layer, factor) {
  const params = paramsOf(layer)
  if (params === null) return
  const f = factor < 0.25 ? 0.25 : factor > 3 ? 3 : factor
  for (const decl of params) {
    if (decl.kind !== 'A') continue
    const av = /** @type {AnimValue} */ (layer.params[decl.name])
    if (typeof av !== 'object' || av === null) continue
    const scaled = Math.round(av.times * f)
    av.times = scaled < 1 ? 1 : scaled > 8 ? 8 : scaled
  }
}

/**
 * Reroll the algorithm assignment within the currently selected character.
 *
 * Re-runs `assign` with the same character but an advanced PRNG state, so the
 * assignment changes. Returns `true` if the new assignment differs from the
 * old, or `false` if the pool is exhausted (every param drew the same
 * algorithm as before — only possible with a pool of size 1, which none of the
 * six pools are, but the contract requires reporting it per FR-11).
 *
 * The caller passes a fresh rng seeded from `layer.rngSeed` (or an advanced
 * state of the previous one). This function does not reseed — it draws from
 * what it is given.
 *
 * @param {Layer} layer
 * @param {CharacterDef} character
 * @param {() => number} rng
 * @returns {boolean} `true` if at least one param's algorithm or times changed.
 */
export function reroll(layer, character, rng) {
  const params = paramsOf(layer)
  if (params === null) return false
  let changed = false
  for (const decl of params) {
    if (decl.kind !== 'A') continue
    const av = /** @type {AnimValue} */ (layer.params[decl.name])
    if (typeof av !== 'object' || av === null) continue
    const oldAlgo = av.algorithm
    const oldTimes = av.times
    av.algorithm = pick(rng, character.pool)
    av.times = intRange(rng, 1, 4)
    if (av.algorithm !== oldAlgo || av.times !== oldTimes) changed = true
  }
  return changed
}