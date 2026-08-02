// @ts-check
/**
 * The seeded pseudo-random number generator (FR-4).
 *
 * Determinism is the product. A seed that renders differently on a friend's
 * phone is a broken seed, so nothing that reaches a pixel may come from
 * `Math.random()`. Every derived value — flare positions, per-ring phase
 * spreads, the grain tile — draws from a stream started at the composition's
 * stored `rngSeed` (architecture §8.5).
 *
 * **The consumption order is the contract.** Two callers that draw the same
 * count of values in the same order get the same stream; a caller that adds a
 * draw in the middle of an existing sequence silently changes every value after
 * it, and therefore changes every existing seed's rendered output. When a layer
 * needs a new derived value, it must be drawn *after* the existing ones — the
 * same append-only discipline the ID registries carry (architecture §8).
 *
 * This module imports nothing. It is a leaf of the dependency DAG (§4 rule 1).
 */

/** 2^32, the divisor that maps a uint32 onto `[0, 1)`. */
const TWO_32 = 4294967296

/**
 * mulberry32 — a 32-bit-state generator.
 *
 * Chosen for FR-4's actual requirements rather than for statistical pedigree:
 * the state is one uint32 (so it round-trips through the seed as a single
 * number), it needs no warm-up, and it is eleven lines that behave identically
 * on every engine because every operation is integer.
 *
 * `Math.imul` and the `|0` / `>>> 0` coercions are load-bearing, not
 * decoration. They pin each step to 32-bit integer arithmetic; without them the
 * intermediate products exceed 2^53 and the stream diverges from the reference
 * implementation — which would silently break every seed ever shared.
 *
 * @param {number} seed uint32. Non-integer or out-of-range input is coerced.
 * @returns {() => number} A generator yielding numbers in `[0, 1)`.
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / TWO_32
  }
}

/**
 * Draw a uint32 from a stream.
 *
 * This is how one PRNG seeds another — a composition-level stream handing each
 * layer its own `rngSeed`, for instance — so that a layer's derived geometry
 * stays stable when a *different* layer gains a draw.
 *
 * @param {() => number} rng
 * @returns {number} An integer in `[0, 2^32)`.
 */
export function uint32(rng) {
  return Math.floor(rng() * TWO_32) >>> 0
}

/**
 * A float in `[min, max)`.
 *
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function range(rng, min, max) {
  return min + rng() * (max - min)
}

/**
 * An integer in `[min, max]` — **inclusive of both ends**, which is what every
 * caller in this project wants, because parameter bounds in FR-6 are inclusive.
 *
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function intRange(rng, min, max) {
  const lo = Math.ceil(min)
  const hi = Math.floor(max)
  if (hi <= lo) return lo
  const v = lo + Math.floor(rng() * (hi - lo + 1))
  // `rng()` is strictly < 1, so `v` cannot exceed `hi` — but a caller passing a
  // generator that is not this module's would not know that, and an
  // out-of-bounds index reaching a param table is worth one comparison.
  return v > hi ? hi : v
}

/**
 * A uniformly chosen element.
 *
 * Throws on an empty array rather than returning `undefined`: every call site
 * in this project draws from a declared, non-empty table (a motion pool, a
 * colour bucket, a role's layer types), so an empty one is a programmer error
 * with no sensible recovery — the same throw-on-author-error rule
 * `model/params.js` applies to declarations.
 *
 * @template T
 * @param {() => number} rng
 * @param {readonly T[]} arr
 * @returns {T}
 */
export function pick(rng, arr) {
  if (arr.length === 0) throw new Error('pick() from an empty array')
  return arr[Math.floor(rng() * arr.length)]
}
