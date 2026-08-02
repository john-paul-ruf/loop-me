// @ts-check
/**
 * Clipboard write, feature-probed.
 *
 * The Clipboard API is missing in insecure contexts and can be denied by
 * permission policy. Neither is exceptional here — FR-13 requires a working
 * fallback, so this module resolves `false` instead of throwing and the
 * caller runs the select-and-⌘C path from mocks/states.html.
 *
 * Reporting the failure to the user is `ui/feedback.js`'s job
 * (`CLIPBOARD_UNAVAILABLE`), not this module's.
 */

/**
 * Whether a clipboard write can even be attempted. Probed per call rather
 * than cached: permission state can change between calls.
 *
 * @returns {boolean}
 */
export function available() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard !== 'undefined' &&
    typeof navigator.clipboard.writeText === 'function' &&
    window.isSecureContext === true
  )
}

/**
 * Attempt to copy `text`. Never throws and never rejects.
 *
 * @param {string} text
 * @returns {Promise<boolean>} `true` only if the write is known to have succeeded.
 */
export async function copy(text) {
  if (!available()) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
