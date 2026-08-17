// @ts-check
/**
 * Add-layer modal (mocks/add-layer.html, FR-5, FR-6, FR-9).
 *
 * Shows all 57 types grouped by role with their CSS impression previews.
 * Picking a type adds it **on top** with randomized in-bounds parameters —
 * never a blank default that renders nothing. Unreachable while the governor
 * warns (the Add layer button in the composition panel is disabled with
 * visible reason text before this modal can even open).
 *
 * The CSS impressions (`.v-ray`, `.v-nth`, etc.) are in `components.css` §4,
 * transcribed verbatim from `mocks/add-layer.html`. Each type button carries
 * a `<i>` element with the matching class inside a `.type__viz` container.
 *
 * Imports `ui/dom.js`, `ui/strings.js`, `core/state.js`, `core/actions.js`,
 * `model/registry.js`, `model/randomize.js`. All legal `ui → core` and
 * `ui → model` edges (§4).
 */

import { el, trapFocus } from '../dom.js'
import { ADD_LAYER } from '../strings.js'
import { state } from '../../core/state.js'
import { byRole } from '../../model/registry.js'
import { generate } from '../../model/randomize.js'
import { defaults } from '../../model/composition.js'
import * as actions from '../../core/actions.js'

/**
 * @typedef {import('../../model/registry.js').LayerModule} LayerModule
 */

// ---------------------------------------------------------------------------
// CSS impression class names per layer type ID
// Mapped from mocks/add-layer.html's .v-* classes (components.css §4).
// ---------------------------------------------------------------------------

/** @type {Record<number, string>} */
const VIZ_CLASS = {
  1: 'v-ray',
  2: 'v-nth',
  3: 'v-poly',
  4: 'v-spir',
  5: 'v-petal',
  6: 'v-orbit',
  7: 'v-arc',
  8: 'v-line',
  9: 'v-moire',
  10: 'v-gridp',
  11: 'v-sine',
  12: 'v-cross',
  13: 'v-fuzz',
  14: 'v-scan',
  15: 'v-vig',
  16: 'v-grain',
  17: 'v-web',
  18: 'v-squares',
  19: 'v-sun',
  20: 'v-pulse',
  21: 'v-star',
  22: 'v-coil',
  23: 'v-prism',
  24: 'v-checker',
  25: 'v-stipple',
  26: 'v-lattice',
  27: 'v-cwaves',
  28: 'v-triang',
  29: 'v-leak',
  30: 'v-tint',
  31: 'v-haze',
  32: 'v-sweep',
  33: 'v-slice',
  34: 'v-rgb',
  35: 'v-blocks',
  36: 'v-roll',
  37: 'v-fold',
  38: 'v-comb',
  39: 'v-echo',
  40: 'v-smear',
  41: 'v-ghost',
  42: 'v-crush',
  43: 'v-liss',
  44: 'v-rose',
  45: 'v-epi',
  // 46 uses `v-skip` (skip-star) — `v-star` is already ID 21's Burst Star
  // impression; a {n/k} polygon deserves its own visual language.
  46: 'v-skip',
  47: 'v-squircle',
  48: 'v-hex',
  49: 'v-truchet',
  50: 'v-voronoi',
  51: 'v-interf',
  52: 'v-flow',
  53: 'v-halftone',
  54: 'v-bokeh',
}

/** Role dot class per role name. */
const ROLE_DOT = {
  primary: 'role-dot--primary',
  secondary: 'role-dot--secondary',
  overlay: 'role-dot--overlay',
  glitch: 'role-dot--glitch',
}

/** Role sub-headings per the mock. */
const ROLE_HEADINGS = [
  { role: 'primary', label: 'Primary', desc: 'centre-anchored structure' },
  { role: 'secondary', label: 'Secondary', desc: 'full-frame texture' },
  { role: 'overlay', label: 'Overlay', desc: 'final-pass mood' },
  { role: 'glitch', label: 'Glitch', desc: 'frame-corrupting chaos' },
]

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
 * Build one type button.
 *
 * @param {LayerModule} mod
 * @param {() => void} onPick
 * @returns {HTMLElement}
 */
function buildTypeButton(mod, onPick) {
  const vizClass = VIZ_CLASS[mod.meta.id] ?? ''
  return el('button', {
    class: 'type',
    on: { click: onPick },
  }, [
    el('span', { class: 'type__viz' }, [
      el('i', { class: vizClass }),
    ]),
    el('span', { class: 'type__name', text: mod.meta.name }),
  ])
}

/**
 * Build the full modal DOM.
 *
 * @param {() => void} onPickType
 * @returns {HTMLElement}
 */
function buildModal(onPickType) {
  const c = state.composition
  const layerCount = c ? c.layers.length : 0
  const remaining = 5 - layerCount

  /** @type {HTMLElement[]} */
  const children = []

  // Header
  children.push(
    el('div', { class: 'between mb-4' }, [
      el('h1', { class: 'modal__title m-0', id: 'al-title', text: ADD_LAYER.title }),
      el('button', {
        class: 'btn btn--icon',
        'aria-label': 'Close',
        text: '\u2715',
        on: { click: () => close() },
      }),
    ]),
  )

  // Hint about remaining slots
  if (remaining > 0) {
    children.push(
      el('p', { class: 'hint m-0 mb-4', text:
        'You have ' + layerCount + ' of 5 layers. A good composition usually mixes roles \u2014 structure, then texture, then mood on top.',
      }),
    )
  }

  // Role groups
  for (const head of ROLE_HEADINGS) {
    const types = byRole(head.role)
    if (types.length === 0) continue

    children.push(
      el('div', { class: 'role-head' }, [
        el('span', { class: 'role-dot ' + (ROLE_DOT[head.role] ?? ''), 'aria-hidden': 'true' }),
        el('span', { text: head.label + ' \u2014 ' + head.desc }),
      ]),
    )

    const grid = el('div', { class: 'grid' })
    for (const mod of types) {
      grid.appendChild(buildTypeButton(mod, () => onPickType(mod.meta.id)))
    }
    children.push(grid)
  }

  const modal = el('div', {
    class: 'modal modal--wide',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'al-title',
  }, children)

  return modal
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/**
 * Open the add-layer modal.
 *
 * @param {HTMLElement} triggerEl  The element that opened this modal (for focus return).
 * @param {(typeId: number) => void} onPick  Called with the chosen type ID.
 */
export function open(triggerEl) {
  close() // ensure no stale modal

  returnFocus = triggerEl

  /**
   * Handle a type pick: add the layer and close.
   * @param {number} typeId
   */
  function handlePick(typeId) {
    // Generate a randomized composition and extract a layer of the chosen
    // type so the new layer renders something (FR-6) rather than a blank.
    // Fall back to a valid default layer (`defaults(typeId)` = createLayer)
    // if the generated composition didn't include this type. Both paths
    // pass a real `Layer` to `addLayer` (which now accepts `number | Layer`).
    const c = generate(state.governorWarned)
    const generated = c.layers.find((l) => l.type === typeId)
    const layer = generated ?? defaults(typeId)
    if (layer) actions.addLayer(layer)
    close()
  }

  scrimEl = el('div', { class: 'scrim' }, [buildModal(handlePick)])
  document.body.appendChild(scrimEl)

  // Trap focus
  const firstBtn = scrimEl.querySelector('button')
  releaseTrap = trapFocus(scrimEl, /** @type {HTMLElement | null} */ (firstBtn))

  // Esc to close (capture phase, so it fires before the shell's handler)
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