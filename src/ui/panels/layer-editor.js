// @ts-check
/**
 * The L1/L2 layer editor (mocks/layer-editor.html, FR-6, FR-10, FR-11).
 *
 * Generated **entirely from the layer module's `params` declaration**
 * (architecture §5.2) so a seventeenth layer type needs no change here.
 *
 * Structure:
 * - Subhead: back button, layer name, Duplicate, Delete
 * - Layer-type `<select>` with role `optgroup`s
 * - Blend mode chips (selectable subset)
 * - Colour card: bucket segmented control + swatches + pinned
 * - Motion section: character chips + Speed band + Reroll button
 * - Parameters section: one control per declared param
 *   - A param → band with bounds + live tick + Advanced disclosure
 *   - S.int → slider (step 1) with a live value readout
 *   - S.num → slider
 *   - S.bool → switch
 *   - S.enum → segmented or select
 * - Envelope opacity band (common to every layer)
 *
 * Subscribes to `TOPICS.COMPOSITION` for structural updates (type change,
 * duplicate, delete). Param edits publish `TOPIC.LAYER` but do NOT trigger
 * a re-render — the controls self-update, and a full rebuild would destroy
 * the native range input mid-drag. Motion character and reroll call
 * `render()` directly from their callbacks. Never reads state directly
 * outside of a notification — mutations go through `core/actions.js`
 * (§4 rule 5).
 *
 * Imports `ui/dom.js`, `ui/strings.js`, `ui/controls/*`, `core/state.js`,
 * `core/actions.js`, `core/clock.js`, `model/registry.js`, `model/blend.js`,
 * `model/motion.js`, `model/params.js`, `core/algorithms.js`, `core/rng.js`. All legal `ui → core`, `ui → model`,
 * `ui → ui` edges (§4).
 */

import { el } from '../dom.js'
import { LAYER_EDITOR } from '../strings.js'
import { toastKey } from '../feedback.js'
import { subscribe, TOPICS, state } from '../../core/state.js'
import * as actions from '../../core/actions.js'
import { onFrame } from '../../core/clock.js'
import { get as getLayer, list as listLayers, ROLES } from '../../model/registry.js'
import { BLEND_NAMES, SELECTABLE_BLENDS } from '../../model/blend.js'
import { CHARACTERS, CHARACTER_COUNT, assign, speed, reroll } from '../../model/motion.js'
import { TIMES_MIN, TIMES_MAX } from '../../model/params.js'
import { ALGORITHMS, algorithmName, coerceAlgorithm } from '../../core/algorithms.js'
import { mulberry32, uint32 } from '../../core/rng.js'
import { clamp } from '../../util/clamp.js'
import * as bandControl from '../controls/band.js'
import * as tickControl from '../controls/tick.js'
import * as chipControl from '../controls/chip.js'
import * as segmentedControl from '../controls/segmented.js'
import * as stepperControl from '../controls/stepper.js'
import * as sliderControl from '../controls/slider.js'
import * as switchControl from '../controls/switch.js'

/**
 * @typedef {import('../../model/params.js').Composition} Composition
 * @typedef {import('../../model/params.js').Layer} Layer
 * @typedef {import('../../model/params.js').AnimValue} AnimValue
 * @typedef {import('../../model/params.js').ParamDecl} ParamDecl
 * @typedef {import('../../model/params.js').Palette} Palette
 * @typedef {import('../../model/params.js').ParamValue} ParamValue
 * @typedef {import('../../model/registry.js').LayerModule} LayerModule
 */

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {HTMLElement | null} */
let container = null
/** @type {number | null} */
let currentIndex = null
/** @type {(() => void) | null} */
let onBack = null

/** Active control instances — destroyed and rebuilt on each render. */
/** @type {Array<{ destroy: () => void }>} */
let activeControls = []

/** @type {(() => void)[]} */
let panelSubscriptions = []

// ---------------------------------------------------------------------------
// Colour source labels (matching the mock's segmented control)
// ---------------------------------------------------------------------------

const COLOR_SOURCES = ['Colour', 'Neutral', 'Background', 'Pinned']
const COLOR_PREFIXES = ['c', 'n', 'b']

// ---------------------------------------------------------------------------
// Role labels for the type `<select>` optgroups
// ---------------------------------------------------------------------------

const ROLE_LABELS = {
  primary: 'Primary \u2014 centre-anchored structure',
  secondary: 'Secondary \u2014 full-frame texture',
  overlay: 'Overlay \u2014 final-pass mood',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a number for display: integers as-is, floats to 3dp max.
 * @param {number} v
 * @returns {string}
 */
function fmtVal(v) {
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 1000) / 1000)
}

/**
 * Detect the colour source from a colour ref string.
 * @param {string} ref
 * @returns {number} 0=Colour, 1=Neutral, 2=Background, 3=Pinned
 */
function colorSourceIndex(ref) {
  if (ref.length === 6 && /^[0-9A-Fa-f]{6}$/.test(ref)) return 3
  const prefix = ref[0]
  if (prefix === 'n') return 1
  if (prefix === 'b') return 2
  return 0
}

/**
 * Parse the selector from a colour ref.
 * @param {string} ref
 * @returns {number}
 */
function colorSelector(ref) {
  if (ref.length <= 1) return 0
  const n = parseInt(ref.slice(1), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// ---------------------------------------------------------------------------
// Subhead
// ---------------------------------------------------------------------------

/**
 * Build the subhead: back button, layer name, Duplicate, Delete.
 * @param {Layer} layer
 * @param {LayerModule} mod
 * @returns {HTMLElement}
 */
function buildSubhead(layer, mod) {
  return el('div', { class: 'subhead' }, [
    el('button', {
      class: 'btn btn--icon btn--sm',
      'aria-label': LAYER_EDITOR.back,
      text: '\u2039',
      on: { click: () => { if (onBack) onBack() } },
    }),
    el('span', { class: 'subhead__title', text: mod.meta.name }),
    el('button', {
      class: 'btn btn--sm',
      text: LAYER_EDITOR.duplicate,
      on: {
        click: () => {
          if (currentIndex !== null) {
            actions.duplicateLayer(currentIndex)
          }
        },
      },
    }),
    el('button', {
      class: 'btn btn--sm btn--danger',
      'aria-label': LAYER_EDITOR.delete,
      text: LAYER_EDITOR.delete,
      disabled: (state.composition?.layers.length ?? 0) <= 1,
      on: {
        click: () => {
          if (currentIndex !== null && actions.deleteLayer(currentIndex)) {
            toastKey('layerDeleted')
            if (onBack) onBack()
          }
        },
      },
    }),
  ])
}

// ---------------------------------------------------------------------------
// Layer-type select
// ---------------------------------------------------------------------------

/**
 * Build the layer-type `<select>` with role optgroups.
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildTypeSelect(layer) {
  const field = el('div', { class: 'field' }, [
    el('label', { class: 'label', text: LAYER_EDITOR.typeLabel }),
  ])

  const select = el('select', { class: 'select' })

  for (const role of ROLES) {
    const group = el('optgroup', { label: ROLE_LABELS[role] ?? role })
    const modules = listLayers().filter((m) => m.meta.role === role)
    for (const m of modules) {
      const opt = el('option', {
        value: String(m.meta.id),
        text: m.meta.name,
      })
      if (m.meta.id === layer.type) {
        opt.setAttribute('selected', 'selected')
      }
      group.appendChild(opt)
    }
    select.appendChild(group)
  }

  select.addEventListener('change', () => {
    if (currentIndex !== null) {
      const typeId = parseInt(select.value, 10)
      if (Number.isFinite(typeId)) {
        actions.setLayerType(currentIndex, typeId)
        render()
      }
    }
  })

  field.appendChild(select)
  return field
}

// ---------------------------------------------------------------------------
// Blend mode chips
// ---------------------------------------------------------------------------

/**
 * Build the blend mode chip group.
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildBlendChips(layer) {
  const field = el('div', { class: 'field' }, [
    el('span', { class: 'label', text: LAYER_EDITOR.blendLabel }),
  ])

  const names = SELECTABLE_BLENDS.map((id) => BLEND_NAMES[id])
  // A legacy layer on a retired blend (3/4) yields -1 → no chip pressed,
  // which chip.js renders correctly (all aria-pressed="false").
  const selected = SELECTABLE_BLENDS.indexOf(layer.blend)

  const ctrl = chipControl.create(
    LAYER_EDITOR.blendLabel,
    names,
    selected,
    (chipIndex) => {
      if (currentIndex !== null) {
        actions.setBlend(currentIndex, SELECTABLE_BLENDS[chipIndex])
      }
    },
  )
  activeControls.push(ctrl)

  field.appendChild(ctrl.node)
  return field
}

// ---------------------------------------------------------------------------
// Colour card
// ---------------------------------------------------------------------------

/**
 * Build the colour card: bucket segmented control + swatches.
 * @param {Layer} layer
 * @param {Palette} palette
 * @returns {HTMLElement}
 */
function buildColourCard(layer, palette) {
  const scheme = palette.scheme
  const srcIndex = colorSourceIndex(layer.color)
  const resolvedColour = palette.layerColors[currentIndex ?? 0] ?? '#FF2E88'

  const field = el('div', { class: 'field' }, [
    el('span', { class: 'label', text: LAYER_EDITOR.colorLabel }),
  ])

  const card = el('div', { class: 'card' })

  // Source segmented control
  const srcCtrl = segmentedControl.create(
    LAYER_EDITOR.colorSource,
    COLOR_SOURCES,
    srcIndex,
    (index) => {
      if (currentIndex === null) return
      if (index === 3) {
        // Pinned: pin the currently resolved colour
        const hex = resolvedColour.replace('#', '')
        actions.setColorRef(currentIndex, hex)
      } else {
        // Bucket: set to bucket prefix + current selector (or 0)
        const prefix = COLOR_PREFIXES[index]
        const sel = colorSelector(layer.color)
        actions.setColorRef(currentIndex, prefix + sel)
      }
      renderSwatches(index)
    },
  )
  activeControls.push(srcCtrl)
  card.appendChild(srcCtrl.node)

  // Swatches for the current bucket
  /** @type {HTMLElement[]} */
  let swatchNodes = []

  /**
   * Render swatches for a given bucket.
   * @param {number} bucketIdx
   */
  function renderSwatches(bucketIdx) {
    for (const n of swatchNodes) n.remove()
    swatchNodes = []

    if (bucketIdx === 3) {
      // Pinned: show the resolved colour only
      const sw = el('button', {
        class: 'swatch',
        'aria-pressed': 'true',
        'aria-label': 'Pinned colour ' + resolvedColour,
      })
      sw.style.setProperty('--swatch', resolvedColour)
      swatchNodes.push(sw)
    } else {
      const bucketName = ['colors', 'neutrals', 'backgrounds'][bucketIdx]
      const arr = scheme[bucketName]
      const currentSel = colorSelector(layer.color)
      for (let i = 0; i < arr.length; i++) {
        const isSel = bucketIdx === srcIndex && i === (currentSel % arr.length)
        const sw = el('button', {
          class: 'swatch',
          'aria-pressed': String(isSel),
          'aria-label': arr[i],
          on: {
            click: () => {
              if (currentIndex !== null) {
                actions.setColorRef(currentIndex, COLOR_PREFIXES[bucketIdx] + i)
                for (let j = 0; j < swatchNodes.length; j++) {
                  swatchNodes[j].setAttribute('aria-pressed', String(j === i))
                }
              }
            },
          },
        })
        sw.style.setProperty('--swatch', arr[i])
        swatchNodes.push(sw)
      }
    }

    const swatchesEl = el('div', { class: 'swatches' }, swatchNodes)
    card.appendChild(swatchesEl)
  }

  // Initial swatches
  renderSwatches(srcIndex)

  const hint = el('p', {
    class: 'hint',
    text: 'Resolved from the layer\u2019s own seed. Change the scheme and this re-resolves; pin it and it survives.',
  })
  card.appendChild(hint)

  field.appendChild(card)
  return field
}

// ---------------------------------------------------------------------------
// Motion section
// ---------------------------------------------------------------------------

/**
 * Build the Motion section: character chips + Speed band + Reroll.
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildMotionSection(layer) {
  const section = el('div', { class: 'section' }, [
    el('div', { class: 'section__title', text: 'Motion' }),
    el('p', {
      class: 'motion-help',
      text: 'Pick how this layer should feel. Every moving value on it gets an oscillation curve chosen to match.',
    }),
  ])

  // Determine current character by matching the layer's algorithm assignments
  // to each character's pool. If no match, default to the first character.
  let currentChar = 0
  const mod = getLayer(layer.type)
  if (mod) {
    const aParams = mod.params.filter((p) => p.kind === 'A')
    if (aParams.length > 0) {
      // Try to find a character whose pool contains all assigned algorithms
      for (let ci = 0; ci < CHARACTER_COUNT; ci++) {
        const char = CHARACTERS[ci]
        const poolSet = new Set(char.pool)
        let allMatch = true
        for (const decl of aParams) {
          const av = layer.params[decl.name]
          if (typeof av === 'object' && av !== null && 'algorithm' in av) {
            const animAv = /** @type {AnimValue} */ (av)
            if (!poolSet.has(animAv.algorithm)) {
              allMatch = false
              break
            }
          }
        }
        if (allMatch) {
          currentChar = ci
          break
        }
      }
    }
  }

  // Character chips
  const charNames = []
  for (let i = 0; i < CHARACTER_COUNT; i++) {
    charNames.push(CHARACTERS[i].name)
  }

  const charCtrl = chipControl.create(
    LAYER_EDITOR.motionLabel,
    charNames,
    currentChar,
    (index) => {
      if (currentIndex === null) return
      const char = CHARACTERS[index]
      const rng = mulberry32(layer.rngSeed)
      actions.setMotionCharacter(currentIndex, () => {
        assign(layer, char, rng)
      })
      render()
    },
  )
  activeControls.push(charCtrl)
  section.appendChild(charCtrl.node)

  // Speed band
  const speedSection = el('div', { class: 'param', style: { 'border-bottom': '0', 'padding-top': '0' } })
  const speedHead = el('div', { class: 'param__head' }, [
    el('span', { class: 'param__name', text: LAYER_EDITOR.speedLabel }),
    el('span', { class: 'param__now', text: '\u00D71.00' }),
  ])

  // Speed: a slider from ×0.25 to ×3.0. The value is transient — it scales
  // every times on the layer via the speed() model function, clamped to 1–8.
  let speedValue = 1.0

  const speedSlider = sliderControl.create(
    0.25, 3.0, 0.05, speedValue,
    LAYER_EDITOR.speedLabel,
    (value) => {
      speedValue = value
      const nowEl = speedHead.querySelector('.param__now')
      if (nowEl) nowEl.textContent = '\u00D7' + fmtVal(value)
      if (currentIndex !== null) {
        actions.setSpeed(currentIndex, () => {
          speed(layer, value)
        })
      }
    },
  )
  activeControls.push(speedSlider)

  const speedBounds = el('div', { class: 'track__bounds' }, [
    el('span', { text: '\u00D70.25' }),
    el('span', { text: '\u00D73.00' }),
  ])

  speedSection.appendChild(speedHead)
  speedSection.appendChild(speedSlider.node)
  speedSection.appendChild(speedBounds)
  section.appendChild(speedSection)

  // Reroll button
  const rerollBtn = el('button', {
    class: 'btn',
    style: { width: '100%' },
    on: {
      click: () => {
        if (currentIndex === null) return
        const char = CHARACTERS[currentChar]
        // Advance the PRNG state for a fresh draw
        const rng = mulberry32(uint32(mulberry32(layer.rngSeed)))
        actions.rerollMotion(currentIndex, () => {
          reroll(layer, char, rng)
        })
        render()
      },
    },
  }, [
    el('span', { class: 'btn__glyph', 'aria-hidden': 'true', text: '\u21BB' }),
    document.createTextNode(' Reroll motion'),
  ])
  section.appendChild(rerollBtn)

  return section
}

// ---------------------------------------------------------------------------
// Parameter controls
// ---------------------------------------------------------------------------

/**
 * Build a single animatable parameter row: band + tick + bounds + Advanced.
 * @param {ParamDecl} decl
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildAnimParam(decl, layer) {
  const av = /** @type {AnimValue} */ (layer.params[decl.name])

  const paramEl = el('div', { class: 'param' })

  // Head: name + badge + "now" value
  const head = el('div', { class: 'param__head' }, [
    el('span', { class: 'param__name' }, [
      document.createTextNode(decl.label + ' '),
      el('span', { class: 'param__badge param__badge--anim', text: '\u2195 Animated' }),
    ]),
    el('span', { class: 'param__now', text: 'now ' + fmtVal((av.min + av.max) / 2) }),
  ])
  paramEl.appendChild(head)

  // Band control
  const band = bandControl.create(decl, (newAv) => {
    if (currentIndex !== null) {
      actions.setParamRange(currentIndex, decl.name, newAv.min, newAv.max)
      // Preserve times and algorithm from the new AnimValue
      if (newAv.times !== av.times) {
        actions.setParamTimes(currentIndex, decl.name, newAv.times)
      }
      if (newAv.algorithm !== av.algorithm) {
        actions.setParamAlgorithm(currentIndex, decl.name, newAv.algorithm)
      }
    }
  })
  band.update(av)
  activeControls.push(band)

  // Tick control
  const tick = tickControl.create(decl, onFrame)
  tick.setValue(av)
  activeControls.push(tick)

  // Insert the tick node inside the band's track
  band.node.appendChild(tick.node)

  paramEl.appendChild(band.node)

  // Bounds
  const boundsMid = el('span', { text: 'min ' + fmtVal(av.min) + ' \u2014 max ' + fmtVal(av.max) })
  const bounds = el('div', { class: 'track__bounds' }, [
    el('span', { text: fmtVal(decl.min) }),
    boundsMid,
    el('span', { text: fmtVal(decl.max) }),
  ])
  paramEl.appendChild(bounds)

  // Advanced disclosure
  paramEl.appendChild(buildAdvanced(decl, layer, av, () => {
    band.update(av)
    const nowEl = head.querySelector('.param__now')
    if (nowEl) nowEl.textContent = 'now ' + fmtVal((av.min + av.max) / 2)
    boundsMid.textContent = 'min ' + fmtVal(av.min) + ' \u2014 max ' + fmtVal(av.max)
  }))

  return paramEl
}

/**
 * Build the Advanced disclosure for an animatable parameter:
 * min, max, cycles (1–8), curve.
 * @param {ParamDecl} decl
 * @param {Layer} layer
 * @param {AnimValue} av
 * @param {() => void} onRangeChange  Called after min/max changes so the band + readouts refresh.
 * @returns {HTMLElement}
 */
function buildAdvanced(decl, layer, av, onRangeChange) {
  /** @type {HTMLElement | null} */
  let panel = null

  const toggle = el('button', {
    class: 'disclosure__toggle',
    'aria-expanded': 'false',
    on: {
      click: () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true'
        toggle.setAttribute('aria-expanded', String(!expanded))
        if (panel) {
          panel.style.setProperty('display', !expanded ? 'block' : 'none')
        }
      },
    },
  }, [
    el('span', { text: LAYER_EDITOR.advanced }),
    el('span', { class: 'caret', 'aria-hidden': 'true', text: '\u203A' }),
  ])

  // Advanced panel content
  panel = el('div', { class: 'disclosure__panel', style: { display: 'none' } })

  const advGrid = el('div', { class: 'param__adv' })

  // Min input
  advGrid.appendChild(el('label', { class: 'label', text: LAYER_EDITOR.minLabel }))
  const minInput = el('input', {
    class: 'input input--mono',
    value: fmtVal(av.min),
    'aria-label': decl.label + ' minimum',
  })
  minInput.addEventListener('change', () => {
    if (currentIndex === null) return
    const v = parseFloat(minInput.value)
    if (Number.isFinite(v)) {
      const clamped = clamp(v, decl.min, av.max)
      actions.setParamRange(currentIndex, decl.name, clamped, av.max)
      av.min = clamped
      minInput.value = fmtVal(clamped)
      onRangeChange()
    } else {
      minInput.value = fmtVal(av.min)
    }
  })
  advGrid.appendChild(minInput)

  // Max input
  advGrid.appendChild(el('label', { class: 'label', text: LAYER_EDITOR.maxLabel }))
  const maxInput = el('input', {
    class: 'input input--mono',
    value: fmtVal(av.max),
    'aria-label': decl.label + ' maximum',
  })
  maxInput.addEventListener('change', () => {
    if (currentIndex === null) return
    const v = parseFloat(maxInput.value)
    if (Number.isFinite(v)) {
      const clamped = clamp(v, av.min, decl.max)
      actions.setParamRange(currentIndex, decl.name, av.min, clamped)
      av.max = clamped
      maxInput.value = fmtVal(clamped)
      onRangeChange()
    } else {
      maxInput.value = fmtVal(av.max)
    }
  })
  advGrid.appendChild(maxInput)

  // Cycles stepper
  advGrid.appendChild(el('label', { class: 'label', text: LAYER_EDITOR.cyclesLabel }))
  const cyclesCtrl = stepperControl.create(
    TIMES_MIN, TIMES_MAX, av.times,
    decl.label + ' cycles',
    (value) => {
      if (currentIndex !== null) {
        actions.setParamTimes(currentIndex, decl.name, value)
      }
    },
  )
  activeControls.push(cyclesCtrl)
  advGrid.appendChild(cyclesCtrl.node)

  // Curve select
  advGrid.appendChild(el('label', { class: 'label', text: LAYER_EDITOR.curveLabel }))

  // Determine the current character to list its pool first
  const currentChar = detectCharacter(layer)
  const charPool = CHARACTERS[currentChar]?.pool ?? []

  const curveSelect = el('select', {
    class: 'select',
    'aria-label': decl.label + ' curve',
  })

  // Optgroup: "In <Character>"
  const inGroup = el('optgroup', {
    label: 'In \u201C' + (CHARACTERS[currentChar]?.name ?? 'Pulse') + '\u201D',
  })
  for (const algoId of charPool) {
    const opt = el('option', {
      value: String(algoId),
      text: algorithmName(algoId),
    })
    if (algoId === av.algorithm) opt.setAttribute('selected', 'selected')
    inGroup.appendChild(opt)
  }
  curveSelect.appendChild(inGroup)

  // Optgroup: All 20 curves
  const allGroup = el('optgroup', { label: 'All 20 curves' })
  for (const algo of ALGORITHMS) {
    // Skip ones already in the character pool (they're in the first group)
    if (charPool.includes(algo.id)) continue
    const opt = el('option', {
      value: String(algo.id),
      text: algo.name,
    })
    if (algo.id === av.algorithm) opt.setAttribute('selected', 'selected')
    allGroup.appendChild(opt)
  }
  curveSelect.appendChild(allGroup)

  curveSelect.addEventListener('change', () => {
    if (currentIndex !== null) {
      const algoId = parseInt(curveSelect.value, 10)
      if (Number.isFinite(algoId)) {
        actions.setParamAlgorithm(currentIndex, decl.name, coerceAlgorithm(algoId))
      }
    }
  })

  advGrid.appendChild(curveSelect)

  panel.appendChild(advGrid)

  // Hint
  panel.appendChild(el('p', {
    class: 'hint',
    text: 'Hand-set values stick through Reroll motion, but change the character above and they\u2019re replaced.',
  }))

  const disclosure = el('div', { class: 'disclosure' }, [toggle, panel])
  return disclosure
}

/**
 * Detect which motion character a layer is currently using by matching
 * algorithm assignments to character pools.
 * @param {Layer} layer
 * @returns {number}
 */
function detectCharacter(layer) {
  const mod = getLayer(layer.type)
  if (!mod) return 0
  const aParams = mod.params.filter((p) => p.kind === 'A')
  if (aParams.length === 0) return 0
  for (let ci = 0; ci < CHARACTER_COUNT; ci++) {
    const poolSet = new Set(CHARACTERS[ci].pool)
    let allMatch = true
    for (const decl of aParams) {
      const av = layer.params[decl.name]
      if (typeof av === 'object' && av !== null && 'algorithm' in av) {
        const animAv = /** @type {AnimValue} */ (av)
        if (!poolSet.has(animAv.algorithm)) {
          allMatch = false
          break
        }
      }
    }
    if (allMatch) return ci
  }
  return 0
}

/**
 * Build a static integer parameter row: single-thumb slider (step 1) with a
 * live value readout. (F: control-and-modal-fixes item 2 — all int params are
 * sliders; the readout preserves the number the stepper used to show.)
 * @param {ParamDecl} decl
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildIntParam(decl, layer) {
  const value = /** @type {number} */ (layer.params[decl.name])

  // Live value readout — a slider hides the number a stepper displayed.
  const valueEl = el('span', { class: 'mono', text: fmtVal(value) })

  const paramEl = el('div', { class: 'param' }, [
    el('div', { class: 'param__head' }, [
      el('span', { class: 'param__name' }, [
        document.createTextNode(decl.label + ' '),
        el('span', { class: 'param__badge', text: 'Fixed' }),
      ]),
    ]),
  ])

  paramEl.querySelector('.param__head')?.appendChild(valueEl)

  const ctrl = sliderControl.create(
    decl.min, decl.max, 1, value,
    decl.label,
    (v) => {
      const iv = Math.round(v)          // slider emits float; params stay integer
      valueEl.textContent = fmtVal(iv)  // live readout — no rerender needed
      if (currentIndex !== null) {
        actions.setParamStatic(currentIndex, decl.name, iv)
      }
    },
  )
  activeControls.push(ctrl)
  paramEl.appendChild(ctrl.node)

  paramEl.appendChild(el('div', { class: 'track__bounds' }, [
    el('span', { text: fmtVal(decl.min) }),
    el('span', { text: fmtVal(decl.max) }),
  ]))

  return paramEl
}

/**
 * Build a static float parameter row: slider.
 * @param {ParamDecl} decl
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildNumParam(decl, layer) {
  const value = /** @type {number} */ (layer.params[decl.name])

  const paramEl = el('div', { class: 'param' }, [
    el('div', { class: 'param__head' }, [
      el('span', { class: 'param__name' }, [
        document.createTextNode(decl.label + ' '),
        el('span', { class: 'param__badge', text: 'Fixed' }),
      ]),
    ]),
  ])

  const ctrl = sliderControl.create(
    decl.min, decl.max, decl.step, value,
    decl.label,
    (v) => {
      if (currentIndex !== null) {
        actions.setParamStatic(currentIndex, decl.name, v)
      }
    },
  )
  activeControls.push(ctrl)
  paramEl.appendChild(ctrl.node)

  paramEl.appendChild(el('div', { class: 'track__bounds' }, [
    el('span', { text: fmtVal(decl.min) }),
    el('span', { text: fmtVal(decl.max) }),
  ]))

  return paramEl
}

/**
 * Build a boolean static parameter row: switch.
 * @param {ParamDecl} decl
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildBoolParam(decl, layer) {
  const value = /** @type {boolean} */ (layer.params[decl.name])

  const paramEl = el('div', { class: 'param' })

  const ctrl = switchControl.create(
    decl.label,
    value,
    (v) => {
      if (currentIndex !== null) {
        actions.setParamStatic(currentIndex, decl.name, v)
      }
    },
  )
  activeControls.push(ctrl)
  paramEl.appendChild(ctrl.node)

  return paramEl
}

/**
 * Build an enum static parameter row: segmented control (small sets)
 * or select (larger sets).
 * @param {ParamDecl} decl
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildEnumParam(decl, layer) {
  const value = /** @type {string|number} */ (layer.params[decl.name])
  const values = decl.values ?? []
  const currentIdx = values.indexOf(value) >= 0 ? values.indexOf(value) : 0

  const field = el('div', { class: 'field' }, [
    el('span', { class: 'label', text: decl.label }),
  ])

  if (values.length <= 4) {
    // Use segmented control for small enums
    const labels = values.map(String)
    const ctrl = segmentedControl.create(
      decl.label,
      labels,
      currentIdx,
      (index) => {
        if (currentIndex !== null && values[index] !== undefined) {
          actions.setParamStatic(currentIndex, decl.name, values[index])
        }
      },
    )
    activeControls.push(ctrl)
    field.appendChild(ctrl.node)
  } else {
    // Use select for larger enums
    const select = el('select', { class: 'select' })
    for (let i = 0; i < values.length; i++) {
      const opt = el('option', { value: String(i), text: String(values[i]) })
      if (i === currentIdx) opt.setAttribute('selected', 'selected')
      select.appendChild(opt)
    }
    select.addEventListener('change', () => {
      if (currentIndex !== null) {
        const idx = parseInt(select.value, 10)
        if (Number.isFinite(idx) && values[idx] !== undefined) {
          actions.setParamStatic(currentIndex, decl.name, values[idx])
        }
      }
    })
    field.appendChild(select)
  }

  return field
}

// ---------------------------------------------------------------------------
// Envelope opacity
// ---------------------------------------------------------------------------

/**
 * Build the envelope opacity band (common to every layer type).
 * @param {Layer} layer
 * @returns {HTMLElement}
 */
function buildOpacityBand(layer) {
  // Use the composition module's opacity declaration
  // The opacity is an A param 0.05–1.0, stored on layer.opacity
  const opacityDecl = {
    kind: 'A',
    name: 'opacity',
    min: 0.05,
    max: 1.0,
    values: null,
    label: 'Opacity',
    unit: '',
    step: 0.01,
    wrap: false,
    default: { min: 0.05, max: 1.0, times: 1, algorithm: 0 },
  }

  const paramEl = el('div', { class: 'param' })

  const head = el('div', { class: 'param__head' }, [
    el('span', { class: 'param__name' }, [
      document.createTextNode('Opacity '),
      el('span', { class: 'param__badge param__badge--anim', text: '\u2195 Animated' }),
    ]),
    el('span', { class: 'param__now', text: 'now ' + fmtVal((layer.opacity.min + layer.opacity.max) / 2) }),
  ])
  paramEl.appendChild(head)

  const band = bandControl.create(
    /** @type {ParamDecl} */ (opacityDecl),
    (newAv) => {
      if (currentIndex !== null) {
        // Envelope opacity lives on layer.opacity, not in layer.params,
        // so it needs its own action (setOpacityRange, added in F2).
        actions.setOpacityRange(currentIndex, newAv.min, newAv.max)
      }
    },
  )
  band.update(layer.opacity)
  activeControls.push(band)

  const tick = tickControl.create(
    /** @type {ParamDecl} */ (opacityDecl),
    onFrame,
  )
  tick.setValue(layer.opacity)
  activeControls.push(tick)
  band.node.appendChild(tick.node)

  paramEl.appendChild(band.node)

  paramEl.appendChild(el('div', { class: 'track__bounds' }, [
    el('span', { text: '0.05' }),
    el('span', { text: 'min ' + fmtVal(layer.opacity.min) + ' \u2014 max ' + fmtVal(layer.opacity.max) }),
    el('span', { text: '1.00' }),
  ]))

  return paramEl
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------

/**
 * Render the full layer editor into the container.
 * Called on init and on every LAYER topic publish.
 */
function render() {
  const c = state.composition
  if (!c || !container || currentIndex === null) return
  if (currentIndex < 0 || currentIndex >= c.layers.length) {
    if (onBack) onBack()
    return
  }

  const layer = c.layers[currentIndex]
  const mod = getLayer(layer.type)
  if (!mod) {
    if (onBack) onBack()
    return
  }

  const palette = state.palette
  if (!palette) return

  // Destroy previous controls
  for (const ctrl of activeControls) {
    try { ctrl.destroy() } catch { /* already destroyed */ }
  }
  activeControls = []

  // Clear the container
  while (container.firstChild) container.removeChild(container.firstChild)

  // Subhead
  container.appendChild(buildSubhead(layer, mod))

  // Action bar (randomize + undo are in the shell's persistent action bar,
  // but the layer editor mock shows its own. We skip it — the shell's
  // action bar persists across panel swaps.)

  // Dock scroll container
  const scroll = el('div', { class: 'dock__scroll' })

  // --- Layer basics ---
  const basicsSection = el('div', { class: 'section' })
  basicsSection.appendChild(buildTypeSelect(layer))
  basicsSection.appendChild(buildBlendChips(layer))
  basicsSection.appendChild(buildColourCard(layer, palette))
  scroll.appendChild(basicsSection)

  // --- Motion ---
  scroll.appendChild(buildMotionSection(layer))

  // --- Parameters ---
  const paramsSection = el('div', { class: 'section' }, [
    el('div', { class: 'section__title' }, [
      document.createTextNode('Parameters '),
      el('span', { class: 'muted small', style: { 'text-transform': 'none', 'letter-spacing': '0' }, text: '\u2195 = animated' }),
    ]),
  ])

  for (const decl of mod.params) {
    if (decl.kind === 'A') {
      paramsSection.appendChild(buildAnimParam(decl, layer))
    } else if (decl.kind === 'int') {
      paramsSection.appendChild(buildIntParam(decl, layer))
    } else if (decl.kind === 'num') {
      paramsSection.appendChild(buildNumParam(decl, layer))
    } else if (decl.kind === 'bool') {
      paramsSection.appendChild(buildBoolParam(decl, layer))
    } else if (decl.kind === 'enum') {
      paramsSection.appendChild(buildEnumParam(decl, layer))
    }
  }

  // Envelope opacity (after declared params)
  paramsSection.appendChild(buildOpacityBand(layer))

  scroll.appendChild(paramsSection)

  container.appendChild(scroll)
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise the layer editor for a specific layer index.
 *
 * @param {HTMLElement} mount  The container element (typically #dock-scroll or similar).
 * @param {number} index  The layer index to edit.
 * @param {{ onBack: () => void }} callbacks
 */
export function initEditor(mount, index, callbacks) {
  // Clean up previous
  destroyEditor()

  container = mount
  currentIndex = index
  onBack = callbacks.onBack

  // Subscribe to COMPOSITION topic (layer may have been deleted, type changed,
  // or duplicated). LAYER-topic param edits are NOT re-rendered here — the
  // controls self-update, and a full rebuild would destroy the native range
  // input mid-drag. Only motion character and reroll need a re-render after a
  // LAYER publish; those call render() directly from their callbacks.
  panelSubscriptions.push(subscribe(TOPICS.COMPOSITION, () => {
    render()
  }))

  render()
}

/**
 * Destroy the editor (cleanup for re-init or navigation back).
 */
export function destroyEditor() {
  for (const ctrl of activeControls) {
    try { ctrl.destroy() } catch { /* already destroyed */ }
  }
  activeControls = []

  for (const unsub of panelSubscriptions) {
    try { unsub() } catch { /* already unsubscribed */ }
  }
  panelSubscriptions = []

  container = null
  currentIndex = null
  onBack = null
}

/**
 * Get the current layer index being edited, or null.
 * @returns {number | null}
 */
export function getCurrentIndex() {
  return currentIndex
}