// @ts-check
/**
 * Contract tests for the param DSL.
 *
 * Not in the Session B1 task list — added because five subsystems read these
 * descriptors (architecture §5.2) and a silent change to a default, a bound,
 * or the frozen-ness of a declaration would surface as a wrong pixel four
 * sessions downstream, with nothing pointing back here.
 */

import { suite, test, assert, assertEq, assertThrows } from './harness.js'
import {
  A,
  S,
  TIMES_MIN,
  TIMES_MAX,
  DEFAULT_ALGORITHM,
  PARAM_KINDS,
  isAnimatable,
  defaultOf,
  enumIndex,
  enumValue,
} from '../src/model/params.js'

suite('params — animatable declarations', () => {
  test('A() defaults to travelling the full declared range, once, on journeySin', () => {
    const d = A('innerRadius', 0, 400)
    assertEq(d.kind, 'A')
    assertEq(d.name, 'innerRadius')
    assertEq(d.min, 0)
    assertEq(d.max, 400)
    assertEq(d.values, null)
    assert(isAnimatable(d), 'A() is animatable')

    const v = /** @type {import('../src/model/params.js').AnimValue} */ (d.default)
    assertEq(v.min, 0, 'default travels from the declared floor')
    assertEq(v.max, 400, 'to the declared ceiling')
    assertEq(v.times, TIMES_MIN, 'one cycle per loop')
    assertEq(v.algorithm, DEFAULT_ALGORITHM, 'journeySin')
  })

  test('a partial default merges over the full range', () => {
    const d = A('rotation', 0, 360, { default: { times: 3, algorithm: 9 }, wrap: true, unit: '°' })
    const v = /** @type {import('../src/model/params.js').AnimValue} */ (d.default)
    assertEq(v.min, 0)
    assertEq(v.max, 360)
    assertEq(v.times, 3)
    assertEq(v.algorithm, 9)
    assertEq(d.wrap, true)
    assertEq(d.unit, '°')
  })

  test('wrap is rejected on static params — 360 and 0 are only adjacent for a travelling value', () => {
    assertThrows(() => S.int('sides', 3, 12, { wrap: true }))
  })

  test('an out-of-bounds default is a programmer error and throws at import', () => {
    assertThrows(() => A('opacity', 0.05, 1, { default: { min: 0 } }), 'min below the floor')
    assertThrows(() => A('opacity', 0.05, 1, { default: { max: 2 } }), 'max above the ceiling')
    assertThrows(() => A('x', 0, 10, { default: { min: 8, max: 2 } }), 'inverted travel')
    assertThrows(() => A('x', 0, 10, { default: { times: 0 } }), 'times below TIMES_MIN')
    assertThrows(() => A('x', 0, 10, { default: { times: TIMES_MAX + 1 } }), 'times above TIMES_MAX')
    assertThrows(() => A('x', 0, 10, { default: { times: 1.5 } }), 'fractional times')
    assertThrows(() => A('x', 0, 10, { default: { algorithm: -1 } }), 'negative algorithm ID')
    assertThrows(() => A('x', 0, 10, { default: 5 }), 'a scalar default on an animatable param')
  })
})

suite('params — static declarations', () => {
  test('S.int', () => {
    const d = S.int('rayCount', 3, 64)
    assertEq(d.kind, 'int')
    assertEq(d.step, 1)
    assertEq(d.default, 3, 'defaults to the floor')
    assert(!isAnimatable(d), 'S.int is not animatable')
    assertThrows(() => S.int('x', 0.5, 4), 'non-integer bounds')
    assertThrows(() => S.int('x', 0, 10, { default: 2.5 }), 'non-integer default')
  })

  test('S.num', () => {
    const d = S.num('rateSpread', 0.5, 3.0, { default: 1 })
    assertEq(d.kind, 'num')
    assertEq(d.step, 0.01)
    assertEq(d.default, 1)
    assertThrows(() => S.num('x', 0, 1, { default: 4 }), 'default above the ceiling')
  })

  test('S.bool', () => {
    const d = S.bool('taper')
    assertEq(d.kind, 'bool')
    assertEq(d.min, 0)
    assertEq(d.max, 1)
    assertEq(d.default, false)
    assertEq(S.bool('filled', { default: true }).default, true)
    assertThrows(() => S.bool('x', { default: 1 }), 'a number is not a boolean')
  })

  test('S.enum holds values, not indices', () => {
    const d = S.enum('mode', ['radial', 'linear'])
    assertEq(d.kind, 'enum')
    assertEq(d.min, 0)
    assertEq(d.max, 1, 'bounds span the index space')
    assertEq(d.default, 'radial', 'the first member')
    assertEq(d.values === null ? '' : d.values.join('|'), 'radial|linear')

    const tile = S.enum('tileSize', [128, 256], { default: 256 })
    assertEq(tile.default, 256)

    assertThrows(() => S.enum('x', []), 'empty enum')
    assertThrows(() => S.enum('x', ['a', 'a']), 'duplicate members')
    assertThrows(() => S.enum('x', ['a', 'b'], { default: 'c' }), 'default outside the set')
  })
})

suite('params — declaration hygiene', () => {
  test('declarations are frozen, and so are their value sets', () => {
    // Cast through `any` rather than `@ts-expect-error`: the write is the
    // point of the test, and a suppression comment that stops being needed
    // becomes an error of its own.
    const d = A('length', 40, 900)
    assertThrows(() => { /** @type {any} */ (d).max = 9000 }, 'a bound must not be writable')
    assertEq(d.max, 900, 'bound survived the attempt')

    const e = S.enum('mode', ['radial', 'linear'])
    assertThrows(() => { /** @type {any} */ (e.values)[0] = 'conic' }, 'the value set must not be writable')
    assertEq(e.values === null ? '' : e.values[0], 'radial', 'value set survived the attempt')
  })

  test('bad bounds throw', () => {
    assertThrows(() => A('x', 10, 5), 'max below min')
    assertThrows(() => A('', 0, 1), 'empty name')
    assertThrows(() => A('x', NaN, 1), 'non-finite bound')
    assertThrows(() => A('x', 0, 1, { step: 0 }), 'zero step')
    assertThrows(() => A('x', 0, 1, { step: -1 }), 'negative step')
  })

  test('every kind is listed in PARAM_KINDS', () => {
    const declared = [
      A('a', 0, 1),
      S.int('b', 0, 1),
      S.num('c', 0, 1),
      S.bool('d'),
      S.enum('e', ['x']),
    ]
    assertEq(declared.length, PARAM_KINDS.length, 'a kind exists with no builder, or vice versa')
    for (const d of declared) {
      assert(PARAM_KINDS.includes(d.kind), `${d.kind} missing from PARAM_KINDS`)
    }
  })

  test('labels humanize the name, and opts win', () => {
    assertEq(A('innerRadius', 0, 1).label, 'Inner radius')
    assertEq(S.int('rayCount', 3, 64).label, 'Ray count')
    assertEq(S.num('scaleStep', 0, 1).label, 'Scale step')
    assertEq(A('angleA', 0, 180, { label: 'Angle A' }).label, 'Angle A', 'the heuristic is overridable')
    assertEq(A('x', 0, 1).unit, '', 'no unit unless declared')
  })

  test('the default step splits animatable params by span', () => {
    // Whole units for pixel/degree/count ranges…
    assertEq(A('thickness', 1, 24).step, 1)
    assertEq(A('rotation', 0, 360).step, 1)
    assertEq(A('sweep', 90, 1440).step, 1)
    // …hundredths for normalized ratios.
    assertEq(A('opacity', 0.05, 1.0).step, 0.01)
    assertEq(A('tightness', 0.05, 1.0).step, 0.01)
    assertEq(A('cellScale', 0.1, 1.0).step, 0.01)
    // And it is only ever a hint — an explicit step wins.
    assertEq(A('frequency', 0.5, 6.0, { step: 0.1 }).step, 0.1)
  })
})

suite('params — helpers', () => {
  test('defaultOf hands out a fresh AnimValue every call', () => {
    const d = A('length', 40, 900)
    const a = /** @type {import('../src/model/params.js').AnimValue} */ (defaultOf(d))
    const b = /** @type {import('../src/model/params.js').AnimValue} */ (defaultOf(d))
    assert(a !== b, 'two layers of the same type must not share one default object')
    assert(a !== d.default, 'and neither may alias the frozen declaration')
    a.times = 7
    const c = /** @type {import('../src/model/params.js').AnimValue} */ (defaultOf(d))
    assertEq(c.times, TIMES_MIN, 'mutating one copy must not reach the next')
  })

  test('defaultOf passes static values through', () => {
    assertEq(defaultOf(S.int('n', 3, 64)), 3)
    assertEq(defaultOf(S.bool('b')), false)
    assertEq(defaultOf(S.enum('mode', ['radial', 'linear'])), 'radial')
  })

  test('enum index round-trips, and repairs rather than throws (FR-18)', () => {
    const d = S.enum('mode', ['radial', 'linear'])
    assertEq(enumIndex(d, 'radial'), 0)
    assertEq(enumIndex(d, 'linear'), 1)
    assertEq(enumValue(d, 0), 'radial')
    assertEq(enumValue(d, 1), 'linear')

    assertEq(enumIndex(d, 'conic'), 0, 'unknown value falls to the first member')
    assertEq(enumValue(d, 9), 'radial', 'index past the end')
    assertEq(enumValue(d, -1), 'radial', 'negative index')
    assertEq(enumValue(d, 0.5), 'radial', 'non-integer index')

    const notAnEnum = S.int('n', 0, 4)
    assertThrows(() => enumIndex(notAnEnum, 1), 'asking a non-enum for an index is a code bug')
    assertThrows(() => enumValue(notAnEnum, 1))
  })

  test('TIMES bounds match FR-11', () => {
    assertEq(TIMES_MIN, 1)
    assertEq(TIMES_MAX, 8)
  })
})
