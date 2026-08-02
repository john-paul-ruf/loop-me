// @ts-check
/**
 * loop-me — application entry point.
 *
 * The normative boot sequence (architecture §7, steps 1–8):
 *
 *  1. index.html parses. Splash is static markup; zero JS needed to paint.
 *  2. This module executes (deferred by `type="module"`).
 *  3. Read prefs + hash.
 *  4. Composition acquisition (async, behind the splash):
 *       hash present → `await codec.decode(seed)`
 *                      on failure → report, fall through to randomize
 *       otherwise    → `randomize.generate()`
 *  5. `prepare.prewarm()` — offscreen geometry into detached canvases.
 *  6. Splash finalized: shared-loop block, reduced-motion note, Enter enabled.
 *  7a. Suppression set → step 8 immediately (no user action).
 *  7b. Otherwise → wait. Enter/Space activates.
 *  8. Entry: reveal canvas, move focus, `painter.paint(0, totalFrames)` as
 *      the first pixel ever drawn, then `clock.start()` unless reduced-motion
 *      or paused.
 *
 * Invariants (architecture §7):
 * - `painter.paint()` is unreachable before step 8.
 * - Suppression is read from `localStorage` only.
 * - If `localStorage` is unavailable, `prefs.get('suppressSplash')` returns
 *   `false` — the failure direction is toward the warning (FR-0).
 * - Reduced-motion pauses regardless of suppression state.
 * - Step 4's decode failure path never reaches step 8 with no composition.
 *   The fallback randomize is unconditional.
 *
 * This module is a leaf of the dependency DAG (architecture §4) — nothing
 * in `src/` imports it. It imports from every subsystem to wire them
 * together, which is the one place that is legal.
 */

import { readSeedFromLocation, createHashWriter } from './seed/hash.js'
import { encode, decode } from './seed/codec.js'
import { generate, generateLayer } from './model/randomize.js'
import { createLayer, clone, clampComposition, totalFrames } from './model/composition.js'
import { buildPalette } from './model/schemes.js'
import { coerceBlend } from './model/blend.js'
import * as state from './core/state.js'
import * as actions from './core/actions.js'
import * as clock from './core/clock.js'
import * as canvas from './render/canvas.js'
import * as painter from './render/painter.js'
import * as prepare from './render/prepare.js'
import * as governor from './render/governor.js'
import { initFeedback } from './ui/feedback.js'
import { initShell, revealApp, revealCanvas, focusMainView, getDockScroll } from './ui/shell.js'
import * as splash from './ui/splash.js'
import { initPanel, updateSeed, getEditingLayerIndex } from './ui/panels/composition.js'
import * as addLayerModal from './ui/panels/add-layer.js'
import * as schemesModal from './ui/panels/schemes.js'
import * as shareModal from './ui/panels/share.js'
import * as galleryModal from './ui/panels/gallery.js'

// ---------------------------------------------------------------------------
// Wire dependency injection: actions + clock
// ---------------------------------------------------------------------------

actions.configure({
  createLayer,
  clone,
  clampComposition,
  buildPalette,
  totalFrames,
  coerceBlend,
})

clock.configure({
  flushDirty: prepare.flushDirty,
  paint: painter.paint,
  governorSample: governor.sample,
  getTotalFrames: () => {
    const c = state.state.composition
    return c ? totalFrames(c.durationId) : 0
  },
})

// ---------------------------------------------------------------------------
// Seed-dirty → hash writer
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof createHashWriter> | null} */
let hashWriter = null

// The seed field update is wired through the composition panel's updateSeed.
// The hash writer debounces encode; on each SEED topic publish we call
// hashWriter.notify() and also update the seed field with null (pending).
state.subscribe(state.TOPICS.SEED, () => {
  if (hashWriter) hashWriter.notify()
})

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Boot the application. Called once on module load (below).
 */
async function boot() {
  // --- Step 3: read prefs + hash ---
  // Prefs are read by splash.finalize() (suppression check); hash here:
  const seedString = readSeedFromLocation()

  // --- Step 4: composition acquisition (async, behind the splash) ---
  /** @type {import('./model/params.js').Composition | null} */
  let composition = null
  let hasSeed = false

  if (seedString) {
    try {
      composition = await decode(seedString)
      hasSeed = true
    } catch {
      // Decode failure — reported on the channel by decode(). Fall through
      // to randomize (architecture §7 step 4: "on failure → report, fall
      // through to randomize **unconditionally**").
    }
  }

  if (composition === null) {
    composition = generate(state.state.governorWarned)
  }

  // Load the composition into state (also publishes, but the splash is still
  // up so no views are listening yet).
  actions.loadComposition(composition)

  // --- Step 5: pre-warm offscreen geometry ---
  prepare.prewarm()

  // --- Initialise feedback (error channel + governor banner) ---
  const feedbackEl = document.getElementById('feedback')
  const liveEl = document.getElementById('live')
  if (feedbackEl && liveEl) {
    initFeedback(feedbackEl, liveEl)
  }

  // Destination openers shared by the stagebar menu (☰, SESSION-02) and the
  // composition panel — identical behaviour from both entry points.
  const openGallery = () => {
    galleryModal.open(/** @type {HTMLElement} */ (document.activeElement || document.body))
  }
  const openPasteSeed = () => {
    const btn = document.activeElement || document.body
    shareModal.open(/** @type {HTMLElement} */ (btn))
  }
  const openSchemes = () => {
    schemesModal.open(/** @type {HTMLElement} */ (document.activeElement || document.body))
  }
  const showWelcome = () => {
    // Re-show the splash (FR-0: always available from the composition panel)
    const splashEl = document.getElementById('splash')
    const splashBg = document.getElementById('splash-bg')
    if (splashEl) splashEl.hidden = false
    if (splashBg) splashBg.hidden = false
    const appEl = document.getElementById('app')
    if (appEl) appEl.setAttribute('inert', '')
  }

  // --- Initialise the shell ---
  initShell({
    onRandomize: doRandomize,
    onShare: () => {
      const btn = document.getElementById('btn-share')
      shareModal.open(/** @type {HTMLElement} */ (btn))
    },
    onSave: () => {
      const btn = document.getElementById('btn-save')
      shareModal.open(/** @type {HTMLElement} */ (btn))
    },
    onOpenGallery: openGallery,
    onPasteSeed: openPasteSeed,
    onOpenSchemes: openSchemes,
    onShowWelcome: showWelcome,
  })

  // --- Initialise the composition panel ---
  const dockScroll = getDockScroll()
  if (dockScroll) {
    initPanel(dockScroll, {
      onNavigateLayer: null,  // wired in F2 (composition.js handles default)
      onAddLayer: () => {
        const btn = document.querySelector('#dock-scroll .btn:not([disabled])')
        addLayerModal.open(/** @type {HTMLElement} */ (btn || document.body))
      },
      onOpenSchemes: openSchemes,
      onOpenGallery: openGallery,
      onPasteSeed: openPasteSeed,
      onShowWelcome: showWelcome,
    })
  }

  // --- Wire the hash writer ---
  hashWriter = createHashWriter(async () => {
    return encode(state.state.composition)
  })

  // Also update the seed field when the seed is recomputed.
  // The hash writer's debounced encode produces the seed; we also want the
  // seed field to show it. We'll poll the writer: on SEED topic, set the
  // field to null (pending), then when the encode resolves, update it.
  // Simplest approach: subscribe to SEED, kick off an encode, and update
  // the field when it resolves.
  state.subscribe(state.TOPICS.SEED, () => {
    updateSeed(null)  // show … placeholder
    // Encode and update the field
    encode(state.state.composition).then((seed) => {
      updateSeed(seed)
    }).catch(() => {
      // Encode failed — keep the previous seed in the field.
    })
  })

  // Do an initial seed field update.
  try {
    const seed = await encode(state.state.composition)
    updateSeed(seed)
  } catch {
    // ignore — the field stays at its placeholder
  }

  // --- Acquire the canvas and set the painter target ---
  const ctx = canvas.init()
  painter.setTarget(ctx)

  // --- Step 6: finalize the splash ---
  const layerCount = composition.layers.length
  splash.finalize(
    { hasSeed, durationId: composition.durationId, layerCount },
    onEnter,
  )
}

// ---------------------------------------------------------------------------
// Step 8: Entry
// ---------------------------------------------------------------------------

/**
 * The Enter callback — architecture §7 step 8.
 *
 * Reveal the canvas, clear `inert`, move focus, paint the first frame,
 * then start the clock unless reduced-motion or paused.
 */
function onEnter() {
  // Reveal the canvas (remove `hidden`).
  revealCanvas()

  // Clear `inert` from the app shell.
  revealApp()

  // Move focus to the main view.
  focusMainView()

  // Paint frame 0 — the FIRST pixel ever drawn (architecture §7 step 8).
  clock.paintOne(0)

  // Start the clock unless reduced-motion or paused.
  if (splash.isReducedMotion()) {
    // Stay paused — show Play (FR-17). The play/pause button already
    // reflects the paused state because `clock.start()` was never called.
  } else {
    clock.start()
  }
}

// ---------------------------------------------------------------------------
// Randomize
// ---------------------------------------------------------------------------

/**
 * Randomize. In the single-layer editor, reroll ONLY that layer (a live edit —
 * playback position and the governor are preserved, FR-10). In the all-layer
 * view, regenerate the whole composition (and reset governor + clock epoch, as
 * before). Called from the Randomize button, the `R` shortcut, and the
 * view-only ghost.
 */
function doRandomize() {
  const editing = getEditingLayerIndex()
  if (editing !== null) {
    const comp = state.state.composition
    const scheme = state.state.palette ? state.state.palette.scheme : null
    if (comp && scheme && editing >= 0 && editing < comp.layers.length) {
      const fresh = generateLayer(comp.layers[editing], scheme, editing)
      actions.randomizeLayer(editing, fresh)
      return
    }
  }

  const c = generate(state.state.governorWarned)
  actions.randomize(c)
  governor.reset()
  clock.resetEpoch()
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

// Run the boot sequence. If anything throws during boot, the splash stays up
// (Enter is still disabled), which is the safe failure mode for FR-0.
boot().catch(() => {
  // A boot failure is catastrophic — the splash stays as the safety gate.
  // The user sees the warning but can never enter. This is better than
  // entering with a broken app. The error is not reported to the channel
  // because the feedback system may not be initialized yet.
})