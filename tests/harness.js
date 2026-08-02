// @ts-check
/**
 * A ~70-line browser test harness (architecture §1.1).
 *
 * Why not `node --test`: it needs either a package.json with
 * `{"type":"module"}` or a rename of every source file to `.mjs`, and this
 * project's defining constraint is that it has no package manifest. A browser
 * page also gets a real CanvasRenderingContext2D, CompressionStream and
 * localStorage for free — which is most of the risky surface.
 *
 * Usage — each suite module:
 *     import { suite, test, assertEq } from './harness.js'
 *     suite('quantize', () => { test('rounds to 3dp', () => { … }) })
 *
 * tests/index.html loads harness.js first, then each suite as its own module
 * script. Module scripts are deferred, so they have all executed by the time
 * `load` fires — which is when the run below starts. No inline script, no
 * registration call to forget.
 */

/** @typedef {{ name: string, fn: () => (void | Promise<void>) }} TestCase */
/** @typedef {{ name: string, tests: TestCase[] }} Suite */

/** @type {Suite[]} */
const suites = []
/** @type {Suite | null} */
let current = null

/**
 * @param {string} name
 * @param {() => void} fn Runs immediately; registers tests via `test()`.
 */
export function suite(name, fn) {
  current = { name, tests: [] }
  suites.push(current)
  try { fn() } finally { current = null }
}

/**
 * @param {string} name
 * @param {() => (void | Promise<void>)} fn
 */
export function test(name, fn) {
  if (current === null) throw new Error(`test("${name}") called outside a suite()`)
  current.tests.push({ name, fn })
}

/**
 * @param {unknown} cond
 * @param {string} [msg]
 * @returns {asserts cond}
 */
export function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'expected a truthy value')
}

/**
 * Strict identity, so `NaN` equals `NaN` and `-0` does not equal `0`.
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [msg]
 */
export function assertEq(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${msg ?? 'not equal'}: expected ${show(expected)}, got ${show(actual)}`)
  }
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} [eps]
 * @param {string} [msg]
 */
export function assertClose(actual, expected, eps = 1e-9, msg) {
  const d = Math.abs(actual - expected)
  if (!(d <= eps)) {
    throw new Error(`${msg ?? 'not close'}: expected ${expected} ±${eps}, got ${actual} (off by ${d})`)
  }
}

/**
 * Structural equality over the JSON-shaped values the codec round-trips.
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [msg]
 */
export function assertDeepEq(actual, expected, msg) {
  const path = deepDiff(actual, expected, '')
  if (path !== null) throw new Error(`${msg ?? 'not deep-equal'}: mismatch at ${path}`)
}

/**
 * @param {() => unknown} fn
 * @param {string} [msg]
 * @returns {unknown} The thrown value, so the caller can assert on it.
 */
export function assertThrows(fn, msg) {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error(msg ?? 'expected the call to throw, but it returned')
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} at
 * @returns {string | null} Path of the first mismatch, or null.
 */
function deepDiff(a, b, at) {
  if (Object.is(a, b)) return null
  if (typeof a !== typeof b || a === null || b === null) return at || '(root)'
  if (Array.isArray(a) !== Array.isArray(b)) return at || '(root)'
  if (typeof a !== 'object') return at || '(root)'
  const ka = Object.keys(/** @type {object} */ (a))
  const kb = Object.keys(/** @type {object} */ (b))
  if (ka.length !== kb.length) return `${at || '(root)'} (${ka.length} vs ${kb.length} keys)`
  for (const k of ka) {
    const sub = deepDiff(
      /** @type {Record<string, unknown>} */ (a)[k],
      /** @type {Record<string, unknown>} */ (b)[k],
      at ? `${at}.${k}` : k,
    )
    if (sub !== null) return sub
  }
  return null
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function show(v) {
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'bigint') return `${v}n`
  if (typeof v === 'object' && v !== null) {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

/**
 * Build one report line. textContent only — never innerHTML, anywhere in
 * this project (architecture §12.1).
 *
 * @param {HTMLElement} parent
 * @param {string} cls
 * @param {string} text
 * @returns {HTMLElement}
 */
function line(parent, cls, text) {
  const el = document.createElement('div')
  el.className = cls
  el.textContent = text
  parent.appendChild(el)
  return el
}

async function run() {
  const root = document.getElementById('report') ?? document.body
  const started = performance.now()
  let passed = 0
  let failed = 0

  for (const s of suites) {
    line(root, 'suite', s.name)
    for (const t of s.tests) {
      try {
        await t.fn()
        passed++
        line(root, 'case case--pass', `  ✓ ${t.name}`)
      } catch (e) {
        failed++
        const message = e instanceof Error ? e.message : String(e)
        line(root, 'case case--fail', `  ✕ ${t.name}`)
        line(root, 'trace', `      ${message}`)
      }
    }
  }

  const ms = Math.round(performance.now() - started)
  const summary = document.getElementById('summary') ?? line(root, 'summary', '')
  summary.className = failed === 0 ? 'summary summary--pass' : 'summary summary--fail'
  summary.textContent =
    `${passed + failed} tests, ${failed} failures — ${suites.length} suites in ${ms} ms`
  document.title = `${failed === 0 ? 'PASS' : 'FAIL'} — loop-me tests`
}

// Module scripts are deferred, so `load` fires only after every suite module
// has executed and registered itself.
window.addEventListener('load', () => { void run() })
