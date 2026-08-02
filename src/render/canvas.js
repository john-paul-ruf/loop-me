// @ts-check
/**
 * Canvas acquisition and stage background (architecture §6.1, FR-1).
 *
 * The backing store is always exactly 1080×1920, set once and never changed —
 * not for DPR, not for resize. Fit-scaling is pure CSS. The letterbox colour
 * is `--stage-bg` on the stage element, rewritten whenever the scheme changes.
 *
 * Imports `core/state.js` only.
 */

import { state, subscribe, TOPICS } from '../core/state.js'

/** The fixed internal coordinate space (FR-1). */
export const WIDTH = 1080
/** @see WIDTH */
export const HEIGHT = 1920

/** @type {HTMLCanvasElement | null} */
let canvasEl = null
/** @type {HTMLElement | null} */
let stageEl = null
/** @type {CanvasRenderingContext2D | null} */
let ctx = null
let subscribed = false

/**
 * Acquire the canvas and stage. Elements may be passed explicitly (tests use
 * detached ones); by default they are looked up in the document. Sets the
 * backing-store size to exactly 1080×1920 — the one and only place that does.
 *
 * Also subscribes to the composition topic so the stage background tracks the
 * active scheme (§6.1). Idempotent: repeat calls rebind elements but never
 * add a second subscription.
 *
 * @param {{ canvas?: HTMLCanvasElement, stage?: HTMLElement }} [els]
 * @returns {CanvasRenderingContext2D | null}
 */
export function init(els = {}) {
  const c = els.canvas ?? document.getElementById('canvas')
  const s = els.stage ?? document.getElementById('stage')
  canvasEl = c instanceof HTMLCanvasElement ? c : null
  stageEl = s instanceof HTMLElement ? s : null
  ctx = null

  if (canvasEl !== null) {
    // Once, never again (§6.1). Assigning width/height clears a canvas, so
    // guard: only touch it when it is wrong.
    if (canvasEl.width !== WIDTH) canvasEl.width = WIDTH
    if (canvasEl.height !== HEIGHT) canvasEl.height = HEIGHT
    ctx = canvasEl.getContext('2d')
  }

  if (!subscribed) {
    subscribed = true
    subscribe(TOPICS.COMPOSITION, applyStageBackground)
  }
  applyStageBackground()
  return ctx
}

/** @returns {CanvasRenderingContext2D | null} */
export function context() {
  return ctx
}

/**
 * Write the letterbox colour. Dynamic styling goes through
 * `style.setProperty` (CSSOM), which the CSP does not govern (§11.2).
 *
 * @param {string} color `#RRGGBB`
 */
export function setStageBackground(color) {
  if (stageEl === null) return
  stageEl.style.setProperty('--stage-bg', color)
}

/** Re-read the palette and update the stage. The composition-topic handler. */
function applyStageBackground() {
  if (state.palette !== null) setStageBackground(state.palette.background)
}
