// @ts-check
/**
 * The L0 composition panel (mocks/main.html, FR-1, FR-2, FR-5, FR-16).
 *
 * Renders into `#dock-scroll` (provided by `shell.js`). Contains:
 * - Duration segmented control (5s / 15s / 30s)
 * - Scheme card + strip
 * - Layer list (grip · role dot · name · meta · ▲▼ with top/bottom disabled)
 * - Add layer (disabled when governor warns, with visible reason text)
 * - Seed field (readonly + copy + meter)
 * - Gallery / Paste seed / Show welcome screen buttons
 *
 * The panel subscribes to the `composition` and `governor` topics and
 * re-renders on every change. It never reads state directly outside of a
 * notification — the mutation funnel is `core/actions.js` (§4 rule 5).
 *
 * Imports `ui/dom.js`, `ui/strings.js`, `ui/controls/*`, `core/state.js`,
 * `core/actions.js`, `model/registry.js`, `model/blend.js`, `model/motion.js`.
 * All legal `ui → core`, `ui → model`, `ui → ui` edges (§4).
 */

import { el } from '../dom.js'
import { COMPOSITION, fmt } from '../strings.js'
import { toastKey } from '../feedback.js'
import { subscribe, TOPICS, state } from '../../core/state.js'
import * as actions from '../../core/actions.js'
import { get as getLayer } from '../../model/registry.js'
import { blendName } from '../../model/blend.js'
import * as segmented from '../controls/segmented.js'
import * as seedField from '../controls/seed-field.js'
import * as layerEditor from './layer-editor.js'

/**
 * @typedef {import('../../model/params.js').Composition} Composition
 * @typedef {import('../../model/params.js').Layer} Layer
 * @typedef {import('../../model/params.js').Palette} Palette
 * @typedef {import('../../model/registry.js').LayerModule} LayerModule
 */

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {HTMLElement | null} */
let container = null
/** @type {ReturnType<typeof segmented.create> | null} */
let durationControl = null
/** @type {ReturnType<typeof seedField.create> | null} */
let seedControl = null
/** @type {HTMLElement | null} */
let layerListEl = null
/** @type {HTMLButtonElement | null} */
let addLayerBtn = null
/** @type {HTMLElement | null} */
let addLayerHintEl = null
/** @type {(() => void) | null} */
let onNavigateLayer = null
/** Whether the layer editor is currently showing. */
let editorActive = false
/** @type {(() => void) | null} */
let onAddLayer = null
/** @type {(() => void) | null} */
let onOpenSchemes = null
/** @type {(() => void) | null} */
let onOpenGallery = null
/** @type {(() => void) | null} */
let onPasteSeed = null
/** @type {(() => void) | null} */
let onShowWelcome = null

/** @type {(() => void)[]} */
let panelSubscriptions = []

/** Current scheme display — rebuilt on composition changes. */
/** @type {HTMLElement | null} */
let schemeCardEl = null

// ---------------------------------------------------------------------------
// Role dot class mapping
// ---------------------------------------------------------------------------

const ROLE_DOT_CLASS = {
  primary: 'role-dot--primary',
  secondary: 'role-dot--secondary',
  overlay: 'role-dot--overlay',
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render the full panel into the container.
 * Called on init and on every composition topic publish.
 */
function render() {
  const c = state.composition
  if (!c || !container) return

  // Clear the container
  while (container.firstChild) container.removeChild(container.firstChild)

  // --- Duration ---
  const durSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__title', text: COMPOSITION.durationLabel }),
  ])
  durationControl = segmented.create(
    COMPOSITION.durationLabel,
    COMPOSITION.durations,
    c.durationId,
    (index) => actions.setDuration(index),
  )
  durSection.appendChild(durationControl.node)
  container.appendChild(durSection)

  // --- Scheme ---
  const schemeSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__title', text: COMPOSITION.schemeLabel }, [
      el('button', {
        class: 'btn btn--ghost btn--sm',
        text: 'Edit schemes',
        on: { click: () => { if (onOpenSchemes) onOpenSchemes() } },
      }),
    ]),
  ])
  schemeCardEl = buildSchemeCard(c)
  schemeSection.appendChild(schemeCardEl)
  container.appendChild(schemeSection)

  // --- Layers ---
  const layersSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__title', text: COMPOSITION.layersLabel + ' ' }, [
      el('span', { class: 'muted', text: c.layers.length + ' of 5' }),
    ]),
  ])
  layerListEl = el('ul')
  renderLayers(c)
  layersSection.appendChild(layerListEl)

  // Add layer button + governor hint
  addLayerBtn = el('button', { class: 'btn' }, [
    el('span', { class: 'btn__glyph', 'aria-hidden': 'true', text: '\uFF0B' }),
    document.createTextNode(' ' + COMPOSITION.addLayer),
  ])
  addLayerBtn.style.setProperty('width', '100%')
  addLayerBtn.style.setProperty('margin-top', 'var(--s2)')
  addLayerBtn.addEventListener('click', () => {
    if (state.governorWarned) return
    if (state.composition && state.composition.layers.length >= 5) return
    if (onAddLayer) onAddLayer()
  })

  addLayerHintEl = el('div', { class: 'hint--block', text: COMPOSITION.addLayerBlocked })
  addLayerHintEl.style.setProperty('display', 'none')

  layersSection.appendChild(addLayerBtn)
  layersSection.appendChild(addLayerHintEl)
  container.appendChild(layersSection)

  // Update Add-layer disabled state from governor
  updateAddLayerState()

  // --- Seed ---
  const seedSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__title', text: COMPOSITION.seedField }),
  ])
  seedControl = seedField.create(COMPOSITION.seedField, null, null)
  // Re-apply the last known seed. render() rebuilds seedControl on every
  // composition change; without this the field resets to empty and only refills
  // if a later SEED publish happens to arrive after. The live value still comes
  // from main.js's encode via updateSeed(). (F: control-and-modal-fixes item 6.)
  if (currentSeed !== null) seedControl.update(currentSeed)
  seedSection.appendChild(seedControl.node)
  container.appendChild(seedSection)
  // The seed field will be updated by the seed-dirty subscription

  // --- Bottom buttons ---
  const bottomSection = el('div', { class: 'section' }, [
    el('div', { class: 'row-2' }, [
      el('button', {
        class: 'btn',
        text: COMPOSITION.gallery,
        on: { click: () => { if (onOpenGallery) onOpenGallery() } },
      }),
      el('button', {
        class: 'btn',
        text: COMPOSITION.pasteSeed,
        on: { click: () => { if (onPasteSeed) onPasteSeed() } },
      }),
    ]),
    el('button', {
      class: 'btn btn--ghost',
      text: COMPOSITION.showWelcome,
      on: { click: () => { if (onShowWelcome) onShowWelcome() } },
    }),
  ])
  const bottomGhost = bottomSection.querySelector('.btn--ghost')
  if (bottomGhost) {
    bottomGhost.style.setProperty('width', '100%')
    bottomGhost.style.setProperty('margin-top', 'var(--s2)')
  }
  container.appendChild(bottomSection)
}

// ---------------------------------------------------------------------------
// Scheme card
// ---------------------------------------------------------------------------

/**
 * Build the scheme card with palette strip.
 * @param {Composition} c
 * @returns {HTMLElement}
 */
function buildSchemeCard(c) {
  const palette = state.palette
  const scheme = palette?.scheme ?? null
  const name = scheme ? scheme.name : 'Custom'
  const colors = scheme ? scheme.colors : []
  const neutrals = scheme ? scheme.neutrals : []
  const backgrounds = scheme ? scheme.backgrounds : []

  /** @type {HTMLElement[]} */
  const stripBars = []
  for (const col of colors) {
    stripBars.push(el('i', { style: { '--sw': col } }))
    stripBars[stripBars.length - 1].style.setProperty('background', col)
  }
  for (const col of neutrals) {
    stripBars.push(el('i', { style: { '--sw': col } }))
    stripBars[stripBars.length - 1].style.setProperty('background', col)
  }
  for (const col of backgrounds) {
    stripBars.push(el('i', { style: { '--sw': col } }))
    stripBars[stripBars.length - 1].style.setProperty('background', col)
  }

  const meta = colors.length + ' colour \u00b7 ' + neutrals.length + ' neutral \u00b7 ' + backgrounds.length + ' background'

  return el('button', {
    class: 'card',
    'aria-label': name + ' \u2014 Change scheme',
    on: { click: () => { if (onOpenSchemes) onOpenSchemes() } },
  }, [
    el('div', { class: 'between' }, [
      el('strong', { text: name }),
      el('span', { class: 'small muted', text: 'Change \u203A' }),
    ]),
    el('div', { class: 'scheme-strip', 'aria-hidden': 'true' }, stripBars),
    el('div', { class: 'small muted', text: meta }),
  ])
}

// ---------------------------------------------------------------------------
// Layer list rendering
// ---------------------------------------------------------------------------

/**
 * Render the layer list items into `layerListEl`.
 * @param {Composition} c
 */
function renderLayers(c) {
  if (!layerListEl) return
  while (layerListEl.firstChild) layerListEl.removeChild(layerListEl.firstChild)

  const layers = c.layers
  const isOnly = layers.length <= 1
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const mod = getLayer(layer.type)
    if (!mod) continue

    const isTop = i === 0
    const isBottom = i === layers.length - 1
    const roleClass = ROLE_DOT_CLASS[mod.meta.role] ?? ''
    const blendLabel = blendName(layer.blend)
    const opPct = Math.round(((layer.opacity.min + layer.opacity.max) / 2) * 100)

    const li = el('li', { class: 'layer' }, [
      el('button', {
        class: 'layer__body',
        'aria-label': mod.meta.name + ' \u2014 Edit',
        on: { click: () => { if (onNavigateLayer) onNavigateLayer(i) } },
      }, [
        el('span', { class: 'layer__name' }, [
          el('span', { class: 'role-dot ' + roleClass, 'aria-hidden': 'true' }),
          document.createTextNode(' ' + mod.meta.name),
        ]),
        el('span', { class: 'layer__meta', text: mod.meta.role.charAt(0).toUpperCase() + mod.meta.role.slice(1) + ' \u00b7 ' + blendLabel + ' blend \u00b7 ' + opPct + '%' }),
      ]),
      el('div', { class: 'layer__order' }, [
        el('button', {
          class: 'btn',
          'aria-label': 'Move ' + mod.meta.name + ' up',
          disabled: isTop,
          text: '\u25B2',
          on: { click: () => actions.reorderLayer(i, -1) },
        }),
        el('button', {
          class: 'btn',
          'aria-label': 'Move ' + mod.meta.name + ' down',
          disabled: isBottom,
          text: '\u25BC',
          on: { click: () => actions.reorderLayer(i, 1) },
        }),
      ]),
      el('div', { class: 'layer__order' }, [
        el('button', {
          class: 'btn btn--danger',
          'aria-label': fmt(COMPOSITION.deleteLayer, { name: mod.meta.name }),
          disabled: isOnly,
          text: '\u2715',
          on: {
            click: () => {
              // FR-5 floor (\u22651 layer) is enforced by actions.deleteLayer;
              // `disabled` mirrors it so the affordance stays honest.
              // deleteLayer snapshots first \u2014 Undo reverses this.
              if (actions.deleteLayer(i)) toastKey('layerDeleted')
            },
          },
        }),
      ]),
    ])
    layerListEl.appendChild(li)
  }
}

// ---------------------------------------------------------------------------
// Governor state — Add layer disable
// ---------------------------------------------------------------------------

/**
 * Update the Add-layer button's disabled state and the hint text.
 * When the governor warns, Add layer is disabled with visible reason text
 * (Designer §5 Flow F — *not* a tooltip).
 */
function updateAddLayerState() {
  if (!addLayerBtn || !addLayerHintEl) return
  const atCap = !!state.composition && state.composition.layers.length >= 5
  const warned = state.governorWarned
  if (warned || atCap) {
    addLayerBtn.disabled = true
    // Governor is the more urgent state — it wins the message.
    addLayerHintEl.textContent = warned ? COMPOSITION.addLayerBlocked : COMPOSITION.addLayerFull
    addLayerHintEl.style.setProperty('display', 'block')
  } else {
    addLayerBtn.disabled = false
    addLayerHintEl.style.setProperty('display', 'none')
  }
}

// ---------------------------------------------------------------------------
// Seed field updates
// ---------------------------------------------------------------------------

/** The current seed string (or null while an encode is in flight). */
/** @type {string | null} */
let currentSeed = null

/**
 * Update the seed field. Called by the seed-dirty subscription (wired from
 * main.js via the hash writer). While the encode is in flight, `null` shows
 * the `…` placeholder.
 *
 * @param {string | null} seed
 */
export function updateSeed(seed) {
  currentSeed = seed
  if (seedControl) seedControl.update(seed)
}

/**
 * The layer index the single-layer editor is currently editing, or `null`
 * when the all-layer (composition) view is showing. Randomize reads this to
 * decide whole-composition vs. single-layer reroll (F: blend-trim-and-control-
 * fixes). `editorActive` is the panel's own open/closed flag; the index comes
 * from the editor module.
 *
 * @returns {number | null}
 */
export function getEditingLayerIndex() {
  return editorActive ? layerEditor.getCurrentIndex() : null
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise the composition panel.
 *
 * @param {HTMLElement} mount  The `#dock-scroll` container.
 * @param {{
 *   onNavigateLayer?: (index: number) => void,
 *   onAddLayer?: () => void,
 *   onOpenSchemes?: () => void,
 *   onOpenGallery?: () => void,
 *   onPasteSeed?: () => void,
 *   onShowWelcome?: () => void,
 * }} [callbacks]
 */
export function initPanel(mount, callbacks = {}) {
  container = mount
  onNavigateLayer = callbacks.onNavigateLayer ?? ((index) => {
    // Default: navigate to the layer editor (F2 wiring).
    if (!container) return
    layerEditor.initEditor(container, index, {
      onBack: () => {
        layerEditor.destroyEditor()
        editorActive = false
        render()
      },
    })
    editorActive = true
  })
  onAddLayer = callbacks.onAddLayer ?? null
  onOpenSchemes = callbacks.onOpenSchemes ?? null
  onOpenGallery = callbacks.onOpenGallery ?? null
  onPasteSeed = callbacks.onPasteSeed ?? null
  onShowWelcome = callbacks.onShowWelcome ?? null

  // Clean up any prior subscriptions
  for (const unsub of panelSubscriptions) {
    try { unsub() } catch { /* already unsubscribed */ }
  }
  panelSubscriptions = []

  // Subscribe to composition changes
  panelSubscriptions.push(subscribe(TOPICS.COMPOSITION, () => {
    render()
  }))

  // Subscribe to layer changes (re-render layer list + scheme card)
  panelSubscriptions.push(subscribe(TOPICS.LAYER, () => {
    if (state.composition && container) {
      renderLayers(state.composition)
    }
  }))

  // Subscribe to governor changes
  panelSubscriptions.push(subscribe(TOPICS.GOVERNOR, updateAddLayerState))

  // Subscribe to seed-dirty for the seed field
  panelSubscriptions.push(subscribe(TOPICS.SEED, () => {
    // The actual seed string update comes from main.js via updateSeed();
    // this just ensures the field knows it's stale.
    updateSeed(null)
  }))

  render()
}

/**
 * Destroy the panel (cleanup for re-init).
 */
export function destroyPanel() {
  for (const unsub of panelSubscriptions) {
    try { unsub() } catch { /* already unsubscribed */ }
  }
  panelSubscriptions = []
  if (editorActive) {
    layerEditor.destroyEditor()
    editorActive = false
  }
  if (seedControl) seedControl.destroy()
  if (durationControl) durationControl.destroy()
  seedControl = null
  durationControl = null
}