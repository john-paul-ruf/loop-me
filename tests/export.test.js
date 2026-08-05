// @ts-check
/**
 * Video export engine (FR-19). Unit tests for the pure helpers.
 * WebCodecs `VideoEncoder` + fMP4 muxing is exercised manually;
 * these tests cover the deterministic parts.
 */

import { suite, test, assertEq } from './harness.js'
import {
  extensionFor,
  buildFilename,
  isExportSupported,
  pickCodec,
} from '../src/render/export.js'

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
      buildFilename(15, 'a1b2c3d4efgh', 'mp4'),
      'loop-me-15s-a1b2c3d4.mp4',
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

suite('export/pickCodec', () => {
  test('prefers avc1.4D4028 (mp4) when supported', async () => {
    const choice = await pickCodec(async (c) => c === 'avc1.4D4028')
    assertEq(choice !== null && choice.codec, 'avc1.4D4028', 'avc1 Main 4.0 picked')
    assertEq(choice !== null && choice.ext, 'mp4', 'ext is mp4')
  })
  test('falls back to avc1.640028 (mp4) when Main 4.0 unsupported', async () => {
    const choice = await pickCodec(async (c) => c === 'avc1.640028')
    assertEq(choice !== null && choice.codec, 'avc1.640028', 'avc1 High 4.0 fallback')
    assertEq(choice !== null && choice.ext, 'mp4', 'ext is mp4')
  })
  test('falls back to vp09 (webm) when no H.264', async () => {
    const choice = await pickCodec(async (c) => c === 'vp09.00.10.08')
    assertEq(choice !== null && choice.codec, 'vp09.00.10.08', 'vp9 fallback')
    assertEq(choice !== null && choice.ext, 'webm', 'ext is webm')
  })
  test('returns null when nothing matches', async () => {
    const choice = await pickCodec(async () => false)
    assertEq(choice, null, 'nothing supported → null')
  })
})

suite('export/isExportSupported', () => {
  test('returns a boolean (browser-dependent smoke)', () => {
    const result = isExportSupported()
    assertEq(typeof result, 'boolean', 'is a boolean')
  })
})