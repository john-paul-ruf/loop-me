// @ts-check
/**
 * Contract tests for the composition model.
 *
 * Covers: clamp repairs out-of-bounds values, missing trailing params take
 * declared defaults, unknown blend clamps to normal, unknown layer type is
 * skipped, and validate accepts a well-formed composition.
 *
 * These tests use a synthetic layer module registered into the real registry
 * so that `composition.clampLayer` and `composition.validate` have something
 * to clamp against. The module is registered with a high ID (900) to avoid
 * colliding with the real catalog (1–16, added in D1–D4) and is never
 * unregistered — registration is permanent by design (architecture §8.2), and
 * the test's ID is far outside the seed range.
 */

import { suite, test, assert, assertEq } from './harness.js'
import {
  DURATIONS,
  totalFrames,
  create,
  clone,
  createLayer,
  defaults,
  clampLayer,
  clampComposition,
  validate,
} from '../src/model/composition.js'
import { register } from '../src/model/registry.js'
import { A, S, TIMES_MIN, TIMES_MAX } from '../src/model/params.js'
import { BLEND_NORMAL } from '../src/model/blend.js'
import { BUILTINS, resolveRef, background, buildPalette, parseHexColor } from '../src/model/schemes.js'

// ---------------------------------------------------------------------------
// Test fixture: a synthetic layer module
// ---------------------------------------------------------------------------

/** @type {import('../src/model/registry.js').LayerModule} */
const TEST_LAYER = {
  meta: {
    id: 900,
    name: 'Test Layer',
    role: 'primary',
    blurb: 'Synthetic layer for composition tests.',
    worstCase: { pathOps: 1, drawCalls: 1 },
    fullCanvasOpaque: false,
  },
  params: [
    S.int('count', 3, 64),
    A('radius', 60, 800),
    A('rotation', 0, 360, { wrap: true, unit: '°' }),
    S.bool('filled', { default: true }),
    S.enum('mode', ['solid', 'dashed']),
    S.num('rate', 0.5, 3.0, { default: 1 }),
  ],
  prepare: () => ({}),
  draw: () => {},
}

// Register once — registration is permanent.
register(TEST_LAYER)

/**
 * Make a fresh test layer with valid defaults.
 * @returns {import('../src/model/params.js').Layer}
 */
function makeTestLayer() {
  const layer = createLayer(900)
  assert(layer !== null, 'createLayer(900) should succeed')
  return /** @type {import('../src/model/params.js').Layer} */ (layer)
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

suite('composition — durations (FR-2)', () => {
  test('exactly three durations: 5, 15, 30', () => {
    assertEq(DURATIONS.length, 3)
    assertEq(DURATIONS[0], 5)
    assertEq(DURATIONS[1], 15)
    assertEq(DURATIONS[2], 30)
  })

  test('totalFrames = duration × 60', () => {
    assertEq(totalFrames(0), 300)
    assertEq(totalFrames(1), 900)
    assertEq(totalFrames(2), 1800)
  })

  test('out-of-range durationId clamps', () => {
    assertEq(totalFrames(-1), totalFrames(0), 'negative clamps to 0')
    assertEq(totalFrames(99), totalFrames(2), 'past the end clamps to last')
    assertEq(totalFrames(1.5), totalFrames(2), 'fractional rounds to nearest in range')
  })
})

suite('composition — create & clone', () => {
  test('createLayer returns null for unknown type', () => {
    assertEq(createLayer(9999), null, 'unknown type')
    assertEq(createLayer(0), null, 'zero is not a legal type ID')
  })

  test('createLayer(900) produces a valid layer', () => {
    const layer = makeTestLayer()
    assertEq(layer.type, 900)
    assertEq(layer.blend, 0, 'default blend is normal')
    assertEq(layer.color, 'c0', 'default color is c0')
    assert(typeof layer.params.count === 'number', 'count is a static number')
    assert(typeof layer.params.radius === 'object', 'radius is an AnimValue')
    assert(typeof layer.params.filled === 'boolean', 'filled is a boolean')
    assertEq(layer.params.mode, 'solid', 'enum defaults to first member')
  })

  test('create() produces a valid composition', () => {
    const c = create(900)
    assertEq(c.durationId, 1, 'default duration is 15s')
    assertEq(c.scheme, 0, 'default scheme is first built-in')
    assertEq(c.layers.length, 1)
  })

  test('clone produces a deep-independent copy', () => {
    const c = create(900)
    const d = clone(c)
    // Mutate the clone
    d.durationId = 2
    d.layers[0].blend = 3
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (d.layers[0].params.radius)).min = 200

    // Original is untouched
    assertEq(c.durationId, 1, 'duration untouched')
    assertEq(c.layers[0].blend, 0, 'blend untouched')
    assertEq(
      /** @type {import('../src/model/params.js').AnimValue} */ (c.layers[0].params.radius).min,
      60,
      'radius min untouched',
    )
  })
})

suite('composition — clamp repairs decoded seeds (FR-12, FR-18)', () => {
  test('out-of-bounds numbers are clamped, not rejected', () => {
    const layer = makeTestLayer()
    // Set params out of bounds
    layer.params.count = 999     // max 64
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)).min = -50  // min 60
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)).max = 9999 // max 800
    layer.params.rate = 10       // max 3.0

    clampLayer(layer)

    assertEq(layer.params.count, 64, 'count clamped to 64')
    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius).min, 60, 'radius min clamped to 60')
    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius).max, 800, 'radius max clamped to 800')
    assert(typeof layer.params.rate === 'number' && layer.params.rate <= 3.0, 'rate clamped to 3.0')
  })

  test('missing trailing params take declared defaults', () => {
    const layer = makeTestLayer()
    // Remove the last two params (mode and rate — trailing in the declaration)
    delete layer.params.mode
    delete layer.params.rate

    clampLayer(layer)

    assertEq(layer.params.mode, 'solid', 'missing enum takes first member default')
    assertEq(layer.params.rate, 1, 'missing num takes declared default')
  })

  test('unknown blend clamps to normal', () => {
    const layer = makeTestLayer()
    layer.blend = 99

    clampLayer(layer)
    assertEq(layer.blend, BLEND_NORMAL)
  })

  test('inverted AnimValue min/max are swapped', () => {
    const layer = makeTestLayer()
    const radius = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)
    radius.min = 700
    radius.max = 100  // inverted: min > max

    clampLayer(layer)

    const repaired = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)
    assert(repaired.min <= repaired.max, `min ${repaired.min} should be <= max ${repaired.max}`)
  })

  test('fractional times is rounded to integer (the C1 seam-repair)', () => {
    const layer = makeTestLayer()
    const radius = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)
    radius.times = 3.7

    clampLayer(layer)

    const repaired = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)
    assertEq(repaired.times, 4, '3.7 rounds to 4')
    assert(Number.isInteger(repaired.times), 'times must be an integer')
  })

  test('times is clamped to [1, 8]', () => {
    const layer = makeTestLayer()
    const radius = /** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)
    radius.times = 0

    clampLayer(layer)
    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius).times, TIMES_MIN, '0 clamps to 1')

    ;(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius)).times = 99
    clampLayer(layer)
    assertEq(/** @type {import('../src/model/params.js').AnimValue} */ (layer.params.radius).times, TIMES_MAX, '99 clamps to 8')
  })

  test('rngSeed is coerced to uint32', () => {
    const layer = makeTestLayer()
    layer.rngSeed = -1

    clampLayer(layer)
    assertEq(layer.rngSeed, 0xFFFFFFFF, '-1 coerces to max uint32')
    assert(layer.rngSeed >= 0 && layer.rngSeed <= 0xFFFFFFFF, 'in uint32 range')
  })

  test('non-boolean filled becomes false', () => {
    const layer = makeTestLayer()
    layer.params.filled = 'yes'

    clampLayer(layer)
    assertEq(layer.params.filled, false)
  })

  test('non-string color becomes c0', () => {
    const layer = makeTestLayer()
    // @ts-expect-error — simulating corrupted data
    layer.color = 42

    clampLayer(layer)
    assertEq(layer.color, 'c0')
  })

  test('errored is reset to false on clamp', () => {
    const layer = makeTestLayer()
    layer.errored = true

    clampLayer(layer)
    assertEq(layer.errored, false, 'a decoded layer gets a fresh chance')
  })

  test('unknown layer type returns false (caller skips and warns)', () => {
    const layer = { type: 4242, blend: 0, rngSeed: 0, color: 'c0', opacity: { min: 0.05, max: 1, times: 1, algorithm: 0 }, params: {}, errored: false }
    const usable = clampLayer(layer)
    assertEq(usable, false, 'unknown type should be skipped')
  })

  test('clampComposition removes unknown-type layers and keeps the rest', () => {
    const c = create(900)
    // Add a layer with an unknown type
    c.layers.push(
      { type: 4242, blend: 0, rngSeed: 0, color: 'c0', opacity: { min: 0.05, max: 1, times: 1, algorithm: 0 }, params: {}, errored: false },
    )

    const result = clampComposition(c)
    assertEq(result.skipped, 1, 'one layer skipped')
    assertEq(c.layers.length, 1, 'one layer remains')
    assertEq(c.layers[0].type, 900, 'the remaining layer is the known one')
  })

  test('clampComposition ensures at least one layer', () => {
    const c = create(900)
    c.layers = []

    clampComposition(c)
    assert(c.layers.length >= 1, 'empty composition gets a fallback layer')
  })

  test('clampComposition enforces the 5-layer cap', () => {
    const c = create(900)
    while (c.layers.length < 7) {
      const copy = /** @type {import('../src/model/params.js').Layer} */ (
        structuredClone(c.layers[0])
      )
      c.layers.push(copy)
    }

    clampComposition(c)
    assert(c.layers.length <= 5, `should be capped at 5, got ${c.layers.length}`)
  })
})

suite('composition — validate', () => {
  test('a freshly created composition is valid', () => {
    const c = create(900)
    assert(validate(c), 'create() should produce a valid composition')
  })

  test('a clamped composition is valid', () => {
    const c = create(900)
    // Corrupt some values
    c.layers[0].blend = 99
    ;(/** @type {import('../src/model/params.js').AnimValue} */ (c.layers[0].params.radius)).min = -100

    clampComposition(c)
    assert(validate(c), 'after clamp, the composition should validate')
  })

  test('validate rejects too many layers', () => {
    const c = create(900)
    while (c.layers.length < 6) {
      const copy = /** @type {import('../src/model/params.js').Layer} */ (
        structuredClone(c.layers[0])
      )
      c.layers.push(copy)
    }
    assert(!validate(c), '6 layers should be invalid')
  })

  test('validate rejects zero layers', () => {
    const c = create(900)
    c.layers = []
    assert(!validate(c), '0 layers should be invalid')
  })

  test('validate rejects an unknown layer type', () => {
    const c = create(900)
    c.layers[0].type = 4242
    assert(!validate(c))
  })
})

suite('schemes — built-ins and resolution (FR-7)', () => {
  test('eight built-in schemes with non-empty buckets', () => {
    assertEq(BUILTINS.length, 8, 'FR-7: eight built-ins as of omni-wave S05')
    for (const s of BUILTINS) {
      assert(s.colors.length >= 1, `${s.name}: colours non-empty`)
      assert(s.neutrals.length >= 1, `${s.name}: neutrals non-empty`)
      assert(s.backgrounds.length >= 1, `${s.name}: backgrounds non-empty`)
    }
  })

  test('built-in names match FR-7', () => {
    assertEq(BUILTINS[0].name, 'Neon Night')
    assertEq(BUILTINS[1].name, 'Solar Flare')
    assertEq(BUILTINS[2].name, 'Deep Sea')
    assertEq(BUILTINS[3].name, 'Bone & Ink')
    assertEq(BUILTINS[4].name, 'Vaporwave')
    assertEq(BUILTINS[5].name, 'CRT Phosphor')
    assertEq(BUILTINS[6].name, 'Riso Print')
    assertEq(BUILTINS[7].name, 'Infrared')
  })

  test('resolveRef picks the right bucket entry by selector % length', () => {
    const s = BUILTINS[0] // Neon Night: 5 colours
    assertEq(resolveRef(s, 'c0'), '#FF2E88', 'c0 → first colour')
    assertEq(resolveRef(s, 'c1'), '#00E5FF', 'c1 → second colour')
    assertEq(resolveRef(s, 'c5'), '#FF2E88', 'c5 → wraps to index 0')
    assertEq(resolveRef(s, 'c7'), '#7C4DFF', 'c7 → index 2')
    assertEq(resolveRef(s, 'n0'), '#FFFFFF', 'n0 → first neutral')
    assertEq(resolveRef(s, 'b0'), '#07060D', 'b0 → first background')
    assertEq(resolveRef(s, 'b1'), '#120B1F', 'b1 → second background')
  })

  test('pinned hex survives untouched', () => {
    const s = BUILTINS[0]
    assertEq(resolveRef(s, 'FF2E88'), '#FF2E88', 'pinned hex returns with #')
    assertEq(resolveRef(s, '00e5ff'), '#00E5FF', 'lowercase normalised to upper')
    // Pinned hex is the same regardless of scheme
    assertEq(resolveRef(BUILTINS[1], 'FF2E88'), '#FF2E88')
  })

  test('background returns the first background bucket entry', () => {
    assertEq(background(0), '#07060D', 'Neon Night background')
    assertEq(background(1), '#120A05', 'Solar Flare background')
    assertEq(background(2), '#03080E', 'Deep Sea background')
    assertEq(background(3), '#0E0D0C', 'Bone & Ink background')
  })

  test('buildPalette resolves every layer colour and the background', () => {
    const c = create(900)
    c.layers[0].color = 'c2'
    // Add a second layer with a pinned colour
    const second = /** @type {import('../src/model/params.js').Layer} */ (
      structuredClone(c.layers[0])
    )
    second.color = 'AABBCC'
    c.layers.push(second)

    const palette = buildPalette(c.scheme, c.layers)
    assertEq(palette.background, '#07060D')
    assertEq(palette.layerColors[0], '#7C4DFF', 'c2 → third colour of Neon Night')
    assertEq(palette.layerColors[1], '#AABBCC', 'pinned hex')
    assertEq(palette.scheme.name, 'Neon Night')
  })

  test('changing scheme re-resolves colours without touching refs', () => {
    const c = create(900)
    c.layers[0].color = 'c0'

    const p0 = buildPalette(0, c.layers) // Neon Night
    const p1 = buildPalette(1, c.layers) // Solar Flare

    assertEq(p0.layerColors[0], '#FF2E88', 'Neon Night c0')
    assertEq(p1.layerColors[0], '#FF6B00', 'Solar Flare c0')
    assert(p0.layerColors[0] !== p1.layerColors[0], 'same ref, different colours')
  })

  test('pinned colour survives a scheme change', () => {
    const c = create(900)
    c.layers[0].color = 'FF2E88'

    const p0 = buildPalette(0, c.layers)
    const p1 = buildPalette(1, c.layers)

    assertEq(p0.layerColors[0], '#FF2E88')
    assertEq(p1.layerColors[0], '#FF2E88', 'pinned colour unchanged across schemes')
  })
})

// ---------------------------------------------------------------------------
// parseHexColor (S04 scheme colour picker) — pure model tests.
// One hex contract with normalizeColor/isValidScheme/resolveRef; no alpha.
// ---------------------------------------------------------------------------

suite('schemes — parseHexColor (S04 colour picker)', () => {
  test('accepts 6-digit hex, canonicalises to #RRGGBB uppercase', () => {
    assertEq(parseHexColor('#ff2e88'), '#FF2E88')
    assertEq(parseHexColor('00E5FF'), '#00E5FF')      // no leading #
    assertEq(parseHexColor('  #7c4dff  '), '#7C4DFF') // trimmed
  })
  test('expands 3-digit shorthand', () => {
    assertEq(parseHexColor('#abc'), '#AABBCC')
    assertEq(parseHexColor('f0f'), '#FF00FF')
  })
  test('rejects invalid input (returns null)', () => {
    assertEq(parseHexColor(''), null)
    assertEq(parseHexColor('#12'), null)
    assertEq(parseHexColor('#FF2E8'), null)           // 5 digits
    assertEq(parseHexColor('zzzzzz'), null)          // non-hex
    assertEq(parseHexColor('#GGGGGG'), null)
  })
  test('rejects 8-digit alpha (no alpha — seed format is 6-hex)', () => {
    assertEq(parseHexColor('#FF2E88AA'), null)
    assertEq(parseHexColor('FF2E88FF'), null)
  })
})

// ---------------------------------------------------------------------------
// defaults(typeId) (S02 add-layer fallback) — returns a usable Layer, not a
// blank params:{} object. Uses a real registered type id (2 = nth-rings).
// ---------------------------------------------------------------------------

suite('composition — defaults(typeId) (S02 add-layer fallback)', () => {
  test('returns a layer of the requested type with real params', () => {
    const layer = defaults(2)
    assert(layer !== null, 'defaults(2) is not null')
    assertEq(layer.type, 2)
    assert(layer.params && typeof layer.params === 'object', 'params object present')
    // params must be populated, not {} (the old broken fallback)
    assert(Object.keys(layer.params).length > 0, 'params are populated')
  })
})