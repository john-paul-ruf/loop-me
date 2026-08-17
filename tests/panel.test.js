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

// ---------------------------------------------------------------------------
// governor-reorder-and-export SESSION-02 — dock jump fix + focus follow.
// ---------------------------------------------------------------------------

suite('panel/reorder-context', () => {
  test('scroll position is preserved across a reorder re-render', () => {
    const { root, prev } = mountPanel()
    try {
      // Make the fixture a real overflow scroller: cap height so the layer
      // list + sections overflow, then scroll partway down.
      root.style.setProperty('height', '160px')
      root.style.setProperty('overflow', 'auto')
      root.scrollTop = 40
      assertEq(root.scrollTop, 40, 'scrollTop set before reorder')

      const down0 = root.querySelector('[data-reorder="down-0"]')
      assert(down0 instanceof HTMLButtonElement, 'down-0 arrow exists')
      down0.click()
      assertEq(root.scrollTop, 40, 'scrollTop unchanged after reorder')
    } finally { unmountPanel(root, prev) }
  })

  test('focus follows the moved layer after a ▼ reorder', () => {
    const { root, prev } = mountPanel()
    try {
      // Need >=3 layers so the moved slot (index 1) is not at the bottom
      // and its ▼ stays enabled. mountPanel() guarantees >=2 on entry.
      while ((state.composition?.layers.length ?? 0) > 3) actions.deleteLayer(0)
      let tries = 0
      while ((state.composition?.layers.length ?? 0) < 3 && tries < 10) {
        actions.randomize(generate(false))
        tries++
      }
      while ((state.composition?.layers.length ?? 0) > 3) actions.deleteLayer(0)
      assertEq(state.composition?.layers.length, 3, 'exactly 3 layers')

      const down0 = root.querySelector('[data-reorder="down-0"]')
      assert(down0 instanceof HTMLButtonElement, 'down-0 arrow exists')
      down0.click()
      const active = document.activeElement
      assert(active instanceof HTMLButtonElement, 'active is a button')
      assertEq(active.getAttribute('data-reorder'), 'down-1', 'focus moved to the new down-1')
    } finally { unmountPanel(root, prev) }
  })

  test('boundary fallback: ▼ on the last slot falls back to the ▲', () => {
    const { root, prev } = mountPanel()
    try {
      // Trim to exactly 2 layers. mountPanel() guarantees >=2 on entry.
      while ((state.composition?.layers.length ?? 0) > 2) actions.deleteLayer(0)
      assertEq(state.composition?.layers.length, 2, 'exactly 2 layers')

      const down0 = root.querySelector('[data-reorder="down-0"]')
      assert(down0 instanceof HTMLButtonElement && !down0.disabled, 'down-0 clickable')
      down0.click()
      // Layer 0 moved to index 1 (now last). Its ▼ is disabled at the
      // boundary — focus should fall back to the ▲ at the same index.
      const active = document.activeElement
      assert(active instanceof HTMLButtonElement, 'active is a button')
      assertEq(active.getAttribute('data-reorder'), 'up-1', 'boundary fallback to up-1')
    } finally { unmountPanel(root, prev) }
  })
})

// ---------------------------------------------------------------------------
// layer-hide-and-fps-dismiss SESSION-01 — eye toggle on the layer row.
// ---------------------------------------------------------------------------

suite('panel/eye-toggle (S01)', () => {
  test('every row carries a [data-vis] toggle whose aria-label starts with "Hide "', () => {
    const { root, prev } = mountPanel()
    try {
      const cards = root.querySelectorAll('.layer')
      assert(cards.length >= 1, 'at least one card')
      for (const card of cards) {
        const btn = card.querySelector('[data-vis]')
        assert(btn instanceof HTMLButtonElement, 'each row has a [data-vis] button')
        const label = btn.getAttribute('aria-label') ?? ''
        assert(label.startsWith('Hide '), 'starts with "Hide ": ' + label)
      }
    } finally { unmountPanel(root, prev) }
  })

  test('clicking hides the layer: state, class, meta, label all flip', () => {
    const { root, prev } = mountPanel()
    try {
      const c = state.composition
      assert(c !== null, 'composition present')
      const vis = /** @type {HTMLButtonElement} */ (root.querySelectorAll('[data-vis]')[0])
      vis.click()
      assertEq(c.layers[0].visible, false, 'state now hidden')
      const row = root.querySelectorAll('.layer')[0]
      assert(row.classList.contains('layer--hidden'), 'row has layer--hidden')
      const meta = row.querySelector('.layer__meta')
      assert(meta !== null && (meta.textContent ?? '').includes('Hidden'), 'meta text contains Hidden')
      const relabelled = /** @type {HTMLButtonElement} */ (root.querySelectorAll('[data-vis]')[0])
      const label2 = relabelled.getAttribute('aria-label') ?? ''
      assert(label2.startsWith('Show '), 'aria-label flipped to Show: ' + label2)
    } finally { unmountPanel(root, prev) }
  })

  test('clicking again restores visible: true', () => {
    const { root, prev } = mountPanel()
    try {
      const c = state.composition
      assert(c !== null, 'composition present')
      const vis1 = /** @type {HTMLButtonElement} */ (root.querySelectorAll('[data-vis]')[0])
      vis1.click()
      assertEq(c.layers[0].visible, false, 'first click hides')
      const vis2 = /** @type {HTMLButtonElement} */ (root.querySelectorAll('[data-vis]')[0])
      vis2.click()
      assertEq(c.layers[0].visible, true, 'second click restores')
      const row = root.querySelectorAll('.layer')[0]
      assert(!row.classList.contains('layer--hidden'), 'row no longer hidden')
    } finally { unmountPanel(root, prev) }
  })

  test('undo restores the previous visibility', () => {
    const { root, prev } = mountPanel()
    try {
      const c = state.composition
      assert(c !== null, 'composition present')
      assertEq(c.layers[0].visible, true, 'starts visible')
      const vis = /** @type {HTMLButtonElement} */ (root.querySelectorAll('[data-vis]')[0])
      vis.click()
      assertEq(state.composition?.layers[0].visible, false)
      actions.undo()
      assertEq(state.composition?.layers[0].visible, true, 'undo restores visible')
    } finally { unmountPanel(root, prev) }
  })

  test('focus follows the same layer\'s [data-vis] button after toggle', () => {
    const { root, prev } = mountPanel()
    try {
      const vis = /** @type {HTMLButtonElement} */ (root.querySelectorAll('[data-vis]')[0])
      vis.click()
      const active = document.activeElement
      assert(active instanceof HTMLButtonElement, 'active is a button')
      assertEq(active.getAttribute('data-vis'), '0', 'focus lands on the same layer\'s eye toggle')
    } finally { unmountPanel(root, prev) }
  })

  test('the S07 reorder pin (▲▼ filter) and S03 danger count are unaffected', () => {
    const { root, prev } = mountPanel()
    try {
      // S07 ▲▼ pin: filter buttons by aria-label matching /Move .+ (up|down)/
      const moveBtns = [...root.querySelectorAll('.layer__order .btn')]
        .filter((b) => /Move .+ (up|down)/.test(b.getAttribute('aria-label') || ''))
      assert(moveBtns.length >= 2, 'reorder arrows still counted')
      // S03 delete pin: exactly one .btn--danger per card
      const cards = root.querySelectorAll('.layer')
      for (const card of cards) {
        assertEq(card.querySelectorAll('.btn--danger').length, 1, 'one ✕ per card')
      }
    } finally { unmountPanel(root, prev) }
  })
})
