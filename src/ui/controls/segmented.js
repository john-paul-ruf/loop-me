// @ts-check
/**
 * Segmented control — `.seg` + `aria-pressed` (architecture §12.3,
 * _tokens.css §6).
 *
 * Used for duration (5s / 15s / 30s) and colour source (Colour / Neutral /
 * Background / Pinned). A group of mutually exclusive buttons where the
 * selected one carries `aria-pressed="true"`.
 *
 * State is carried by fill AND weight AND aria-pressed — never colour alone
 * (_tokens.css §6 comment).
 */

import { el } from '../dom.js'

/**
 * @typedef {object} SegmentedControl
 * @property {HTMLElement} node   The `.seg` element.
 * @property {(index: number) => void} update  Set the pressed index.
 * @property {() => void} destroy  Remove event listeners.
 */

/**
 * Create a segmented control.
 *
 * @param {string} label    Group label for `aria-label`.
 * @param {string[]} items  Button labels, in order.
 * @param {number} selected  Initially pressed index.
 * @param {(index: number) => void} onChange  Called with the new index on press.
 * @returns {SegmentedControl}
 */
export function create(label, items, selected, onChange) {
  /** @type {HTMLButtonElement[]} */
  const buttons = []

  /**
   * Set the pressed state to one button and clear the rest.
   * @param {number} index
   */
  function setPressed(index) {
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(i === index))
    }
  }

  const node = el('div', { class: 'seg', role: 'group', 'aria-label': label })

  for (let i = 0; i < items.length; i++) {
    const btn = el('button', {
      'aria-pressed': String(i === selected),
      text: items[i],
    })
    btn.addEventListener('click', () => {
      setPressed(i)
      onChange(i)
    })
    buttons.push(btn)
    node.appendChild(btn)
  }

  return {
    node,
    /**
     * @param {number} index
     */
    update(index) {
      setPressed(index)
    },
    destroy() {
      // Buttons are children of node; removing node from the DOM
      // is the caller's job. No external listeners to clean up.
    },
  }
}