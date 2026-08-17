// @ts-check
/**
 * Toasts, banners, and the sole aria-live writer (architecture §12.3, FR-18).
 *
 * This module is the **only writer** to the single `aria-live="polite"` region
 * created in `index.html` (`#live`). Every toast announces through it, so state
 * is never conveyed by visual toast alone (Designer §3, accessibility §12.3).
 *
 * Banner styles (`banner`, `banner--warn`, `banner--error`) are defined in
 * `_tokens.css` §14. The `feedback` mount point (`#feedback`) is positioned
 * by `components.css` §7 — fixed above the dock, pointer-transparent, below
 * the splash's z-index.
 *
 * CSP compliance: all DOM is built through `dom.js`'s `el()` + `text()`.
 * No `innerHTML`, no `style=` attributes, no `<style>` blocks.
 *
 * Error codes arrive from `core/errors.js`'s report channel (§12.2). This
 * module subscribes to that channel and maps each code to a message via
 * `ui/strings.js`'s `ERRORS` table. The mapping is here, not in `core/`,
 * because `core/` must not know what a sentence looks like.
 */

import { el } from './dom.js'
import {
  ERRORS,
  UNKNOWN_ERROR,
  TOASTS,
  GOVERNOR,
  fmt,
} from './strings.js'
import {
  onReport,
  isErrorCode,
  STORAGE_UNAVAILABLE,
  STORAGE_QUOTA,
} from '../core/errors.js'
import { subscribe, TOPICS, state } from '../core/state.js'
import { get as getLayer } from '../model/registry.js'

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {HTMLElement | null} */
let feedbackMount = null
/** @type {HTMLElement | null} */
let liveRegion = null

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

/**
 * Show a transient toast and announce it via aria-live.
 * Auto-dismisses after 2.5 seconds.
 *
 * @param {string} message The message text (from TOASTS or a literal).
 * @param {number} [ms] Auto-dismiss duration, default 2500.
 */
export function toast(message, ms = 2500) {
  if (!feedbackMount) return

  const node = el('span', { class: 'toast' }, [
    el('span', { class: 'toast__tick', 'aria-hidden': 'true', text: '\u2713' }),
    el('span', { text: message }),
  ])

  feedbackMount.appendChild(node)
  announce(message)

  setTimeout(() => {
    if (node.parentElement) node.remove()
  }, ms)
}

/**
 * Show a toast from the TOASTS table by key.
 *
 * @param {keyof typeof TOASTS} key
 */
export function toastKey(key) {
  toast(TOASTS[key] ?? key)
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

/** @typedef {'info'|'warn'|'error'} BannerLevel */

/**
 * Show a dismissible banner in the feedback mount.
 * The banner stays until dismissed or explicitly removed.
 *
 * @param {string} title
 * @param {string} body
 * @param {BannerLevel} level
 * @param {boolean} [dismissible=true]
 * @param {() => void} [onDismiss] Called after the user removes the banner
 *   via its \u2715 \u2014 lets the owner clear its handle/bookkeeping. Not called on
 *   programmatic removal.
 * @returns {HTMLElement} The banner element (for programmatic removal).
 */
export function banner(title, body, level, dismissible = true, onDismiss) {
  if (!feedbackMount) return /** @type {HTMLElement} */ (null)

  const cls = level === 'warn'
    ? 'banner banner--warn'
    : level === 'error'
      ? 'banner banner--error'
      : 'banner'

  const icon = level === 'warn' ? '\u25B2'
    : level === 'error' ? '\u2715'
      : '\u25C8'

  const children = [
    el('span', { class: 'banner__icon', 'aria-hidden': 'true', text: icon }),
    el('div', { class: 'banner__body' }, [
      el('div', { class: 'banner__title', text: title }),
      el('div', { text: body }),
    ]),
  ]

  if (dismissible) {
    children.push(
      el('button', {
        class: 'btn btn--icon btn--sm',
        'aria-label': 'Dismiss',
        text: '\u2715',
        on: {
          click: () => {
            /** @type {HTMLElement} */ (node).remove()
            if (onDismiss) onDismiss()
          },
        },
      }),
    )
  }

  const node = el('div', { class: cls }, children)
  feedbackMount.appendChild(node)
  return node
}

// ---------------------------------------------------------------------------
// The aria-live region — the sole writer (architecture §12.3)
// ---------------------------------------------------------------------------

/**
 * Announce a message through the single aria-live region.
 * This is the only function in the app that writes to `#live`.
 *
 * @param {string} message
 */
export function announce(message) {
  if (!liveRegion) return
  // Clear and re-set to ensure the change is announced even if the message
  // is identical to the last one (screen readers may not re-announce
  // identical text without a change event).
  liveRegion.textContent = ''
  liveRegion.textContent = message
}

// ---------------------------------------------------------------------------
// Error channel subscription
// ---------------------------------------------------------------------------

/** @typedef {{ node: HTMLElement, remove: () => void }} BannerHandle */

/** @type {Map<string, BannerHandle>} */
const activeBanners = new Map()

/**
 * Handle a single error report from the channel.
 *
 * Some codes produce persistent banners (storage unavailable, storage
 * quota), others produce transient ones that the user dismisses.
 *
 * @param {{ code: string, detail: unknown }} r
 */
function handleReport(r) {
  const key = r.code
  const msg = isErrorCode(key) ? ERRORS[key] : UNKNOWN_ERROR

  let title = msg.title
  let body = msg.body

  // Interpolate detail into the body where relevant.
  if (key === 'SEED_VERSION' && r.detail) {
    body = fmt(body, { v: String(r.detail), c: '1' })
  } else if (key === 'SEED_TOO_LONG' && typeof r.detail === 'number') {
    body = fmt(body, { n: String(r.detail) })
  } else if (key === 'LAYER_DRAW_FAILED' && r.detail && typeof r.detail === 'object') {
    // The painter reports { index, phase, error }. Look up the layer name
    // from the registry so the user sees "Ray Rings" not "index 2".
    const detail = /** @type {{ index?: number, name?: string }} */ (r.detail)
    let name = detail.name ?? 'that layer'
    if (typeof detail.index === 'number') {
      const c = state.composition
      if (c && c.layers[detail.index]) {
        const mod = getLayer(c.layers[detail.index].type)
        if (mod) name = mod.meta.name
      }
    }
    body = fmt(body, { name })
  }

  // Storage codes produce persistent banners that stay until conditions
  // change. Others are dismissible by the user.
  const persistent = key === STORAGE_UNAVAILABLE || key === STORAGE_QUOTA

  // If a banner for this code is already showing, don't stack duplicates.
  if (activeBanners.has(key)) return

  // Route the ✕ through the same cleanup as the stored handle's remove(),
  // so a user dismiss clears the map key and a later report of the same
  // code produces a fresh banner (was: the key lingered forever, silently
  // suppressing every future report of that code for the session).
  const node = banner(title, body, msg.level, !persistent, () => {
    activeBanners.delete(key)
  })
  if (!node) return

  activeBanners.set(key, {
    node,
    remove: () => {
      node.remove()
      activeBanners.delete(key)
    },
  })

  // Also announce via aria-live.
  announce(title)
}

// ---------------------------------------------------------------------------
// Governor banner (FR-15)
//
// Per-episode dismiss semantics (layer-hide-and-fps-dismiss SESSION-02):
// the ✕ hides the banner for the current hot episode only. When the governor
// leaves WARN (`state.governorWarned → false`) the latch resets, so a new
// hot episode warns again. FR-15's purpose — the user finds out the piece
// is heavy — survives; the banner just stops being un-closable.
//
// Add-layer stays governor-disabled while `state.governorWarned` is true
// independently of the banner (see composition panel + strings.js
// `addLayerBlocked`); dismissing the banner does NOT re-enable Add-layer.
// ---------------------------------------------------------------------------

/** @type {BannerHandle | null} */
let governorBanner = null
/**
 * True from the moment the user dismisses the governor banner until the
 * governor leaves WARN. One hot episode = at most one banner (FR-15 ext);
 * a new episode warns again.
 */
let governorDismissed = false

/**
 * Handle the governor topic — show or hide the warning banner.
 *
 * @param {...unknown} args
 */
function handleGovernor(...args) {
  const warned = state.governorWarned

  if (warned && !governorBanner && !governorDismissed) {
    // The governor publishes (true/false, fps). Use the fps from the
    // publish args if available; fall back to 42 (the mock's placeholder).
    const fps = args.length > 1 && typeof args[1] === 'number'
      ? String(args[1])
      : '42'
    const title = GOVERNOR.title
    const body = fmt(GOVERNOR.body, { fps })
    const node = banner(title, body, 'warn', true, () => {
      // User ✕: drop the handle, latch the episode. The banner stays away
      // until the governor cools and re-enters WARN.
      governorBanner = null
      governorDismissed = true
    })
    if (node) {
      governorBanner = {
        node,
        remove: () => {
          node.remove()
          governorBanner = null
        },
      }
      announce(title)
    }
  } else if (!warned) {
    // Episode over — clear any showing banner AND reset the latch so the
    // next hot episode warns again (FR-15's purpose is intact).
    if (governorBanner) governorBanner.remove()
    governorDismissed = false
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** @type {(() => void)[]} */
let subscriptions = []

/**
 * Initialise the feedback system. Wires the error report channel, the
 * governor topic, and the DOM mount points.
 *
 * Called once during boot (main.js, F1). Safe to call multiple times —
 * re-init re-subscribes and re-binds without creating duplicates.
 *
 * @param {HTMLElement} feedbackEl The `#feedback` mount point.
 * @param {HTMLElement} liveEl The `#live` aria-live region.
 */
export function initFeedback(feedbackEl, liveEl) {
  // Clean up any prior init.
  for (const unsub of subscriptions) {
    try { unsub() } catch { /* already unsubscribed */ }
  }
  subscriptions = []

  // Clear existing banners from a prior session.
  for (const [, handle] of activeBanners) handle.remove()
  if (governorBanner) governorBanner.remove()
  governorDismissed = false

  feedbackMount = feedbackEl
  liveRegion = liveEl

  // Subscribe to the error channel. onReport replays any pending reports.
  subscriptions.push(onReport(handleReport))

  // Subscribe to the governor topic.
  subscriptions.push(subscribe(TOPICS.GOVERNOR, handleGovernor))
}

/**
 * Clear all feedback (banners + toasts). Used when opening/closing modals
 * to avoid stale banners persisting across modal transitions.
 */
export function clearFeedback() {
  if (!feedbackMount) return
  for (const [, handle] of activeBanners) handle.remove()
  if (governorBanner) governorBanner.remove()
  governorDismissed = false
  while (feedbackMount.firstChild) {
    feedbackMount.removeChild(feedbackMount.firstChild)
  }
}