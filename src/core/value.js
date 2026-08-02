// @ts-check
/**
 * The loop-safe value engine (FR-3).
 *
 * Every animatable parameter in the project resolves through the single
 * function below. There is no second path: `render/resolve.js` calls it once
 * per **A** param per layer per frame, and nothing else evaluates a curve.
 * One call site is what makes the loop-closure guarantee auditable
 * (architecture §8.1).
 *
 * Imports `core/algorithms.js` and `util/clamp.js` only.
 */

import { evaluate } from './algorithms.js'
import { clamp } from '../util/clamp.js'

/**
 * Resolve an animatable parameter to a concrete value for one frame.
 *
 * ## Loop closure is structural, not numerical
 *
 * The frame is wrapped with a modulo *before* it becomes a cycle position:
 *
 *     f = currentFrame mod totalFrame
 *
 * At `currentFrame === totalFrame` that yields exactly `0`, so
 * `findValue(…, totalFrame)` is not merely within 1e-9 of `findValue(…, 0)` —
 * it is the identical double, computed from an identical input. FR-3's
 * acceptance criterion is met by construction rather than by the curves being
 * carefully balanced, and it cannot drift as algorithms are added.
 *
 * The *visual* half of that promise — no seam at the wrap — lives in
 * `algorithms.js`, where every shape is periodic-continuous, and is asserted
 * separately by the suite.
 *
 * ## Bounds are enforced twice
 *
 * `evaluate()` clamps the normalized amplitude to `[0, 1]`, and the mapped
 * result is clamped again to `[min, max]`. The second clamp is not redundant:
 * `min + (max - min) * 1` is not guaranteed to be exactly `max` in binary
 * floating point, and FR-3 says *inclusive*. Two comparisons buy an assertion
 * that can never be violated by rounding.
 *
 * ## `times` must be a whole number
 *
 * A fractional `times` still satisfies loop closure — the modulo sees to that —
 * but it leaves a visible discontinuity at the wrap, because the curve is mid-
 * cycle when the frame counter resets. Enforcement belongs to
 * `model/composition.js`'s clamp pass (FR-6, integer 1–8), where the input is
 * untrusted and a repair can be reported. This function deliberately does not
 * round: silently correcting a bad value here would hide the data bug from the
 * one place equipped to fix it.
 *
 * Allocates nothing (architecture §6.5).
 *
 * @param {number} min          Lower travel bound.
 * @param {number} max          Upper travel bound.
 * @param {number} times        Cycles completed over one loop (FR-6: integer 1–8).
 * @param {number} totalFrame   Frames in the loop: `duration × 60`.
 * @param {number} currentFrame Fractional, wall-clock derived (FR-1).
 * @param {number} algorithmId  Stable ID; unknown falls back to `0` (architecture §8.1).
 * @returns {number} A value in `[min, max]`, inclusive.
 */
export function findValue(min, max, times, totalFrame, currentFrame, algorithmId) {
  // The three edge cases FR-3 specifies, plus non-finite inputs from a repaired
  // seed. All return `min`: a parameter that cannot travel sits at the bottom
  // of its range, which is always a renderable value.
  if (!Number.isFinite(min) || !Number.isFinite(max)) return min
  // `!(max > min)` rather than `max === min`: it also catches an inverted pair
  // surviving from a mangled seed, where mapping onto `[min, max]` has no
  // meaning. `model/composition.js` repairs the ordering; this just stays sane.
  if (!(max > min)) return min
  if (!(totalFrame > 0)) return min
  if (!(times > 0)) return min
  if (!Number.isFinite(currentFrame)) return min

  let f = currentFrame % totalFrame
  if (f < 0) f += totalFrame

  const amplitude = evaluate(algorithmId, (f / totalFrame) * times)
  return clamp(min + (max - min) * amplitude, min, max)
}
