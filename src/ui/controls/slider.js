// @ts-check
/**
 * Slider control — single-value static param, native `<input type="range">`
 * (architecture §12.3).
 *
 * Used for `S.num` static parameters (e.g. `rateSpread`, `spacing`).
 * A single native range input, visually styled by `_tokens.css`'s `.track`
 * classes. Unlike the band (which has two thumbs), this is one thumb on a
 * rail.
 *
 * The visible thumb is positioned by JS from the input value via the
 * `--thumb-left` custom property, same as the band. The native input is
 * transparent and sits above the visual layers.
 */

import { el } from '../dom.js'
import { clamp } from '../../util/clamp.js'

/**
 * @typedef {object} SliderControl
 * @property {HTMLElement} node   The `.track` element.
 * @property {(value: number) => void} update  Set the current value.
 * @property {() => void} destroy  Remove event listeners.
 */

/**
 * Create a slider control for a single numeric value.
 *
 * @param {number} min       Minimum value (inclusive).
 * @param {number} max       Maximum value (inclusive).
 * @param {number} step     Step size.
 * @param {number} value    Initial value.
 * @param {string} ariaLabel  Label for the input.
 * @param {(value: number) => void} onChange  Called with the new value on change.
 * @returns {SliderControl}
 */
export function create(min, max, step, value, ariaLabel, onChange) {
  let current = clamp(value, min, max)

  const rail = el('div', { class: 'track__rail' })
  const thumb = el('div', { class: 'track__thumb', 'aria-hidden': 'true' })

  const input = el('input', {
    class: 'range-input',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    'aria-label': ariaLabel,
    value: String(current),
  })

  const node = el('div', { class: 'track' }, [rail, thumb, input])

  /**
   * Convert a value to a percentage of [min, max].
   * @param {number} v
   * @returns {number}
   */
  function toPct(v) {
    if (max === min) return 0
    return ((v - min) / (max - min)) * 100
  }

  /**
   * Update the visible thumb position.
   */
  function syncVisuals() {
    thumb.style.setProperty('--thumb-left', toPct(current) + '%')
  }

  function onInput() {
    current = parseFloat(/** @type {string} */ (input.value))
    syncVisuals()
    onChange(current)
  }

  input.addEventListener('input', onInput)
  syncVisuals()

  return {
    node,
    /**
     * @param {number} v
     */
    update(v) {
      current = clamp(v, min, max)
      input.value = String(current)
      syncVisuals()
    },
    destroy() {
      input.removeEventListener('input', onInput)
    },
  }
}