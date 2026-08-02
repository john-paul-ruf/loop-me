// @ts-check
/**
 * 3-decimal-place quantization (architecture §9.3).
 *
 * Every float is quantized before encoding. This is what makes
 * `decode(encode(c))` deep-equal `c` (FR-12) rather than merely close, and
 * it materially shortens the payload — `0.123` instead of
 * `0.12299999999999999`.
 */

/** Scale factor for 3dp. */
const SCALE = 1000

/**
 * Round to 3 decimal places.
 *
 * Integers and non-finite values pass straight through as `0`-safe results:
 * a non-finite input yields `0`, because a seed field is a number slot and
 * `NaN` does not survive `JSON.stringify` (it becomes `null`, which then
 * decodes as a missing value rather than a repairable one).
 *
 * `-0` is normalised to `0`. Without that, a round-trip comparison using
 * `Object.is` reports a mismatch on a value that is numerically identical.
 *
 * @param {number} n
 * @returns {number}
 */
export function q3(n) {
  if (!Number.isFinite(n)) return 0
  if (Number.isInteger(n)) return n === 0 ? 0 : n
  const r = Math.round(n * SCALE) / SCALE
  return r === 0 ? 0 : r
}

/**
 * Quantize every number in an array, recursing into nested arrays.
 *
 * The seed's pre-encoding form is a positional array whose leaves are
 * numbers, booleans and short strings (architecture §9.2), so anything that
 * is not a number or an array is passed through untouched.
 *
 * Returns a new array; the input is not mutated.
 *
 * @param {readonly unknown[]} arr
 * @returns {unknown[]}
 */
export function qArray(arr) {
  const out = new Array(arr.length)
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (typeof v === 'number') out[i] = q3(v)
    else if (Array.isArray(v)) out[i] = qArray(v)
    else out[i] = v
  }
  return out
}
