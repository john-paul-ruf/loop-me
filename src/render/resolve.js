// @ts-check
/**
 * Per-frame parameter resolution (architecture §5.2, §6.5).
 *
 * Walks a layer's param declarations in order: **A** params run through
 * `findValue`, **S** params pass straight through, all written into a
 * preallocated, reused `slots[i]` object keyed by param name. Allocates
 * nothing on the frame path.
 *
 * ## Flag 4 — the `opacity` collision, resolved structurally
 *
 * The layer envelope declares `opacity` (A 0.05–1.0) for every layer, and
 * FR-6 *also* declares an `opacity` param on Scan Lines and Grain. §6.4's
 * pseudocode reads `slots[i].opacity` for `globalAlpha`, which those two
 * layers would silently overwrite. The fix here: **the envelope's opacity
 * never enters the slot at all** — `resolveLayer` *returns* it, and the
 * painter sets `globalAlpha` from the return value. The slot namespace
 * belongs to declared params alone, so no declared name can ever collide
 * with the envelope. Layers keep reading `resolved.<name>` flat, per §5.1.
 *
 * Imports `core/value.js` and `model/registry.js`.
 */

import { findValue } from '../core/value.js'
import { get } from '../model/registry.js'

/**
 * @typedef {import('../model/params.js').Composition} Composition
 * @typedef {import('../model/params.js').Layer} Layer
 * @typedef {import('../model/params.js').AnimValue} AnimValue
 * @typedef {import('../model/params.js').Resolved} Resolved
 */

/** @type {Resolved[]} */
let slots = []

/**
 * The per-layer slot array for a composition — one reused object per layer
 * index, reallocated only when the layer count changes. Callers get the same
 * array back frame after frame (§6.5).
 *
 * @param {Composition} c
 * @returns {Resolved[]}
 */
export function slotsFor(c) {
  const n = c.layers.length
  if (slots.length !== n) {
    slots = new Array(n)
    for (let i = 0; i < n; i++) slots[i] = {}
  }
  return slots
}

/**
 * Fill `slot` with one frame's resolved values for `layer`, and return the
 * envelope opacity for the painter's `globalAlpha` (see the Flag 4 note).
 *
 * Unknown layer type: returns 0 and leaves the slot untouched — the painter
 * skips the layer anyway (FR-18).
 *
 * @param {Layer} layer
 * @param {number} frame        Fractional current frame (FR-1).
 * @param {number} totalFrames
 * @param {Resolved} slot       Preallocated; refilled in place.
 * @returns {number} The resolved envelope opacity, 0.05–1.0 (or 0 to skip).
 */
export function resolveLayer(layer, frame, totalFrames, slot) {
  const mod = get(layer.type)
  if (mod === null) return 0

  const decls = mod.params
  for (let i = 0; i < decls.length; i++) {
    const decl = decls[i]
    if (decl.kind === 'A') {
      const av = /** @type {AnimValue} */ (layer.params[decl.name])
      slot[decl.name] = findValue(av.min, av.max, av.times, totalFrames, frame, av.algorithm)
    } else {
      slot[decl.name] = /** @type {number|boolean|string} */ (layer.params[decl.name])
    }
  }

  const op = layer.opacity
  return findValue(op.min, op.max, op.times, totalFrames, frame, op.algorithm)
}
