// @ts-check
/**
 * Seed field — mono readonly input + copy button + character meter
 * (mocks/main.html, mocks/share.html, architecture §9.6).
 *
 * Three visual states:
 * - **Normal**: the seed string, the count, a green meter fill.
 * - **Amber near-limit**: > 3,000 chars, meter fill turns amber.
 * - **Warn over-limit**: > 4,000 chars, meter fill turns amber and the
 *   count turns amber too.
 *
 * While an encode is in flight (async codec, architecture §9.4), shows the
 * `…` placeholder so the user sees something is happening.
 *
 * Copy uses `util/clipboard.js`; on failure, the input auto-selects and
 * the caller shows the CLIPBOARD_UNAVAILABLE banner (FR-13).
 */

import { el, text } from '../dom.js'
import { copy as copyToClipboard } from '../../util/clipboard.js'
import { SEED_HARD_WARN } from '../../seed/codec.js'

/**
 * @typedef {object} SeedFieldControl
 * @property {HTMLElement} node   The container element.
 * @property {(seed: string | null) => void} update  Set the seed string (or `null` for `…`).
 * @property {() => void} destroy  Remove event listeners.
 */

/** Character count above which the meter turns amber. */
const AMBER_THRESHOLD = 3000

/**
 * Create a seed field control.
 *
 * @param {string} ariaLabel  Label for the input.
 * @param {() => void} [onCopySuccess]  Called after a successful copy (for toast).
 * @param {() => void} [onCopyFail]  Called after a failed copy (for fallback).
 * @returns {SeedFieldControl}
 */
export function create(ariaLabel, onCopySuccess, onCopyFail) {
  const input = el('input', {
    class: 'input input--mono',
    readonly: true,
    'aria-label': ariaLabel,
    value: '',
    placeholder: '\u2026',
  })

  const copyBtn = el('button', {
    class: 'btn btn--icon',
    'aria-label': 'Copy seed',
    text: '\u29C9',
  })

  const seedbox = el('div', { class: 'seedbox' }, [input, copyBtn])

  const meterFill = el('div', { class: 'seed-meter__fill' })
  const meterCount = el('span', { class: 'mono', text: '0 / ' + SEED_HARD_WARN })

  const meterBar = el('div', { class: 'seed-meter__bar' }, [meterFill])
  const meter = el('div', { class: 'seed-meter' }, [meterBar, meterCount])

  const node = el('div', {}, [seedbox, meter])

  /**
   * Set the seed string and update the meter.
   *
   * @param {string | null} seed  The seed string, or `null` to show `…`.
   */
  function update(seed) {
    if (seed === null) {
      // Encode in flight — show placeholder.
      input.value = ''
      input.placeholder = '\u2026'
      meterFill.style.setProperty('--meter-fill', '0%')
      text(meterCount, '\u2026')
      return
    }

    input.value = seed
    const len = seed.length
    const pct = Math.min(100, (len / SEED_HARD_WARN) * 100)

    meterFill.style.setProperty('--meter-fill', pct + '%')

    if (len > AMBER_THRESHOLD) {
      meterFill.classList.add('seed-meter__fill--warn')
      meterCount.classList.add('seed-meter__count--warn')
    } else {
      meterFill.classList.remove('seed-meter__fill--warn')
      meterCount.classList.remove('seed-meter__count--warn')
    }

    text(meterCount, `${len} / ${SEED_HARD_WARN}`)
  }

  /**
   * Copy the seed to the clipboard.
   * On success: call `onCopySuccess`.
   * On failure: select the input and call `onCopyFail` (FR-13 fallback).
   */
  async function doCopy() {
    const seed = input.value
    if (!seed) return

    const ok = await copyToClipboard(seed)
    if (ok) {
      if (onCopySuccess) onCopySuccess()
    } else {
      // Fallback: select the input so the user can press ⌘C.
      input.removeAttribute('readonly')
      input.focus()
      input.select()
      input.setAttribute('readonly', 'true')
      if (onCopyFail) onCopyFail()
    }
  }

  copyBtn.addEventListener('click', doCopy)

  return {
    node,
    update,
    destroy() {
      copyBtn.removeEventListener('click', doCopy)
    },
  }
}