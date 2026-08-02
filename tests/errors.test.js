// @ts-check
/**
 * Contract tests for the error channel.
 *
 * Not in the Session B1 task list — added because one specific guarantee here
 * is load-bearing for FR-18: `report()` is called from inside the painter's
 * per-layer `try/catch`, and if it could throw, "no unhandled exception can
 * stop the render loop" would be circular. That is exactly the kind of
 * invariant that regresses silently, so it is pinned.
 *
 * The channel is module-global state, so each test below leaves it with no
 * subscribers and an empty replay buffer. The order matters: the replay test
 * runs first, while the buffer is provably untouched.
 */

import { suite, test, assert, assertEq } from './harness.js'
import {
  ERROR_CODES,
  AppError,
  report,
  onReport,
  isErrorCode,
  SEED_VERSION,
  SEED_MALFORMED,
  SEED_TRUNCATED,
  SEED_TOO_LONG,
  LAYER_UNKNOWN_TYPE,
  LAYER_DRAW_FAILED,
  STORAGE_UNAVAILABLE,
  STORAGE_QUOTA,
  CLIPBOARD_UNAVAILABLE,
} from '../src/core/errors.js'

suite('errors — taxonomy (architecture §12.2)', () => {
  test('exactly the nine codes, each its own name', () => {
    assertEq(ERROR_CODES.length, 9, 'the taxonomy grew or shrank')
    assertEq(
      ERROR_CODES.join(' '),
      [
        SEED_VERSION, SEED_MALFORMED, SEED_TRUNCATED, SEED_TOO_LONG,
        LAYER_UNKNOWN_TYPE, LAYER_DRAW_FAILED,
        STORAGE_UNAVAILABLE, STORAGE_QUOTA, CLIPBOARD_UNAVAILABLE,
      ].join(' '),
    )
    assertEq(new Set(ERROR_CODES).size, 9, 'two codes share a value')
    for (const c of ERROR_CODES) assertEq(c, c.toUpperCase(), `${c} is not upper snake case`)
  })

  test('isErrorCode recognises the nine and nothing else', () => {
    for (const c of ERROR_CODES) assert(isErrorCode(c), `${c} should be recognised`)
    assertEq(isErrorCode('SEED_WHATEVER'), false)
    assertEq(isErrorCode(''), false)
    assertEq(isErrorCode(3), false)
    assertEq(isErrorCode(null), false)
    assertEq(isErrorCode(undefined), false)
  })

  test('AppError carries its code and detail', () => {
    const e = new AppError(SEED_VERSION, 'seed says version 2', { got: '2' })
    assert(e instanceof Error, 'AppError is an Error')
    assertEq(e.name, 'AppError')
    assertEq(e.code, SEED_VERSION)
    assertEq(e.message, 'seed says version 2')
    assertEq(new AppError(SEED_MALFORMED).message, SEED_MALFORMED, 'message defaults to the code')
    assertEq(new AppError(SEED_MALFORMED).detail, null, 'detail defaults to null, never undefined')
  })
})

suite('errors — the report channel never unwinds (FR-18)', () => {
  test('a report made before anyone subscribes is replayed to the first listener', () => {
    // Boot step 4 decodes the seed; ui/feedback.js is constructed later
    // (architecture §7). Without this, a broken shared link says nothing.
    report(SEED_TRUNCATED, { where: 'boot' })

    /** @type {string[]} */
    const seen = []
    const off = onReport((r) => { seen.push(String(r.code)) })
    assertEq(seen.join(','), SEED_TRUNCATED, 'the buffered report arrived on subscribe')

    // …and only once.
    const off2 = onReport(() => { seen.push('SECOND_LISTENER') })
    assertEq(seen.length, 1, 'a drained report must not be replayed again')
    off2()
    off()
  })

  test('delivers to every listener, and stops on unsubscribe', () => {
    /** @type {string[]} */
    const a = []
    /** @type {string[]} */
    const b = []
    const offA = onReport((r) => { a.push(String(r.code)) })
    const offB = onReport((r) => { b.push(String(r.code)) })

    report(STORAGE_QUOTA)
    assertEq(a.join(','), STORAGE_QUOTA, 'listener a')
    assertEq(b.join(','), STORAGE_QUOTA, 'listener b')

    offA()
    report(CLIPBOARD_UNAVAILABLE)
    assertEq(a.length, 1, 'unsubscribed listener went quiet')
    assertEq(b.length, 2, 'the remaining listener kept receiving')
    offB()
  })

  test('a throwing listener does not unwind report(), and does not starve the others', () => {
    /** @type {string[]} */
    const survived = []
    const offBad = onReport(() => { throw new Error('this listener is broken') })
    const offGood = onReport((r) => { survived.push(String(r.code)) })

    // If this throws, the painter's per-layer fence becomes the thing that
    // stops the render loop — the exact failure FR-18 forbids.
    const r = report(LAYER_DRAW_FAILED, { index: 2 })

    assertEq(survived.join(','), LAYER_DRAW_FAILED, 'the healthy listener still ran')
    assertEq(r.code, LAYER_DRAW_FAILED, 'report() returned the report it built')
    offBad()
    offGood()
  })

  test('report normalises detail and accepts an unmapped code without complaint', () => {
    /** @type {unknown[]} */
    const details = []
    const off = onReport((r) => { details.push(r.detail) })

    report(SEED_TOO_LONG)
    assertEq(details[0], null, 'omitted detail becomes null')

    report(LAYER_UNKNOWN_TYPE, 17)
    assertEq(details[1], 17, 'detail passes through untouched')

    // core/ does not police the code space — that guard lives at the UI
    // boundary, where isErrorCode() picks the message.
    report(STORAGE_UNAVAILABLE)
    assertEq(details.length, 3)
    off()
  })
})
