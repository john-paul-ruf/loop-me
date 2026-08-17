// @ts-check
/**
 * The painter (architecture §6.4, FR-5, FR-18).
 *
 * Background fill (not a layer), then per-layer: resolve → save → composite +
 * alpha → fenced draw → restore. Explicit state reset before and after the
 * loop, so composite op, alpha and transform cannot leak between layers or
 * frames. A throwing layer is marked `errored`, skipped from then on, and
 * reported — it fails loudly in the UI and quietly in the pixels.
 *
 * The target ctx is injected (`setTarget`), so tests paint into a detached
 * canvas and `main.js` wires the visible one at boot. Allocates nothing per
 * frame (§6.5).
 *
 * Imports `core/state.js`, `core/errors.js`, `model/blend.js`,
 * `model/registry.js`, and its render siblings.
 */

import { state } from '../core/state.js'
import { report, LAYER_DRAW_FAILED } from '../core/errors.js'
import { BLEND_OPS } from '../model/blend.js'
import { get } from '../model/registry.js'
import { slotsFor, resolveLayer } from './resolve.js'
import { getPrepared } from './prepare.js'
import { WIDTH, HEIGHT } from './canvas.js'

/** @type {CanvasRenderingContext2D | null} */
let ctx = null

/**
 * Inject the rendering target. Boot step 8 passes the visible canvas's ctx;
 * tests pass a detached one.
 *
 * @param {CanvasRenderingContext2D | null} target
 */
export function setTarget(target) {
  ctx = target
}

/**
 * Paint one frame. Reads `state.composition` and `state.palette`; a missing
 * target or composition is a no-op, never a throw.
 *
 * @param {number} frame        Fractional current frame (FR-1).
 * @param {number} totalFrames
 */
export function paint(frame, totalFrames) {
  const c = state.composition
  const palette = state.palette
  if (ctx === null || c === null || palette === null) return

  // Explicit reset before the loop (§6.4).
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1

  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const layers = c.layers
  const slots = slotsFor(c)

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (layer.errored === true) continue
    if (layer.visible === false) continue // hidden (FR-5 ext) — resolve/draw skipped; export inherits via paint()
    const mod = get(layer.type)
    if (mod === null) continue

    const alpha = resolveLayer(layer, frame, totalFrames, slots[i])

    ctx.save()
    ctx.globalCompositeOperation = BLEND_OPS[layer.blend]
    ctx.globalAlpha = alpha
    try {
      mod.draw(ctx, slots[i], getPrepared(i), palette)
    } catch (e) {
      layer.errored = true
      report(LAYER_DRAW_FAILED, { index: i, phase: 'draw', error: e })
    } finally {
      ctx.restore()
    }
  }

  // Explicit reset after the loop (§6.4).
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}
