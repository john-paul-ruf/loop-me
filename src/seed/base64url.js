// @ts-check
/**
 * base64url — unpadded, alphabet `[A-Za-z0-9-_]` (architecture §9.1, FR-12).
 *
 * The seed payload must survive a URL hash fragment with no escaping, which
 * rules out standard base64's `+`, `/` and `=`. Encoding maps through the
 * platform's `btoa`/`atob` (bytes → binary string → base64) with the two
 * URL-hostile characters swapped and the padding stripped; decoding reverses
 * it and validates first, so a corrupted seed fails *here*, loudly, and the
 * codec maps that to `SEED_MALFORMED` — never a silent garbage decode.
 *
 * Imports nothing.
 */

/** Strict alphabet check: every char must be `[A-Za-z0-9-_]`. */
const B64URL_RE = /^[A-Za-z0-9\-_]*$/

/**
 * `btoa` argument-size safety: build the binary string in chunks so a large
 * payload never blows the engine's argument-spread limit.
 */
const CHUNK = 0x8000

/**
 * Bytes → unpadded base64url string.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToB64url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/**
 * Unpadded base64url string → bytes.
 *
 * Throws a plain `Error` on any character outside the alphabet or on a
 * length that no unpadded base64 string can have (`4n + 1`). The codec is
 * the boundary that owns turning that throw into a `SEED_MALFORMED` report —
 * this module stays ignorant of the error taxonomy.
 *
 * @param {string} s
 * @returns {Uint8Array}
 */
export function b64urlToBytes(s) {
  if (typeof s !== 'string' || !B64URL_RE.test(s)) {
    throw new Error('base64url: input contains characters outside [A-Za-z0-9-_]')
  }
  if (s.length % 4 === 1) {
    throw new Error('base64url: impossible length (4n + 1)')
  }
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i)
  }
  return out
}
