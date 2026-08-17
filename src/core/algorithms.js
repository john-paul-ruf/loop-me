// @ts-check
/**
 * The 24 loop-safe oscillation algorithms (FR-3, architecture §8.1).
 *
 * Each algorithm is a **periodic shape function** of a normalized cycle
 * position `u ∈ [0, 1)`, returning a normalized amplitude in `[0, 1]`.
 * `core/value.js` maps that onto the caller's `[min, max]`.
 *
 * ## The one invariant every curve here must satisfy
 *
 *     fn(0) === lim(u→1) fn(u)
 *
 * The loop must close *continuously*, not merely return the same number at the
 * boundary. FR-3's acceptance criterion — `findValue(…, 0)` equals
 * `findValue(…, totalFrame)` within 1e-9 — is satisfied structurally by
 * `value.js` wrapping the frame with a modulo before it ever reaches here, so
 * that test alone would pass even for a curve with a visible seam. The seam is
 * what the product actually promises against ("you never catch the loop
 * restarting"), so `tests/algorithms.test.js` asserts wrap *continuity*
 * separately, and that is the assertion that matters.
 *
 * Every curve below is therefore built from wrap-safe primitives only:
 * sinusoids at **integer** harmonics of the cycle, functions of `journey()`,
 * periodic phase warps that vanish at both ends, and `bump()`, whose distance
 * measure is taken around the circle. No curve uses a term like `exp(-k·u)` or
 * `1 - u` on its own, because those end the cycle somewhere other than where
 * they began.
 *
 * ## Amplitude normalization
 *
 * Each shape is scanned once at module load and affinely mapped so its range is
 * exactly `[0, 1]`. This is not cosmetic: a curve that only spanned, say,
 * `[0, 0.62]` would quietly deny the user the top 38% of every bound they set,
 * which reads as a broken control rather than a gentle curve. Curves that
 * already span `[0, 1]` analytically are snapped to an exact identity transform
 * so they pass through untouched.
 *
 * The scan is deterministic — the same sample count and the same IEEE-754
 * doubles on every device — so it cannot become a source of cross-device drift
 * (FR-4).
 *
 * ## IDs are append-only forever
 *
 * An algorithm may never be renumbered or removed: the ID is what a seed
 * stores, so renumbering silently repaints every composition ever shared
 * (architecture §8). New algorithms append at 20 and up.
 *
 * Imports `util/clamp.js` only (architecture §4 rule 1).
 */

import { clamp } from '../util/clamp.js'

const TAU = Math.PI * 2
const PI = Math.PI

// ---------------------------------------------------------------------------
// Wrap-safe primitives
// ---------------------------------------------------------------------------

/**
 * The base journey: `sin²(πu)`, rising 0 → 1 → 0 across one cycle. Smooth,
 * periodic, and the parent of half the catalog.
 *
 * @param {number} u
 * @returns {number}
 */
function journey(u) {
  return (1 - Math.cos(TAU * u)) / 2
}

/**
 * Smootherstep with clamped input — zero first *and* second derivative at both
 * ends, which is what makes a plateau look intentional rather than clipped.
 *
 * @param {number} t
 * @returns {number}
 */
function smoother(t) {
  const x = clamp(t, 0, 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/**
 * Distance between two positions **around the cycle**, so 0.98 and 0.02 are
 * 0.04 apart rather than 0.96. This is what lets a bump sit near the loop
 * boundary without tearing it.
 *
 * @param {number} u
 * @param {number} c
 * @returns {number}
 */
function ringDist(u, c) {
  const d = Math.abs(u - c)
  return d > 0.5 ? 1 - d : d
}

/**
 * A gaussian bump centred at `c`, width `w`, measured around the cycle.
 *
 * @param {number} u
 * @param {number} c
 * @param {number} w
 * @returns {number}
 */
function bump(u, c, w) {
  const d = ringDist(u, c) / w
  return Math.exp(-d * d)
}

// ---------------------------------------------------------------------------
// The 24 shape functions
//
// Each takes `u ∈ [0, 1)` and returns an un-normalized amplitude. Range is
// fixed by the load-time scan below, so a shape is free to peak wherever its
// formula naturally does.
// ---------------------------------------------------------------------------

/** 0 — the plain rise and fall. The calmest curve in the library. */
function journeySin(u) {
  return journey(u)
}

/** 1 — squared: a longer dwell at the bottom, a sharper visit to the top. */
function journeySinSquared(u) {
  const j = journey(u)
  return j * j
}

/** 2 — exponential envelope: the top of the travel arrives late and hard. */
function journeyExpEnvelope(u) {
  return (Math.exp(3 * journey(u)) - 1) / (Math.exp(3) - 1)
}

/** 3 — a narrow bell: mostly rest, one decisive peak mid-cycle. */
function journeySteepBell(u) {
  const j = journey(u)
  const j2 = j * j
  const j4 = j2 * j2
  return j4 * j4
}

/** 4 — flat bottom, flat top, quick transits between them. */
function journeyFlatTop(u) {
  return smoother((journey(u) - 0.15) / 0.7)
}

/** 5 — the inverse bell: high at the loop boundary, dipping through the middle. */
function invertedBell(u) {
  const j = journey(u)
  return 1 - j * j
}

/** 6 — two peaks per cycle, deliberately unequal so the pair reads as a phrase. */
function doublePeak(u) {
  const d = (1 - Math.cos(2 * TAU * u)) / 2
  const skew = (1 + Math.sin(TAU * u)) / 2
  return d * (0.55 + 0.45 * skew)
}

/**
 * 7 — fast attack, long decay, windowed so the tail closes the loop cleanly.
 *
 * The attack is shaped by the decay constant, **not** by a fractional power of
 * the window. `sin(πu)^0.6` reads as a snappier attack on paper and has an
 * infinite derivative at `u = 0`: the curve leaves the loop boundary vertically,
 * which is a visible snap at the top of every cycle — precisely the seam FR-3
 * exists to prevent. A plain `sin(πu)` window leaves the boundary at a finite
 * slope, and `exp(-6u)` pulls the peak forward to ~15% of the cycle, which is
 * where the "decay" character actually comes from.
 */
function exponentialDecay(u) {
  return Math.sin(PI * u) * Math.exp(-6 * u)
}

/** 8 — an overshooting settle: four decaying wobbles inside one journey. */
function elasticBounce(u) {
  return journey(u) * (0.6 + 0.4 * Math.sin(TAU * 4 * u) * Math.exp(-3 * u))
}

/** 9 — a soft, broad swell. Slower to leave the top than `journeySin`. */
function breathing(u) {
  return Math.pow(journey(u), 0.65)
}

/** 10 — near-square: long low, long high, brief smooth edges. */
function pulseWave(u) {
  return smoother((journey(u) - 0.42) / 0.16)
}

/** 11 — five ripples riding a single swell. */
function ripple(u) {
  return journey(u) * (0.55 + 0.45 * Math.sin(TAU * 5 * u - PI / 2))
}

/** 12 — lub-dub: two unequal beats close together, then a long rest. */
function heartbeat(u) {
  return Math.max(bump(u, 0.1, 0.045), 0.72 * bump(u, 0.26, 0.05))
}

/** 13 — slow gather, sudden break, fast wash-out. Asymmetric by phase warp. */
function waveCrash(u) {
  const sk = u + 0.18 * Math.sin(TAU * u)
  return Math.pow((1 - Math.cos(TAU * sk)) / 2, 1.5)
}

/** 14 — long dormancy, one violent burst with a tremor inside it. */
function volcanic(u) {
  const j = journey(u)
  const j2 = j * j
  const j4 = j2 * j2
  const j8 = j4 * j4
  return j8 * j4 * j2 * (0.8 + 0.2 * Math.sin(TAU * 6 * u))
}

/** 15 — accelerating away from the start: the warp front-loads the travel. */
function spiralOut(u) {
  const sk = u - 0.2 * Math.sin(TAU * u)
  return (1 - Math.cos(TAU * sk)) / 2
}

/** 16 — the mirror of `spiralOut`: the travel arrives late and tightens. */
function spiralIn(u) {
  const sk = u + 0.2 * Math.sin(TAU * u)
  return (1 - Math.cos(TAU * sk)) / 2
}

/** 17 — three harmonics of unequal weight: a ridge line of uneven peaks. */
function mountainRange(u) {
  return 0.5 + 0.5 * (
    0.55 * Math.sin(TAU * u - PI / 2) +
    0.3 * Math.sin(TAU * 2 * u + 0.9) +
    0.15 * Math.sin(TAU * 3 * u + 2.1)
  )
}

/** 18 — a deep primary swell with one slow secondary. The slowest-reading curve. */
function oceanTide(u) {
  return 0.5 + 0.5 * (
    0.8 * Math.sin(TAU * u - PI / 2) +
    0.2 * Math.sin(TAU * 2 * u - PI / 2)
  )
}

/** 19 — high odd harmonics: erratic, fluttering, never quite repeating within the cycle. */
function butterfly(u) {
  return 0.5 + 0.5 * (
    0.45 * Math.sin(TAU * u) +
    0.3 * Math.sin(TAU * 3 * u + 1.3) +
    0.25 * Math.sin(TAU * 5 * u + 2.7)
  )
}

/**
 * 20 — a smoothed staircase riding the journey: rise in steps, fall in steps.
 * @param {number} u
 * @returns {number}
 */
function staccatoSteps(u) {
  const s = 4
  const j = journey(u) * s
  const step = Math.floor(j)
  return (step + smoother(j - step)) / s
}

/**
 * 21 — three swings under one swell, each softer than the last half.
 * @param {number} u
 * @returns {number}
 */
function pendulum(u) {
  return Math.abs(Math.sin(3 * Math.PI * u)) * journey(u)
}

/**
 * 22 — two lobes, big then small: a figure-eight's near and far pass.
 * @param {number} u
 * @returns {number}
 */
function figureEight(u) {
  return journey(2 * u) * (0.65 + 0.35 * Math.sin(TAU * u))
}

/**
 * 23 — a single swell with a fine shiver riding it.
 * @param {number} u
 * @returns {number}
 */
function tremor(u) {
  return journey(u) * (0.82 + 0.18 * Math.cos(12 * TAU * u))
}

// ---------------------------------------------------------------------------
// The registry — APPEND ONLY
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Algorithm
 * @property {number} id     Stable, append-only (architecture §8.1).
 * @property {string} name   Also the UI label in the Advanced disclosure (FR-11).
 * @property {(u: number) => number} fn  Raw shape; see `evaluate` for the normalized form.
 * @property {number} phase  Fixed cycle offset in `[0, 1)`. See PHASE OFFSETS below.
 */

/**
 * ## PHASE OFFSETS — PROVISIONAL, PENDING THE `my-nft-gen` PORT
 *
 * FR-3 and `requirements.md` §Dependencies specify that each algorithm carries
 * "a fixed deterministic phase offset (as in the source implementation)", and
 * name `my-nft-gen` as the reference for correctness. **That source is not in
 * this repository and was not reachable from the build session that wrote this
 * file** — no filesystem copy, no network, no package manifest to resolve.
 *
 * The offsets below are therefore *derived, not ported*. They follow one
 * documented rule rather than per-curve taste, so they are reproducible and
 * reviewable:
 *
 *     phase(i) = frac(i × φ),  φ = 0.6180339887498949
 *
 * The golden ratio gives a low-discrepancy sequence — any two algorithms in the
 * set land far apart on the cycle — which delivers exactly the property FR-3
 * asks the offsets for: layers on different algorithms peak at staggered times
 * rather than pulsing in unison. `journeySin` keeps phase 0 so the default
 * algorithm still starts a composition at the bottom of its travel.
 *
 * **What this costs.** Every FR-3 contract — loop closure, bounds, continuity,
 * fractional input — holds by construction and is asserted by the suite. What
 * differs from the reference is *which* stagger you get: a composition renders
 * a valid loop, but not bit-for-bit the one `my-nft-gen` would produce.
 *
 * **Retiring it is a one-table edit.** Replace the `phase` column below with
 * the reference constants; nothing else in the project reads a phase, and no
 * shape function depends on one. Seeds do not store phases, so a later swap
 * breaks no existing seed — it only changes rendered stagger.
 *
 * @type {readonly Algorithm[]}
 */
export const ALGORITHMS = Object.freeze([
  Object.freeze({ id: 0, name: 'journeySin', fn: journeySin, phase: 0 }),
  Object.freeze({ id: 1, name: 'journeySinSquared', fn: journeySinSquared, phase: 0.618034 }),
  Object.freeze({ id: 2, name: 'journeyExpEnvelope', fn: journeyExpEnvelope, phase: 0.236068 }),
  Object.freeze({ id: 3, name: 'journeySteepBell', fn: journeySteepBell, phase: 0.854102 }),
  Object.freeze({ id: 4, name: 'journeyFlatTop', fn: journeyFlatTop, phase: 0.472136 }),
  Object.freeze({ id: 5, name: 'invertedBell', fn: invertedBell, phase: 0.09017 }),
  Object.freeze({ id: 6, name: 'doublePeak', fn: doublePeak, phase: 0.708204 }),
  Object.freeze({ id: 7, name: 'exponentialDecay', fn: exponentialDecay, phase: 0.326238 }),
  Object.freeze({ id: 8, name: 'elasticBounce', fn: elasticBounce, phase: 0.944272 }),
  Object.freeze({ id: 9, name: 'breathing', fn: breathing, phase: 0.562306 }),
  Object.freeze({ id: 10, name: 'pulseWave', fn: pulseWave, phase: 0.18034 }),
  Object.freeze({ id: 11, name: 'ripple', fn: ripple, phase: 0.798374 }),
  Object.freeze({ id: 12, name: 'heartbeat', fn: heartbeat, phase: 0.416408 }),
  Object.freeze({ id: 13, name: 'waveCrash', fn: waveCrash, phase: 0.034442 }),
  Object.freeze({ id: 14, name: 'volcanic', fn: volcanic, phase: 0.652476 }),
  Object.freeze({ id: 15, name: 'spiralOut', fn: spiralOut, phase: 0.27051 }),
  Object.freeze({ id: 16, name: 'spiralIn', fn: spiralIn, phase: 0.888544 }),
  Object.freeze({ id: 17, name: 'mountainRange', fn: mountainRange, phase: 0.506578 }),
  Object.freeze({ id: 18, name: 'oceanTide', fn: oceanTide, phase: 0.124612 }),
  Object.freeze({ id: 19, name: 'butterfly', fn: butterfly, phase: 0.742646 }),
  Object.freeze({ id: 20, name: 'staccatoSteps', fn: staccatoSteps, phase: 0.36068 }),
  Object.freeze({ id: 21, name: 'pendulum', fn: pendulum, phase: 0.978714 }),
  Object.freeze({ id: 22, name: 'figureEight', fn: figureEight, phase: 0.596748 }),
  Object.freeze({ id: 23, name: 'tremor', fn: tremor, phase: 0.214782 }),
])

/** How many algorithms exist. Grows; never shrinks. */
export const ALGORITHM_COUNT = ALGORITHMS.length

// ---------------------------------------------------------------------------
// Hot-path tables
//
// `evaluate()` runs once per animatable parameter per layer per frame — for a
// 5-layer composition that is on the order of 150 calls at 60 Hz. Parallel
// typed arrays keep that path to indexed reads instead of walking a frozen
// object graph, and allocate nothing.
// ---------------------------------------------------------------------------

/** @type {((u: number) => number)[]} */
const FNS = ALGORITHMS.map((a) => a.fn)
const PHASES = Float64Array.from(ALGORITHMS, (a) => a.phase)
const OFFSETS = new Float64Array(ALGORITHM_COUNT)
const SCALES = new Float64Array(ALGORITHM_COUNT)

/**
 * Samples used to measure each curve's natural range. 4096 is far finer than
 * the ~1800 frames of the longest loop, so the measured extremes are at least
 * as tight as anything a viewer can land on.
 */
const SCAN_SAMPLES = 4096

/** Below this, a measured endpoint is treated as exactly 0 or exactly 1. */
const SNAP = 1e-6

for (let i = 0; i < ALGORITHM_COUNT; i++) {
  const fn = FNS[i]
  let lo = Infinity
  let hi = -Infinity
  for (let k = 0; k < SCAN_SAMPLES; k++) {
    const v = fn(k / SCAN_SAMPLES)
    if (Number.isFinite(v)) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!(hi > lo)) {
    // A constant (or entirely non-finite) shape. Pass it through untouched
    // rather than dividing by zero; the suite's span assertion catches it.
    lo = 0
    hi = 1
  }
  if (Math.abs(lo) < SNAP) lo = 0
  if (Math.abs(hi - 1) < SNAP) hi = 1
  OFFSETS[i] = lo
  SCALES[i] = 1 / (hi - lo)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Coerce any value to a usable algorithm ID.
 *
 * An unknown ID resolves to `0` rather than throwing — a decoded seed is
 * untrusted input, and an algorithm that was added after this build shipped is
 * exactly the forward-tolerance case architecture §9.5 requires be repaired
 * silently.
 *
 * @param {number} id
 * @returns {number}
 */
export function coerceAlgorithm(id) {
  return Number.isInteger(id) && id >= 0 && id < ALGORITHM_COUNT ? id : 0
}

/**
 * The display name for an ID, for the Advanced disclosure's algorithm list
 * (FR-11).
 *
 * @param {number} id
 * @returns {string}
 */
export function algorithmName(id) {
  return ALGORITHMS[coerceAlgorithm(id)].name
}

/**
 * Evaluate an algorithm at a cycle position, normalized to `[0, 1]`.
 *
 * `cycles` counts **whole cycles elapsed** and may exceed 1 or be fractional;
 * the algorithm's fixed phase offset is added here and the result wrapped, so
 * phase stays private to this module. Allocates nothing.
 *
 * @param {number} algorithmId
 * @param {number} cycles
 * @returns {number} A value in `[0, 1]`, inclusive.
 */
export function evaluate(algorithmId, cycles) {
  const i = coerceAlgorithm(algorithmId)
  const t = cycles + PHASES[i]
  if (!Number.isFinite(t)) return 0
  const u = t - Math.floor(t)
  return clamp((FNS[i](u) - OFFSETS[i]) * SCALES[i], 0, 1)
}
