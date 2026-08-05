// @ts-check
/**
 * One-loop video export via `captureStream` + `MediaRecorder` (FR-19,
 * architecture §6.1).
 *
 * Records exactly one loop-boundary-aligned cycle of the live 1080×1920
 * canvas at up to 30 fps, then downloads the blob.
 *
 * **Tier-1 caveats (accepted — see STATE.md D7/D8):**
 * - Capture is *realtime*: a 30 s loop takes 30 s to record.
 * - The tab must stay visible — background rAF throttling freezes the canvas.
 * - Dropped frames land in the file.
 * - The governor is NOT consulted and rendering is never altered (FR-15
 *   still holds — export observes pixels, never changes them).
 *
 * Container reality in 2026: Safari's MediaRecorder produces MP4 (H.264);
 * Chrome/Edge ≥ 126 support `video/mp4`; Chrome/Firefox otherwise produce
 * WebM. TikTok's web upload accepts MP4, WebM, and MOV — every branch is
 * uploadable. The mime order prefers the most widely-supported first.
 *
 * Imports only `./canvas.js`, `../core/clock.js` (render → render sibling
 * and render → core are legal §4 edges). The CSP is untouched: blob
 * `<a download>` is not governed by `connect-src`.
 */

import { getCanvas } from './canvas.js'
import * as clock from '../core/clock.js'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Mime candidates, most-compatible first. The predicate is injectable so
 * tests can exercise every branch without a real MediaRecorder.
 *
 * @param {(t: string) => boolean} [isSupported]
 * @returns {string | null} The first supported mime, or null when nothing matches.
 */
export function pickMimeType(isSupported = (t) =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
) {
  const candidates = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  for (const t of candidates) {
    if (isSupported(t)) return t
  }
  return null
}

/**
 * @param {string} mime
 * @returns {'mp4' | 'webm'}
 */
export function extensionFor(mime) {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
}

/**
 * Build a seed-tagged filename: `loop-me-15s-a1b2c3d4.webm`. The seed prefix
 * is the first 8 chars of the seed string (filename-safe base64url), or
 * 'loop' when the seed is null/empty/short.
 *
 * @param {number} durationSeconds
 * @param {string | null} seed
 * @param {'mp4' | 'webm'} ext
 * @returns {string}
 */
export function buildFilename(durationSeconds, seed, ext) {
  const prefix = seed && seed.length >= 8 ? seed.slice(0, 8) : 'loop'
  return 'loop-me-' + durationSeconds + 's-' + prefix + '.' + ext
}

/**
 * Is video export supported in this browser? Requires captureStream,
 * MediaRecorder, and a usable mime type.
 *
 * @returns {boolean}
 */
export function isExportSupported() {
  const cv = getCanvas()
  if (cv === null) return false
  if (typeof cv.captureStream !== 'function') return false
  if (typeof MediaRecorder === 'undefined') return false
  return pickMimeType() !== null
}

// ---------------------------------------------------------------------------
// Recording state
// ---------------------------------------------------------------------------

/** Module-level flag so two exports cannot interleave. */
let running = false

// ---------------------------------------------------------------------------
// startExport — record one loop, then download
// ---------------------------------------------------------------------------

/**
 * Record exactly one loop, then download it.
 *
 * Flow:
 *  1. Guard: unsupported or already running → onError + return null.
 *  2. Remember `wasPlaying`; if paused, resume (a frozen canvas records nothing).
 *  3. `captureStream(30)` + `MediaRecorder` at 12 Mbps; collect chunks.
 *  4. Subscribe `clock.onFrame`. Phase A: wait for the wrap (`frame < lastFrame`)
 *     → `recorder.start()`. Phase B: report `onProgress`; on the next wrap →
 *     `recorder.stop()` + unsubscribe. Wrap-to-wrap guarantees a
 *     boundary-aligned, seamlessly loopable file regardless of timer drift.
 *  5. `recorder.onstop`: build a Blob, click a JS-built `<a download>`, revoke
 *     the object URL, restore `wasPlaying`, call `onDone(filename)`.
 *  6. `cancel()`: unsubscribe, set a discard flag so `onstop` skips the
 *     download, stop the recorder, restore play state.
 *
 * @param {{
 *   durationSeconds: number,
 *   seed?: string | null,
 *   onProgress?: (pct: number) => void,
 *   onDone?: (filename: string) => void,
 *   onError?: (message: string) => void,
 * }} opts
 * @returns {{ cancel: () => void } | null} null if unsupported or already running.
 */
export function startExport(opts) {
  const onProgress = opts.onProgress ?? (() => {})
  const onDone = opts.onDone ?? (() => {})
  const onError = opts.onError ?? (() => {})

  // 1. Guard — unsupported or already running.
  if (!isExportSupported()) {
    onError('export not supported in this browser')
    return null
  }
  if (running) {
    onError('an export is already in progress')
    return null
  }
  const cv = getCanvas()
  if (cv === null) {
    onError('canvas not mounted')
    return null
  }
  const mime = pickMimeType()
  if (mime === null) {
    onError('no supported mime type')
    return null
  }
  const ext = extensionFor(mime)

  running = true
  let discard = false
  let unsub = /** @type {(() => void) | null} */ (null)

  // 2. Remember play state; resume if paused so a frozen canvas records nothing.
  const wasPlaying = clock.isPlaying()
  if (!wasPlaying) clock.resume()

  // 3. Build the recorder and collect chunks.
  /** @type {BlobPart[]} */
  const chunks = []
  /** @type {MediaRecorder} */
  let recorder
  try {
    const stream = cv.captureStream(30)
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 12_000_000,
    })
  } catch (err) {
    running = false
    if (!wasPlaying) clock.pause()
    onError('recorder setup failed: ' + (err instanceof Error ? err.message : String(err)))
    return null
  }

  recorder.addEventListener('dataavailable', (/** @type {BlobEvent} */ ev) => {
    if (ev.data.size > 0) chunks.push(ev.data)
  })

  // 5. onstop — build the blob and download, unless cancelled.
  recorder.addEventListener('stop', () => {
    if (unsub) { unsub(); unsub = null }
    running = false
    if (!wasPlaying) clock.pause()
    if (discard) {
      // Cancelled mid-flight: skip the download.
      return
    }
    const blob = new Blob(chunks, { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const filename = buildFilename(opts.durationSeconds, opts.seed ?? null, ext)
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    onDone(filename)
  })

  recorder.addEventListener('error', (/** @type {Event} */ ev) => {
    if (unsub) { unsub(); unsub = null }
    running = false
    if (!wasPlaying) clock.pause()
    const msg = ev instanceof ErrorEvent ? ev.message : 'media recorder error'
    onError(msg)
  })

  // 4. Subscribe to the frame clock. Phase A waits for the wrap that
  // starts the loop; Phase B reports progress and stops at the next wrap.
  let started = false
  let lastFrame = -1
  let totalFrames = 0
  unsub = clock.onFrame((frame, tf) => {
    totalFrames = tf
    if (!started) {
      // Phase A: wait for the wrap (frame < lastFrame) or for a legit 0 frame.
      if (lastFrame >= 0 && frame < lastFrame) {
        recorder.start()
        started = true
      }
      lastFrame = frame
      return
    }
    // Phase B: report progress, watch for the next wrap.
    if (totalFrames > 0) {
      const pct = Math.min(99, Math.round((frame / totalFrames) * 100))
      onProgress(pct)
    }
    if (frame < lastFrame) {
      // Wrap detected — stop the recorder; onstop fires and downloads.
      onProgress(100)
      recorder.stop()
      if (unsub) { unsub(); unsub = null }
    }
    lastFrame = frame
  })

  // 6. cancel — discard the download, stop the recorder, restore play state.
  function cancel() {
    if (!running) return
    discard = true
    if (unsub) { unsub(); unsub = null }
    try {
      if (recorder.state !== 'inactive') recorder.stop()
    } catch {
      // Swallow — recorder may already be stopping.
    }
    if (!wasPlaying) clock.pause()
    running = false
  }

  return { cancel }
}