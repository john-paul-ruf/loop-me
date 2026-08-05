// @ts-check
/**
 * Share & save modal (mocks/share.html, FR-12, FR-13, FR-14).
 *
 * Copy Link is the primary action; Copy Seed is secondary. The character
 * meter turns amber past 3,000 and warns before the 4,000 ceiling. When the
 * composition uses a custom scheme, a banner explains it's baked in.
 *
 * Save to gallery: a textarea for an optional description, then Save.
 *
 * Paste Seed: accepts a bare seed, a full URL, or either with whitespace.
 * On load, decodes the seed and replaces the current composition. On
 * failure, the error channel surfaces a banner and the current composition
 * is untouched.
 *
 * Clipboard failure falls back to a selected readonly input with the
 * "press \u2318C" hint (FR-13, CLIPBOARD_UNAVAILABLE).
 *
 * Imports `ui/dom.js`, `ui/strings.js`, `ui/controls/seed-field.js`,
 * `core/state.js`, `seed/codec.js`, `seed/hash.js`, `store/gallery.js`,
 * `util/clipboard.js`, `ui/feedback.js`. All legal edges (§4).
 */

import { el, trapFocus } from '../dom.js'
import { SHARE, fmt } from '../strings.js'
import { state } from '../../core/state.js'
import { encode, decode } from '../../seed/codec.js'
import { parseSeed } from '../../seed/hash.js'
import * as gallery from '../../store/gallery.js'
import { copy as copyToClipboard } from '../../util/clipboard.js'
import { toast, toastKey } from '../feedback.js'
import * as actions from '../../core/actions.js'
import * as clock from '../../core/clock.js'
import * as governor from '../../render/governor.js'
import * as videoExport from '../../render/export.js'
import { DURATIONS } from '../../model/composition.js'

/**
 * @typedef {import('../../model/params.js').Composition} Composition
 * @typedef {import('../../model/params.js').Scheme} Scheme
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
/** @type {string | null} */
let currentSeed = null
/** @type {string | null} */
let currentUrl = null
/** Active export handle; null when idle. Closing the modal cancels this. */
/** @type {{ cancel: () => void } | null} */
let exportHandle = null
/**
 * Blob + filename waiting for a user click to download. Set when encoding
 * finishes; cleared on save or modal close. The download cannot be
 * triggered from the async encode completion — browsers drop programmatic
 * `<a download>` clicks once transient user activation has expired.
 * @type {{ blob: Blob, filename: string } | null}
 */
let pendingDownload = null

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Is the current composition's scheme a custom (embedded) scheme?
 * @returns {boolean}
 */
function hasCustomScheme() {
  const c = state.composition
  if (!c) return false
  return typeof c.scheme !== 'number'
}

/**
 * Get the custom scheme's name, if any.
 * @returns {string}
 */
function customSchemeName() {
  const c = state.composition
  if (!c || typeof c.scheme === 'number') return ''
  return /** @type {Scheme} */ (c.scheme).name
}

/**
 * Build the full modal DOM.
 * @returns {HTMLElement}
 */
function buildModal() {
  /** @type {HTMLElement[]} */
  const children = []

  // Header
  children.push(el('div', { class: 'between mb-4' }, [
    el('h1', { class: 'modal__title m-0', id: 'sh-title', text: SHARE.title }),
    el('button', {
      class: 'btn btn--icon',
      'aria-label': 'Close',
      text: '\u2715',
      on: { click: () => close() },
    }),
  ]))

  // --- Link field ---
  const linkInput = el('input', {
    class: 'input input--mono',
    id: 'url',
    readonly: true,
    value: currentUrl ?? '',
    placeholder: '\u2026',
  })
  const linkCopyBtn = el('button', {
    class: 'btn btn--primary btn--fixed',
  }, [
    el('span', { class: 'btn__glyph', 'aria-hidden': 'true', text: '\u29C9' }),
    document.createTextNode(' ' + SHARE.copyLink),
  ])
  linkCopyBtn.addEventListener('click', async () => {
    if (!currentUrl) return
    const ok = await copyToClipboard(currentUrl)
    if (ok) {
      toastKey('linkCopied')
    } else {
      // Fallback: select the input
      linkInput.removeAttribute('readonly')
      linkInput.focus()
      linkInput.select()
      linkInput.setAttribute('readonly', 'true')
      toast('Copying isn\u2019t available here \u2014 press \u2318C / Ctrl+C')
    }
  })

  children.push(el('div', { class: 'field' }, [
    el('label', { class: 'label', for: 'url', text: SHARE.linkLabel }),
    el('div', { class: 'seedbox' }, [linkInput, linkCopyBtn]),
    el('p', { class: 'hint', text: SHARE.linkHint }),
  ]))

  // --- Seed-only field ---
  const seedInput = el('input', {
    class: 'input input--mono',
    id: 'seed',
    readonly: true,
    value: currentSeed ?? '',
    placeholder: '\u2026',
  })
  const seedCopyBtn = el('button', {
    class: 'btn btn--fixed',
  }, [
    el('span', { class: 'btn__glyph', 'aria-hidden': 'true', text: '\u29C9' }),
  ])
  seedCopyBtn.addEventListener('click', async () => {
    if (!currentSeed) return
    const ok = await copyToClipboard(currentSeed)
    if (ok) {
      toastKey('seedCopied')
    } else {
      seedInput.removeAttribute('readonly')
      seedInput.focus()
      seedInput.select()
      seedInput.setAttribute('readonly', 'true')
      toast('Copying isn\u2019t available here \u2014 press \u2318C / Ctrl+C')
    }
  })

  // Seed meter
  const seedLen = currentSeed ? currentSeed.length : 0
  const seedPct = Math.min(100, (seedLen / 4000) * 100)
  const meterFill = el('div', { class: 'seed-meter__fill' })
  meterFill.style.setProperty('--meter-fill', seedPct + '%')
  if (seedLen > 3000) {
    meterFill.classList.add('seed-meter__fill--warn')
  }
  const meterCount = el('span', { class: 'mono', text: seedLen + ' characters' })
  if (seedLen > 3000) {
    meterCount.classList.add('seed-meter__count--warn')
  }

  children.push(el('div', { class: 'field' }, [
    el('label', { class: 'label', for: 'seed', text: SHARE.seedLabel }),
    el('div', { class: 'seedbox' }, [seedInput, seedCopyBtn]),
    el('div', { class: 'seed-meter' }, [
      el('div', { class: 'seed-meter__bar' }, [meterFill]),
      meterCount,
    ]),
  ]))

  // --- Custom scheme banner ---
  if (hasCustomScheme()) {
    children.push(el('div', { class: 'banner' }, [
      el('span', { class: 'banner__icon', 'aria-hidden': 'true', text: '\u25C8' }),
      el('div', { class: 'banner__body' }, [
        el('div', { class: 'banner__title', text: fmt(SHARE.customSchemeBaked, { name: customSchemeName() }) }),
        el('div', { text: SHARE.customSchemeBakedBody }),
      ]),
    ]))
  }

  // --- Divider ---
  children.push(el('div', { class: 'divider' }))

  // --- Download video (FR-19) ---
  const c = state.composition
  const durSec = c ? DURATIONS[c.durationId] : DURATIONS[0]
  const supported = videoExport.isExportSupported()
  const exportBtn = /** @type {HTMLButtonElement} */ (el('button', { class: 'btn btn--block', disabled: !supported }, [
    el('span', { class: 'btn__glyph', 'aria-hidden': 'true', text: '\u2B73' }),
    document.createTextNode(' ' + fmt(SHARE.exportButton, { duration: durSec })),
  ]))
  const exportHint = el('p', {
    class: 'hint',
    text: supported ? SHARE.exportHint : SHARE.exportUnsupported,
  })

  const exportIdleLabel = fmt(SHARE.exportButton, { duration: durSec })
  /** @type {boolean} */
  let exportEncoding = false

  /**
   * @param {string} text
   */
  function setExportLabel(text) {
    const span = exportBtn.querySelector('.btn__glyph')
    while (exportBtn.lastChild) exportBtn.removeChild(exportBtn.lastChild)
    if (span) exportBtn.appendChild(span)
    exportBtn.appendChild(document.createTextNode(' ' + text))
  }

  function resetExportButton() {
    exportEncoding = false
    exportHandle = null
    pendingDownload = null
    exportBtn.disabled = !supported
    setExportLabel(exportIdleLabel)
    exportHint.textContent = supported ? SHARE.exportHint : SHARE.exportUnsupported
  }

  exportBtn.addEventListener('click', () => {
    if (pendingDownload) {
      videoExport.downloadBlob(pendingDownload.blob, pendingDownload.filename)
      pendingDownload = null
      toastKey('exportDone')
      resetExportButton()
      return
    }
    if (exportEncoding || exportHandle) return

    exportEncoding = true
    exportBtn.disabled = true
    exportHandle = videoExport.startExport({
      durationSeconds: durSec,
      seed: currentSeed,
      onProgress: (pct) => {
        setExportLabel(fmt(SHARE.exportRecording, { pct }))
      },
      onDone: (blob, filename) => {
        exportHandle = null
        exportEncoding = false
        pendingDownload = { blob, filename }
        exportBtn.disabled = false
        setExportLabel(SHARE.exportSave)
        exportHint.textContent = SHARE.exportReadyHint
      },
      onError: () => {
        toastKey('exportFailed')
        resetExportButton()
      },
    })
    if (!exportHandle) {
      toastKey('exportFailed')
      resetExportButton()
    }
  })
  children.push(el('div', { class: 'field' }, [
    el('label', { class: 'label', text: SHARE.exportLabel }),
    exportBtn,
    exportHint,
  ]))

  // --- Divider ---
  children.push(el('div', { class: 'divider' }))

  // --- Save to gallery ---
  const descInput = el('textarea', {
    class: 'textarea',
    id: 'desc',
    placeholder: SHARE.savePlaceholder,
  })
  const saveBtn = el('button', {
    class: 'btn btn--primary btn--block mt-2',
  }, [
    el('span', { class: 'btn__glyph', 'aria-hidden': 'true', text: '\u2665' }),
    document.createTextNode(' ' + SHARE.saveButton),
  ])
  saveBtn.addEventListener('click', () => {
    if (!currentSeed) return
    const c = state.composition
    const dur = c ? c.durationId : 0
    const entry = gallery.save(currentSeed, descInput.value, dur)
    if (entry) {
      toastKey('saved')
      descInput.value = ''
    } else {
      toast('Couldn\u2019t save \u2014 your browser\u2019s storage may be full or unavailable.')
    }
  })

  children.push(el('div', { class: 'field' }, [
    el('label', { class: 'label', for: 'desc', text: SHARE.saveLabel }),
    descInput,
    saveBtn,
  ]))

  // --- Divider ---
  children.push(el('div', { class: 'divider' }))

  // --- Paste seed ---
  const pasteInput = el('input', {
    class: 'input input--mono',
    id: 'paste',
    placeholder: SHARE.pastePlaceholder,
  })
  const loadBtn = el('button', {
    class: 'btn btn--fixed',
    text: SHARE.pasteButton,
  })
  loadBtn.addEventListener('click', async () => {
    const raw = pasteInput.value
    const seed = parseSeed(raw)
    if (!seed) return

    try {
      const comp = await decode(seed)
      actions.loadComposition(comp)
      governor.reset()
      clock.resetEpoch()
      close()
    } catch {
      // decode() reports on the channel; the banner surfaces.
      // Stay open so the user can try again.
      pasteInput.value = ''
    }
  })
  // Also handle Enter in the paste field
  pasteInput.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      loadBtn.click()
    }
  })

  children.push(el('div', { class: 'field m-0' }, [
    el('label', { class: 'label', for: 'paste', text: SHARE.pasteLabel }),
    el('div', { class: 'seedbox' }, [pasteInput, loadBtn]),
    el('p', { class: 'hint', text: SHARE.pasteHint }),
  ]))

  return el('div', {
    class: 'modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'sh-title',
  }, children)
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/**
 * Open the share modal.
 * @param {HTMLElement} triggerEl
 */
export async function open(triggerEl) {
  close()
  returnFocus = triggerEl

  // Encode the current composition to populate the fields
  const c = state.composition
  if (c) {
    try {
      currentSeed = await encode(c)
      currentUrl = location.origin + location.pathname + '#s=' + currentSeed
    } catch {
      currentSeed = null
      currentUrl = null
    }
  }

  scrimEl = el('div', { class: 'scrim' }, [buildModal()])
  document.body.appendChild(scrimEl)

  const firstBtn = scrimEl.querySelector('button')
  releaseTrap = trapFocus(scrimEl, /** @type {HTMLElement | null} */ (firstBtn))
  scrimEl.addEventListener('keydown', onEsc, true)
}

/**
 * Close the modal. Cancels an in-flight export (D9 — never leave a recorder
 * running) before tearing down the DOM.
 */
export function close() {
  if (exportHandle) {
    exportHandle.cancel()
    exportHandle = null
  }
  pendingDownload = null
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