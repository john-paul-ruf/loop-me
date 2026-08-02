// @ts-check
/**
 * Error taxonomy and the report channel (architecture §12.2, FR-18).
 *
 * Every failure the user can provoke gets a code. `ui/strings.js` maps each
 * code to a message in Designer's voice — keeping the mapping in exactly one
 * auditable place is what stops codec, engine and browser vocabulary leaking
 * into a banner (Designer §6 Voice).
 *
 * **The channel is pub/sub, not `throw`.** This is load-bearing. `painter.js`
 * calls `report()` from inside its per-layer `try/catch`, once per frame, on a
 * path whose entire purpose is that a broken layer cannot stop the loop
 * (FR-18: "no unhandled exception can leave the canvas blank or the render
 * loop stopped"). If reporting could itself throw, that guarantee would be
 * circular. So `report()` catches everything, including a subscriber that
 * throws, and always returns normally.
 *
 * This module imports nothing — `core/*` depends only on `util/*`
 * (architecture §4 rule 1), and this file does not even need that.
 */

// ---------------------------------------------------------------------------
// The nine codes (architecture §12.2)
// ---------------------------------------------------------------------------

/** Unrecognized version prefix. The codec's only hard failure. */
export const SEED_VERSION = 'SEED_VERSION'
/** base64url, inflate, or JSON parse failure. */
export const SEED_MALFORMED = 'SEED_MALFORMED'
/** Structurally short payload — the shape decoded but the content is missing. */
export const SEED_TRUNCATED = 'SEED_TRUNCATED'
/** Over 4,000 characters on encode. Sharing is warned about, never blocked. */
export const SEED_TOO_LONG = 'SEED_TOO_LONG'
/** Unknown layer type ID in a seed. That layer is skipped; the rest renders. */
export const LAYER_UNKNOWN_TYPE = 'LAYER_UNKNOWN_TYPE'
/** Exception inside a layer's `draw()`. The layer is fenced off; the loop survives. */
export const LAYER_DRAW_FAILED = 'LAYER_DRAW_FAILED'
/** `localStorage` absent or throwing. Save is disabled; everything else works. */
export const STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE'
/** Quota exceeded on write. Explicit message, never a silent failure. */
export const STORAGE_QUOTA = 'STORAGE_QUOTA'
/** Clipboard API missing or denied. Falls back to a selected readonly input. */
export const CLIPBOARD_UNAVAILABLE = 'CLIPBOARD_UNAVAILABLE'

/**
 * Every code, in the order architecture §12.2 lists them. Unlike the algorithm,
 * layer-type and blend registries, this ordering carries no wire meaning — no
 * seed stores an error code — so it is documentation, not a contract.
 */
export const ERROR_CODES = Object.freeze([
  SEED_VERSION,
  SEED_MALFORMED,
  SEED_TRUNCATED,
  SEED_TOO_LONG,
  LAYER_UNKNOWN_TYPE,
  LAYER_DRAW_FAILED,
  STORAGE_UNAVAILABLE,
  STORAGE_QUOTA,
  CLIPBOARD_UNAVAILABLE,
])

/** @typedef {(typeof ERROR_CODES)[number]} ErrorCode */

const CODE_SET = new Set(ERROR_CODES)

/**
 * Is `v` one of the nine? Used at the UI boundary so an unmapped code renders
 * a generic message instead of an empty banner.
 *
 * @param {unknown} v
 * @returns {v is ErrorCode}
 */
export function isErrorCode(v) {
  return typeof v === 'string' && CODE_SET.has(/** @type {ErrorCode} */ (v))
}

/**
 * One reported failure.
 *
 * `detail` is free-form context for the *message*, never for control flow —
 * the layer index for `LAYER_DRAW_FAILED`, the offending version string for
 * `SEED_VERSION`. It is deliberately not typed per code: adding structure here
 * would put message-shaping knowledge in `core/`, and `core/` must not know
 * what a sentence looks like.
 *
 * @typedef {object} ErrorReport
 * @property {ErrorCode|string} code
 * @property {unknown} detail
 */

/** @typedef {(report: ErrorReport) => void} ReportListener */

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

/**
 * A coded exception, for the rare places that genuinely must unwind — the
 * codec rejecting an unrecognized seed version being the only one in the
 * project (architecture §9.5). Everything else reports and carries on.
 */
export class AppError extends Error {
  /**
   * @param {ErrorCode|string} code
   * @param {string} [message] Developer-facing. The *user* sees ui/strings.js.
   * @param {unknown} [detail]
   */
  constructor(code, message, detail) {
    super(message ?? code)
    this.name = 'AppError'
    /** @type {ErrorCode|string} */
    this.code = code
    /** @type {unknown} */
    this.detail = detail ?? null
  }
}

// ---------------------------------------------------------------------------
// The report channel
// ---------------------------------------------------------------------------

/**
 * How many reports to hold for a subscriber that does not exist yet.
 *
 * Boot step 4 decodes the seed, and a decode failure must reach the user
 * (FR-18) — but `ui/feedback.js` is constructed later in the sequence
 * (architecture §7). Without a small replay buffer, the single most important
 * error in the product ("that link didn't survive the trip") would be reported
 * into a void. The cap keeps a pathological loop from growing it without
 * bound; a run that reports more than sixteen distinct failures before the UI
 * exists has worse problems than a dropped banner.
 */
const REPLAY_CAP = 16

/** @type {Set<ReportListener>} */
const listeners = new Set()

/** @type {ErrorReport[]} */
const pending = []

/**
 * Report a failure. **Never throws, never unwinds** — see the module note.
 *
 * @param {ErrorCode|string} code
 * @param {unknown} [detail]
 * @returns {ErrorReport} The report, so a caller can log or assert on it.
 */
export function report(code, detail) {
  /** @type {ErrorReport} */
  const r = { code, detail: detail === undefined ? null : detail }
  try {
    if (listeners.size === 0) {
      if (pending.length < REPLAY_CAP) pending.push(r)
      return r
    }
    for (const fn of listeners) {
      try {
        fn(r)
      } catch {
        // A subscriber that throws is a bug in the subscriber. It must not
        // propagate into the render loop that called report().
      }
    }
  } catch {
    // Unreachable in practice — every inner call is already fenced. Present
    // because "report() cannot throw" is a guarantee other modules rely on,
    // and a guarantee with an escape hatch is not one.
  }
  return r
}

/**
 * Subscribe. Any reports made while nobody was listening are replayed
 * immediately, in order, to this listener.
 *
 * @param {ReportListener} fn
 * @returns {() => void} Unsubscribe.
 */
export function onReport(fn) {
  listeners.add(fn)
  if (pending.length > 0) {
    const drained = pending.splice(0, pending.length)
    for (const r of drained) {
      try {
        fn(r)
      } catch {
        // Same reasoning as in report(): a broken subscriber is contained.
      }
    }
  }
  return () => {
    listeners.delete(fn)
  }
}
