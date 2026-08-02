// @ts-check
/**
 * FR-4 contract tests for the seeded PRNG.
 *
 * Determinism is the product: "the same seed on two different browsers produces
 * the same rendered frame" is what makes sharing mean anything. These tests
 * cover the properties every consumer downstream relies on.
 */

import { suite, test, assert, assertEq, assertClose } from './harness.js'
import { mulberry32, uint32, range, intRange, pick } from '../src/core/rng.js'

/**
 * @param {() => number} rng
 * @param {number} n
 * @returns {number[]}
 */
function draw(rng, n) {
  /** @type {number[]} */
  const out = []
  for (let i = 0; i < n; i++) out.push(rng())
  return out
}

suite('rng — determinism', () => {
  test('the same seed produces an identical stream', () => {
    const a = draw(mulberry32(123456789), 200)
    const b = draw(mulberry32(123456789), 200)
    for (let i = 0; i < a.length; i++) assertEq(a[i], b[i], `draw ${i}`)
  })

  test('a generator is independent of any other generator', () => {
    // Two live streams interleaved must not disturb each other — layers each
    // hold their own generator and draw at different times.
    const solo = draw(mulberry32(42), 50)
    const g1 = mulberry32(42)
    const g2 = mulberry32(99)
    /** @type {number[]} */
    const interleaved = []
    for (let i = 0; i < 50; i++) { interleaved.push(g1()); g2() }
    for (let i = 0; i < 50; i++) assertEq(interleaved[i], solo[i], `draw ${i}`)
  })

  test('different seeds diverge immediately', () => {
    const a = draw(mulberry32(1), 20)
    const b = draw(mulberry32(2), 20)
    let same = 0
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++
    assert(same === 0, `${same} of 20 draws collided between adjacent seeds`)
  })

  test('seed 0 produces a live stream, not a stuck one', () => {
    // A generator that degenerates on a zero seed is a classic failure, and 0
    // is reachable: `uint32()` can legitimately return it.
    const v = draw(mulberry32(0), 20)
    assertEq(new Set(v).size, 20, 'distinct values from seed 0')
  })

  test('seeds are coerced to uint32, so equivalent seeds agree', () => {
    const a = draw(mulberry32(0xdeadbeef), 10)
    const b = draw(mulberry32(-559038737), 10) // the same bits, read as signed
    for (let i = 0; i < a.length; i++) assertEq(a[i], b[i], `draw ${i}`)
  })
})

suite('rng — distribution', () => {
  test('every draw lies in [0, 1)', () => {
    const v = draw(mulberry32(7), 10000)
    for (let i = 0; i < v.length; i++) {
      assert(v[i] >= 0 && v[i] < 1, `draw ${i} was ${v[i]}`)
    }
  })

  test('the stream does not repeat within a composition-sized run', () => {
    const v = draw(mulberry32(2024), 5000)
    // Not an exact-uniqueness assertion. mulberry32 hashes a counter and is not
    // a permutation, so ~0.3% of 5,000-draw runs contain one birthday
    // collision by chance. Demanding 5000/5000 would be asserting a property
    // the generator does not have; a healthy generator will not produce five.
    assert(new Set(v).size >= 4995, `only ${new Set(v).size} of 5000 draws were distinct`)
  })

  test('the mean is near 0.5 and every tenth of the range is hit', () => {
    const v = draw(mulberry32(31337), 20000)
    let sum = 0
    /** @type {number[]} */
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < v.length; i++) {
      sum += v[i]
      buckets[Math.floor(v[i] * 10)]++
    }
    assertClose(sum / v.length, 0.5, 0.02, 'mean')
    for (let b = 0; b < 10; b++) {
      assert(buckets[b] > 1400, `bucket ${b} held only ${buckets[b]} of 20000`)
    }
  })
})

suite('rng — helpers', () => {
  test('uint32 returns whole numbers across the full 32-bit range', () => {
    const rng = mulberry32(555)
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < 5000; i++) {
      const v = uint32(rng)
      assert(Number.isInteger(v), `${v} is not an integer`)
      assert(v >= 0 && v < 4294967296, `${v} outside uint32`)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    assert(lo < 100000000, `low end never sampled (min ${lo})`)
    assert(hi > 4194967296, `high end never sampled (max ${hi})`)
  })

  test('range stays within [min, max)', () => {
    const rng = mulberry32(11)
    for (let i = 0; i < 2000; i++) {
      const v = range(rng, 40, 900)
      assert(v >= 40 && v < 900, `${v} outside [40, 900)`)
    }
  })

  test('range handles a zero-width span', () => {
    const rng = mulberry32(12)
    assertEq(range(rng, 5, 5), 5, 'collapsed range')
  })

  test('intRange is inclusive of both ends and never exceeds them', () => {
    const rng = mulberry32(13)
    const seen = new Set()
    for (let i = 0; i < 4000; i++) {
      const v = intRange(rng, 3, 8)
      assert(Number.isInteger(v), `${v} is not an integer`)
      assert(v >= 3 && v <= 8, `${v} outside [3, 8]`)
      seen.add(v)
    }
    // Inclusivity is the whole point: FR-6 bounds are inclusive, so a layer
    // declaring `rayCount` 3–64 must be able to reach 64.
    assertEq(seen.size, 6, 'every value in [3, 8] reachable')
    assert(seen.has(3) && seen.has(8), 'both endpoints reachable')
  })

  test('intRange with a single-value span returns that value', () => {
    const rng = mulberry32(14)
    for (let i = 0; i < 10; i++) assertEq(intRange(rng, 5, 5), 5, 'single value')
  })

  test('intRange with inverted bounds returns the low end rather than looping', () => {
    const rng = mulberry32(15)
    assertEq(intRange(rng, 9, 2), 9, 'inverted')
  })

  test('pick reaches every element and stays in the array', () => {
    const rng = mulberry32(16)
    const pool = ['a', 'b', 'c', 'd']
    const seen = new Set()
    for (let i = 0; i < 500; i++) {
      const v = pick(rng, pool)
      assert(pool.includes(v), `picked ${v}, which is not in the pool`)
      seen.add(v)
    }
    assertEq(seen.size, 4, 'every element reachable')
  })

  test('pick from an empty array throws — it is a programmer error', () => {
    const rng = mulberry32(17)
    let threw = false
    try { pick(rng, []) } catch { threw = true }
    assert(threw, 'expected pick() to throw on an empty pool')
  })

  test('a fixed draw sequence is reproducible end to end', () => {
    // The consumption-order contract: the same calls in the same order against
    // the same seed must yield the same values. This is what guarantees a
    // layer's derived geometry survives a reload.
    /** @param {number} seed */
    const sequence = (seed) => {
      const rng = mulberry32(seed)
      return [
        intRange(rng, 3, 64),
        range(rng, 0, 400),
        uint32(rng),
        pick(rng, [0, 1, 4, 18]),
        range(rng, 0.05, 1),
      ]
    }
    const a = sequence(987654321)
    const b = sequence(987654321)
    for (let i = 0; i < a.length; i++) assertEq(a[i], b[i], `step ${i}`)
  })
})
