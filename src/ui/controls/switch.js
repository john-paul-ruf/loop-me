// @ts-check
/**
 * Switch control — `role="switch"` + `aria-checked` for boolean statics
 * (_tokens.css §10, architecture §12.3).
 *
 * Used for `S.bool` parameters (e.g. `taper`, `filled`). A button styled
 * as a toggle switch; `aria-checked="true"` moves the thumb right and
 * tints the track accent-pink.
 */

import { el } from '../dom.js'

/**
 * @typedef {object} SwitchControl
 * @property {HTMLElement} node   The `.switch` button element.
 * @property {(value: boolean) => void} update  Set the checked state.
 * @property {() => void} destroy  Remove event listeners.
 */

/**
 * Create a switch control.
 *
 * @param {string} label    Visible label text shown on the left.
 * @param {boolean} checked  Initial state.
 * @param {(value: boolean) => void} onChange  Called with the new state on toggle.
 * @returns {SwitchControl}
 */
export function create(label, checked, onChange) {
  let state = checked

  const track = el('span', { class: 'switch__track' })
  const labelSpan = el('span', { class: 'param__name', text: label })

  const node = el('button', {
    class: 'switch',
    role: 'switch',
    'aria-checked': String(state),
  }, [
    labelSpan,
    track,
  ])

  /**
   * @param {boolean} value
   */
  function setChecked(value) {
    state = value
    node.setAttribute('aria-checked', String(state))
  }

  node.addEventListener('click', () => {
    setChecked(!state)
    onChange(state)
  })

  return {
    node,
    /**
     * @param {boolean} value
     */
    update(value) {
      setChecked(value)
    },
    destroy() {
      // No external listeners.
    },
  }
}