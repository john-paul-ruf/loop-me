// @ts-check
/**
 * Seed codec contract tests (C5) — FR-12, FR-13, architecture §9.
 *
 * The centrepiece is the round-trip property test: ≥ 200 generated
 * compositions must satisfy `decode(encode(c))` deep-equals `c`. The
 * generator draws from `mulberry32` (never `Math.random`) and emits values
 * that are already 3dp-quantized and in-bounds, so equality is exact, not
 * approximate. Both wire flags are exercised: even iterations use the
 * engine's default (`z` where capable), odd iterations force `p`.
 *
 * Synthetic layer types 910 / 911 / 912 are registered here — the real
 * catalog does not exist until D1, and the codec walks declarations, not
 * layers, so synthetic declarations prove the same contract.
 */

import { suite, test, assert, assertEq, assertDeepEq, assertThrows } from './harness.js'
import {
  toArray,
  fromArray,
  encode,
  decode,
  SEED_HARD_WARN,
} from '../src/seed/codec.js'
import { bytesToB64url, b64urlToBytes } from '../src/seed/base64url.js'
import { canDeflate, deflate, inflate } from '../src/seed/deflate.js'
import { parseSeed, createHashWriter } from '../src/seed/hash.js'
import { SCHEMA_VERSION } from '../src/version.js'
import {
  AppError,
  onReport,
  SEED_VERSION,
  SEED_MALFORMED,
  SEED_TRUNCATED,
  SEED_TOO_LONG,
  LAYER_UNKNOWN_TYPE,
} from '../src/core/errors.js'
import { register, has } from '../src/model/registry.js'
import { A, S } from '../src/model/params.js'
import { BUILTINS } from '../src/model/schemes.js'
import { mulberry32, uint32, intRange, pick } from '../src/core/rng.js'
import { q3 } from '../src/util/quantize.js'
import { clamp } from '../src/util/clamp.js'

/**
 * @typedef {import('../src/model/params.js').Composition} Composition
 * @typedef {import('../src/model/params.js').Layer} Layer
 * @typedef {import('../src/model/params.js').AnimValue} AnimValue
 * @typedef {import('../src/model/params.js').ParamDecl} ParamDecl
 * @typedef {import('../src/core/errors.js').ErrorReport} ErrorReport
 */

// ---------------------------------------------------------------------------
// Synthetic layer types
// ---------------------------------------------------------------------------

const noopPrepare = () => null
const noopDraw = () => {}

if (!has(910)) {
  register({
    meta: {
      id: 910,
      name: 'Codec Mixed',
      role: 'primary',
      blurb: 'synthetic — every param kind',
      worstCase: { pathOps: 1, drawCalls: 1 },
      fullCanvasOpaque: false,
    },
    params: [
      A('radius', 0, 400),
      S.int('count', 1, 24),
      A('rotation', 0, 360, { wrap: true }),
      S.bool('filled'),
      S.enum('mode', ['solid', 'dashed', 'dotted']),
      S.num('scale', 0.1, 1.0),
    ],
    prepare: noopPrepare,
    draw: noopDraw,
  })
}

if (!has(911)) {
  register({
    meta: {
      id: 911,
      name: 'Codec Simple',
      role: 'secondary',
      blurb: 'synthetic — minimal params',
      worstCase: { pathOps: 1, drawCalls: 1 },
      fullCanvasOpaque: false,
    },
    params: [
      A('height', 10, 900),
      S.int('bars', 2, 40),
    ],
    prepare: noopPrepare,
    draw: noopDraw,
  })
}

if (!has(912)) {
  register({
    meta: {
      id: 912,
      name: 'Codec Wide',
      role: 'overlay',
      blurb: 'synthetic — 32 A params, for the long-seed test',
      worstCase: { pathOps: 1, drawCalls: 1 },
      fullCanvasOpaque: false,
    },
    params: Array.from({ length: 32 }, (_, i) => A('p' + i, 0, 1000)),
    prepare: noopPrepare,
    draw: noopDraw,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run `fn` while capturing reports. The replayed backlog delivered at
 * subscription is discarded — only reports made *during* `fn` are returned.
 *
 * @param {() => (void | Promise<void>)} fn
 * @returns {Promise<ErrorReport[]>}
 */
async function captureReports(fn) {
  /** @type {ErrorReport[]} */
  const seen = []
  const off = onReport((r) => { seen.push(r) })
  seen.length = 0 // drop anything replayed from before this test
  try {
    await fn()
  } finally {
    off()
  }
  return seen
}

/**
 * Await a rejection and hand back the thrown value.
 *
 * @param {() => Promise<unknown>} fn
 * @param {string} [msg]
 * @returns {Promise<unknown>}
 */
async function assertRejects(fn, msg) {
  try {
    await fn()
  } catch (e) {
    return e
  }
  throw new Error(msg ?? 'expected the promise to reject, but it resolved')
}

// ---------------------------------------------------------------------------
// Deterministic composition generator
// ---------------------------------------------------------------------------

/** Colour pool for custom schemes — already `#`-prefixed uppercase, the exact
 *  in-memory shape, so `normalizeScheme` is an identity on them. */
const HEXES = ['#FF2E88', '#00E5FF', '#7C4DFF', '#FFD400', '#0E7490', '#EDE6D8']

/** Colour refs a layer may carry — bucket refs and pinned uppercase hex. */
const COLOR_REFS = ['c0', 'c1', 'c2', 'c7', 'n0', 'n1', 'b0', 'b1', 'FF2E88', '00E5FF']

/**
 * A 3dp-quantized float in `[min, max]`.
 *
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function q3r(rng, min, max) {
  return clamp(q3(min + rng() * (max - min)), min, max)
}

/**
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {AnimValue}
 */
function genAnim(rng, min, max) {
  const a = q3r(rng, min, max)
  const b = q3r(rng, min, max)
  return {
    min: Math.min(a, b),
    max: Math.max(a, b),
    times: intRange(rng, 1, 8),
    algorithm: intRange(rng, 0, 19),
  }
}

/**
 * @param {() => number} rng
 * @param {number} typeId
 * @param {readonly ParamDecl[]} decls
 * @returns {Layer}
 */
function genLayer(rng, typeId, decls) {
  /** @type {Record<string, import('../src/model/params.js').ParamValue>} */
  const params = {}
  for (const decl of decls) {
    if (decl.kind === 'A') {
      params[decl.name] = genAnim(rng, decl.min, decl.max)
    } else if (decl.kind === 'int') {
      params[decl.name] = intRange(rng, decl.min, decl.max)
    } else if (decl.kind === 'num') {
      params[decl.name] = q3r(rng, decl.min, decl.max)
    } else if (decl.kind === 'bool') {
      params[decl.name] = rng() < 0.5
    } else {
      params[decl.name] = pick(rng, /** @type {readonly (string|number)[]} */ (decl.values))
    }
  }
  return {
    type: typeId,
    blend: intRange(rng, 0, 6),
    rngSeed: uint32(rng),
    color: pick(rng, COLOR_REFS),
    opacity: genAnim(rng, 0.05, 1.0),
    // Envelope `visible` is materialized by clamp on decode (same precedent
    // as `errored: false`) — deep-eq round-trips require it in generated
    // fixtures too. Ckpt 2 will exercise `visible: false` under the mask.
    visible: true,
    params,
    errored: false,
  }
}

/** Declarations for the two main synthetic types, fetched once. */
const DECLS_910 = [
  A('radius', 0, 400),
  S.int('count', 1, 24),
  A('rotation', 0, 360, { wrap: true }),
  S.bool('filled'),
  S.enum('mode', ['solid', 'dashed', 'dotted']),
  S.num('scale', 0.1, 1.0),
]
const DECLS_911 = [A('height', 10, 900), S.int('bars', 2, 40)]

/**
 * @param {() => number} rng
 * @returns {Composition}
 */
function genComposition(rng) {
  /** @type {number | import('../src/model/params.js').Scheme} */
  let scheme
  if (rng() < 0.7) {
    scheme = intRange(rng, 0, 3)
  } else {
    scheme = {
      id: 'custom',
      name: pick(rng, ['Dusk', 'Ember', 'Tide', 'Static']),
      colors: Array.from({ length: intRange(rng, 1, 4) }, () => pick(rng, HEXES)),
      neutrals: Array.from({ length: intRange(rng, 1, 3) }, () => pick(rng, HEXES)),
      backgrounds: Array.from({ length: intRange(rng, 1, 2) }, () => pick(rng, HEXES)),
    }
  }
  const layerCount = intRange(rng, 1, 5)
  /** @type {Layer[]} */
  const layers = []
  for (let i = 0; i < layerCount; i++) {
    const typeId = rng() < 0.5 ? 910 : 911
    layers.push(genLayer(rng, typeId, typeId === 910 ? DECLS_910 : DECLS_911))
  }
  return { durationId: intRange(rng, 0, 2), scheme, layers }
}

/** A fixed, hand-authored composition for the shape tests. */
function fixedComposition() {
  /** @type {Composition} */
  const c = {
    durationId: 1,
    scheme: 2,
    layers: [{
      type: 910,
      blend: 3,
      rngSeed: 4123456789,
      color: 'c2',
      opacity: { min: 0.05, max: 1, times: 3, algorithm: 17 },
      // Envelope `visible` is materialized by clamp on decode (same precedent
      // as `errored: false`) — deep-eq round-trips require it in the fixture.
      visible: true,
      params: {
        radius: { min: 12.5, max: 398.25, times: 5, algorithm: 12 },
        count: 17,
        rotation: { min: 0, max: 360, times: 2, algorithm: 7 },
        filled: true,
        mode: 'dashed',
        scale: 0.834,
      },
      errored: false,
    }],
  }
  return c
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

suite('seed/base64url', () => {
  test('round-trips bytes at every padding remainder', () => {
    const cases = [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([0, 255]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array([251, 252, 253, 254, 255, 0, 63, 62]),
    ]
    for (const bytes of cases) {
      const s = bytesToB64url(bytes)
      assertDeepEq(Array.from(b64urlToBytes(s)), Array.from(bytes), `len ${bytes.length}`)
    }
  })

  test('output uses only [A-Za-z0-9-_] and no padding', () => {
    // 0xFB 0xEF … produce + and / in standard base64; they must become - and _.
    const bytes = new Uint8Array(256).map((_, i) => i)
    const s = bytesToB64url(bytes)
    assert(/^[A-Za-z0-9\-_]+$/.test(s), 'alphabet leak')
    assert(!s.includes('='), 'padding leak')
  })

  test('rejects characters outside the alphabet', () => {
    assertThrows(() => b64urlToBytes('abc+'))
    assertThrows(() => b64urlToBytes('abc/'))
    assertThrows(() => b64urlToBytes('abc='))
    assertThrows(() => b64urlToBytes('ab c'))
  })

  test('rejects impossible length 4n + 1', () => {
    assertThrows(() => b64urlToBytes('AAAAA'))
  })

  test('round-trips a large payload through the btoa chunking path', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => (i * 31) & 0xff)
    assertDeepEq(Array.from(b64urlToBytes(bytesToB64url(bytes))), Array.from(bytes))
  })
})

// ---------------------------------------------------------------------------
// deflate
// ---------------------------------------------------------------------------

suite('seed/deflate', () => {
  test('capability probe is a cached boolean', () => {
    assertEq(typeof canDeflate(), 'boolean')
    assertEq(canDeflate(), canDeflate())
  })

  test('deflate → inflate round-trips (z-capable engines)', async () => {
    if (!canDeflate()) return // the p path is proven in the codec suite
    const bytes = new TextEncoder().encode('["loop-me",1,2,[[910,0,42,"c0"]]]')
    const packed = await deflate(bytes)
    const back = await inflate(packed)
    assertDeepEq(Array.from(back), Array.from(bytes))
  })

  test('inflate rejects a corrupted stream', async () => {
    if (!canDeflate()) return
    await assertRejects(() => inflate(new Uint8Array([1, 2, 3, 4, 5])))
  })
})

// ---------------------------------------------------------------------------
// toArray / fromArray
// ---------------------------------------------------------------------------

suite('seed/codec — toArray/fromArray', () => {
  test('toArray emits the §9.2 positional structure', () => {
    const arr = toArray(fixedComposition())
    assert(Array.isArray(arr))
    assertEq(arr[0], SCHEMA_VERSION, 'schemaVersion first')
    assertEq(arr[1], 1, 'durationId second')
    assertEq(arr[2], 2, 'built-in scheme as bare index')
    const layers = /** @type {unknown[][]} */ (arr[3])
    assertEq(layers.length, 1)
    const w = layers[0]
    assertEq(w[0], 910, 'typeId')
    assertEq(w[1], 3, 'blendId')
    assertEq(w[2], 4123456789, 'rngSeed')
    assertEq(w[3], 'c2', 'colorRef')
    assertDeepEq(w[4], [0.05, 1, 3, 17], 'opacity 4-tuple')
    assertDeepEq(w[5], [12.5, 398.25, 5, 12], 'A param 4-tuple')
    assertEq(w[6], 17, 'int passes through')
    assertDeepEq(w[7], [0, 360, 2, 7], 'second A param')
    assertEq(w[8], true, 'bool passes through')
    assertEq(w[9], 1, 'enum encodes as index, not value')
    assertEq(w[10], 0.834, 'num passes through')
    assertEq(w.length, 11, 'nothing extra on the wire')
  })

  test('toArray quantizes floats to 3dp', () => {
    const c = fixedComposition()
    ;(/** @type {AnimValue} */ (c.layers[0].params.radius)).max = 398.123456
    c.layers[0].params.scale = 0.123456
    const w = /** @type {unknown[][]} */ (toArray(c)[3])[0]
    assertDeepEq(w[5], [12.5, 398.123, 5, 12])
    assertEq(w[10], 0.123)
  })

  test('fromArray(toArray(c)) deep-equals c', () => {
    const c = fixedComposition()
    assertDeepEq(fromArray(toArray(c)), c)
  })

  test('missing trailing params take declared defaults', () => {
    const arr = toArray(fixedComposition())
    const w = /** @type {unknown[]} */ (/** @type {unknown[][]} */ (arr[3])[0])
    w.length = 7 // keep envelope + radius + count; drop rotation, filled, mode, scale
    const c = fromArray(arr)
    const layer = c.layers[0]
    assertDeepEq(layer.params.rotation, { min: 0, max: 360, times: 1, algorithm: 0 }, 'A default')
    assertEq(layer.params.filled, false, 'bool default')
    assertEq(layer.params.mode, 'solid', 'enum default')
    assertEq(layer.params.scale, 0.1, 'num default (declared min)')
  })

  test('unknown trailing elements from a newer build are ignored', () => {
    const arr = toArray(fixedComposition())
    const w = /** @type {unknown[]} */ (/** @type {unknown[][]} */ (arr[3])[0])
    w.push([1, 2, 3, 4], 'future-param', 99)
    assertDeepEq(fromArray(arr), fixedComposition())
  })

  test('out-of-range values clamp instead of rejecting', () => {
    const arr = toArray(fixedComposition())
    const w = /** @type {unknown[]} */ (/** @type {unknown[][]} */ (arr[3])[0])
    w[5] = [-50, 9999, 40, -3] // radius: bounds 0–400, times 1–8
    w[6] = 999                 // count: 1–24
    const layer = fromArray(arr).layers[0]
    assertDeepEq(layer.params.radius, { min: 0, max: 400, times: 8, algorithm: 0 })
    assertEq(layer.params.count, 24)
  })

  test('unknown blend clamps to normal', () => {
    const arr = toArray(fixedComposition())
    ;(/** @type {unknown[]} */ (/** @type {unknown[][]} */ (arr[3])[0]))[1] = 99
    assertEq(fromArray(arr).layers[0].blend, 0)
  })

  test('unknown layer type is skipped with a warning; the rest renders', async () => {
    const c = fixedComposition()
    const arr = toArray(c)
    const layers = /** @type {unknown[][]} */ (arr[3])
    layers.unshift([99999, 0, 1, 'c0', [0.05, 1, 1, 0]])
    /** @type {Composition | null} */
    let out = null
    const reports = await captureReports(() => { out = fromArray(arr) })
    assert(out !== null)
    assertEq(/** @type {Composition} */ (out).layers.length, 1, 'known layer survives')
    assertEq(/** @type {Composition} */ (out).layers[0].type, 910)
    assertEq(reports.length, 1)
    assertEq(reports[0].code, LAYER_UNKNOWN_TYPE)
  })

  test('a seed whose layers are all unknown throws SEED_TRUNCATED', async () => {
    const reports = await captureReports(() => {
      const e = assertThrows(() => fromArray([SCHEMA_VERSION, 1, 0, [[99999, 0, 1, 'c0', [0.05, 1, 1, 0]]]]))
      assert(e instanceof AppError)
      assertEq(e.code, SEED_TRUNCATED)
    })
    assertEq(reports.length, 1, 'the unknown type is still warned about')
    assertEq(reports[0].code, LAYER_UNKNOWN_TYPE)
  })

  test('unrecognized version is rejected, naming the mismatch', () => {
    const e = assertThrows(() => fromArray(['2', 1, 0, [[910, 0, 1, 'c0', [0.05, 1, 1, 0]]]]))
    assert(e instanceof AppError)
    assertEq(e.code, SEED_VERSION)
    const detail = /** @type {{version: string}} */ (/** @type {AppError} */ (e).detail)
    assertEq(detail.version, '2')
  })

  test('non-array and short-array input throw SEED_TRUNCATED', () => {
    for (const bad of [null, 42, 'seed', {}, [], [SCHEMA_VERSION, 1]]) {
      const e = assertThrows(() => fromArray(bad))
      assert(e instanceof AppError, 'AppError expected')
      assertEq(/** @type {AppError} */ (e).code, SEED_TRUNCATED)
    }
  })

  test('out-of-range built-in scheme index clamps to the last built-in', () => {
    const arr = toArray(fixedComposition())
    arr[2] = 99
    assertEq(fromArray(arr).scheme, BUILTINS.length - 1)
  })

  test('out-of-range durationId clamps', () => {
    const arr = toArray(fixedComposition())
    arr[1] = 99
    assertEq(fromArray(arr).durationId, 2)
  })

  test('an embedded custom scheme travels without # and comes back with it', () => {
    const c = fixedComposition()
    c.scheme = {
      id: 'custom',
      name: 'Dusk',
      colors: ['#FF2E88', '#00E5FF'],
      neutrals: ['#EDE6D8'],
      backgrounds: ['#0E7490'],
    }
    const arr = toArray(c)
    assertDeepEq(arr[2], ['Dusk', ['FF2E88', '00E5FF'], ['EDE6D8'], ['0E7490']], 'wire form')
    assertDeepEq(fromArray(arr), c, 'round-trip restores # and id')
  })
})

// ---------------------------------------------------------------------------
// encode / decode
// ---------------------------------------------------------------------------

suite('seed/codec — encode/decode', () => {
  test('round-trip property: 200 generated compositions, both flags', async () => {
    const rng = mulberry32(0xC0DEC)
    for (let i = 0; i < 200; i++) {
      const c = genComposition(rng)
      const seed = await encode(c, i % 2 === 1 ? { compress: false } : undefined)
      assert(/^[A-Za-z0-9\-_]+$/.test(seed), `seed ${i} is not URL-safe: ${seed.slice(0, 20)}…`)
      assertEq(seed[0], SCHEMA_VERSION, `seed ${i} version prefix`)
      assert(seed[1] === 'z' || seed[1] === 'p', `seed ${i} flag`)
      const back = await decode(seed)
      assertDeepEq(back, c, `composition ${i} (flag ${seed[1]})`)
    }
  })

  test('a p-flag seed decodes regardless of engine capability', async () => {
    const c = fixedComposition()
    const seed = await encode(c, { compress: false })
    assertEq(seed.slice(0, 2), SCHEMA_VERSION + 'p')
    assertDeepEq(await decode(seed), c)
  })

  test('a z-flag seed decodes on a z-capable engine', async () => {
    if (!canDeflate()) return
    const c = fixedComposition()
    const seed = await encode(c)
    assertEq(seed.slice(0, 2), SCHEMA_VERSION + 'z')
    assertDeepEq(await decode(seed), c)
  })

  test('decode accepts surrounding whitespace', async () => {
    const c = fixedComposition()
    const seed = await encode(c)
    assertDeepEq(await decode(`  ${seed}\n`), c)
  })

  test('a 5-layer built-in-scheme seed stays under 1,500 chars', async () => {
    const rng = mulberry32(5)
    /** @type {Composition} */
    const c = {
      durationId: 2,
      scheme: 0,
      layers: Array.from({ length: 5 }, () => genLayer(rng, 910, DECLS_910)),
    }
    const seed = await encode(c)
    assert(seed.length <= 1500, `seed is ${seed.length} chars`)
  })

  test('a truncated seed reports and throws SEED_MALFORMED', async () => {
    const seed = await encode(fixedComposition())
    const truncated = seed.slice(0, Math.floor(seed.length / 2))
    const reports = await captureReports(async () => {
      const e = await assertRejects(() => decode(truncated))
      assert(e instanceof AppError)
      assertEq(/** @type {AppError} */ (e).code, SEED_MALFORMED)
    })
    assertEq(reports.length, 1, 'exactly one report per failure')
    assertEq(reports[0].code, SEED_MALFORMED)
  })

  test('a "2…" seed reports and throws SEED_VERSION, naming the version', async () => {
    const reports = await captureReports(async () => {
      const e = await assertRejects(() => decode('2zAAAA'))
      assert(e instanceof AppError)
      assertEq(/** @type {AppError} */ (e).code, SEED_VERSION)
    })
    assertEq(reports.length, 1)
    assertEq(reports[0].code, SEED_VERSION)
    assertEq(/** @type {{version: string}} */ (reports[0].detail).version, '2')
  })

  test('empty and flagless seeds report SEED_MALFORMED', async () => {
    for (const bad of ['', '  ', '1', '1x_AAA', '1zn ot-b64!']) {
      const reports = await captureReports(async () => {
        const e = await assertRejects(() => decode(bad), `"${bad}" should reject`)
        assert(e instanceof AppError, `"${bad}" threw a non-AppError`)
        assertEq(/** @type {AppError} */ (e).code, SEED_MALFORMED, `code for "${bad}"`)
      })
      assertEq(reports.length, 1, `reports for "${bad}"`)
    }
  })

  test('a seed over 4,000 chars reports SEED_TOO_LONG but still encodes and decodes', async () => {
    const rng = mulberry32(912)
    /** @type {Composition} */
    const c = {
      durationId: 1,
      scheme: 1,
      layers: Array.from({ length: 5 }, () =>
        genLayer(rng, 912, Array.from({ length: 32 }, (_, i) => A('p' + i, 0, 1000)))),
    }
    /** @type {string} */
    let seed = ''
    const reports = await captureReports(async () => {
      seed = await encode(c, { compress: false })
    })
    assert(seed.length > SEED_HARD_WARN, `long seed is only ${seed.length} chars`)
    assertEq(reports.length, 1)
    assertEq(reports[0].code, SEED_TOO_LONG)
    assertDeepEq(await decode(seed), c, 'sharing is warned about, never blocked')
  })

  test('encoding a composition with an unregistered layer type skips it with a warning', async () => {
    const c = fixedComposition()
    c.layers.push(/** @type {Layer} */ ({
      type: 99999,
      blend: 0,
      rngSeed: 1,
      color: 'c0',
      opacity: { min: 0.05, max: 1, times: 1, algorithm: 0 },
      params: {},
      errored: false,
    }))
    const reports = await captureReports(async () => {
      const seed = await encode(c)
      const back = await decode(seed)
      assertEq(back.layers.length, 1, 'only the known layer is on the wire')
    })
    assertEq(reports.length, 1)
    assertEq(reports[0].code, LAYER_UNKNOWN_TYPE)
  })
})

// ---------------------------------------------------------------------------
// hash
// ---------------------------------------------------------------------------

suite('seed/hash', () => {
  test('parseSeed accepts a bare seed', () => {
    assertEq(parseSeed('1zABC-_9'), '1zABC-_9')
  })

  test('parseSeed accepts a full URL', () => {
    assertEq(parseSeed('https://x.github.io/loop-me/#s=1zABC'), '1zABC')
  })

  test('parseSeed accepts either with surrounding whitespace', () => {
    assertEq(parseSeed('  1zABC \n'), '1zABC')
    assertEq(parseSeed(' https://x.github.io/loop-me/#s=1zABC  '), '1zABC')
  })

  test('parseSeed passes a future-version seed through for decode to name', () => {
    assertEq(parseSeed('2zFUTURE'), '2zFUTURE')
  })

  test('parseSeed returns null for empty input', () => {
    assertEq(parseSeed(''), null)
    assertEq(parseSeed('   '), null)
    assertEq(parseSeed('https://x.github.io/loop-me/#s='), null)
  })

  test('the writer debounces: many notifies, one write', async () => {
    /** @type {string[]} */
    const applied = []
    let encodes = 0
    const writer = createHashWriter(
      async () => { encodes++; return '1zSEED' },
      { delayMs: 15, apply: (s) => { applied.push(s) } },
    )
    writer.notify()
    writer.notify()
    writer.notify()
    assertEq(applied.length, 0, 'nothing lands before the idle gap')
    await sleep(60)
    assertEq(encodes, 1, 'one encode for the burst')
    assertDeepEq(applied, ['1zSEED'])
    assertEq(writer.pending(), false)
  })

  test('a stale slow encode never overwrites a newer fast one', async () => {
    /** @type {string[]} */
    const applied = []
    let call = 0
    const writer = createHashWriter(
      async () => {
        call++
        if (call === 1) { await sleep(80); return '1zSTALE' }
        return '1zFRESH'
      },
      { delayMs: 10, apply: (s) => { applied.push(s) } },
    )
    writer.notify()
    await sleep(30)    // first encode is now in flight, and slow
    writer.notify()
    await sleep(120)   // both encodes have resolved
    assertDeepEq(applied, ['1zFRESH'], 'latest wins; the stale write is dropped')
  })

  test('cancel drops a scheduled write', async () => {
    /** @type {string[]} */
    const applied = []
    const writer = createHashWriter(
      async () => '1zSEED',
      { delayMs: 15, apply: (s) => { applied.push(s) } },
    )
    writer.notify()
    writer.cancel()
    await sleep(50)
    assertEq(applied.length, 0)
  })
})
