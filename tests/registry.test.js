// @ts-check
/**
 * Pins the two append-only ID spaces: blend modes (7 entries) and layer types
 * (16 as of D4 — the catalog is complete and the literal 1–16 pin below is
 * live, per architecture §5.3 step 3).
 *
 * The earlier layer-type assertions are written as invariants that held at
 * every point of the build; the D4 suite adds the literal pins: exact IDs,
 * names, roles, and the §10.2 worstCase table row by row. Test suites also
 * register synthetic types (IDs ≥ 900 by convention), so the catalog pins
 * filter to id ≤ 16.
 */

import { suite, test, assert, assertEq, assertThrows } from './harness.js'
import {
  BLEND_OPS,
  BLEND_NAMES,
  BLEND_COUNT,
  BLEND_NORMAL,
  BLEND_ADDITIVE,
  BLEND_SCREEN,
  BLEND_MULTIPLY,
  BLEND_OVERLAY,
  BLEND_DIFFERENCE,
  BLEND_HARD_LIGHT,
  SELECTABLE_BLENDS,
  coerceBlend,
  blendOp,
  blendName,
} from '../src/model/blend.js'
import { get, has, list, byRole, count, register, ROLES } from '../src/model/registry.js'

suite('blend — append-only ID space (architecture §8.3)', () => {
  test('composite operations are pinned in exact order', () => {
    // Changing a line here silently repaints every seed ever shared.
    assertEq(BLEND_OPS.length, 7, 'blend count')
    assertEq(BLEND_OPS[0], 'source-over', 'id 0')
    assertEq(BLEND_OPS[1], 'lighter', 'id 1')
    assertEq(BLEND_OPS[2], 'screen', 'id 2')
    assertEq(BLEND_OPS[3], 'multiply', 'id 3')
    assertEq(BLEND_OPS[4], 'overlay', 'id 4')
    assertEq(BLEND_OPS[5], 'difference', 'id 5')
    assertEq(BLEND_OPS[6], 'hard-light', 'id 6')
  })

  test('named constants match their positions', () => {
    assertEq(BLEND_NORMAL, 0)
    assertEq(BLEND_ADDITIVE, 1)
    assertEq(BLEND_SCREEN, 2)
    assertEq(BLEND_MULTIPLY, 3)
    assertEq(BLEND_OVERLAY, 4)
    assertEq(BLEND_DIFFERENCE, 5)
    assertEq(BLEND_HARD_LIGHT, 6)
    assertEq(BLEND_COUNT, 7)
  })

  test('user-facing names match the chips in mocks/layer-editor.html', () => {
    assertEq(BLEND_NAMES.join('|'), 'Normal|Additive|Screen|Multiply|Overlay|Difference|Hard light')
  })

  test('names and operations stay the same length', () => {
    assertEq(BLEND_NAMES.length, BLEND_OPS.length, 'a mode gained an op but no name, or vice versa')
  })

  test('tables are frozen', () => {
    // Cast through `any` rather than `@ts-expect-error`: the write is the
    // point of the test, and a suppression comment that stops being needed
    // becomes an error of its own.
    assertThrows(() => { /** @type {any} */ (BLEND_OPS)[0] = 'destination-out' }, 'BLEND_OPS must be frozen')
    assertThrows(() => { /** @type {any} */ (BLEND_NAMES)[0] = 'Nope' }, 'BLEND_NAMES must be frozen')
  })

  test('an unknown blend ID clamps to normal, never throws (FR-18)', () => {
    assertEq(coerceBlend(-1), 0, 'negative')
    assertEq(coerceBlend(7), 0, 'one past the end — a mode from a future build')
    assertEq(coerceBlend(999), 0, 'far out of range')
    assertEq(coerceBlend(1.5), 0, 'non-integer')
    assertEq(coerceBlend(NaN), 0, 'NaN')
    assertEq(coerceBlend('3'), 0, 'numeric string — JSON gives numbers, so this is corruption')
    assertEq(coerceBlend(null), 0, 'null')
    assertEq(coerceBlend(undefined), 0, 'undefined — a missing trailing element')
  })

  test('every legal ID survives coercion unchanged', () => {
    for (let id = 0; id < BLEND_COUNT; id++) assertEq(coerceBlend(id), id, `id ${id}`)
  })

  test('blendOp and blendName agree with the tables and fall back safely', () => {
    for (let id = 0; id < BLEND_COUNT; id++) {
      assertEq(blendOp(id), BLEND_OPS[id], `op ${id}`)
      assertEq(blendName(id), BLEND_NAMES[id], `name ${id}`)
    }
    assertEq(blendOp(42), 'source-over', 'unknown op falls back')
    assertEq(blendName(42), 'Normal', 'unknown name falls back')
  })
})

suite('blend — selectable subset (retirement)', () => {
  test('SELECTABLE_BLENDS excludes Multiply (3) and Overlay (4)', () => {
    assert(!SELECTABLE_BLENDS.includes(BLEND_MULTIPLY), 'Multiply must be retired')
    assert(!SELECTABLE_BLENDS.includes(BLEND_OVERLAY), 'Overlay must be retired')
  })
  test('SELECTABLE_BLENDS is exactly [0,1,2,5,6]', () => {
    assertEq(SELECTABLE_BLENDS.join(','), '0,1,2,5,6')
  })
  test('every selectable id is a real, in-range blend', () => {
    for (const id of SELECTABLE_BLENDS) assertEq(coerceBlend(id), id, `id ${id}`)
  })
  test('the full table is untouched — retirement never renumbers', () => {
    assertEq(BLEND_COUNT, 7)
    assertEq(BLEND_NAMES[3], 'Multiply')
    assertEq(BLEND_NAMES[4], 'Overlay')
  })
  test('SELECTABLE_BLENDS is frozen', () => {
    assertThrows(() => { /** @type {any} */ (SELECTABLE_BLENDS)[0] = 42 }, 'must be frozen')
  })
})

suite('registry — layer type catalog (architecture §5.3, §8.2)', () => {
  test('IDs are unique and ascending', () => {
    const ids = list().map((m) => m.meta.id)
    for (let i = 1; i < ids.length; i++) {
      assert(ids[i] > ids[i - 1], `list() must ascend by ID: ${ids[i - 1]} then ${ids[i]}`)
    }
    assertEq(new Set(ids).size, ids.length, 'duplicate layer type ID')
    assertEq(ids.length, count(), 'list() and count() disagree')
  })

  test('every registered module satisfies the four-export contract', () => {
    for (const m of list()) {
      assert(typeof m.meta.name === 'string' && m.meta.name.length > 0, `type ${m.meta.id}: name`)
      assert(ROLES.includes(m.meta.role), `type ${m.meta.id}: role ${m.meta.role}`)
      assert(m.params.length > 0, `type ${m.meta.id}: params`)
      assert(typeof m.prepare === 'function', `type ${m.meta.id}: prepare`)
      assert(typeof m.draw === 'function', `type ${m.meta.id}: draw`)
    }
  })

  test('byRole partitions list() exactly', () => {
    let total = 0
    for (const role of ROLES) {
      const group = byRole(role)
      for (const m of group) assertEq(m.meta.role, role, 'byRole returned a foreign role')
      total += group.length
    }
    assertEq(total, list().length, 'the three roles do not cover the catalog')
  })

  test('an unknown type ID returns null rather than throwing (FR-18)', () => {
    // A seed from a future build naming a type this one has never heard of.
    assertEq(get(9999), null, 'unregistered ID')
    assertEq(get(0), null, 'zero is not a legal type ID')
    assertEq(get(-1), null, 'negative')
    assertEq(get(1.5), null, 'non-integer')
    assertEq(get('1'), null, 'string')
    assertEq(get(null), null, 'null')
    assertEq(get(undefined), null, 'undefined')
    assertEq(has(9999), false, 'has() agrees')
  })

  test('register rejects a malformed module', () => {
    // Every case below throws before touching the map, so the real catalog is
    // untouched by this test.
    assertThrows(() => register(null), 'null')
    assertThrows(() => register(42), 'not an object')
    assertThrows(() => register({}), 'no meta')
    assertThrows(() => register({ meta: {} }), 'no id')
    assertThrows(() => register({ meta: { id: 0, name: 'X' } }), 'id below 1')
    assertThrows(() => register({ meta: { id: 1.5, name: 'X' } }), 'non-integer id')
    assertThrows(
      () => register({ meta: { id: 9800, name: 'X', role: 'decorative' } }),
      'unknown role',
    )
    assertThrows(
      () => register({
        meta: { id: 9800, name: 'X', role: 'primary', blurb: 'b', worstCase: { pathOps: 1, drawCalls: 1 }, fullCanvasOpaque: false },
      }),
      'no params',
    )
    assertThrows(
      () => register({
        meta: { id: 9800, name: 'X', role: 'primary', blurb: 'b', worstCase: { pathOps: 1, drawCalls: 1 }, fullCanvasOpaque: false },
        params: [{ kind: 'nope', name: 'x' }],
      }),
      'params not built by the DSL',
    )
    assertThrows(
      () => register({
        meta: { id: 9800, name: 'X', role: 'primary', blurb: 'b', worstCase: { pathOps: 1, drawCalls: 1 }, fullCanvasOpaque: false },
        params: [{ kind: 'int', name: 'x' }],
        prepare: () => ({}),
      }),
      'no draw',
    )
    assertEq(get(9800), null, 'a rejected module must not have been registered')
  })

  test('worstCase is mandatory — architecture §10.2 is a budget, not a suggestion', () => {
    assertThrows(
      () => register({
        meta: { id: 9801, name: 'X', role: 'primary', blurb: 'b', fullCanvasOpaque: false },
        params: [{ kind: 'int', name: 'x' }],
        prepare: () => ({}),
        draw: () => {},
      }),
      'missing worstCase',
    )
  })
})

// ---------------------------------------------------------------------------
// D4 — the catalog is complete. Literal pins from here down.
// ---------------------------------------------------------------------------

/** The real catalog, without any suite's synthetic types. */
function catalog() {
  return list().filter((m) => m.meta.id <= 33)
}

suite('registry — the 33-type catalog pin (architecture §8.2, FR-6)', () => {
  test('exactly types 1–33, in ID order, names pinned', () => {
    // Changing a line here silently orphans every seed that stores the ID.
    const NAMES = [
      'Ray Rings', 'Nth Rings', 'Layered Poly', 'Encircled Spiral',
      'Petal Bloom', 'Orbit Dots', 'Arc Gates',
      'Line Field', 'Moiré Grid', 'Grid Pulse', 'Sine Ribbons', 'Crosshatch',
      'Fuzz Flare', 'Scan Lines', 'Vignette Wash', 'Grain',
      'Spiral Web', 'Nested Squares', 'Sunburst',
      'Pulse Rings', 'Burst Star', 'Ribbon Coil',
      'Prism Shard', 'Checker Wave', 'Stipple Field',
      'Lattice Weave', 'Concentric Waves', 'Triangulation',
      'Light Leak', 'Soft Tint', 'Dot Haze',
      'Stripe Sweep',
      'Slice Shift',
    ]
    const cat = catalog()
    assertEq(cat.length, 33, 'the catalog holds exactly 33 types')
    for (let i = 0; i < 33; i++) {
      assertEq(cat[i].meta.id, i + 1, `position ${i} carries ID ${i + 1}`)
      assertEq(cat[i].meta.name, NAMES[i], `ID ${i + 1} name`)
    }
  })

  test('roles partition the catalog exactly as FR-6 groups it', () => {
    for (const m of catalog()) {
      const want =
        m.meta.id <= 7 ? 'primary' : m.meta.id <= 12 ? 'secondary' : m.meta.id <= 16 ? 'overlay'
        : m.meta.id <= 23 ? 'primary' : m.meta.id <= 28 ? 'secondary' : m.meta.id <= 32 ? 'overlay'
        : 'glitch'
      assertEq(m.meta.role, want, `type ${m.meta.id} role`)
    }
  })

  test('meta.worstCase matches the architecture §10.2 table row by row', () => {
    /** @type {Record<number, [number, number]>} */
    const TABLE = {
      1: [64, 2], 2: [24, 24], 3: [144, 12], 4: [2160, 12],
      5: [144, 4], 6: [192, 8], 7: [10, 10],
      8: [80, 1], 9: [750, 2], 10: [2304, 1], 11: [2400, 12], 12: [600, 2],
      13: [8, 8], 14: [1, 1], 15: [1, 1], 16: [1, 1],
      17: [432, 1], 18: [64, 16], 19: [144, 1],
      20: [24, 24], 21: [48, 1], 22: [400, 1],
      23: [27, 2], 24: [2304, 1], 25: [300, 1],
      26: [600, 2], 27: [600, 1], 28: [2304, 1],
      29: [1, 1], 30: [1, 1], 31: [12, 12],
      32: [1, 1],
      33: [24, 25],
    }
    for (const m of catalog()) {
      const row = TABLE[m.meta.id]
      assertEq(m.meta.worstCase.pathOps, row[0], `type ${m.meta.id} pathOps`)
      assertEq(m.meta.worstCase.drawCalls, row[1], `type ${m.meta.id} drawCalls`)
    }
  })

  test('every catalog module satisfies the full four-export contract', () => {
    for (const m of catalog()) {
      assert(typeof m.meta.blurb === 'string' && m.meta.blurb.length > 0, `type ${m.meta.id}: blurb`)
      assert(typeof m.meta.fullCanvasOpaque === 'boolean', `type ${m.meta.id}: fullCanvasOpaque`)
      assert(m.params.length > 0, `type ${m.meta.id}: params`)
      assert(typeof m.prepare === 'function', `type ${m.meta.id}: prepare`)
      assert(typeof m.draw === 'function', `type ${m.meta.id}: draw`)
    }
  })

  test('re-registering a taken ID throws before touching the catalog (B1 deferral)', () => {
    const one = get(1)
    assert(one !== null, 'type 1 exists')
    // `register` throws before it writes, so the real catalog is unharmed —
    // which is exactly why B1 deferred this test until the catalog existed.
    assertThrows(() => register(one), 'duplicate ID must be rejected')
    assertEq(get(1), one, 'the original module is still registered')
    assertEq(catalog().length, 33, 'catalog unchanged')
  })

  test('the reserved statics keys are rejected as param names (D4 scratch injection)', () => {
    for (const name of ['color', 'scratch']) {
      assertThrows(
        () => register({
          meta: { id: 9802, name: 'X', role: 'overlay', blurb: 'b', worstCase: { pathOps: 1, drawCalls: 1 }, fullCanvasOpaque: false },
          params: [{ kind: 'num', name }],
          prepare: () => ({}),
          draw: () => {},
        }),
        `param named "${name}" must be rejected`,
      )
    }
    assertEq(get(9802), null, 'nothing was registered')
  })
})
