// @ts-check
/**
 * FR-3 contract tests for the value engine.
 *
 * This is the highest-risk correctness surface in the project: if loop closure
 * is wrong, the product's central promise — that you never catch the loop
 * restarting — is broken in a way no amount of UI work can hide. So these
 * assertions are written against the *contract*, not against the current
 * formulae, and every one of them must keep passing when a twenty-first
 * algorithm is appended.
 */

import { suite, test, assert, assertEq, assertClose } from './harness.js'
import { ALGORITHMS, ALGORITHM_COUNT, algorithmName, coerceAlgorithm, evaluate } from '../src/core/algorithms.js'
import { findValue } from '../src/core/value.js'

/**
 * The exact ordering, pinned (FR-3 AC: "Algorithm ID ↔ name mapping is defined
 * in one place and covered by a test asserting the exact ordering").
 *
 * APPEND ONLY. If a future session needs to change an existing entry of this
 * array, the change is wrong: the ID is what a seed stores, so renumbering
 * repaints every composition ever shared.
 */
const PINNED = [
  'journeySin',
  'journeySinSquared',
  'journeyExpEnvelope',
  'journeySteepBell',
  'journeyFlatTop',
  'invertedBell',
  'doublePeak',
  'exponentialDecay',
  'elasticBounce',
  'breathing',
  'pulseWave',
  'ripple',
  'heartbeat',
  'waveCrash',
  'volcanic',
  'spiralOut',
  'spiralIn',
  'mountainRange',
  'oceanTide',
  'butterfly',
  'staccatoSteps',
  'pendulum',
  'figureEight',
  'tremor',
]

suite('algorithms — registry', () => {
  test('all 24 are present, in the pinned order', () => {
    assert(ALGORITHM_COUNT >= PINNED.length, `expected at least ${PINNED.length} algorithms`)
    for (let i = 0; i < PINNED.length; i++) {
      assertEq(ALGORITHMS[i].name, PINNED[i], `algorithm ${i} name`)
      assertEq(ALGORITHMS[i].id, i, `algorithm ${i} id`)
    }
  })

  test('ids are their own index, so a seed can index directly', () => {
    for (let i = 0; i < ALGORITHM_COUNT; i++) assertEq(ALGORITHMS[i].id, i, `id at ${i}`)
  })

  test('names are unique', () => {
    const names = new Set(ALGORITHMS.map((a) => a.name))
    assertEq(names.size, ALGORITHM_COUNT, 'distinct names')
  })

  test('phase offsets are in [0, 1) and distinct', () => {
    const seen = new Set()
    for (const a of ALGORITHMS) {
      assert(a.phase >= 0 && a.phase < 1, `${a.name}: phase ${a.phase} outside [0, 1)`)
      assert(!seen.has(a.phase), `${a.name}: phase ${a.phase} collides with another algorithm`)
      seen.add(a.phase)
    }
  })

  test('unknown ids coerce to 0 rather than throwing', () => {
    assertEq(coerceAlgorithm(-1), 0, 'negative')
    assertEq(coerceAlgorithm(ALGORITHM_COUNT), 0, 'past the end')
    assertEq(coerceAlgorithm(1.5), 0, 'fractional')
    assertEq(coerceAlgorithm(NaN), 0, 'NaN')
    assertEq(algorithmName(9999), 'journeySin', 'name of an unknown id')
  })
})

suite('algorithms — shape contract', () => {
  test('every curve stays within [0, 1] across a fine sweep', () => {
    const N = 2000
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      for (let k = 0; k <= N; k++) {
        const v = evaluate(i, k / N)
        assert(
          Number.isFinite(v) && v >= 0 && v <= 1,
          `${ALGORITHMS[i].name}: evaluate at ${k / N} produced ${v}`,
        )
      }
    }
  })

  test('every curve closes continuously at the wrap', () => {
    // The seam test, and the reason this suite exists. A curve built from a
    // non-periodic term — exp(-ku), 1-u, a raw ramp — passes loop closure
    // (value.js wraps the frame, so the numbers match) and still tears visibly.
    //
    // Sampled on the RAW shape, not through `evaluate`: `evaluate` adds the
    // algorithm's phase offset, so `evaluate(i, 1-ε)` and `evaluate(i, 0)`
    // straddle an arbitrary interior point rather than the seam. The seam of
    // the shape itself is always at u = 0. Normalization is affine, so
    // continuity of the raw shape implies continuity of the normalized one.
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      const fn = ALGORITHMS[i].fn
      let lo = Infinity
      let hi = -Infinity
      for (let k = 0; k < 2048; k++) {
        const v = fn(k / 2048)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      const span = hi - lo
      assertClose(
        fn(1 - 1e-7),
        fn(0),
        1e-3 * span,
        `${ALGORITHMS[i].name}: discontinuity at the loop boundary`,
      )
    }
  })

  test('no curve leaves the loop boundary vertically', () => {
    // Continuity is not enough on its own: a curve can meet itself exactly at
    // the seam and still take off with an unbounded slope, which reads as a
    // snap rather than a loop. Measure how much of its own range the curve
    // covers in the first thousandth of a cycle.
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      const fn = ALGORITHMS[i].fn
      let lo = Infinity
      let hi = -Infinity
      for (let k = 0; k < 2048; k++) {
        const v = fn(k / 2048)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      const span = hi - lo || 1
      // 0.05 is deliberately tight. The worst legitimate curve here is
      // `exponentialDecay` at ~0.017; the `sin(πu)^0.6` attack it was first
      // written with sits at ~0.079, so a looser threshold would have let
      // exactly the defect this test exists to catch through.
      const leaving = Math.abs(fn(0.001) - fn(0)) / span
      assert(
        leaving < 0.05,
        `${ALGORITHMS[i].name}: moves ${(leaving * 100).toFixed(1)}% of its range in the first 0.1% of the cycle`,
      )
    }
  })

  test('every curve uses most of its range, so no bound is quietly unreachable', () => {
    const N = 2000
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      let lo = Infinity
      let hi = -Infinity
      for (let k = 0; k <= N; k++) {
        const v = evaluate(i, k / N)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      assert(hi - lo >= 0.9, `${ALGORITHMS[i].name}: spans only ${(hi - lo).toFixed(3)} of [0, 1]`)
      assert(lo <= 0.05, `${ALGORITHMS[i].name}: never reaches the bottom (min ${lo.toFixed(3)})`)
      assert(hi >= 0.95, `${ALGORITHMS[i].name}: never reaches the top (max ${hi.toFixed(3)})`)
    }
  })

  test('curves are not all the same curve', () => {
    // Cheap guard against a copy-paste that leaves two entries identical.
    const probes = [0.07, 0.21, 0.38, 0.54, 0.71, 0.89]
    /** @type {Map<string, string>} */
    const seen = new Map()
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      // Sample the raw shape, not `evaluate` — two curves may legitimately
      // share a phase-shifted profile, but not an identical unshifted one.
      const sig = probes.map((u) => ALGORITHMS[i].fn(u).toFixed(6)).join(',')
      const clash = seen.get(sig)
      assert(clash === undefined, `${ALGORITHMS[i].name} is identical to ${clash}`)
      seen.set(sig, ALGORITHMS[i].name)
    }
  })
})

suite('value — findValue contract', () => {
  const TOTALS = [300, 900, 1800]

  test('closes the loop: frame 0 equals frame totalFrame, exactly', () => {
    // FR-3 AC allows 1e-9; the modulo in value.js makes it exact, and asserting
    // exactness is what would catch a future refactor that reintroduces drift.
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      for (const total of TOTALS) {
        for (const times of [1, 2, 3, 5, 8]) {
          const a = findValue(0, 100, times, total, 0, i)
          const b = findValue(0, 100, times, total, total, i)
          assertEq(a, b, `${ALGORITHMS[i].name}: total ${total}, times ${times}`)
        }
      }
    }
  })

  test('stays within [min, max] inclusive across a full fractional sweep', () => {
    const total = 300
    const N = 1200 // 4 samples per frame — fractional inputs, as the clock produces
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      for (const [min, max] of [[0, 1], [0.05, 1], [-30, 30], [40, 900], [0, 360]]) {
        for (let k = 0; k <= N; k++) {
          const v = findValue(min, max, 3, total, (k / N) * total, i)
          assert(
            v >= min && v <= max,
            `${ALGORITHMS[i].name}: ${v} outside [${min}, ${max}] at sample ${k}`,
          )
        }
      }
    }
  })

  test('output is continuous — no jump between adjacent frames', () => {
    const total = 300
    const N = 3000
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      let prev = findValue(0, 1, 8, total, 0, i)
      for (let k = 1; k <= N; k++) {
        const v = findValue(0, 1, 8, total, (k / N) * total, i)
        assert(
          Math.abs(v - prev) < 0.2,
          `${ALGORITHMS[i].name}: jumped ${Math.abs(v - prev).toFixed(3)} at sample ${k}`,
        )
        prev = v
      }
    }
  })

  test('fractional frames interpolate rather than snap', () => {
    const a = findValue(0, 1, 1, 300, 74, 0)
    const mid = findValue(0, 1, 1, 300, 74.5, 0)
    const b = findValue(0, 1, 1, 300, 75, 0)
    assert(
      (mid > a && mid < b) || (mid < a && mid > b),
      `expected ${mid} to lie between ${a} and ${b}`,
    )
  })

  test('the FR-3 edge cases return min', () => {
    assertEq(findValue(5, 5, 3, 300, 120, 0), 5, 'max === min')
    assertEq(findValue(5, 90, 3, 0, 120, 0), 5, 'totalFrame === 0')
    assertEq(findValue(5, 90, 0, 300, 120, 0), 5, 'times === 0')
    assertEq(findValue(5, 90, -2, 300, 120, 0), 5, 'negative times')
    assertEq(findValue(5, 90, 3, -300, 120, 0), 5, 'negative totalFrame')
    assertEq(findValue(5, 90, 3, 300, NaN, 0), 5, 'non-finite frame')
    assertEq(findValue(NaN, 90, 3, 300, 120, 0), NaN, 'non-finite min returns min')
    assertEq(findValue(90, 5, 3, 300, 120, 0), 90, 'inverted bounds return min')
  })

  test('an unknown algorithm id falls back to 0 instead of failing the frame', () => {
    const expected = findValue(0, 100, 2, 300, 137.5, 0)
    assertEq(findValue(0, 100, 2, 300, 137.5, 9999), expected, 'past the end')
    assertEq(findValue(0, 100, 2, 300, 137.5, -3), expected, 'negative')
  })

  test('frames past the end of the loop wrap rather than running away', () => {
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      const at50 = findValue(0, 100, 3, 300, 50, i)
      assertEq(findValue(0, 100, 3, 300, 350, i), at50, `${ALGORITHMS[i].name}: one loop on`)
      assertEq(findValue(0, 100, 3, 300, 950, i), at50, `${ALGORITHMS[i].name}: three loops on`)
      assertEq(findValue(0, 100, 3, 300, -250, i), at50, `${ALGORITHMS[i].name}: one loop back`)
    }
  })

  test('different algorithms peak at staggered times (the point of the phase offsets)', () => {
    // FR-3: "so that layers using different algorithms peak at staggered
    // times". Assert the population is spread rather than checking any one
    // offset, so this survives the my-nft-gen port replacing the phase table.
    const total = 300
    /** @type {number[]} */
    const peaks = []
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      let best = 0
      let bestAt = 0
      for (let k = 0; k < total; k++) {
        const v = findValue(0, 1, 1, total, k, i)
        if (v > best) { best = v; bestAt = k / total }
      }
      peaks.push(bestAt)
    }
    const distinct = new Set(peaks.map((p) => Math.round(p * 10)))
    assert(distinct.size >= 6, `peaks cluster into only ${distinct.size} tenths of the loop`)
  })
})
