// @ts-check
/**
 * The prepare cache and its invalidation (architecture §6.3, §13 Q4).
 *
 * One `prepared` object per layer index, rebuilt when — and only when — the
 * layer's **static** params, colour ref, `rngSeed`, or the scheme change.
 * `core/actions.js` marks `state.dirty[i]`; `flushDirty()` drains it at the
 * top of the frame. A rebuild completes into a fully-built object *before*
 * the reference is swapped, so a slider drag can never expose a half-built
 * cache.
 *
 * The `statics` object handed to a layer's `prepare(statics, palette, rng)`
 * carries every **S** param by name plus one reserved key, `color` — the
 * layer's resolved `#RRGGBB` string. `color` is an envelope field, so no
 * declared param can collide with it (same reasoning as Flag 4 in resolve.js).
 *
 * §13 Q4 (`OffscreenCanvas` vs detached `<canvas>`) stays behind this module:
 * `createScratchCanvas` below is the single place the choice lives, and
 * swapping it is a one-line change. Layers cannot import render/* (§4 rule 2),
 * so it is injected as the reserved `statics.scratch` key (D4) — typed as
 * `Statics` in model/params.js. D1 predicted Grain as the only consumer; in
 * fact all four overlays need it, because §6.5 bans creating gradients and
 * patterns in `draw` and a gradient cannot be minted without *some* context.
 *
 * Imports `core/state.js`, `core/errors.js`, `core/rng.js`,
 * `model/registry.js`, `model/params.js`.
 */

import { state } from '../core/state.js'
import { report, LAYER_DRAW_FAILED } from '../core/errors.js'
import { mulberry32 } from '../core/rng.js'
import { get } from '../model/registry.js'
import { isAnimatable } from '../model/params.js'

/**
 * @typedef {import('../model/params.js').Prepared} Prepared
 * @typedef {import('../model/params.js').Statics} Statics
 */

/** @type {(Prepared | null)[]} */
let prepared = []

/**
 * A detached scratch canvas (§13 Q4). Detached `<canvas>` rather than
 * `OffscreenCanvas`: prepare runs on the main thread either way, so the
 * difference is cosmetic, and a detached element is universally safe.
 * Swapping this one function is the whole migration.
 *
 * @param {number} w
 * @param {number} h
 * @returns {HTMLCanvasElement}
 */
export function createScratchCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * Rebuild one layer's prepared object. Returns the fresh object, or `null`
 * (with the layer fenced) if the type is unknown or its `prepare` threw.
 *
 * @param {number} i
 * @returns {Prepared | null}
 */
function build(i) {
  const c = state.composition
  const palette = state.palette
  if (c === null || palette === null) return null
  const layer = c.layers[i]
  if (layer === undefined) return null

  const mod = get(layer.type)
  if (mod === null) return null

  /** @type {Statics} */
  const statics = {
    color: palette.layerColors[i] ?? '#FFFFFF',
    scratch: createScratchCanvas,
  }
  for (const decl of mod.params) {
    if (!isAnimatable(decl)) {
      statics[decl.name] = /** @type {number|boolean|string} */ (layer.params[decl.name])
    }
  }

  try {
    return mod.prepare(statics, palette, mulberry32(layer.rngSeed))
  } catch (e) {
    // Same fence as the painter's (FR-18): a broken layer fails loudly in the
    // UI and quietly in the pixels, never by taking the loop down.
    layer.errored = true
    report(LAYER_DRAW_FAILED, { index: i, phase: 'prepare', error: e })
    return null
  }
}

/**
 * Rebuild every layer's cache and clear all dirty flags. Boot step 5 — runs
 * behind the splash, into detached state only (architecture §7).
 */
export function prewarm() {
  const c = state.composition
  if (c === null) {
    prepared = []
    return
  }
  const n = c.layers.length
  prepared = new Array(n)
  for (let i = 0; i < n; i++) {
    prepared[i] = build(i)
    state.dirty[i] = false
  }
}

/**
 * Rebuild any invalidated caches. Runs at the top of every frame (§6.2).
 * A layer-count change (add/delete/reorder marks all dirty anyway) resizes
 * the array and rebuilds everything.
 */
export function flushDirty() {
  const c = state.composition
  if (c === null) return
  const n = c.layers.length
  if (prepared.length !== n) {
    prewarm()
    return
  }
  for (let i = 0; i < n; i++) {
    if (state.dirty[i] === true) {
      prepared[i] = build(i)
      state.dirty[i] = false
    }
  }
}

/**
 * @param {number} i
 * @returns {Prepared | null}
 */
export function getPrepared(i) {
  return prepared[i] ?? null
}
