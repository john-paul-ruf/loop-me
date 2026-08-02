// @ts-check
/**
 * Numeric range helpers.
 *
 * Imported freely by every layer of the DAG (architecture §4): this module
 * depends on nothing and touches no DOM.
 */

/**
 * Constrain `v` to `[min, max]`.
 *
 * A non-finite input returns `min` rather than propagating NaN. That is
 * deliberate: this is the function the decoder's repair pass leans on
 * (architecture §9.5, "number outside declared bounds → clamped, not
 * rejected"), and a seed that arrived with `null` or `"x"` in a numeric slot
 * must resolve to something renderable, not poison the frame.
 *
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  if (!Number.isFinite(v)) return min
  if (v < min) return min
  if (v > max) return max
  return v
}

/**
 * Clamp and round to an integer. Half-values round up, matching the
 * stepper's visible behaviour.
 *
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampInt(v, min, max) {
  if (!Number.isFinite(v)) return Math.round(min)
  return clamp(Math.round(v), Math.round(min), Math.round(max))
}

/**
 * Normalise an angle into `[0, 360)`.
 *
 * Params declared with `wrap: true` are angular, so 360 and 0 are the same
 * place and the UI must not treat the ends of the band as far apart
 * (architecture §5.4).
 *
 * @param {number} deg
 * @returns {number}
 */
export function wrapDeg(deg) {
  if (!Number.isFinite(deg)) return 0
  const r = deg % 360
  return r < 0 ? r + 360 : r
}

/**
 * Linear interpolation, `t` unclamped.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t
}
