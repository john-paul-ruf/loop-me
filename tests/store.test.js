// @ts-check
/**
 * Session C4 contract tests — the storage layer (FR-0, FR-8, FR-14, FR-18).
 *
 * Every test installs a fresh Map-backed stub via `installBackend()` before
 * touching a store. That gives two guarantees at once: tests never write to
 * the real `localStorage` of whoever opens the test page, and every test
 * starts from a known-empty keyspace regardless of run order.
 *
 * The two degradation paths the C4 exit check names — backend unavailable,
 * write over quota — are driven through the same seam with a throwing stub
 * and a fillable stub.
 */

import { suite, test, assert, assertEq, assertDeepEq } from './harness.js'
import * as local from '../src/store/local.js'
import * as prefs from '../src/store/prefs.js'
import * as gallery from '../src/store/gallery.js'
import * as schemesStore from '../src/store/schemes-store.js'
import { onReport, STORAGE_UNAVAILABLE, STORAGE_QUOTA } from '../src/core/errors.js'
import { isValidScheme } from '../src/model/schemes.js'

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** A working in-memory Storage stand-in. */
function memStub() {
  /** @type {Map<string, string>} */
  const m = new Map()
  return {
    /** @param {string} k */
    getItem: (k) => m.get(k) ?? null,
    /** @param {string} k @param {string} v */
    setItem: (k, v) => {
      m.set(k, String(v))
    },
    /** @param {string} k */
    removeItem: (k) => {
      m.delete(k)
    },
  }
}

/** A backend where every call throws — private-browsing worst case. */
function throwingStub() {
  return {
    /** @param {string} _k @returns {string | null} */
    getItem(_k) {
      throw new Error('storage blocked')
    },
    /** @param {string} _k @param {string} _v */
    setItem(_k, _v) {
      throw new Error('storage blocked')
    },
    /** @param {string} _k */
    removeItem(_k) {
      throw new Error('storage blocked')
    },
  }
}

/** A backend that works until `fill()` — passes the probe, then hits quota. */
function quotaStub() {
  /** @type {Map<string, string>} */
  const m = new Map()
  let full = false
  return {
    /** @param {string} k */
    getItem: (k) => m.get(k) ?? null,
    /** @param {string} k @param {string} v */
    setItem(k, v) {
      if (full) throw new Error('QuotaExceededError')
      m.set(k, String(v))
    },
    /** @param {string} k */
    removeItem(k) {
      m.delete(k)
    },
    fill() {
      full = true
    },
  }
}

/** Install a fresh empty working backend. Called at the top of every test. */
function fresh() {
  local.installBackend(memStub())
}

/**
 * Run `fn` with a report listener attached, returning only the reports made
 * *during* `fn` — the replay backlog drained at subscribe time is discarded.
 *
 * @param {() => void} fn
 * @returns {import('../src/core/errors.js').ErrorReport[]}
 */
function captureReports(fn) {
  /** @type {import('../src/core/errors.js').ErrorReport[]} */
  const seen = []
  const off = onReport((r) => {
    seen.push(r)
  })
  seen.length = 0 // drop anything replayed from before this test
  try {
    fn()
  } finally {
    off()
  }
  return seen
}

// ---------------------------------------------------------------------------
// local.js — the guarded wrapper
// ---------------------------------------------------------------------------

suite('store/local', () => {
  test('keyspace constants match specs/database.md exactly', () => {
    assertEq(local.KEYS.version, 'loopme:v')
    assertEq(local.KEYS.prefs, 'loopme:prefs')
    assertEq(local.KEYS.gallery, 'loopme:gallery')
    assertEq(local.KEYS.schemes, 'loopme:schemes')
    assertEq(local.STORE_VERSION, 1)
  })

  test('install on a working backend: available, version marker written', () => {
    fresh()
    assertEq(local.isAvailable(), true)
    assertEq(local.storedVersion(), local.STORE_VERSION)
  })

  test('raw set/get/remove round-trip', () => {
    fresh()
    assertEq(local.set('loopme:x', 'hello'), true)
    assertEq(local.get('loopme:x'), 'hello')
    assertEq(local.remove('loopme:x'), true)
    assertEq(local.get('loopme:x'), null)
  })

  test('setJson/getJson round-trip a structured value', () => {
    fresh()
    const value = { a: 1, b: [true, 'two'], c: null }
    assertEq(local.setJson('loopme:x', value), true)
    assertDeepEq(local.getJson('loopme:x'), value)
  })

  test('getJson on a malformed blob returns null, never throws', () => {
    fresh()
    local.set('loopme:x', '{not json')
    assertEq(local.getJson('loopme:x'), null)
  })

  test('setJson refuses an unserializable value without reporting quota', () => {
    fresh()
    const seen = captureReports(() => {
      assertEq(local.setJson('loopme:x', undefined), false)
    })
    assertEq(seen.length, 0, 'stringify failure is a caller bug, not a quota event')
  })

  test('unavailable backend degrades to memory and reports STORAGE_UNAVAILABLE', () => {
    const seen = captureReports(() => {
      assertEq(local.installBackend(throwingStub()), false)
    })
    assert(
      seen.some((r) => r.code === STORAGE_UNAVAILABLE),
      'expected a STORAGE_UNAVAILABLE report',
    )
    assertEq(local.isAvailable(), false)
    // Every call still returns a sane value against the memory fallback.
    assertEq(local.set('loopme:x', 'v'), true)
    assertEq(local.get('loopme:x'), 'v')
    assertEq(local.remove('loopme:x'), true)
    assertEq(local.getJson('loopme:x'), null)
    fresh()
  })

  test('write failure on a working backend reports STORAGE_QUOTA and returns false', () => {
    const stub = quotaStub()
    assertEq(local.installBackend(stub), true, 'quota stub must pass the probe')
    stub.fill()
    const seen = captureReports(() => {
      assertEq(local.set('loopme:x', 'v'), false)
    })
    assert(
      seen.some((r) => r.code === STORAGE_QUOTA),
      'expected a STORAGE_QUOTA report',
    )
    assertEq(local.get('loopme:x'), null, 'the failed write left nothing behind')
    fresh()
  })
})

// ---------------------------------------------------------------------------
// prefs.js — FR-0's failure direction
// ---------------------------------------------------------------------------

suite('store/prefs', () => {
  test('both preferences default to false on an empty store', () => {
    fresh()
    assertEq(prefs.get('suppressSplash'), false)
    assertEq(prefs.get('reducedMotionOptIn'), false)
  })

  test('set/get round-trip, and setting one preserves the other', () => {
    fresh()
    assertEq(prefs.set('suppressSplash', true), true)
    assertEq(prefs.get('suppressSplash'), true)
    assertEq(prefs.set('reducedMotionOptIn', true), true)
    assertEq(prefs.get('suppressSplash'), true, 'first pref survived the second write')
    assertEq(prefs.get('reducedMotionOptIn'), true)
    prefs.set('suppressSplash', false)
    assertEq(prefs.get('suppressSplash'), false)
  })

  test('a corrupted blob falls back to defaults field-by-field', () => {
    fresh()
    local.setJson(local.KEYS.prefs, { suppressSplash: 'yes', reducedMotionOptIn: true })
    assertEq(prefs.get('suppressSplash'), false, 'non-boolean repaired to default')
    assertEq(prefs.get('reducedMotionOptIn'), true, 'valid field kept')
    local.setJson(local.KEYS.prefs, 42)
    assertEq(prefs.get('suppressSplash'), false)
    local.set(local.KEYS.prefs, '{broken')
    assertEq(prefs.get('suppressSplash'), false)
  })

  test('suppressSplash is false when storage is unavailable — even after set()', () => {
    local.installBackend(throwingStub()) // → memory fallback, unavailable
    prefs.set('suppressSplash', true) // lands in the memory fallback
    assertEq(
      prefs.get('suppressSplash'),
      false,
      'FR-0: the failure direction is toward the warning',
    )
    assertEq(
      prefs.get('reducedMotionOptIn'),
      false,
      'other prefs read their default from the empty fallback',
    )
    fresh()
  })

  test('set() reports honestly when the write cannot persist', () => {
    const stub = quotaStub()
    local.installBackend(stub)
    stub.fill()
    assertEq(prefs.set('suppressSplash', true), false)
    fresh()
  })
})

// ---------------------------------------------------------------------------
// gallery.js — FR-14
// ---------------------------------------------------------------------------

suite('store/gallery', () => {
  test('save stores seed + optional description + timestamp and list returns it', () => {
    fresh()
    const e = gallery.save('1zAAAA', 'my first loop', 1)
    assert(e !== null)
    assertEq(e.seed, '1zAAAA')
    assertEq(e.description, 'my first loop')
    assertEq(e.durationId, 1)
    assert(e.createdAt > 0)
    assert(e.id.length > 0)
    const all = gallery.list()
    assertEq(all.length, 1)
    assertDeepEq(all[0], e)
  })

  test('description is optional; durationId clamps to 0–2', () => {
    fresh()
    const bare = gallery.save('1zBBBB')
    assert(bare !== null)
    assertEq(bare.description, '')
    assertEq(bare.durationId, 0)
    const high = gallery.save('1zCCCC', '', 99)
    assert(high !== null)
    assertEq(high.durationId, 2)
    const low = gallery.save('1zDDDD', '', -5)
    assert(low !== null)
    assertEq(low.durationId, 0)
  })

  test('an empty seed refuses to save', () => {
    fresh()
    assertEq(gallery.save(''), null)
    assertEq(gallery.count(), 0)
  })

  test('list is newest-first, including same-millisecond saves', () => {
    fresh()
    const a = gallery.save('1zAAAA')
    const b = gallery.save('1zBBBB')
    const c = gallery.save('1zCCCC')
    assert(a !== null && b !== null && c !== null)
    const ids = gallery.list().map((e) => e.id)
    assertDeepEq(ids, [c.id, b.id, a.id])
  })

  test('rename edits the description; unknown id returns false', () => {
    fresh()
    const e = gallery.save('1zAAAA', 'old')
    assert(e !== null)
    assertEq(gallery.rename(e.id, 'new words'), true)
    assertEq(gallery.list()[0].description, 'new words')
    assertEq(gallery.rename(e.id, ''), true, 'clearing is allowed')
    assertEq(gallery.list()[0].description, '')
    assertEq(gallery.rename('nope', 'x'), false)
  })

  test('remove deletes exactly one entry; unknown id returns false', () => {
    fresh()
    const a = gallery.save('1zAAAA')
    const b = gallery.save('1zBBBB')
    assert(a !== null && b !== null)
    assertEq(gallery.remove(a.id), true)
    assertEq(gallery.count(), 1)
    assertEq(gallery.list()[0].id, b.id)
    assertEq(gallery.remove(a.id), false, 'already gone')
  })

  test('a malformed stored entry is skipped; the rest survive, repaired', () => {
    fresh()
    local.setJson(local.KEYS.gallery, [
      { id: 'g1', seed: '1zAAAA', description: 'fine', durationId: 1, createdAt: 1000 },
      { id: 'g2' }, // no seed → skipped
      42, // not an object → skipped
      { id: 'g3', seed: '1zBBBB', durationId: 'nope', createdAt: 'later' }, // repaired
    ])
    const all = gallery.list()
    assertEq(all.length, 2)
    const g3 = all.find((e) => e.id === 'g3')
    assert(g3 !== undefined)
    assertEq(g3.durationId, 0, 'unparseable durationId repaired to 0')
    assertEq(g3.createdAt, 0, 'unparseable createdAt repaired to 0')
    assertEq(g3.description, '')
  })

  test('export → import round-trips every entry onto a fresh device', () => {
    fresh()
    const a = gallery.save('1zAAAA', 'first', 0)
    const b = gallery.save('1zBBBB', 'second', 2)
    assert(a !== null && b !== null)
    const blob = gallery.exportJson()

    fresh() // a different device: empty store
    const res = gallery.importJson(blob)
    assert(res !== null)
    assertEq(res.imported, 2)
    assertEq(res.skipped, 0)
    const all = gallery.list()
    assertEq(all.length, 2)
    assertDeepEq(all.map((e) => e.seed), [b.seed, a.seed])

    const again = gallery.importJson(blob)
    assert(again !== null)
    assertEq(again.imported, 0, 're-import is idempotent')
    assertEq(again.skipped, 2)
  })

  test('import skips malformed entries without discarding existing ones', () => {
    fresh()
    const mine = gallery.save('1zMINE')
    assert(mine !== null)
    const res = gallery.importJson(
      JSON.stringify({
        format: 'loopme-gallery',
        version: 1,
        entries: [{ id: 'gx', seed: '1zGOOD', createdAt: 5 }, { id: 'bad-no-seed' }],
      }),
    )
    assert(res !== null)
    assertEq(res.imported, 1)
    assertEq(res.skipped, 1)
    assertEq(gallery.count(), 2, 'existing entry untouched')
  })

  test('import rejects non-gallery input with null, never a throw', () => {
    fresh()
    assertEq(gallery.importJson('not json at all'), null)
    assertEq(gallery.importJson('{"some":"object"}'), null)
    assertEq(gallery.importJson('123'), null)
    assertEq(gallery.count(), 0)
  })
})

// ---------------------------------------------------------------------------
// schemes-store.js — FR-8
// ---------------------------------------------------------------------------

/** A valid input for create(), fresh each call. */
function schemeFields() {
  return {
    name: 'Midnight Test',
    colors: ['#ff2e88', '00E5FF'],
    neutrals: ['#FFFFFF'],
    backgrounds: ['#07060D', '#120b1f'],
  }
}

suite('store/schemes', () => {
  test('create normalises colours to #RRGGBB uppercase and persists', () => {
    fresh()
    const s = schemesStore.create(schemeFields())
    assert(s !== null)
    assertDeepEq(s.colors, ['#FF2E88', '#00E5FF'])
    assertDeepEq(s.backgrounds, ['#07060D', '#120B1F'])
    const back = schemesStore.get(s.id)
    assert(back !== null)
    assertDeepEq(back, s)
    assertEq(schemesStore.list().length, 1)
  })

  test('a created scheme is valid by model/schemes.js rules — the shape agreement', () => {
    fresh()
    const s = schemesStore.create(schemeFields())
    assert(s !== null)
    assertEq(isValidScheme(s), true, 'stored shape must be the model shape')
  })

  test('every bucket enforces 1–8: empty and oversized are rejected', () => {
    fresh()
    const empty = { ...schemeFields(), neutrals: [] }
    assertEq(schemesStore.create(empty), null)
    const nine = { ...schemeFields(), colors: Array.from({ length: 9 }, () => '#FF2E88') }
    assertEq(schemesStore.create(nine), null)
    const missing = { name: 'x', colors: ['#FF2E88'], neutrals: ['#FFFFFF'] }
    assertEq(schemesStore.create(missing), null)
    assertEq(schemesStore.list().length, 0)
  })

  test('an invalid colour rejects the whole write', () => {
    fresh()
    const bad = { ...schemeFields(), colors: ['#FF2E88', 'not-a-colour'] }
    assertEq(schemesStore.create(bad), null)
    const shortHex = { ...schemeFields(), colors: ['#F28'] }
    assertEq(schemesStore.create(shortHex), null)
    assertEq(schemesStore.list().length, 0)
  })

  test('name is required and trimmed', () => {
    fresh()
    assertEq(schemesStore.create({ ...schemeFields(), name: '' }), null)
    assertEq(schemesStore.create({ ...schemeFields(), name: '   ' }), null)
    const s = schemesStore.create({ ...schemeFields(), name: '  Edges  ' })
    assert(s !== null)
    assertEq(s.name, 'Edges')
  })

  test('update edits fields, keeps omitted ones, rejects invalid ones atomically', () => {
    fresh()
    const s = schemesStore.create(schemeFields())
    assert(s !== null)

    const renamed = schemesStore.update(s.id, { name: 'Renamed' })
    assert(renamed !== null)
    assertEq(renamed.name, 'Renamed')
    assertDeepEq(renamed.colors, s.colors, 'omitted bucket kept')

    const rebucketed = schemesStore.update(s.id, { colors: ['#123456'] })
    assert(rebucketed !== null)
    assertDeepEq(rebucketed.colors, ['#123456'])
    assertEq(rebucketed.name, 'Renamed')

    assertEq(schemesStore.update(s.id, { colors: [] }), null, 'invalid bucket rejected')
    const after = schemesStore.get(s.id)
    assert(after !== null)
    assertDeepEq(after.colors, ['#123456'], 'rejected update changed nothing')

    assertEq(schemesStore.update('nope', { name: 'x' }), null)
  })

  test('remove deletes the scheme; unknown id returns false', () => {
    fresh()
    const s = schemesStore.create(schemeFields())
    assert(s !== null)
    assertEq(schemesStore.remove(s.id), true)
    assertEq(schemesStore.get(s.id), null)
    assertEq(schemesStore.remove(s.id), false)
  })

  test('a malformed stored scheme is skipped on read; valid ones survive', () => {
    fresh()
    const good = schemesStore.create(schemeFields())
    assert(good !== null)
    const raw = /** @type {unknown[]} */ (local.getJson(local.KEYS.schemes))
    assert(Array.isArray(raw))
    raw.push({ id: 'sx', name: 'Broken', colors: [] }) // empty bucket → skip
    raw.push({ id: 'sy' }) // no buckets at all → skip
    local.setJson(local.KEYS.schemes, raw)
    const all = schemesStore.list()
    assertEq(all.length, 1)
    assertEq(all[0].id, good.id)
  })

  test('two creates get distinct ids, even in the same millisecond', () => {
    fresh()
    const a = schemesStore.create(schemeFields())
    const b = schemesStore.create({ ...schemeFields(), name: 'Second' })
    assert(a !== null && b !== null)
    assert(a.id !== b.id)
    assertEq(schemesStore.list().length, 2)
  })
})
