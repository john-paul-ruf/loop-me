// @ts-check
/**
 * Blend mode registry (architecture §8.3, FR-5).
 *
 * **This ordering is append-only forever.** The index is what a seed stores;
 * renumbering or removing an entry silently repaints every composition ever
 * shared. A new mode goes on the end, never in the middle.
 *
 * Names are Designer's, transcribed from the blend chips in
 * `mocks/layer-editor.html` — 'Additive', not 'Lighter'; 'Hard light',
 * sentence case. The user never sees a composite-operation string.
 *
 * This module imports nothing.
 */

export const BLEND_NORMAL = 0
export const BLEND_ADDITIVE = 1
export const BLEND_SCREEN = 2
export const BLEND_MULTIPLY = 3
export const BLEND_OVERLAY = 4
export const BLEND_DIFFERENCE = 5
export const BLEND_HARD_LIGHT = 6

/**
 * ID → canvas composite operation. Indexed directly by the painter
 * (`ctx.globalCompositeOperation = BLEND_OPS[layer.blend]`, architecture §6.4),
 * which is safe because `composition.clamp()` coerces every blend ID on the
 * way in — the frame path does no validation of its own.
 *
 * @type {readonly GlobalCompositeOperation[]}
 */
export const BLEND_OPS = Object.freeze(
  /** @type {GlobalCompositeOperation[]} */ ([
    'source-over',
    'lighter',
    'screen',
    'multiply',
    'overlay',
    'difference',
    'hard-light',
  ]),
)

/**
 * ID → user-facing name, exactly as the mocks label the chips.
 * @type {readonly string[]}
 */
export const BLEND_NAMES = Object.freeze([
  'Normal',
  'Additive',
  'Screen',
  'Multiply',
  'Overlay',
  'Difference',
  'Hard light',
])

/** How many blend modes exist today. Grows; never shrinks. */
export const BLEND_COUNT = BLEND_OPS.length

/**
 * The blend IDs a user may **pick** and the randomizer may **produce**, in
 * display order. This is deliberately a subset of the full table: Multiply (3)
 * and Overlay (4) are *retired* — muddy against this palette — but their
 * indices stay reserved forever (a shared seed that still carries them decodes
 * and renders unchanged; see the append-only note at the top of this file).
 * Retiring ≠ renumbering. To retire another mode, drop its ID here only.
 *
 * @type {readonly number[]}
 */
export const SELECTABLE_BLENDS = Object.freeze([
  BLEND_NORMAL,     // 0
  BLEND_ADDITIVE,   // 1
  BLEND_SCREEN,     // 2
  BLEND_DIFFERENCE, // 5
  BLEND_HARD_LIGHT, // 6
])

/**
 * Coerce an untrusted blend ID to a legal one.
 *
 * An unknown ID clamps to `normal` rather than failing the composition —
 * FR-18's "recoverable inconsistencies repaired silently". Anything that is
 * not an integer in range (a float, a numeric string, `null`, a future mode
 * this build has never heard of) lands on `0`.
 *
 * @param {unknown} id
 * @returns {number}
 */
export function coerceBlend(id) {
  if (typeof id !== 'number' || !Number.isInteger(id)) return BLEND_NORMAL
  if (id < 0 || id >= BLEND_COUNT) return BLEND_NORMAL
  return id
}

/**
 * @param {unknown} id
 * @returns {GlobalCompositeOperation}
 */
export function blendOp(id) {
  return BLEND_OPS[coerceBlend(id)]
}

/**
 * @param {unknown} id
 * @returns {string}
 */
export function blendName(id) {
  return BLEND_NAMES[coerceBlend(id)]
}
