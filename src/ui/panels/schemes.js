// @ts-check
/**
 * Colour schemes modal (mocks/schemes.html, FR-7, FR-8).
 *
 * Two tabs:
 * - **Choose**: 4 built-ins + the user's custom schemes, each as a button
 *   with a palette strip. Selecting a built-in sets the scheme index;
 *   selecting a custom sets it as an embedded scheme.
 * - **Edit**: name, three buckets (colours, neutrals, backgrounds), 1–8
 *   enforced structurally (add button disappears at 8, last swatch has no
 *   ✕), delete, save.
 *
 * A recipient opening a seed with an embedded custom scheme sees an explicit
 * "Save this scheme" offer — it is never added to their library silently
 * (FR-8). This offer is shown when the composition's scheme is an embedded
 * custom scheme that is not in the user's stored library.
 *
 * Imports `ui/dom.js`, `ui/strings.js`, `ui/controls/swatch.js`,
 * `core/state.js`, `core/actions.js`, `model/schemes.js`,
 * `store/schemes-store.js`. All legal `ui → core`, `ui → model`,
 * `ui → store` edges (§4).
 */

import { el, trapFocus } from '../dom.js'
import { SCHEMES, fmt } from '../strings.js'
import { state } from '../../core/state.js'
import * as actions from '../../core/actions.js'
import { BUILTINS, parseHexColor } from '../../model/schemes.js'
import * as schemesStore from '../../store/schemes-store.js'
import * as swatch from '../controls/swatch.js'

/**
 * @typedef {import('../../model/params.js').Scheme} Scheme
 * @typedef {import('../../model/params.js').Composition} Composition
 * @typedef {import('../../store/schemes-store.js').StoredScheme} StoredScheme
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
/** @type {'choose' | 'edit'} */
let activeTab = 'choose'
/** @type {StoredScheme | null} */
let editingScheme = null
/** @type {{ colors: string[], neutrals: string[], backgrounds: string[] }} */
let editingBuckets = { colors: [], neutrals: [], backgrounds: [] }
/** @type {string} */
let editingName = ''
/** @type {boolean} */
let isNewScheme = false
/** The colour currently being added/edited, or null. `index:'new'` = add. */
/** @type {{ label: string, index: number | 'new' } | null} */
let editingColor = null
/** The uncommitted hex text in the editor (not yet validated/stored). */
/** @type {string} */
let colorDraft = ''

// ---------------------------------------------------------------------------
// Scheme strip builder
// ---------------------------------------------------------------------------

/**
 * Build a `.scheme-strip` element from a scheme's colours.
 * @param {string[]} colors
 * @param {string[]} neutrals
 * @param {string[]} backgrounds
 * @returns {HTMLElement}
 */
function buildStrip(colors, neutrals, backgrounds) {
  const bars = []
  for (const c of colors) {
    const i = el('i')
    i.style.setProperty('--sw', c)
    i.style.setProperty('background', c)
    bars.push(i)
  }
  for (const c of neutrals) {
    const i = el('i')
    i.style.setProperty('--sw', c)
    i.style.setProperty('background', c)
    bars.push(i)
  }
  for (const c of backgrounds) {
    const i = el('i')
    i.style.setProperty('--sw', c)
    i.style.setProperty('background', c)
    bars.push(i)
  }
  return el('div', { class: 'scheme-strip', 'aria-hidden': 'true' }, bars)
}

// ---------------------------------------------------------------------------
// Choose tab
// ---------------------------------------------------------------------------

/**
 * Is the current composition's scheme this built-in?
 * @param {number} index
 * @returns {boolean}
 */
function isCurrentBuiltin(index) {
  const c = state.composition
  if (!c) return false
  return typeof c.scheme === 'number' && c.scheme === index
}

/**
 * Is the current composition's scheme this stored scheme?
 * Matches by name + colours (stored schemes have store-issued ids that
 * don't survive the seed round-trip).
 * @param {StoredScheme} s
 * @returns {boolean}
 */
function isCurrentStored(s) {
  const c = state.composition
  if (!c || typeof c.scheme === 'number') return false
  const cs = /** @type {Scheme} */ (c.scheme)
  return cs.name === s.name &&
    cs.colors.join(',') === s.colors.join(',')
}

/**
 * Build the Choose tab.
 * @returns {HTMLElement}
 */
function buildChooseTab() {
  /** @type {HTMLElement[]} */
  const children = []

  // Built-in schemes
  children.push(el('div', { class: 'section__title', text: 'Built in' }))

  for (let i = 0; i < BUILTINS.length; i++) {
    const s = BUILTINS[i]
    const selected = isCurrentBuiltin(i)
    const top = el('div', { class: 'scheme__top' }, [
      el('span', { class: 'scheme__name', text: s.name }),
    ])
    if (selected) {
      top.appendChild(el('span', { class: 'scheme__tick', 'aria-hidden': 'true', text: '\u2713' }))
      top.appendChild(el('span', { class: 'sr-only', text: 'Currently selected' }))
    }

    children.push(el('button', {
      class: 'scheme',
      'aria-pressed': String(selected),
      on: { click: () => {
        actions.setScheme(i)
        rerender()
      } },
    }, [
      top,
      buildStrip(s.colors, s.neutrals, s.backgrounds),
    ]))
  }

  // Custom schemes
  const customs = schemesStore.list()
  if (customs.length > 0) {
    children.push(el('div', { class: 'section__title mt-5', text: 'Yours' }))

    for (const s of customs) {
      const selected = isCurrentStored(s)
      const top = el('div', { class: 'scheme__top' }, [
        el('span', { class: 'scheme__name', text: s.name }),
        el('button', {
          class: 'btn btn--sm btn--ghost',
          text: 'Edit',
          on: { click: (/** @type {Event} */ ev) => {
            ev.stopPropagation()
            startEdit(s)
          } },
        }),
      ])
      if (selected) {
        top.appendChild(el('span', { class: 'scheme__tick', 'aria-hidden': 'true', text: '\u2713' }))
      }

      children.push(el('button', {
        class: 'scheme',
        'aria-pressed': String(selected),
        on: { click: () => {
          // Set the scheme as an embedded custom scheme
          actions.setScheme({
            id: s.id,
            name: s.name,
            colors: s.colors,
            neutrals: s.neutrals,
            backgrounds: s.backgrounds,
          })
          rerender()
        } },
      }, [
        top,
        buildStrip(s.colors, s.neutrals, s.backgrounds),
      ]))
    }
  }

  // New scheme button
  children.push(el('button', {
    class: 'btn mt-3 btn--block',
    text: '\uFF0B New scheme',
    on: { click: () => startNew() },
  }))

  // Recipient offer: if the current composition has an embedded custom
  // scheme that is not in the user's library, offer to save it.
  const offer = buildRecipientOffer()
  if (offer) children.push(offer)

  return el('div', { role: 'tabpanel' }, children)
}

/**
 * Build the "Save this scheme" offer for an embedded custom scheme
 * that is not in the user's stored library (FR-8).
 * @returns {HTMLElement | null}
 */
function buildRecipientOffer() {
  const c = state.composition
  if (!c || typeof c.scheme === 'number') return null
  const cs = /** @type {Scheme} */ (c.scheme)

  // Check if it's already in the library (match by name + colours)
  const customs = schemesStore.list()
  const alreadySaved = customs.some((s) =>
    s.name === cs.name && s.colors.join(',') === cs.colors.join(','),
  )
  if (alreadySaved) return null

  return el('div', { class: 'banner mt-5' }, [
    el('span', { class: 'banner__icon', 'aria-hidden': 'true', text: '\u25C8' }),
    el('div', { class: 'banner__body' }, [
      el('div', { class: 'banner__title', text: SCHEMES.recipientOfferTitle }),
      el('div', { text: fmt(SCHEMES.recipientOfferBody, { name: cs.name }) }),
    ]),
    el('button', {
      class: 'btn btn--sm btn--primary',
      text: SCHEMES.save,
      on: { click: () => {
        const result = schemesStore.create({
          name: cs.name,
          colors: cs.colors,
          neutrals: cs.neutrals,
          backgrounds: cs.backgrounds,
        })
        if (result) {
          rerender()
        }
      } },
    }),
  ])
}

// ---------------------------------------------------------------------------
// Edit tab
// ---------------------------------------------------------------------------

/**
 * Start editing an existing stored scheme.
 * @param {StoredScheme} s
 */
function startEdit(s) {
  editingScheme = s
  editingName = s.name
  editingBuckets = {
    colors: s.colors.slice(),
    neutrals: s.neutrals.slice(),
    backgrounds: s.backgrounds.slice(),
  }
  isNewScheme = false
  editingColor = null
  colorDraft = ''
  activeTab = 'edit'
  rerender()
}

/**
 * Start a new scheme.
 */
function startNew() {
  editingScheme = null
  editingName = ''
  editingBuckets = {
    colors: ['#FF2E88'],
    neutrals: ['#FFFFFF'],
    backgrounds: ['#07060D'],
  }
  isNewScheme = true
  editingColor = null
  colorDraft = ''
  activeTab = 'edit'
  rerender()
}

/**
 * Build a bucket row with swatches and an add button.
 * @param {string} label
 * @param {string} desc
 * @param {string[]} colours
 * @param {string} addLabel
 * @returns {HTMLElement}
 */
function buildBucketRow(label, desc, colours, addLabel) {
  /** @type {HTMLElement[]} */
  const swatches = []
  for (let i = 0; i < colours.length; i++) {
    const isLast = i === colours.length - 1
    const c = colours[i]
    const isEditing = editingColor?.label === label && editingColor.index === i
    swatches.push(swatch.swatch(
      c, isEditing, !isLast,
      label + ' ' + (i + 1),
      () => { editingColor = { label, index: i }; colorDraft = c; rerender() },
      () => { removeColour(label, i) },
    ).node)
  }

  // Add button disappears at 8
  if (colours.length < 8) {
    swatches.push(swatch.addSlot(addLabel, () => { addColour(label) }).node)
  }

  const countText = colours.length + ' / 8'

  /** @type {HTMLElement[]} */
  const rowChildren = [
    el('div', { class: 'between' }, [
      el('span', { class: 'label m-0' }, [
        document.createTextNode(label + ' '),
        el('span', { class: 'note', text: '\u2014 ' + desc }),
      ]),
      el('span', { class: 'small muted mono', text: countText }),
    ]),
    el('div', { class: 'swatches' }, swatches),
  ]
  if (editingColor && editingColor.label === label) {
    rowChildren.push(buildHexEditor(label))
  }
  return el('div', { class: 'bucket-row' }, rowChildren)
}

/**
 * Map a bucket label to the editingBuckets array.
 * @param {string} label
 * @returns {string[]}
 */
function getBucket(label) {
  if (label === 'Colours') return editingBuckets.colors
  if (label === 'Neutrals') return editingBuckets.neutrals
  return editingBuckets.backgrounds
}

/**
 * Add a default colour to a bucket.
 * @param {string} label
 */
function addColour(label) {
  const arr = getBucket(label)
  if (arr.length >= 8) return
  editingColor = { label, index: 'new' }
  colorDraft = ''
  rerender()
}

/**
 * Remove a colour from a bucket by index.
 * @param {string} label
 * @param {number} index
 */
function removeColour(label, index) {
  const arr = getBucket(label)
  if (arr.length <= 1) return // every bucket needs at least one
  arr.splice(index, 1)
  // If we were editing the removed colour, close the editor; if editing a
  // later colour in the same bucket, shift its index down to stay on it.
  if (editingColor && editingColor.label === label) {
    if (editingColor.index === index) { editingColor = null; colorDraft = '' }
    else if (editingColor.index !== 'new' && editingColor.index > index) {
      editingColor = { label, index: editingColor.index - 1 }
    }
  }
  rerender()
}

/**
 * Inline hex editor for a bucket. The text input updates `colorDraft` WITHOUT
 * rerendering (keeps focus/caret — cf. the gallery-search focus bug, S05);
 * commit and cancel are the only rerenders.
 * @param {string} label
 * @returns {HTMLElement}
 */
function buildHexEditor(label) {
  const target = editingColor
  if (!target) return el('div')                 // narrowing guard for @ts-check
  const isNew = target.index === 'new'

  const preview = el('span', { class: 'swatch swatch--preview', 'aria-hidden': 'true' })
  preview.style.setProperty('--swatch', parseHexColor(colorDraft) ?? '#000000')

  const input = el('input', {
    class: 'input input--mono',
    value: colorDraft,
    placeholder: '#RRGGBB',
    maxlength: '7',
    'aria-label': (isNew ? 'New ' : 'Edit ') + label + ' colour, hex',
  })
  const err = el('span', { class: 'hint', text: '' })

  input.addEventListener('input', () => {
    colorDraft = /** @type {HTMLInputElement} */ (input).value
    const parsed = parseHexColor(colorDraft)
    preview.style.setProperty('--swatch', parsed ?? '#000000')
    err.textContent = parsed || colorDraft.trim() === '' ? '' : 'Enter a hex like #FF2E88'
  })
  input.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitColor(label) }
    else if (ev.key === 'Escape') { ev.stopPropagation(); cancelColor() }
  })

  return el('div', { class: 'field mt-2' }, [
    el('div', { class: 'between' }, [preview, input]),
    err,
    el('div', { class: 'inline-acts mt-2' }, [
      el('button', { class: 'btn btn--sm', text: 'Cancel', on: { click: () => cancelColor() } }),
      el('button', {
        class: 'btn btn--sm btn--primary',
        text: isNew ? 'Add colour' : 'Save colour',
        on: { click: () => commitColor(label) },
      }),
    ]),
  ])
}

/**
 * Validate + store the draft, or keep the editor open on invalid input.
 * @param {string} label
 */
function commitColor(label) {
  const target = editingColor
  if (!target) return
  const parsed = parseHexColor(colorDraft)
  if (!parsed) return                            // invalid — leave editor open (err shown)
  const arr = getBucket(label)
  if (target.index === 'new') {
    if (arr.length < 8) arr.push(parsed)
  } else {
    arr[target.index] = parsed
  }
  editingColor = null
  colorDraft = ''
  rerender()
}

/** Cancel the hex editor and discard the draft. */
function cancelColor() {
  editingColor = null
  colorDraft = ''
  rerender()
}

/**
 * Build the Edit tab.
 * @returns {HTMLElement}
 */
function buildEditTab() {
  const nameHeader = isNewScheme ? 'New scheme' : 'Editing \u201c' + editingName + '\u201d'

  /** @type {HTMLElement[]} */
  const children = []

  children.push(el('div', { class: 'section__title', text: nameHeader }))

  // Name field
  const nameInput = el('input', {
    class: 'input',
    id: 'sname',
    value: editingName,
    placeholder: SCHEMES.namePlaceholder,
  })
  nameInput.addEventListener('input', () => {
    editingName = nameInput.value
  })
  children.push(el('div', { class: 'field' }, [
    el('label', { class: 'label', for: 'sname', text: 'Name' }),
    nameInput,
  ]))

  // Bucket rows
  children.push(buildBucketRow('Colours', 'the vivid ones', editingBuckets.colors, SCHEMES.addColour))
  children.push(buildBucketRow('Neutrals', 'blacks, whites, greys', editingBuckets.neutrals, SCHEMES.addColour))
  children.push(buildBucketRow('Backgrounds', 'the canvas fill', editingBuckets.backgrounds, SCHEMES.addColour))

  // "Every bucket needs at least one" hint
  children.push(el('p', { class: 'hint', text: 'Every bucket needs at least one colour, so the last one can\u2019t be removed.' }))

  // Banner about embedded schemes
  children.push(el('div', { class: 'banner' }, [
    el('span', { class: 'banner__icon', 'aria-hidden': 'true', text: '\u2197' }),
    el('div', { class: 'banner__body', text:
      'Your schemes travel inside the seed. Share a loop that uses this and your friend sees these exact colours, even though they\u2019ve never had this scheme.',
    }),
  ]))

  // Action buttons
  /** @type {HTMLElement[]} */
  const actionBtns = []

  if (!isNewScheme && editingScheme) {
    actionBtns.push(el('button', {
      class: 'btn btn--danger',
      text: SCHEMES.delete,
      on: { click: () => {
        if (editingScheme) {
          schemesStore.remove(editingScheme.id)
        }
        activeTab = 'choose'
        editingScheme = null
        rerender()
      } },
    }))
  }

  actionBtns.push(el('button', {
    class: 'btn btn--primary',
    text: 'Save scheme',
    on: { click: () => {
      const name = editingName.trim()
      if (name.length === 0) return

      const fields = {
        name,
        colors: editingBuckets.colors,
        neutrals: editingBuckets.neutrals,
        backgrounds: editingBuckets.backgrounds,
      }

      if (isNewScheme) {
        const result = schemesStore.create(fields)
        if (result) {
          editingScheme = result
          isNewScheme = false
        }
      } else if (editingScheme) {
        schemesStore.update(editingScheme.id, fields)
      }
      activeTab = 'choose'
      rerender()
    } },
  }))

  children.push(el('div', { class: 'row-2 mt-4' }, actionBtns))

  return el('div', { role: 'tabpanel' }, children)
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

/**
 * Build the tab bar.
 * @returns {HTMLElement}
 */
function buildTabs() {
  const chooseTab = el('button', {
    class: 'tab',
    role: 'tab',
    'aria-selected': String(activeTab === 'choose'),
    text: SCHEMES.chooseTab,
    on: { click: () => { activeTab = 'choose'; rerender() } },
  })

  /** @type {HTMLElement[]} */
  const tabs = [chooseTab]

  if (activeTab === 'edit') {
    const label = isNewScheme ? 'New' : (editingName || 'Scheme')
    tabs.push(el('button', {
      class: 'tab',
      role: 'tab',
      'aria-selected': 'true',
      text: SCHEMES.editTab + ' \u201c' + label + '\u201d',
      on: { click: () => { activeTab = 'edit'; rerender() } },
    }))
  }

  return el('div', { class: 'tabs', role: 'tablist' }, tabs)
}

// ---------------------------------------------------------------------------
// Modal build + open / close
// ---------------------------------------------------------------------------

/**
 * Build the full modal DOM.
 * @returns {HTMLElement}
 */
function buildModal() {
  /** @type {HTMLElement[]} */
  const children = []

  // Header
  children.push(el('div', { class: 'between mb-4' }, [
    el('h1', { class: 'modal__title m-0', id: 'sc-title', text: SCHEMES.title }),
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Close',
      text: '\u2715',
      on: { click: () => close() },
    }),
  ]))

  // Tabs
  children.push(buildTabs())

  // Tab content
  if (activeTab === 'choose') {
    children.push(buildChooseTab())
  } else {
    children.push(buildEditTab())
  }

  return el('div', {
    class: 'modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'sc-title',
  }, children)
}

/**
 * Re-render the modal content (preserving the scrim and trap).
 */
function rerender() {
  if (!scrimEl) return
  const oldModal = scrimEl.querySelector('.modal')
  if (oldModal) oldModal.remove()
  scrimEl.appendChild(buildModal())
  // Re-trap focus on the new modal content
  if (releaseTrap) {
    releaseTrap()
  }
  const firstBtn = scrimEl.querySelector('button')
  releaseTrap = trapFocus(scrimEl, /** @type {HTMLElement | null} */ (firstBtn))
}

/**
 * Open the schemes modal.
 * @param {HTMLElement} triggerEl
 */
export function open(triggerEl) {
  close()
  returnFocus = triggerEl
  activeTab = 'choose'
  editingScheme = null

  scrimEl = el('div', { class: 'scrim' }, [buildModal()])
  document.body.appendChild(scrimEl)

  const firstBtn = scrimEl.querySelector('button')
  releaseTrap = trapFocus(scrimEl, /** @type {HTMLElement | null} */ (firstBtn))
  scrimEl.addEventListener('keydown', onEsc, true)
}

/**
 * Close the modal.
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
  activeTab = 'choose'
  editingScheme = null
  editingColor = null
  colorDraft = ''
}

/**
 * @param {KeyboardEvent} ev
 */
function onEsc(ev) {
  if (ev.key === 'Escape') {
    ev.stopPropagation()
    close()
  }
}

/**
 * @returns {boolean}
 */
export function isOpen() {
  return scrimEl !== null
}