// @ts-check
/**
 * Stepper control — `.stepper` for bounded integers (_tokens.css §9).
 *
 * Used for integer static parameters (ray count, gate count, etc.).
 * The −/＋ buttons disable at min/max rather than silently clamping,
 * so the user sees the boundary (Designer §6).
 */

import { el } from '../dom.js'
import { clampInt } from '../../util/clamp.js'

/**
 * @typedef {object} StepperControl
 * @property {HTMLElement} node   The `.stepper` element.
 * @property {(value: number) => void} update  Set the current value.
 * @property {() => void} destroy  Remove event listeners.
 */

/**
 * Create a stepper control.
 *
 * @param {number} min       Minimum value (inclusive).
 * @param {number} max       Maximum value (inclusive).
 * @param {number} value     Initial value.
 * @param {string} ariaLabel  Label prefix for the ± buttons.
 * @param {(value: number) => void} onChange  Called with the new value on each step.
 * @returns {StepperControl}
 */
export function create(min, max, value, ariaLabel, onChange) {
  let current = clampInt(value, min, max)

  const valSpan = el('span', { class: 'stepper__val', text: String(current) })

  const decBtn = el('button', {
    class: 'btn btn--icon',
    'aria-label': `Decrease ${ariaLabel}`,
    text: '\u2212',
  })

  const incBtn = el('button', {
    class: 'btn btn--icon',
    'aria-label': `Increase ${ariaLabel}`,
    text: '\uFF0B',
  })

  const node = el('div', { class: 'stepper' }, [decBtn, valSpan, incBtn])

  /**
   * Update button disabled states and the value display.
   */
  function sync() {
    valSpan.textContent = String(current)
    decBtn.disabled = current <= min
    incBtn.disabled = current >= max
  }

  /**
   * @param {number} v
   */
  function setValue(v) {
    current = clampInt(v, min, max)
    sync()
  }

  decBtn.addEventListener('click', () => {
    if (current > min) {
      current--
      sync()
      onChange(current)
    }
  })

  incBtn.addEventListener('click', () => {
    if (current < max) {
      current++
      sync()
      onChange(current)
    }
  })

  sync()

  return {
    node,
    /**
     * @param {number} v
     */
    update(v) {
      setValue(v)
    },
    destroy() {
      // No external listeners.
    },
  }
}