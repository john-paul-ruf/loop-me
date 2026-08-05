// @ts-check
/**
 * D6 — video export engine (FR-19). Unit tests for the pure helpers.
 * Realtime `captureStream` + `MediaRecorder` capture is exercised by
 * SESSION-04's manual E2E matrix; these tests cover the deterministic parts.
 *
 * The harness runs in a real browser, but `pickMimeType` accepts an
 * injectable predicate so every branch can be driven without patching the
 * global `MediaRecorder`.
 */

import { suite, test, assertEq } from './harness.js'
import {
  pickMimeType,
  extensionFor,
  buildFilename,
  isExportSupported,
} from '../src/render/export.js'

suite('export/pickMimeType', () => {
  test('prefers video/mp4 when supported', () => {
    assertEq(
      pickMimeType((t) => t === 'video/mp4'),
      'video/mp4',
      'mp4 wins when supported',
    )
  })

  test('falls back to vp9 webm when mp4 is unsupported', () => {
    assertEq(
      pickMimeType((t) => t === 'video/webm;codecs=vp9'),
      'video/webm;codecs=vp9',
      'vp9 picked when mp4 unsupported',
    )
  })

  test('falls back to bare webm when neither mp4 nor vp9 are supported', () => {
    assertEq(
      pickMimeType((t) => t === 'video/webm'),
      'video/webm',
      'bare webm picked as last resort',
    )
  })

  test('returns null when nothing matches', () => {
    assertEq(pickMimeType(() => false), null, 'nothing supported → null')
  })
})

suite('export/extensionFor', () => {
  test('video/mp4 → mp4', () => {
    assertEq(extensionFor('video/mp4'), 'mp4', 'mp4 maps to mp4')
  })

  test('webm variants → webm', () => {
    assertEq(extensionFor('video/webm'), 'webm', 'bare webm → webm')
    assertEq(extensionFor('video/webm;codecs=vp9'), 'webm', 'vp9 webm → webm')
    assertEq(extensionFor('video/webm;codecs=vp8'), 'webm', 'vp8 webm → webm')
  })
})

suite('export/buildFilename', () => {
  test('long seed uses first 8 chars', () => {
    assertEq(
      buildFilename(15, 'a1b2c3d4efgh', 'webm'),
      'loop-me-15s-a1b2c3d4.webm',
      'first 8 chars + ext',
    )
  })

  test('null seed uses "loop" as the prefix', () => {
    assertEq(
      buildFilename(15, null, 'webm'),
      'loop-me-15s-loop.webm',
      'null seed → "loop" prefix',
    )
  })

  test('short seed falls back to "loop"', () => {
    assertEq(
      buildFilename(5, 'abc', 'mp4'),
      'loop-me-5s-loop.mp4',
      'too-short seed → "loop" prefix',
    )
  })

  test('exactly-8-char seed is used verbatim', () => {
    assertEq(
      buildFilename(30, '12345678', 'mp4'),
      'loop-me-30s-12345678.mp4',
      '8-char boundary kept',
    )
  })
})

suite('export/isExportSupported', () => {
  test('returns a boolean (browser-dependent smoke)', () => {
    const result = isExportSupported()
    assertEq(typeof result, 'boolean', 'is a boolean')
  })
})