// @ts-check
/**
 * Shell interaction regressions — the stagebar-and-quick-delete feature.
 *
 * Locks in three fixes that a one-line revert would silently undo:
 * - SESSION-01: the ⤢ view-only button's own click must NOT self-cancel the
 *   mode it enters (a listener added to `document` mid-dispatch receives the
 *   still-bubbling click). "Tap anywhere" (FR-16) must still exit for real
 *   stage taps; the ghost cluster's own buttons must not exit.
 * - SESSION-02: the ☰ menu opens a destinations modal, routes an item AFTER
 *   returning focus to ☰ (chained focus return), and its capture-phase Esc
 *   closes the menu WITHOUT collapsing the dock.
 *
 * DOM-interaction tests: the harness runs real DOM, so the real shell is
 * mounted against a minimal id-matched fixture and driven with `el.click()`
 * (a genuine bubbling activation — the whole point of the ⤢ regression).
 * `innerHTML` is fine here: the CSP meta lives only in the app's index.html,
 * and no `style=` attribute is used.
 */

import { suite, test, assert, assertEq } from './harness.js'
import { initShell, destroyShell } from '../src/ui/shell.js'
import * as menuModal from '../src/ui/panels/menu.js'
import { MENU, fmt, STATUS } from '../src/ui/strings.js'

const FIXTURE_HTML =
  '<div id="app">' +
  '<main id="stage">' +
  '<div id="stagebar">' +
  '<button id="btn-playpause"><span class="btn__glyph"></span></button>' +
  '<button id="btn-viewonly"></button>' +
  '<button id="btn-menu"></button>' +
  '</div>' +
  '<div id="canvas-frame"></div>' +
  '<div id="stage-status"><span id="fps-dot"></span><span id="fps-text">' +
  '</span><span id="elapsed-text"></span><span id="layers-text"></span></div>' +
  '</main>' +
  '<aside id="dock" class="dock dock--expanded">' +
  '<button id="dock-grabber"></button>' +
  '<button id="btn-randomize"></button><button id="btn-share"></button>' +
  '<button id="btn-save"></button><button id="btn-undo"></button>' +
  '<div id="dock-scroll"></div>' +
  '</aside></div>'

/**
 * Mount fixture + shell; returns root. Callers MUST tear down in finally.
 * @param {Parameters<typeof initShell>[0]} [callbacks]
 * @returns {HTMLElement}
 */
function mount(callbacks) {
  const root = document.createElement('div')
  root.id = 'shell-fixture'
  root.innerHTML = FIXTURE_HTML
  document.body.appendChild(root)
  initShell(callbacks || {})
  return root
}

/** @param {HTMLElement} root */
function unmount(root) {
  // Exit view-only if active so applyViewOnly removes its document listeners.
  const bar = document.getElementById('stagebar')
  if (bar && bar.hidden) document.getElementById('canvas-frame')?.click()
  menuModal.close()
  destroyShell()
  root.remove()
}

suite('shell', () => {
  test('⤢ click enters view-only and survives its own bubble', () => {
    const root = mount()
    try {
      const bar = /** @type {HTMLElement} */ (document.getElementById('stagebar'))
      document.getElementById('btn-viewonly')?.click()
      assertEq(bar.hidden, true, 'stagebar hidden after entering view-only')
      assert(root.querySelector('.ghost') !== null, 'ghost cluster present (click did not self-cancel)')
    } finally { unmount(root) }
  })

  test('ghost Randomize fires without exiting view-only', () => {
    let calls = 0
    const root = mount({ onRandomize: () => { calls++ } })
    try {
      const bar = /** @type {HTMLElement} */ (document.getElementById('stagebar'))
      document.getElementById('btn-viewonly')?.click()
      const prim = /** @type {HTMLElement} */ (root.querySelector('.ghost .btn--primary'))
      prim.click()
      assertEq(calls, 1, 'onRandomize fired once')
      assertEq(bar.hidden, true, 'view-only still active after ghost Randomize')
      const ghostBtns = root.querySelectorAll('.ghost .btn')
      const restore = /** @type {HTMLElement} */ (ghostBtns[ghostBtns.length - 1])
      restore.click() // Restore ⭯
      assertEq(bar.hidden, false, 'Restore exits view-only')
    } finally { unmount(root) }
  })

  test('tap on the stage exits view-only (FR-16)', () => {
    const root = mount()
    try {
      const bar = /** @type {HTMLElement} */ (document.getElementById('stagebar'))
      document.getElementById('btn-viewonly')?.click()
      document.getElementById('canvas-frame')?.click()
      assertEq(bar.hidden, false, 'tap on the stage exits view-only')
      assert(root.querySelector('.ghost') === null, 'ghost removed on exit')
      assert(root.querySelector('.hint-pill') === null, 'hint removed on exit')
    } finally { unmount(root) }
  })

  test('Esc exits view-only', () => {
    const root = mount()
    try {
      const bar = /** @type {HTMLElement} */ (document.getElementById('stagebar'))
      document.getElementById('btn-viewonly')?.click()
      assertEq(bar.hidden, true, 'entered view-only')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      assertEq(bar.hidden, false, 'Esc exits view-only')
    } finally { unmount(root) }
  })

  test('☰ opens the menu; an item routes, closes, returns focus', () => {
    let opened = 0
    const root = mount({ onOpenGallery: () => { opened++ } })
    try {
      const menuBtn = /** @type {HTMLElement} */ (document.getElementById('btn-menu'))
      menuBtn.click()
      assert(menuModal.isOpen(), 'menu is open')
      assert(document.querySelector('.scrim .modal') !== null, 'modal is in the DOM')
      /** @type {HTMLElement | null} */
      let galleryItem = null
      for (const b of document.querySelectorAll('.scrim .modal button')) {
        if ((b.textContent ?? '').trim() === MENU.gallery) galleryItem = /** @type {HTMLElement} */ (b)
      }
      assert(galleryItem !== null, 'gallery item found by its label')
      galleryItem.click()
      assertEq(opened, 1, 'onOpenGallery routed exactly once')
      assertEq(menuModal.isOpen(), false, 'menu closed after item click')
      assertEq(document.activeElement, menuBtn, 'focus returned to ☰ (close before handler)')
    } finally { unmount(root) }
  })

  test('Esc closes the menu without collapsing the dock', () => {
    const root = mount()
    try {
      const dock = /** @type {HTMLElement} */ (document.getElementById('dock'))
      document.getElementById('btn-menu')?.click()
      assert(menuModal.isOpen(), 'menu open')
      const firstBtn = /** @type {HTMLElement} */ (document.querySelector('.scrim .modal button'))
      firstBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      assertEq(menuModal.isOpen(), false, 'menu closed by Esc')
      assert(dock.classList.contains('dock--expanded'), 'dock still expanded (Esc did not reach the shell)')
    } finally { unmount(root) }
  })

  test('elapsed format renders a live second, not a frozen zero', () => {
    assertEq(fmt(STATUS.elapsed, { cur: (123 / 60).toFixed(1), dur: 15 }), '2.1s / 15s')
  })
})
