// @ts-check
/**
 * The UI shell — stage/dock arrangement, sheet peek/expand, view-only mode,
 * and the single keyboard-map registration (Designer §6, architecture §12.3).
 *
 * `shell.js` owns the chrome that persists across every panel swap: the
 * stagebar (play/pause, view-only), the dock grabber (peek/expand), the
 * pinned action bar (randomize, share, save, undo), and the keyboard
 * shortcuts that operate on the whole app rather than a specific control.
 *
 * Panel content (composition, layer-editor, modals) renders into
 * `#dock-scroll`; `shell.js` provides the container and the navigation hooks
 * but does not know what a layer is.
 *
 * ## Keyboard map (Designer §6)
 *
 * Registered once here, not scattered across panels. A text-field guard
 * prevents `Space`/`R`/`V` from firing inside inputs and textareas. `Esc` is
 * always handled (exit view-only, close modal, collapse sheet). Arrow keys on
 * a focused slider thumb are handled by the native `<input type="range">`
 * itself, not here.
 *
 * Imports `ui/dom.js`, `ui/strings.js`, `ui/feedback.js`, `core/state.js`,
 * `core/actions.js`, `core/clock.js`. All legal `ui → core` edges (§4).
 */

import { el, moveFocus } from './dom.js'
import { MISC, VIEW_ONLY, STATUS, fmt } from './strings.js'
import { toastKey } from './feedback.js'
import { state, subscribe, TOPICS } from '../core/state.js'
import * as clock from '../core/clock.js'
import * as actions from '../core/actions.js'
import * as addLayerModal from './panels/add-layer.js'
import * as schemesModal from './panels/schemes.js'
import * as shareModal from './panels/share.js'
import * as galleryModal from './panels/gallery.js'
import * as menuModal from './panels/menu.js'

/**
 * @typedef {import('../model/params.js').Composition} Composition
 */

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {HTMLElement | null} */
let appEl = null
/** @type {HTMLElement | null} */
let stageEl = null
/** @type {HTMLElement | null} */
let dockEl = null
/** @type {HTMLElement | null} */
let stagebarEl = null
/** @type {HTMLElement | null} */
let statusEl = null
/** @type {HTMLElement | null} */
let dockScrollEl = null
/** @type {HTMLButtonElement | null} */
let playPauseBtn = null
/** @type {HTMLButtonElement | null} */
let viewOnlyBtn = null
/** @type {HTMLButtonElement | null} */
let randomizeBtn = null
/** @type {HTMLButtonElement | null} */
let shareBtn = null
/** @type {HTMLButtonElement | null} */
let saveBtn = null
/** @type {HTMLButtonElement | null} */
let undoBtn = null
/** @type {HTMLButtonElement | null} */
let grabberBtn = null
/** @type {HTMLButtonElement | null} */
let menuBtn = null

/** Whether view-only mode is active. */
let viewOnly = false

/** The function that opens the share panel (wired by main.js or later). */
/** @type {(() => void) | null} */
let onShare = null

/** The function that opens the save/gallery flow (wired by main.js). */
/** @type {(() => void) | null} */
let onSave = null

/** The function that randomizes (calls generate then the action). */
/** @type {(() => void) | null} */
let onRandomize = null

/** The menu (☰) destination openers (wired by main.js). */
/** @type {(() => void) | null} */
let onOpenGallery = null
/** @type {(() => void) | null} */
let onPasteSeed = null
/** @type {(() => void) | null} */
let onOpenSchemes = null
/** @type {(() => void) | null} */
let onShowWelcome = null

// ---------------------------------------------------------------------------
// Stage status updates
// ---------------------------------------------------------------------------

/** @type {HTMLElement | null} */
let fpsDotEl = null
/** @type {HTMLElement | null} */
let fpsTextEl = null
/** @type {HTMLElement | null} */
let elapsedTextEl = null
/** @type {HTMLElement | null} */
let layersTextEl = null

// ---------------------------------------------------------------------------
// Sheet peek / expand
// ---------------------------------------------------------------------------

/** Whether the dock is expanded (full height) or peeked (grabber + actionbar). */
let dockExpanded = true

/**
 * Toggle between peek and expanded. The CSS classes `.dock--peek` and
 * `.dock--expanded` carry the visual state (layout.css). `aria-expanded` on
 * the grabber reflects it for screen readers.
 */
function toggleDock() {
  if (dockEl === null) return
  dockExpanded = !dockExpanded
  if (dockExpanded) {
    dockEl.classList.remove('dock--peek')
    dockEl.classList.add('dock--expanded')
    if (grabberBtn) {
      grabberBtn.setAttribute('aria-expanded', 'true')
      grabberBtn.setAttribute('aria-label', MISC.collapse)
    }
  } else {
    dockEl.classList.remove('dock--expanded')
    dockEl.classList.add('dock--peek')
    if (grabberBtn) {
      grabberBtn.setAttribute('aria-expanded', 'false')
      grabberBtn.setAttribute('aria-label', MISC.expand)
    }
  }
}

// ---------------------------------------------------------------------------
// View-only mode (FR-16, FR-17)
// ---------------------------------------------------------------------------

/**
 * Toggle view-only mode. When active:
 * - The stagebar, dock, and stage-status are hidden.
 * - The canvas fills the stage edge to edge (`.stage--full` + `.canvas-frame--full`).
 * - A ghost cluster (28% opacity) with Pause + Randomize + Restore survives
 *   at the bottom (layout.css `.ghost`).
 * - A hint pill at the top fades after a few seconds and returns on any input.
 *
 * Exit: tap, Esc, or the Restore button — never a reload (FR-17).
 */
function toggleViewOnly() {
  viewOnly = !viewOnly
  applyViewOnly()
}

/** @type {HTMLElement | null} */
let ghostEl = null
/** @type {HTMLElement | null} */
let hintEl = null
/** @type {number} */
let hintFadeTimer = 0

/**
 * Apply or remove view-only DOM state. Builds the ghost cluster and hint pill
 * on entry, removes them on exit.
 */
function applyViewOnly() {
  if (viewOnly) {
    // Enter view-only
    if (stagebarEl) stagebarEl.hidden = true
    if (dockEl) dockEl.hidden = true
    if (statusEl) statusEl.hidden = true
    if (stageEl) stageEl.classList.add('stage--full')
    const frame = document.getElementById('canvas-frame')
    if (frame) frame.classList.add('canvas-frame--full')

    // Build the ghost cluster
    ghostEl = el('div', { class: 'ghost' }, [
      el('button', {
        class: 'btn btn--icon btn--sm',
        'aria-label': MISC.pause,
        text: '\u23F8',
        on: { click: () => { clock.toggle(); updatePlayPause() } },
      }),
      el('button', {
        class: 'btn btn--primary btn--sm',
        text: MISC.randomize,
        on: { click: () => { if (onRandomize) onRandomize() } },
      }),
      el('button', {
        class: 'btn btn--icon btn--sm',
        'aria-label': VIEW_ONLY.restore,
        text: '\u2B6F',
        on: { click: () => { viewOnly = false; applyViewOnly() } },
      }),
    ])

    // Build the hint pill
    hintEl = el('div', { class: 'hint-pill', text: VIEW_ONLY.hint })

    if (stageEl) {
      stageEl.appendChild(ghostEl)
      stageEl.appendChild(hintEl)
    }

    // Start the hint fade timer
    scheduleHintFade()

    // Listen for any input to restore the hint
    document.addEventListener('pointermove', onInputRestore, { passive: true })
    document.addEventListener('keydown', onInputRestore, { passive: true })
    document.addEventListener('click', onStageTap, { passive: true })

    if (viewOnlyBtn) {
      viewOnlyBtn.setAttribute('aria-pressed', 'true')
      viewOnlyBtn.setAttribute('aria-label', VIEW_ONLY.restore)
    }
  } else {
    // Exit view-only
    if (stagebarEl) stagebarEl.hidden = false
    if (dockEl) dockEl.hidden = false
    if (statusEl) statusEl.hidden = false
    if (stageEl) stageEl.classList.remove('stage--full')
    const frame = document.getElementById('canvas-frame')
    if (frame) frame.classList.remove('canvas-frame--full')

    if (ghostEl) { ghostEl.remove(); ghostEl = null }
    if (hintEl) { hintEl.remove(); hintEl = null }
    if (hintFadeTimer) { clearTimeout(hintFadeTimer); hintFadeTimer = 0 }

    document.removeEventListener('pointermove', onInputRestore)
    document.removeEventListener('keydown', onInputRestore)
    document.removeEventListener('click', onStageTap)

    if (viewOnlyBtn) {
      viewOnlyBtn.setAttribute('aria-pressed', 'false')
      viewOnlyBtn.setAttribute('aria-label', MISC.viewOnly)
    }
  }
}

/**
 * Tap on the stage exits view-only (FR-16) — but not taps on the ghost
 * cluster's own controls, and not the stagebar click that just toggled
 * view-only ON: that click is still bubbling when this listener is added,
 * so `document` receives it in the same dispatch. Guarding by target keeps
 * "tap anywhere" true for real stage taps (including the hint pill, whose
 * copy promises exactly that) while making entry and the ghost buttons
 * usable.
 * @param {MouseEvent} ev
 */
function onStageTap(ev) {
  if (!viewOnly) return
  const t = ev.target
  if (t instanceof Node) {
    if (ghostEl && ghostEl.contains(t)) return
    if (stagebarEl && stagebarEl.contains(t)) return
  }
  viewOnly = false
  applyViewOnly()
}

/** Any input restores the hint pill's visibility. */
function onInputRestore() {
  if (!hintEl) return
  hintEl.classList.remove('hint-pill--faded')
  scheduleHintFade()
}

/** Schedule the hint pill to fade after 4 seconds. */
function scheduleHintFade() {
  if (hintFadeTimer) clearTimeout(hintFadeTimer)
  hintFadeTimer = setTimeout(() => {
    if (hintEl) hintEl.classList.add('hint-pill--faded')
  }, 4000)
}

// ---------------------------------------------------------------------------
// Play/pause button
// ---------------------------------------------------------------------------

/**
 * Update the play/pause button's label and glyph to match the clock state.
 */
function updatePlayPause() {
  if (!playPauseBtn) return
  const playing = clock.isPlaying()
  playPauseBtn.setAttribute('aria-label', playing ? MISC.pause : MISC.play)
  const glyph = playPauseBtn.querySelector('.btn__glyph')
  if (glyph) glyph.textContent = playing ? '\u23F8' : '\u25B6'
}

// ---------------------------------------------------------------------------
// Keyboard map (Designer §6)
// ---------------------------------------------------------------------------

/**
 * Is the focus inside a text field where play/pause/randomize/view-only
 * shortcuts should not fire?
 * @returns {boolean}
 */
function inTextField() {
  const a = document.activeElement
  if (!a) return false
  const tag = a.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable
}

/**
 * The single keydown handler. Registered once.
 * @param {KeyboardEvent} ev
 */
function onKeydown(ev) {
  // Esc is always handled, even inside text fields (closes things).
  if (ev.key === 'Escape') {
    // If a modal is open, let it handle Esc (capture phase) first.
    // The modals register their own capture-phase listeners that call
    // stopPropagation, so if we get here, no modal was open.
    if (viewOnly) { viewOnly = false; applyViewOnly(); return }
    // If a modal is open, its own Esc handler fires (capture) and
    // stops propagation. If we reach here, collapse the dock.
    if (addLayerModal.isOpen()) { addLayerModal.close(); return }
    if (schemesModal.isOpen()) { schemesModal.close(); return }
    if (shareModal.isOpen()) { shareModal.close(); return }
    if (galleryModal.isOpen()) { galleryModal.close(); return }
    if (menuModal.isOpen()) { menuModal.close(); return }
    if (dockExpanded) { toggleDock() }
    return
  }

  if (inTextField()) return

  if (ev.key === ' ' || ev.code === 'Space') {
    ev.preventDefault()
    clock.toggle()
    updatePlayPause()
  } else if (ev.key === 'r' || ev.key === 'R') {
    if (onRandomize) onRandomize()
  } else if (ev.key === 'v' || ev.key === 'V') {
    toggleViewOnly()
  }
}

// ---------------------------------------------------------------------------
// Status bar updates
// ---------------------------------------------------------------------------

/**
 * Write the live elapsed readout. `frame` is the fractional current frame; at
 * 60 fps, seconds = frame / 60. Clamped to the loop length so the wrap point
 * shows the full duration rather than briefly flashing 0.0 (design: the bar
 * reads "where in the loop am I"). Uses STATUS.elapsed so the format stays in
 * strings.js.
 * @param {number} frame
 */
function updateElapsed(frame) {
  if (!elapsedTextEl) return
  const c = state.composition
  if (!c) return
  const durSecs = [5, 15, 30][c.durationId] ?? 15
  const cur = Math.min(frame / 60, durSecs)
  elapsedTextEl.textContent = fmt(STATUS.elapsed, { cur: cur.toFixed(1), dur: durSecs })
}

/**
 * Update the status bar from state. Called on composition and playback
 * topic publishes.
 */
function updateStatus() {
  const c = state.composition
  if (!c) return

  // Layer count
  if (layersTextEl) {
    const n = c.layers.length
    layersTextEl.textContent = n === 1 ? '1 layer' : n + ' layers'
  }

  // FPS dot + text
  if (fpsDotEl && fpsTextEl) {
    if (state.governorWarned) {
      fpsDotEl.style.setProperty('color', 'var(--warn)')
      fpsTextEl.textContent = STATUS.noFps // fps number arrives from the governor topic
    } else if (!state.playing) {
      fpsDotEl.style.setProperty('color', 'var(--text-faint)')
      fpsTextEl.textContent = STATUS.noFps
    } else {
      fpsDotEl.style.setProperty('color', 'var(--ok)')
      fpsTextEl.textContent = '60 fps' // placeholder until governor publishes a real number
    }
  }

  // Elapsed — recomputed from the clock so topic-driven repaints (pause,
  // duration change) show the true position; per-frame updates ride onFrame.
  if (elapsedTextEl) {
    updateElapsed(clock.currentFrame())
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** @type {(() => void)[]} */
let shellSubscriptions = []

/**
 * Initialise the shell. Acquires DOM elements, wires buttons, registers the
 * keyboard map, and subscribes to state topics for the status bar.
 *
 * Called once during boot (main.js, F1).
 *
 * @param {{
 *   onRandomize?: () => void,
 *   onShare?: () => void,
 *   onSave?: () => void,
 *   onOpenGallery?: () => void,
 *   onPasteSeed?: () => void,
 *   onOpenSchemes?: () => void,
 *   onShowWelcome?: () => void,
 * }} [callbacks]
 */
export function initShell(callbacks = {}) {
  appEl = document.getElementById('app')
  stageEl = document.getElementById('stage')
  dockEl = document.getElementById('dock')
  stagebarEl = document.getElementById('stagebar')
  statusEl = document.getElementById('stage-status')
  dockScrollEl = document.getElementById('dock-scroll')
  playPauseBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-playpause'))
  viewOnlyBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-viewonly'))
  randomizeBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-randomize'))
  shareBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-share'))
  saveBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-save'))
  undoBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-undo'))
  grabberBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('dock-grabber'))
  menuBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-menu'))

  fpsDotEl = document.getElementById('fps-dot')
  fpsTextEl = document.getElementById('fps-text')
  elapsedTextEl = document.getElementById('elapsed-text')
  layersTextEl = document.getElementById('layers-text')

  onRandomize = callbacks.onRandomize ?? null
  onShare = callbacks.onShare ?? null
  onSave = callbacks.onSave ?? null
  onOpenGallery = callbacks.onOpenGallery ?? null
  onPasteSeed = callbacks.onPasteSeed ?? null
  onOpenSchemes = callbacks.onOpenSchemes ?? null
  onShowWelcome = callbacks.onShowWelcome ?? null

  // Wire the persistent buttons
  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      clock.toggle()
      updatePlayPause()
    })
  }

  if (viewOnlyBtn) {
    viewOnlyBtn.addEventListener('click', toggleViewOnly)
  }

  if (randomizeBtn) {
    randomizeBtn.addEventListener('click', () => {
      if (onRandomize) onRandomize()
    })
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (onShare) onShare()
    })
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (onSave) onSave()
    })
  }

  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      actions.undo()
      toastKey('undone')
    })
  }

  if (grabberBtn) {
    grabberBtn.addEventListener('click', toggleDock)
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      if (menuBtn) {
        menuModal.open(menuBtn, {
          onOpenGallery: onOpenGallery ?? undefined,
          onPasteSeed: onPasteSeed ?? undefined,
          onOpenSchemes: onOpenSchemes ?? undefined,
          onShowWelcome: onShowWelcome ?? undefined,
        })
      }
    })
  }

  // Register the keyboard map
  document.addEventListener('keydown', onKeydown)

  // Subscribe to state topics for status updates
  shellSubscriptions.push(subscribe(TOPICS.COMPOSITION, updateStatus))
  shellSubscriptions.push(subscribe(TOPICS.PLAYBACK, () => {
    updatePlayPause()
    updateStatus()
  }))
  shellSubscriptions.push(subscribe(TOPICS.GOVERNOR, (...args) => {
    // The governor publishes (true/false, fps). Update the status bar.
    if (args.length > 1 && typeof args[1] === 'number' && fpsTextEl) {
      fpsTextEl.textContent = args[1] + ' fps'
    }
    updateStatus()
  }))

  // Live elapsed readout — one CSS-free textContent write per frame. onFrame
  // returns an unsubscribe fn; park it with the topic unsubscribers so
  // destroyShell tears it down. When paused the loop stops firing, so the
  // last written value stays put (correct: it shows where you paused).
  shellSubscriptions.push(clock.onFrame((frame) => updateElapsed(frame)))

  updatePlayPause()
  updateStatus()
}

/**
 * Clear the `inert` attribute from the app shell so it becomes interactive.
 * Called by the splash on Enter (FR-0 gate).
 */
export function revealApp() {
  if (appEl) appEl.removeAttribute('inert')
}

/**
 * Move focus to the main view (the stage or the dock). Called by the splash
 * on Enter after revealing the app.
 */
export function focusMainView() {
  if (randomizeBtn) {
    moveFocus(randomizeBtn)
  } else if (dockEl) {
    moveFocus(dockEl)
  }
}

/**
 * Reveal the canvas (remove `hidden`). Called by the splash on Enter.
 */
export function revealCanvas() {
  const canvas = document.getElementById('canvas')
  if (canvas) canvas.removeAttribute('hidden')
}

/**
 * Return the dock-scroll element — the container panels render into.
 * @returns {HTMLElement | null}
 */
export function getDockScroll() {
  return dockScrollEl
}

/**
 * Destroy the shell (cleanup for tests / re-init).
 */
export function destroyShell() {
  document.removeEventListener('keydown', onKeydown)
  for (const unsub of shellSubscriptions) {
    try { unsub() } catch { /* already unsubscribed */ }
  }
  shellSubscriptions = []
}