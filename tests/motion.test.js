// @ts-check
/**
 * FR-11 contract tests for motion characters and algorithm-pool assignment.
 *
 * The critical assertion is that the union of all eight pools is exactly the
 * 24 algorithm IDs — this is the FR-11 acceptance criterion. Also covers
 * `assign`, `speed`, and `reroll` behaviour.
 *
 * A synthetic layer module (id 901) is registered so that `motion.assign` can
 * look up params from the registry by `layer.type`. The ID is far outside the
 * real catalog range (1–16) to avoid collision.
 */

import { suite, test, assert, assertEq } from './harness.js'
import {
  CHARACTERS,
  CHARACTER_COUNT,
  ALL_POOL_IDS,
  getCharacter,
  characterByIndex,
  assign,
  speed,
  reroll,
} from '../src/model/motion.js'
import { ALGORITHM_COUNT } from '../src/core/algorithms.js'
import { mulberry32 } from '../src/core/rng.js'
import { A, S, TIMES_MIN, TIMES_MAX } from '../src/model/params.js'
import { register } from '../src/model/registry.js'

// ---------------------------------------------------------------------------
// Test fixture: a synthetic layer module registered into the real registry
// ---------------------------------------------------------------------------

/** @type {import('../src/model/registry.js').LayerModule} */
const MOTION_TEST_LAYER = {
  meta: {
    id: 901,
    name: 'Motion Test Layer',
    role: 'primary',
    blurb: 'Synthetic layer for motion tests.',
    worstCase: { pathOps: 1, drawCalls: 1 },
    fullCanvasOpaque: false,
  },
  params: [
    S.int('count', 3, 64),
    A('radius', 60, 800),
    A('rotation', 0, 360, { wrap: true, unit: '°' }),
    S.bool('filled'),
    A('weight', 1, 20),
  ],
  prepare: () => ({}),
  draw: () => {},
}

register(MOTION_TEST_LAYER)

/**
 * Build a test layer with default params.
 * @returns {import('../src/model/params.js').Layer}
 */
function makeLayer() {
  return {
    type: 901,
    blend: 0,
    rngSeed: 12345,
    color: 'c0',
    opacity: { min: 0.05, max: 1.0, times: 1, algorithm: 0 },
    params: {
      count: 3,
      radius: { min: 60, max: 800, times: 1, algorithm: 0 },
      rotation: { min: 0, max: 360, times: 1, algorithm: 0 },
      filled: false,
      weight: { min: 1, max: 20, times: 1, algorithm: 0 },
    },
    errored: false,
  }
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

suite('motion — character pools (FR-11)', () => {
  test('exactly eight characters', () => {
    assertEq(CHARACTER_COUNT, 8, 'FR-11 names eight characters')
    assertEq(CHARACTERS.length, 8)
  })

  test('names are the pinned eight, in order', () => {
    const names = CHARACTERS.map((c) => c.name).join('|')
    assertEq(names, 'Calm|Breathing|Pulse|Tidal|Heartbeat|Chaotic|Staccato|Drift')
  })

  test('every pool contains only valid algorithm IDs', () => {
    for (const c of CHARACTERS) {
      assert(c.pool.length > 0, `${c.name}: pool is empty`)
      for (const id of c.pool) {
        assert(
          Number.isInteger(id) && id >= 0 && id < ALGORITHM_COUNT,
          `${c.name}: pool contains invalid ID ${id}`,
        )
      }
    }
  })

  test('the union of all eight pools is exactly the 24 algorithm IDs (FR-11 AC)', () => {
    // This is the single most important assertion in this suite. FR-11:
    // "Every one of the algorithms belongs to at least one character pool."
    assertEq(ALL_POOL_IDS.length, ALGORITHM_COUNT, `union has ${ALL_POOL_IDS.length}, expected ${ALGORITHM_COUNT}`)
    for (let i = 0; i < ALGORITHM_COUNT; i++) {
      assert(ALL_POOL_IDS.includes(i), `algorithm ${i} is missing from every pool`)
    }
    // No extras
    assertEq(ALL_POOL_IDS[0], 0)
    assertEq(ALL_POOL_IDS[ALL_POOL_IDS.length - 1], ALGORITHM_COUNT - 1)
  })

  test('no pool is empty and no pool exceeds the algorithm count', () => {
    for (const c of CHARACTERS) {
      assert(c.pool.length >= 4, `${c.name}: pool has only ${c.pool.length} entries (expected >= 4)`)
      assert(c.pool.length <= ALGORITHM_COUNT, `${c.name}: pool exceeds the algorithm count`)
    }
  })

  test('pools are frozen', () => {
    let threw = false
    try { /** @type {any} */ (CHARACTERS[0].pool).push(99) } catch { threw = true }
    assert(threw, 'pools must be frozen')
  })
})

suite('motion — lookups', () => {
  test('getCharacter is case-insensitive and returns null for unknown', () => {
    assertEq(getCharacter('Calm')?.name, 'Calm')
    assertEq(getCharacter('calm')?.name, 'Calm')
    assertEq(getCharacter('CALM')?.name, 'Calm')
    assertEq(getCharacter('Unknown'), null)
    assertEq(getCharacter(''), null)
    // @ts-expect-error — testing runtime guard: number is not assignable to string
    assertEq(getCharacter(42), null)
  })

  test('characterByIndex', () => {
    assertEq(characterByIndex(0)?.name, 'Calm')
    assertEq(characterByIndex(5)?.name, 'Chaotic')
    assertEq(characterByIndex(6), null)
    assertEq(characterByIndex(-1), null)
  })
})

suite('motion — assign', () => {
  test('assigns algorithms to every A param, in declaration order', () => {
    const layer = makeLayer()
    const calm = getCharacter('Calm')
    assert(calm !== null)
    const rng = mulberry32(layer.rngSeed)
    assign(layer, calm, rng)

    // Every A param should now have an algorithm from the Calm pool
    for (const name of ['radius', 'rotation', 'weight']) {
      const av = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params[name])
      assert(typeof av === 'object' && av !== null, `${name}: not an AnimValue`)
      assert(
        calm.pool.includes(av.algorithm),
        `${name}: algorithm ${av.algorithm} is not in the Calm pool [${calm.pool.join(',')}]`,
      )
    }
  })

  test('does not touch static params', () => {
    const layer = makeLayer()
    const calm = getCharacter('Calm')
    assert(calm !== null)
    const rng = mulberry32(layer.rngSeed)
    assign(layer, calm, rng)

    assertEq(layer.params.count, 3, 'S.int untouched')
    assertEq(layer.params.filled, false, 'S.bool untouched')
  })

  test('the same seed and character produce the same assignment', () => {
    const a = makeLayer()
    const b = makeLayer()
    const calm = getCharacter('Calm')
    assert(calm !== null)

    assign(a, calm, mulberry32(a.rngSeed))
    assign(b, calm, mulberry32(b.rngSeed))

    for (const name of ['radius', 'rotation', 'weight']) {
      const avA = /** @type {import('../src/model/params.js').AnimValue} */ (a.params[name])
      const avB = /** @type {import('../src/model/params.js').AnimValue} */ (b.params[name])
      assertEq(avA.algorithm, avB.algorithm, `${name}: same seed should give same algorithm`)
      assertEq(avA.times, avB.times, `${name}: same seed should give same times`)
    }
  })

  test('different seeds produce different assignments (statistically)', () => {
    // Not a strict assertion — with 4-element pools and 3 A params, there is a
    // small chance two adjacent seeds produce the same triple. Run 20 pairs
    // and assert at least 15 differ.
    let differ = 0
    for (let s = 0; s < 20; s++) {
      const a = makeLayer()
      const b = makeLayer()
      a.rngSeed = s * 1000
      b.rngSeed = s * 1000 + 1
      const calm = getCharacter('Calm')
      assert(calm !== null)
      assign(a, calm, mulberry32(a.rngSeed))
      assign(b, calm, mulberry32(b.rngSeed))

      let anyDiff = false
      for (const name of ['radius', 'rotation', 'weight']) {
        const avA = /** @type {import('../src/model/params.js').AnimValue} */ (a.params[name])
        const avB = /** @type {import('../src/model/params.js').AnimValue} */ (b.params[name])
        if (avA.algorithm !== avB.algorithm || avA.times !== avB.times) anyDiff = true
      }
      if (anyDiff) differ++
    }
    assert(differ >= 15, `only ${differ} of 20 seed pairs produced different assignments`)
  })

  test('times is set within [1, 4]', () => {
    const layer = makeLayer()
    const chaotic = getCharacter('Chaotic')
    assert(chaotic !== null)
    assign(layer, chaotic, mulberry32(999))

    for (const name of ['radius', 'rotation', 'weight']) {
      const av = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params[name])
      assert(av.times >= 1 && av.times <= 4, `${name}: times ${av.times} outside [1, 4]`)
    }
  })
})

suite('motion — speed', () => {
  test('scales times by the factor, clamped to 1–8', () => {
    const layer = makeLayer()
    // Set known times values
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)).times = 2
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.rotation)).times = 4
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.weight)).times = 1

    speed(layer, 2)

    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius).times, 4, '2 × 2 = 4')
    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.rotation).times, 8, '4 × 2 = 8 (clamped)')
    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.weight).times, 2, '1 × 2 = 2')
  })

  test('does not touch static params', () => {
    const layer = makeLayer()
    speed(layer, 3)
    assertEq(layer.params.count, 3, 'S.int untouched')
    assertEq(layer.params.filled, false, 'S.bool untouched')
  })

  test('factor is clamped to [0.25, 3]', () => {
    const layer = makeLayer()
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)).times = 4

    // ×0.1 → clamped to ×0.25 → 4 × 0.25 = 1
    speed(layer, 0.1)
    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius).times, 1, '0.1 clamps to 0.25')

    // ×10 → clamped to ×3 → 1 × 3 = 3
    speed(layer, 10)
    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius).times, 3, '10 clamps to 3')
  })

  test('resulting times never exceeds 8 or goes below 1', () => {
    const layer = makeLayer()
    // Set extreme times
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)).times = 8
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.rotation)).times = 1
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.weight)).times = 4

    speed(layer, 3)

    for (const name of ['radius', 'rotation', 'weight']) {
      const av = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params[name])
      assert(av.times >= TIMES_MIN, `${name}: times ${av.times} below ${TIMES_MIN}`)
      assert(av.times <= TIMES_MAX, `${name}: times ${av.times} above ${TIMES_MAX}`)
    }
  })
})

suite('motion — reroll', () => {
  test('reroll changes at least one assignment within the same character', () => {
    const layer = makeLayer()
    const calm = getCharacter('Calm')
    assert(calm !== null)

    // First assignment
    assign(layer, calm, mulberry32(layer.rngSeed))

    // Reroll with a different seed
    const changed = reroll(layer, calm, mulberry32(layer.rngSeed + 1))
    assert(changed, 'reroll should change at least one assignment')

    // Verify algorithms are still from the pool
    for (const name of ['radius', 'rotation', 'weight']) {
      const av = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params[name])
      assert(calm.pool.includes(av.algorithm), `${name}: rerolled algorithm ${av.algorithm} not in pool`)
    }
  })

  test('reroll with the same seed produces the same result', () => {
    const a = makeLayer()
    const b = makeLayer()
    const calm = getCharacter('Calm')
    assert(calm !== null)

    assign(a, calm, mulberry32(a.rngSeed))
    assign(b, calm, mulberry32(b.rngSeed))

    reroll(a, calm, mulberry32(a.rngSeed + 77))
    reroll(b, calm, mulberry32(b.rngSeed + 77))

    for (const name of ['radius', 'rotation', 'weight']) {
      const avA = /** @type {import('../src/model/params.js').AnimValue} */ (a.params[name])
      const avB = /** @type {import('../src/model/params.js').AnimValue} */ (b.params[name])
      assertEq(avA.algorithm, avB.algorithm, `${name}: same reroll seed should match`)
      assertEq(avA.times, avB.times, `${name}: same reroll seed should match times`)
    }
  })
})