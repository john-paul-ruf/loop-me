// @ts-check
/**
 * Composition-panel card-delete regressions — SESSION-03.
 *
 * The one-tap ✕ on each layer card routes through `actions.deleteLayer`
 * (the mutation funnel, §4 rule 5), which snapshots for undo and enforces
 * the FR-5 ≥1-layer floor; the panel re-renders from its COMPOSITION
 * subscription. These DOM-interaction tests mount the real panel against a
 * real generated composition and drive the ✕ with `el.click()`.
 *
 * No harness suite installs a composition today, so this suite must do it
 * itself: it configures `actions` (mirrors main.js:62-69) and installs a
 * composition via `actions.randomize` before rendering. `toastKey` is a safe
 * no-op without `initFeedback` (feedback.js's `toast()`/`announce()` early-
 * return while their mounts are null), so the fixture needs no feedback DOM.
 */

import { suite, test, assert, assertEq } from './harness.js'
import { state } from '../src/core/state.js'
import * as actions from '../src/core/actions.js'
import { generate } from '../src/model/randomize.js'
import { initPanel, destroyPanel, updateSeed } from '../src/ui/panels/composition.js'
import { createLayer, clone, clampComposition, totalFrames } from '../src/model/composition.js'
import { buildPalette } from '../src/model/schemes.js'
import { coerceBlend } from '../src/model/blend.js'

// Mirror main.js:62-69 — no harness suite configures actions for us.
actions.configure({ createLayer, clone, clampComposition, buildPalette, totalFrames, coerceBlend })

/**
 * Install a fresh ≥2-layer composition through the mutation funnel and mount
 * the real panel. Captures prior state for exact restoration on teardown.
 * @returns {{ root: HTMLElement, prev: { composition: typeof state.composition, palette: typeof state.palette, dirty: typeof state.dirty } }}
 */
function mountPanel() {
  const prev = {
    composition: state.composition,
    palette: state.palette,
    dirty: state.dirty,
  }
  // generate() may produce 1 layer; retry a few times for >=2.
  let tries = 0
  do { actions.randomize(generate(false)); tries++ }
  while ((state.composition?.layers.length ?? 0) < 2 && tries < 10)
  const root = document.createElement('div')
  root.id = 'panel-fixture'
  document.body.appendChild(root)
  initPanel(root, {})
  return { root, prev }
}

/**
 * @param {HTMLElement} root
 * @param {{ composition: typeof state.composition, palette: typeof state.palette, dirty: typeof state.dirty }} prev
 */
function unmountPanel(root, prev) {
  destroyPanel()
  root.remove()
  // Test-only pragmatism: restore captured state directly (the panel is
  // destroyed, so nothing re-renders from this).
  state.composition = prev.composition
  state.palette = prev.palette
  state.dirty = prev.dirty
}

suite('panel', () => {
  test('every layer card carries a named ✕ delete control', () => {
    const { root, prev } = mountPanel()
    try {
      const cards = root.querySelectorAll('.layer')
      assertEq(cards.length, state.composition?.layers.length, 'one card per layer')
      for (const card of cards) {
        const dangers = card.querySelectorAll('.btn--danger')
        assertEq(dangers.length, 1, 'exactly one ✕ per card')
        const label = dangers[0].getAttribute('aria-label') ?? ''
        assert(label.startsWith('Delete '), 'aria-label names the layer: ' + label)
      }
    } finally { unmountPanel(root, prev) }
  })

  test('✕ deletes exactly that layer and the panel re-renders', () => {
    const { root, prev } = mountPanel()
    try {
      const c = state.composition
      assert(c !== null && c.layers.length >= 2, 'have >=2 layers')
      const n = c.layers.length
      const removed = c.layers[1]
      const del1 = /** @type {HTMLElement} */ (root.querySelectorAll('.layer')[1].querySelector('.btn--danger'))
      del1.click()
      assertEq(state.composition?.layers.length, n - 1, 'one fewer layer')
      assert(!(state.composition?.layers.includes(removed)), 'the exact layer was removed')
      assertEq(root.querySelectorAll('.layer').length, n - 1, 're-rendered with n-1 cards')
    } finally { unmountPanel(root, prev) }
  })

  test('the last layer\'s ✕ is disabled and inert', () => {
    const { root, prev } = mountPanel()
    try {
      while ((state.composition?.layers.length ?? 0) > 1) actions.deleteLayer(0)
      assertEq(state.composition?.layers.length, 1, 'down to one layer')
      const danger = /** @type {HTMLButtonElement} */ (root.querySelector('.layer .btn--danger'))
      assertEq(danger.disabled, true, 'survivor ✕ is disabled')
      danger.click()
      assertEq(state.composition?.layers.length, 1, 'clicking the disabled ✕ is inert')
    } finally { unmountPanel(root, prev) }
  })

  test('undo restores a quick-deleted layer', () => {
    const { root, prev } = mountPanel()
    try {
      const n = state.composition?.layers.length ?? 0
      assert(n >= 2, 'have >=2 layers')
      const del = /** @type {HTMLElement} */ (root.querySelector('.layer .btn--danger'))
      del.click()
      assertEq(state.composition?.layers.length, n - 1, 'one fewer after delete')
      actions.undo()
      assertEq(state.composition?.layers.length, n, 'undo restores the layer')
    } finally { unmountPanel(root, prev) }
  })
})

// ---------------------------------------------------------------------------
// S07 — the dead .layer__grip element is gone, but the labelled ▲▼ arrows
// (the real reorder affordance) remain.
// ---------------------------------------------------------------------------

suite('composition panel — reorder grip removed (S07)', () => {
  test('layer rows have no .layer__grip but keep the ▲▼ arrows', () => {
    const { root, prev } = mountPanel()
    try {
      assertEq(root.querySelector('.layer__grip'), null, 'no dead grip element')
      const moveBtns = [...root.querySelectorAll('.layer__order .btn')]
        .filter((b) => /Move .+ (up|down)/.test(b.getAttribute('aria-label') || ''))
      assert(moveBtns.length >= 2, 'reorder arrows still present and labelled')
    } finally { unmountPanel(root, prev) }
  })
})

// ---------------------------------------------------------------------------
// S06 — render() rebuilds seedControl on every COMPOSITION publish but now
// re-applies currentSeed, so the seed field stays populated across re-renders.
// We force a COMPOSITION publish (setScheme → rebuildPaletteAndPublish) to
// trigger render() — the S06 fix path. (setDuration publishes PLAYBACK/SEED
// only, not COMPRESSION, so it would NOT exercise render()).
// ---------------------------------------------------------------------------

suite('composition panel — seed survives re-render (S06)', () => {
  test('updateSeed value persists across a COMPOSITION-triggered render()', () => {
    const { root, prev } = mountPanel()
    try {
      updateSeed('ABC123XYZ')                 // stand-in seed
      // Force a COMPOSITION publish → panel render() rebuilds seedControl.
      actions.setScheme(0)
      const input = /** @type {HTMLInputElement|null} */ (root.querySelector('.input--mono'))
      assert(input !== null, 'seed input exists')
      assertEq(input.value, 'ABC123XYZ', 'seed field re-applied after render')
    } finally { unmountPanel(root, prev) }
  })
})
