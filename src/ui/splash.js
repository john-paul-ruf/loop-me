// @ts-check
/**
 * The FR-0 flash-safety gate (architecture §7, Designer §5 Flow A/B).
 *
 * The splash is **static markup in `index.html`** — it paints before any JS
 * runs, which is what buys "time to splash paint < 300 ms" with certainty
 * (NFR). This module operates on those nodes; it never rebuilds them.
 *
 * ## What `finalize()` does (architecture §7 step 6)
 *
 * When a seed was decoded from the hash: unhide the shared-loop block and
 * name the duration. When `prefers-reduced-motion: reduce` is active: unhide
 * the reduced-motion note. Enable and focus Enter. Trap focus inside the
 * splash dialog.
 *
 * ## What `onEnter()` does (architecture §7 step 8)
 *
 * Release the focus trap, reveal the canvas, clear `inert` from `.app`,
 * move focus to the main view. The caller (main.js) follows with
 * `painter.paint(0, totalFrames)` and `clock.start()` (unless paused).
 *
 * ## Suppression (FR-0)
 *
 * If `prefs.get('suppressSplash')` is true AND `prefers-reduced-motion` is
 * NOT active, the splash is dismissed immediately — `onEnter()` runs without
 * waiting for a click. Suppression is per-device, never in a seed, never
 * inferable from anything a sender controls (FR-0).
 *
 * Reduced-motion **overrides** suppression: even a user who dismissed the
 * splash enters paused (architecture §7 invariant).
 *
 * Imports `ui/dom.js`, `ui/strings.js`, `store/prefs.js`. All legal
 * `ui → store` and `ui → ui` edges (§4).
 */

import { trapFocus } from './dom.js'
import { SPLASH, fmt } from './strings.js'
import { get as getPref, set as setPref } from '../store/prefs.js'

/** @type {HTMLElement | null} */
let splashEl = null
/** @type {HTMLButtonElement | null} */
let enterBtn = null
/** @type {HTMLElement | null} */
let sharedEl = null
/** @type {HTMLElement | null} */
let sharedMetaEl = null
/** @type {HTMLElement | null} */
let rmNoteEl = null
/** @type {HTMLInputElement | null} */
let suppressCheckbox = null

/** The focus trap release function, or null if not trapped. */
/** @type {(() => void) | null} */
let releaseTrap = null

/** Whether reduced-motion is active at boot. */
let reducedMotion = false

/** The callback to run on Enter (provided by main.js). */
/** @type {(() => void) | null} */
let enterCallback = null

/** Whether the splash has already been dismissed. */
let dismissed = false

/** Duration label for the shared-loop notice. */
const DURATION_WORDS = ['5', '15', '30']

// ---------------------------------------------------------------------------
// Reduced-motion detection
// ---------------------------------------------------------------------------

/**
 * Read `prefers-reduced-motion` once at boot. Architecture §12.3:
 * "read once at boot and re-read on `matchMedia` change; it gates
 * `clock.start()`, never the rendered content."
 */
function detectReducedMotion() {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = mq.matches
  // Re-read on change (the user may toggle it while the splash is up).
  mq.addEventListener('change', (e) => {
    reducedMotion = e.matches
    if (rmNoteEl) rmNoteEl.hidden = !reducedMotion
  })
}

// ---------------------------------------------------------------------------
// Finalize — architecture §7 step 6
// ---------------------------------------------------------------------------

/**
 * Finalize the splash after composition acquisition + pre-warm (step 5).
 *
 * Unhides the shared-loop block if a seed was decoded, naming the duration
 * and layer count. Unhides the reduced-motion note if applicable. Enables
 * and focuses Enter. Traps focus.
 *
 * If suppression is set and reduced-motion is NOT active, the splash is
 * dismissed immediately — the caller's `onEnter` fires without waiting.
 *
 * @param {{ hasSeed: boolean, durationId: number, layerCount: number }} info
 * @param {() => void} onEnter  The callback to run when the user presses Enter.
 */
export function finalize(info, onEnter) {
  splashEl = document.getElementById('splash')
  enterBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('sp-enter'))
  sharedEl = document.getElementById('sp-shared')
  sharedMetaEl = document.getElementById('sp-shared-meta')
  rmNoteEl = document.getElementById('sp-rm-note')
  suppressCheckbox = /** @type {HTMLInputElement | null} */ (document.getElementById('sp-suppress'))

  enterCallback = onEnter
  detectReducedMotion()

  // Shared-loop notice (FR-0)
  if (info.hasSeed && sharedEl && sharedMetaEl) {
    sharedEl.hidden = false
    const splashRoot = document.getElementById('splash')
    if (splashRoot) splashRoot.classList.add('splash--seeded')
    const dur = DURATION_WORDS[info.durationId] ?? '15'
    sharedMetaEl.textContent = fmt(SPLASH.sharedMeta, {
      dur: dur,
      n: String(info.layerCount),
    })
  }

  // Reduced-motion note (FR-17)
  if (reducedMotion && rmNoteEl) {
    rmNoteEl.hidden = false
  }

  // Enable and focus Enter
  if (enterBtn) {
    enterBtn.disabled = false
  }

  // Trap focus inside the splash dialog
  const modal = document.getElementById('splash-modal')
  if (modal) {
    releaseTrap = trapFocus(modal, enterBtn ?? undefined)
  }

  // Wire Enter click
  if (enterBtn) {
    enterBtn.addEventListener('click', dismiss)
  }

  // Wire the suppression checkbox
  if (suppressCheckbox) {
    suppressCheckbox.addEventListener('change', () => {
      setPref('suppressSplash', suppressCheckbox.checked)
    })
  }

  // Check suppression: if set and reduced-motion is NOT active, skip the
  // splash immediately (architecture §7 step 7a).
  if (getPref('suppressSplash') && !reducedMotion) {
    dismiss()
  }
}

// ---------------------------------------------------------------------------
// Dismiss — architecture §7 step 8
// ---------------------------------------------------------------------------

/**
 * Dismiss the splash. Called on Enter click or on auto-dismiss when
 * suppression is active. Runs the enter callback once and hides the splash.
 */
function dismiss() {
  if (dismissed) return
  dismissed = true

  if (releaseTrap) {
    releaseTrap()
    releaseTrap = null
  }

  if (splashEl) {
    splashEl.hidden = true
  }

  const splashBg = document.getElementById('splash-bg')
  if (splashBg) splashBg.hidden = true

  if (enterCallback) {
    enterCallback()
    enterCallback = null
  }
}

// ---------------------------------------------------------------------------
// Public query: is reduced motion active?
// ---------------------------------------------------------------------------

/**
 * Whether `prefers-reduced-motion: reduce` is active.
 * `main.js` uses this to decide whether to start the clock or stay paused.
 * @returns {boolean}
 */
export function isReducedMotion() {
  return reducedMotion
}