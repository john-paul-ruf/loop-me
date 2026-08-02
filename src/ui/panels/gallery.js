// @ts-check
/**
 * Gallery modal (mocks/gallery.html, FR-14).
 *
 * Text-only rows rendered from stored fields alone — nothing decodes a seed
 * until Load is pressed. Newest-first, with search. Each entry has Load /
 * Copy link / Edit description / Delete with inline confirmation.
 * Export / Import buttons at the top. Empty state when nothing is saved.
 *
 * Delete confirmation is inline (the entry turns red with Keep / Delete),
 * not a stacked dialog. The confirmation names the consequence: "The seed
 * is gone unless you copied it."
 *
 * Imports `ui/dom.js`, `ui/strings.js`, `core/state.js`, `seed/codec.js`,
 * `seed/hash.js`, `store/gallery.js`, `util/clipboard.js`, `ui/feedback.js`,
 * `core/actions.js`, `core/clock.js`, `render/governor.js`.
 * All legal edges (§4).
 */

import { el, trapFocus } from '../dom.js'
import { GALLERY } from '../strings.js'
import { decode } from '../../seed/codec.js'
import * as galleryStore from '../../store/gallery.js'
import { copy as copyToClipboard } from '../../util/clipboard.js'
import { toast, toastKey } from '../feedback.js'
import * as actions from '../../core/actions.js'
import * as clock from '../../core/clock.js'
import * as governor from '../../render/governor.js'

/**
 * @typedef {import('../../store/gallery.js').GalleryEntry} GalleryEntry
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
/** @type {string} */
let searchTerm = ''
/** @type {string | null} */
let confirmingDeleteId = null
/** @type {string | null} */
let editingEntryId = null
/** @type {HTMLElement | null} */
let resultsEl = null

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @type {readonly number[]} */
const DUR_SECS = [5, 15, 30]

/**
 * Format a timestamp as a relative date string.
 * @param {number} ts
 * @returns {string}
 */
function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return 'Today, ' + time
  if (isYesterday) return 'Yesterday, ' + time
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + time
}

/**
 * Truncate a seed for display when no description exists.
 * @param {string} seed
 * @returns {string}
 */
function truncateSeed(seed) {
  return seed.length > 30 ? seed.slice(0, 30) + '\u2026' : seed
}

// ---------------------------------------------------------------------------
// Entry rendering
// ---------------------------------------------------------------------------

/**
 * Build one gallery entry row.
 * @param {GalleryEntry} entry
 * @returns {HTMLElement}
 */
function buildEntry(entry) {
  const isConfirming = confirmingDeleteId === entry.id
  const isEditing = editingEntryId === entry.id

  if (isConfirming) {
    return el('li', { class: 'entry entry--confirm' }, [
      el('div', { class: 'between' }, [
        el('div', { class: 'entry__main' }, [
          el('div', { class: 'entry__title', text: entry.description || truncateSeed(entry.seed) }),
          el('div', { class: 'entry__meta' }, [
            el('span', { class: 'dur', text: DUR_SECS[entry.durationId] + 's' }),
            el('span', { text: formatDate(entry.createdAt) }),
          ]),
        ]),
      ]),
      el('div', { class: 'between mt-3' }, [
        el('span', { class: 'small entry__warn', text: GALLERY.deleteConfirm }),
        el('div', { class: 'inline-acts' }, [
          el('button', {
            class: 'btn btn--sm',
            text: GALLERY.deleteKeep,
            on: { click: () => { confirmingDeleteId = null; rerender() } },
          }),
          el('button', {
            class: 'btn btn--sm btn--danger',
            text: GALLERY.deleteConfirmButton,
            on: { click: () => {
              galleryStore.remove(entry.id)
              confirmingDeleteId = null
              rerender()
            } },
          }),
        ]),
      ]),
    ])
  }

  /** @type {HTMLElement[]} */
  const acts = []

  // Load
  acts.push(el('button', {
    class: 'btn btn--primary btn--auto',
    text: GALLERY.load,
    on: { click: () => loadEntry(entry) },
  }))

  // Copy link
  acts.push(el('button', {
    class: 'btn',
    'aria-label': GALLERY.copyLink + ' for \u201c' + (entry.description || truncateSeed(entry.seed)) + '\u201d',
    text: '\u29C9',
    on: { click: async () => {
      const url = location.origin + location.pathname + '#s=' + entry.seed
      const ok = await copyToClipboard(url)
      if (ok) {
        toastKey('linkCopied')
      } else {
        toast('Couldn\u2019t copy \u2014 the clipboard API isn\u2019t available here.')
      }
    } },
  }))

  // Edit / Add description
  const editLabel = entry.description ? GALLERY.editDescription : GALLERY.addDescription
  acts.push(el('button', {
    class: 'btn',
    'aria-label': editLabel + ' for \u201c' + (entry.description || truncateSeed(entry.seed)) + '\u201d',
    text: '\u270E',
    on: { click: () => { editingEntryId = entry.id; rerender() } },
  }))

  // Delete
  acts.push(el('button', {
    class: 'btn',
    'aria-label': GALLERY.delete + ' \u201c' + (entry.description || truncateSeed(entry.seed)) + '\u201d',
    text: '\u{1F5D1}',
    on: { click: () => { confirmingDeleteId = entry.id; rerender() } },
  }))

  /** @type {HTMLElement[]} */
  const mainChildren = []

  if (isEditing) {
    // Inline edit mode: show a text input
    const editInput = el('input', {
      class: 'input',
      value: entry.description,
      placeholder: 'What is this one? (optional)',
    })
    editInput.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault()
        galleryStore.rename(entry.id, editInput.value)
        editingEntryId = null
        rerender()
      } else if (ev.key === 'Escape') {
        ev.stopPropagation()
        editingEntryId = null
        rerender()
      }
    })
    mainChildren.push(editInput)
    // Save + cancel buttons
    mainChildren.push(el('div', { class: 'inline-acts mt-2' }, [
      el('button', {
        class: 'btn btn--sm',
        text: 'Cancel',
        on: { click: () => { editingEntryId = null; rerender() } },
      }),
      el('button', {
        class: 'btn btn--sm btn--primary',
        text: 'Save',
        on: { click: () => {
          galleryStore.rename(entry.id, editInput.value)
          editingEntryId = null
          rerender()
        } },
      }),
    ]))

    return el('li', { class: 'entry', style: { 'flex-direction': 'column', 'align-items': 'stretch' } }, [
      el('div', { class: 'entry__main' }, mainChildren),
    ])
  }

  // Normal display
  if (entry.description) {
    mainChildren.push(el('div', { class: 'entry__title', text: entry.description }))
  } else {
    mainChildren.push(el('div', { class: 'entry__title entry__title--none', text: truncateSeed(entry.seed) }))
  }

  /** @type {HTMLElement[]} */
  const metaParts = [
    el('span', { class: 'dur', text: DUR_SECS[entry.durationId] + 's' }),
    el('span', { text: formatDate(entry.createdAt) }),
  ]
  mainChildren.push(el('div', { class: 'entry__meta' }, metaParts))

  return el('li', { class: 'entry' }, [
    el('div', { class: 'entry__main' }, mainChildren),
    el('div', { class: 'entry__acts' }, acts),
  ])
}

// ---------------------------------------------------------------------------
// Load entry
// ---------------------------------------------------------------------------

/**
 * Load a gallery entry: decode its seed and replace the current composition.
 * @param {GalleryEntry} entry
 */
async function loadEntry(entry) {
  try {
    const comp = await decode(entry.seed)
    actions.loadComposition(comp)
    governor.reset()
    clock.resetEpoch()
    close()
  } catch {
    // decode() reports on the channel; the banner surfaces.
    // Stay open so the user can try a different entry.
  }
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

/**
 * Trigger a file download with the gallery export JSON.
 */
function doExport() {
  const json = galleryStore.exportJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = el('a', { href: url, download: 'loop-me-gallery.json' })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Trigger a file picker for gallery import.
 */
function doImport() {
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json' })
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result)
      const result = galleryStore.importJson(text)
      if (result) {
        toast('Imported ' + result.imported + ' entries' +
          (result.skipped > 0 ? ', skipped ' + result.skipped : '.'))
        rerender()
      } else {
        toast('That file doesn\u2019t look like a loop-me gallery export.')
      }
    }
    reader.readAsText(file)
  })
  fileInput.click()
}

// ---------------------------------------------------------------------------
// Modal build
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
    el('h1', { class: 'modal__title m-0', id: 'g-title', text: GALLERY.title }),
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Close',
      text: '\u2715',
      on: { click: () => close() },
    }),
  ]))

  // Search — built ONCE; typing does NOT rebuild it (keeps focus/caret).
  const searchInput = el('input', {
    class: 'input',
    type: 'search',
    placeholder: GALLERY.searchPlaceholder,
    value: searchTerm,
  })
  searchInput.addEventListener('input', () => {
    searchTerm = /** @type {HTMLInputElement} */ (searchInput).value
    renderResults()   // results only — the search input stays mounted + focused
  })
  children.push(el('div', { class: 'search' }, [searchInput]))

  // Results container (count + list/empty), filled by renderResults().
  resultsEl = el('div')
  children.push(resultsEl)

  // Footer hint
  children.push(el('p', { class: 'hint center mt-4', text: GALLERY.storageHint }))

  const modal = el('div', {
    class: 'modal modal--md',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'g-title',
  }, children)

  renderResults()   // initial fill
  return modal
}

/**
 * Rebuild just the count row + entry list from the current searchTerm. Called
 * on every search keystroke so the search input keeps focus (unlike rerender(),
 * which rebuilds the whole modal). (F: control-and-modal-fixes item 7.)
 * @returns {void}
 */
function renderResults() {
  if (!resultsEl) return
  while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild)

  let entries = galleryStore.list()
  if (searchTerm.trim()) {
    const term = searchTerm.toLowerCase()
    entries = entries.filter((e) =>
      e.description.toLowerCase().includes(term) ||
      e.seed.toLowerCase().includes(term),
    )
  }

  // Count + Export/Import
  resultsEl.appendChild(el('div', { class: 'between mb-3' }, [
    el('span', { class: 'small muted', text: entries.length + ' ' + GALLERY.countSuffix }),
    el('div', { class: 'inline-acts' }, [
      el('button', {
        class: 'btn btn--sm',
        text: GALLERY.export,
        on: { click: doExport },
      }),
      el('button', {
        class: 'btn btn--sm',
        text: GALLERY.import,
        on: { click: doImport },
      }),
    ]),
  ]))

  // Entries / empty state
  if (entries.length === 0) {
    const allCount = galleryStore.count()
    resultsEl.appendChild(el('p', { class: 'hint center mt-4', text:
      allCount === 0 ? GALLERY.empty : 'No matches for \u201c' + searchTerm + '\u201d.' }))
  } else {
    const list = el('ul')
    for (const entry of entries) {
      list.appendChild(buildEntry(entry))
    }
    resultsEl.appendChild(list)
  }
}

// ---------------------------------------------------------------------------
// Open / close / rerender
// ---------------------------------------------------------------------------

/**
 * Open the gallery modal.
 * @param {HTMLElement} triggerEl
 */
export function open(triggerEl) {
  close()
  returnFocus = triggerEl
  searchTerm = ''
  confirmingDeleteId = null
  editingEntryId = null

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
  searchTerm = ''
  confirmingDeleteId = null
  editingEntryId = null
  resultsEl = null
}

/**
 * Re-render the modal content.
 */
function rerender() {
  if (!scrimEl) return
  const oldModal = scrimEl.querySelector('.modal')
  if (oldModal) oldModal.remove()
  scrimEl.appendChild(buildModal())
  if (releaseTrap) {
    releaseTrap()
  }
  const firstBtn = scrimEl.querySelector('button')
  releaseTrap = trapFocus(scrimEl, /** @type {HTMLElement | null} */ (firstBtn))
}

/**
 * @param {KeyboardEvent} ev
 */
function onEsc(ev) {
  if (ev.key === 'Escape') {
    ev.stopPropagation()
    // If confirming or editing, cancel that first
    if (confirmingDeleteId) {
      confirmingDeleteId = null
      rerender()
      return
    }
    if (editingEntryId) {
      editingEntryId = null
      rerender()
      return
    }
    close()
  }
}

/**
 * @returns {boolean}
 */
export function isOpen() {
  return scrimEl !== null
}