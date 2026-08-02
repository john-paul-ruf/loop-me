// @ts-check
/**
 * Stagebar menu modal (☰) — a short list of app destinations.
 *
 * `#btn-menu` is stagebar chrome (build-plan F1) that no spec gives behaviour
 * to and no mock defines. This modal follows the mocks/add-layer.html idiom —
 * scrim → `document.body`, focus trap, capture-phase Esc, focus return — and
 * surfaces the four destinations that already live at the bottom of the
 * composition panel (Gallery · Paste seed · Edit schemes · Show welcome
 * screen), so they are one tap from the stage instead of a long sheet-scroll
 * away on mobile. It invents no feature: the openers are the same closures
 * `main.js` hands the composition panel.
 *
 * Imports `ui/dom.js`, `ui/strings.js` — legal `ui → ui` edges (§4).
 */

import { el, trapFocus } from '../dom.js'
import { MENU } from '../strings.js'

/**
 * @typedef {{
 *   onOpenGallery?: () => void,
 *   onPasteSeed?: () => void,
 *   onOpenSchemes?: () => void,
 *   onShowWelcome?: () => void,
 * }} MenuHandlers
 */

// ---------------------------------------------------------------------------
// Modal state
// ---------------------------------------------------------------------------

/** @type {HTMLElement | null} */
let scrimEl = null
/** @type {(() => void) | null} */
let releaseTrap = null
/** @type {HTMLElement | null} */
let returnFocus = null

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build one destination button — full-width, stacked (setProperty idiom from
 * composition.js:190-194; never a `style=` attribute, CSP hard rule §11.2).
 * `close()` runs BEFORE the handler so focus returns to ☰ first; the
 * destination modal then captures ☰ (`document.activeElement`) as its own
 * return target, chaining focus back to ☰ when it closes.
 *
 * @param {string} label
 * @param {(() => void) | undefined} handler
 * @returns {HTMLElement}
 */
function buildItem(label, handler) {
  const b = el('button', {
    class: 'btn',
    text: label,
    on: { click: () => { close(); if (handler) handler() } },
  })
  b.style.setProperty('width', '100%')
  b.style.setProperty('margin-top', 'var(--s2)')
  return b
}

/**
 * Build the full modal DOM (a plain `.modal`, not `modal--wide`).
 * @param {MenuHandlers} handlers
 * @returns {HTMLElement}
 */
function buildModal(handlers) {
  return el('div', {
    class: 'modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'menu-title',
  }, [
    el('div', { class: 'between mb-4' }, [
      el('h1', { class: 'modal__title m-0', id: 'menu-title', text: MENU.title }),
      el('button', {
        class: 'btn btn--icon',
        'aria-label': MENU.close,
        text: '✕',
        on: { click: () => close() },
      }),
    ]),
    buildItem(MENU.gallery, handlers.onOpenGallery),
    buildItem(MENU.pasteSeed, handlers.onPasteSeed),
    buildItem(MENU.editSchemes, handlers.onOpenSchemes),
    buildItem(MENU.showWelcome, handlers.onShowWelcome),
  ])
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/**
 * Open the menu modal.
 * @param {HTMLElement} triggerEl  The element that opened this modal (☰), for focus return.
 * @param {MenuHandlers} handlers  Destination openers; each runs after close().
 */
export function open(triggerEl, handlers) {
  close() // ensure no stale modal

  returnFocus = triggerEl

  scrimEl = el('div', { class: 'scrim' }, [buildModal(handlers)])
  document.body.appendChild(scrimEl)

  // Trap focus on the ✕ close button (the add-layer idiom). `?? undefined`
  // rather than the siblings' null-cast keeps this new file off the modals'
  // pre-existing trapFocus type-drift (TS2345) — no NEW typecheck error.
  const firstBtn = scrimEl.querySelector('button')
  releaseTrap = trapFocus(scrimEl, firstBtn ?? undefined)

  // Esc to close (capture phase, so it fires before the shell's handler).
  scrimEl.addEventListener('keydown', onEsc, true)
}

/**
 * Close the modal and restore focus.
 */
export function close() {
  if (releaseTrap) {
    releaseTrap()
    releaseTrap = null
  }
  if (scrimEl) {
    scrimEl.removeEventListener('keydown', onEsc, true)
    scrimEl.remove()
    scrimEl = null
  }
  if (returnFocus) {
    returnFocus.focus()
    returnFocus = null
  }
}

/**
 * Esc handler (capture phase).
 * @param {KeyboardEvent} ev
 */
function onEsc(ev) {
  if (ev.key === 'Escape') {
    ev.stopPropagation()
    close()
  }
}

/**
 * Is the modal currently open?
 * @returns {boolean}
 */
export function isOpen() {
  return scrimEl !== null
}
