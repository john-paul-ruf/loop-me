// @ts-check
/**
 * Chip control — `.chip` + `aria-pressed` + the `✓` glyph
 * (_tokens.css §7, architecture §12.3).
 *
 * Used for blend modes (single-select) and motion characters (single-select).
 * State is never carried by colour alone — the `✓` glyph is injected via
 * CSS `::before` on `[aria-pressed="true"]`, and aria-pressed is the
 * semantic source of truth.
 *
 * For single-select chips (blend, character), one chip is always pressed.
 * The caller can also use this in multi-select mode if needed.
 */

import { el } from '../dom.js'

/**
 * @typedef {object} ChipControl
 * @property {HTMLElement} node   The `.chips` container.
 * @property {(index: number) => void} update  Set the pressed index.
 * @property {() => void} destroy  Remove event listeners.
 */

/**
 * Create a single-select chip group.
 *
 * @param {string} label     Group label for `aria-label`.
 * @param {string[]} items   Chip labels, in order.
 * @param {number} selected  Initially pressed index.
 * @param {(index: number) => void} onChange  Called with the new index on press.
 * @returns {ChipControl}
 */
export function create(label, items, selected, onChange) {
  /** @type {HTMLButtonElement[]} */
  const chips = []

  /**
   * @param {number} index
   */
  function setPressed(index) {
    for (let i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed', String(i === index))
    }
  }

  const node = el('div', { class: 'chips', role: 'group', 'aria-label': label })

  for (let i = 0; i < items.length; i++) {
    const chip = el('button', {
      class: 'chip',
      'aria-pressed': String(i === selected),
      text: items[i],
    })
    chip.addEventListener('click', () => {
      setPressed(i)
      onChange(i)
    })
    chips.push(chip)
    node.appendChild(chip)
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
      // No external listeners.
    },
  }
}