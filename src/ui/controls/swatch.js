// @ts-check
/**
 * Swatch control — `.swatch` incl. selected double-ring, removable `✕`,
 * and the dashed add-slot (_tokens.css §17, mocks/schemes.html).
 *
 * Used in the schemes panel for colour buckets. Each swatch is a button
 * with a background colour set via the `--swatch` CSS custom property
 * (CSP-safe). The selected swatch gets a double-ring outline via
 * `.swatch[aria-pressed="true"]`.
 *
 * The last swatch in a bucket renders **with no ✕ at all** — the rule is
 * enforced by absence, not by an error message (mocks/schemes.html).
 * The add-slot is a `.swatch.swatch--add` with a dashed border and `＋`.
 *
 * This module provides two factories:
 * - `swatch(colour, selected, canRemove, onSelect, onRemove)` — a single colour swatch.
 * - `addSlot(onAdd)` — the dashed `＋` button.
 */

import { el } from '../dom.js'

/**
 * @typedef {object} SwatchHandle
 * @property {HTMLElement} node   The `.swatch` button.
 * @property {() => void} destroy  Remove event listeners.
 */

/**
 * Create a single colour swatch.
 *
 * @param {string} colour       Hex colour (`#RRGGBB`).
 * @param {boolean} selected    Whether this swatch is the currently selected one.
 * @param {boolean} canRemove   Whether the remove `✕` is shown (false for the last swatch in a bucket).
 * @param {string} ariaLabel    Accessible label, e.g. "Edit rust orange".
 * @param {() => void} onSelect  Called when the swatch is clicked.
 * @param {() => void} [onRemove]  Called when the `✕` is clicked (only if `canRemove`).
 * @returns {SwatchHandle}
 */
export function swatch(colour, selected, canRemove, ariaLabel, onSelect, onRemove) {
  const node = el('button', {
    class: 'swatch',
    'aria-pressed': String(selected),
    'aria-label': ariaLabel,
  })
  node.style.setProperty('--swatch', colour)

  node.addEventListener('click', onSelect)

  let xBtn = null
  if (canRemove && onRemove) {
    xBtn = el('span', { class: 'swatch__x', 'aria-hidden': 'true', text: '\u2715' })
    xBtn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      onRemove()
    })
    node.appendChild(xBtn)
  }

  return {
    node,
    destroy() {
      // No external listeners; child listeners die with the node.
    },
  }
}

/**
 * Create the dashed add-slot swatch.
 *
 * @param {string} ariaLabel  Accessible label, e.g. "Add a colour".
 * @param {() => void} onAdd   Called when clicked.
 * @returns {SwatchHandle}
 */
export function addSlot(ariaLabel, onAdd) {
  const node = el('button', {
    class: 'swatch swatch--add',
    'aria-label': ariaLabel,
    text: '\uFF0B',
  })
  node.addEventListener('click', onAdd)

  return {
    node,
    destroy() {
      // No external listeners.
    },
  }
}