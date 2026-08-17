// @ts-check
/**
 * The single mutation funnel (architecture §1).
 *
 * **Every state change goes through this module.** Views never mutate `state`
 * directly; they call an action here. Each mutating action:
 *
 *   1. Snapshots the current composition via `structuredClone` (undo, depth 1,
 *      FR-10).
 *   2. Mutates the composition.
 *   3. Marks `dirty[i] = true` when a **static** param, colour ref, `rngSeed`,
 *      or the scheme changed — the prepare-cache invalidation boundary
 *      (architecture §6.3).
 *   4. Publishes the relevant topic so views update.
 *
 * ## Why `core/actions.js` imports `model/` — and how the DAG is preserved
 *
 * Architecture §4 rule 1 says `core/*` imports only `util/*`. But `actions.js`
 * must call `createLayer`, `clampComposition`, `clone`, `buildPalette`, and the
 * motion functions to do its job — all in `model/`.
 *
 * The resolution is **dependency injection via `configure()`**. `main.js`
 * (session F1) passes the model functions into `configure()` at boot, before
 * any action is callable. `actions.js` stores them in module-private variables
 * and calls them through those variables. The import graph stays a DAG
 * because `core/actions.js` never imports `model/*` at the top level — the
 * only edge is `main.js → core/actions.js` (already present) and
 * `main.js → model/*` (already present).
 *
 * This module also imports `core/state.js` (same parent) and `core/errors.js`
 * for reporting — both are `core/*` internal edges, which are permitted.
 */

import { state, publish, TOPICS } from './state.js'

/**
 * @typedef {import('../model/params.js').Composition} Composition
 * @typedef {import('../model/params.js').Layer} Layer
 * @typedef {import('../model/params.js').Palette} Palette
 * @typedef {import('../model/params.js').AnimValue} AnimValue
 * @typedef {import('../model/params.js').ParamDecl} ParamDecl
 * @typedef {import('../model/params.js').ParamValue} ParamValue
 * @typedef {import('../model/params.js').Scheme} Scheme
 */

// ---------------------------------------------------------------------------
// Injected model dependencies
// ---------------------------------------------------------------------------

/** @type {{ createLayer: (id: number) => Layer | null, clone: (c: Composition) => Composition, clampComposition: (c: Composition) => { skipped: number, kept: number }, buildPalette: (scheme: number | Scheme, layers: readonly Layer[]) => Palette, totalFrames: (id: number) => number, coerceBlend: (id: unknown) => number } | null} */
let model = null

/**
 * Inject the model dependencies. Called once at boot from `main.js`.
 *
 * @param {{ createLayer: (id: number) => Layer | null, clone: (c: Composition) => Composition, clampComposition: (c: Composition) => { skipped: number, kept: number }, buildPalette: (scheme: number | Scheme, layers: readonly Layer[]) => Palette, totalFrames: (id: number) => number, coerceBlend: (id: unknown) => number }} deps
 */
export function configure(deps) {
  model = deps
}

/**
 * @returns {{ createLayer: (id: number) => Layer | null, clone: (c: Composition) => Composition, clampComposition: (c: Composition) => { skipped: number, kept: number }, buildPalette: (scheme: number | Scheme, layers: readonly Layer[]) => Palette, totalFrames: (id: number) => number, coerceBlend: (id: unknown) => number }}
 */
function m() {
  if (model === null) {
    throw new Error('actions: configure() has not been called — model deps are missing')
  }
  return model
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Snapshot the current composition for undo, then mutate. If there is no
 * composition yet (pre-boot), does nothing.
 */
function snapshot() {
  if (state.composition !== null) {
    state.undoSnapshot = m().clone(state.composition)
  }
}

/**
 * Mark a single layer's prepare cache dirty. Called when a static param,
 * colour ref, or `rngSeed` changes (architecture §6.3).
 *
 * @param {number} index
 */
function markDirty(index) {
  while (state.dirty.length <= index) state.dirty.push(false)
  state.dirty[index] = true
}

/**
 * Mark every layer dirty. Called on scheme change (re-resolves colours, which
 * are cached in `prepared`) and on composition load.
 */
function markAllDirty() {
  if (state.composition === null) return
  for (let i = 0; i < state.composition.layers.length; i++) {
    markDirty(i)
  }
}

/**
 * Rebuild the palette from the current composition and publish the composition
 * topic.
 */
function rebuildPaletteAndPublish() {
  if (state.composition === null) return
  state.palette = m().buildPalette(state.composition.scheme, state.composition.layers)
  publish(TOPICS.COMPOSITION)
  publish(TOPICS.SEED)
}

// ---------------------------------------------------------------------------
// Actions — composition-level
// ---------------------------------------------------------------------------

/**
 * Load a composition (from decode or randomize). Replaces the current state.
 * Marks every layer dirty so the prepare cache rebuilds. Resets undo.
 *
 * @param {Composition} c
 */
export function loadComposition(c) {
  // No undo snapshot for a load — loading is not an undoable action.
  state.composition = c
  state.undoSnapshot = null
  state.palette = m().buildPalette(c.scheme, c.layers)
  state.dirty = new Array(c.layers.length).fill(true)
  publish(TOPICS.COMPOSITION)
  publish(TOPICS.PLAYBACK) // duration may have changed
  publish(TOPICS.SEED)
}

/**
 * Undo the last mutation. Restores the snapshot. If there is no snapshot, does
 * nothing (FR-10: "undo of the last edit is available", not "undo is always
 * possible").
 */
export function undo() {
  if (state.undoSnapshot === null) return
  state.composition = state.undoSnapshot
  state.undoSnapshot = null // depth 1: no redo
  state.palette = m().buildPalette(state.composition.scheme, state.composition.layers)
  state.dirty = new Array(state.composition.layers.length).fill(true)
  publish(TOPICS.COMPOSITION)
  publish(TOPICS.SEED)
}

/**
 * Set the loop duration. Changing duration requires a clock epoch reset
 * (FR-2: "changing duration re-renders from frame 0"), which is why this
 * publishes the playback topic — the clock listens for it and resets.
 *
 * @param {number} durationId
 */
export function setDuration(durationId) {
  if (state.composition === null) return
  snapshot()
  state.composition.durationId = durationId
  publish(TOPICS.PLAYBACK) // clock resets epoch
  publish(TOPICS.SEED)
}

/**
 * Set the scheme. Re-resolves every layer's colours without altering any other
 * parameter (FR-7). Marks every layer dirty (colours are cached in `prepared`).
 *
 * @param {number | Scheme} scheme
 */
export function setScheme(scheme) {
  if (state.composition === null) return
  snapshot()
  state.composition.scheme = scheme
  markAllDirty()
  rebuildPaletteAndPublish()
}

/**
 * Randomize. The actual generation lives in `model/randomize.js` (D5); the
 * `randomize` action here receives the generated composition and loads it.
 * Until D5, `main.js` can call `loadComposition` directly.
 *
 * @param {Composition} c
 */
export function randomize(c) {
  loadComposition(c)
}

// ---------------------------------------------------------------------------
// Actions — layer-level
// ---------------------------------------------------------------------------

/**
 * Add a layer at the end. Accepts either a numeric **type id** (a default layer
 * of that type is created) or a **pre-built `Layer`** (inserted as-is — the
 * add-layer picker builds a taste-randomized one so a new layer never renders
 * blank, FR-6). Core does not import `model`, so a pre-built Layer is passed in
 * — same pattern as `randomizeLayer(index, layer)`. Blocked beyond 5 (FR-5).
 *
 * @param {number | Layer} typeIdOrLayer
 * @returns {boolean} `true` if the layer was added.
 */
export function addLayer(typeIdOrLayer) {
  if (state.composition === null) return false
  if (state.composition.layers.length >= 5) return false
  const layer = typeof typeIdOrLayer === 'number'
    ? m().createLayer(typeIdOrLayer)
    : typeIdOrLayer
  if (layer === null || typeof layer !== 'object') return false
  snapshot()
  state.composition.layers.push(layer)
  markDirty(state.composition.layers.length - 1)
  state.palette = m().buildPalette(state.composition.scheme, state.composition.layers)
  // Extend the dirty array
  while (state.dirty.length < state.composition.layers.length) state.dirty.push(false)
  publish(TOPICS.COMPOSITION)
  publish(TOPICS.SEED)
  return true
}

/**
 * Delete a layer by index. Blocked if it is the last remaining layer (FR-5).
 *
 * @param {number} index
 * @returns {boolean} `true` if the layer was deleted.
 */
export function deleteLayer(index) {
  if (state.composition === null) return false
  if (state.composition.layers.length <= 1) return false
  if (index < 0 || index >= state.composition.layers.length) return false
  snapshot()
  state.composition.layers.splice(index, 1)
  // Rebuild dirty array — all indices after the deleted one shift
  state.dirty = new Array(state.composition.layers.length).fill(true)
  state.palette = m().buildPalette(state.composition.scheme, state.composition.layers)
  publish(TOPICS.COMPOSITION)
  publish(TOPICS.SEED)
  return true
}

/**
 * Reorder a layer by swapping `index` with `index + dir`.
 *
 * @param {number} index
 * @param {number} dir -1 for up, +1 for down
 * @returns {boolean} `true` if the reorder happened.
 */
export function reorderLayer(index, dir) {
  if (state.composition === null) return false
  const layers = state.composition.layers
  const target = index + dir
  if (target < 0 || target >= layers.length) return false
  snapshot()
  const tmp = layers[index]
  layers[index] = layers[target]
  layers[target] = tmp
  // Reordering changes draw order, so rebuild all prepare caches
  state.dirty = new Array(layers.length).fill(true)
  state.palette = m().buildPalette(state.composition.scheme, layers)
  publish(TOPICS.COMPOSITION)
  publish(TOPICS.SEED)
  return true
}

/**
 * Duplicate a layer (insert a clone right after the original).
 * Blocked beyond 5 layers.
 *
 * @param {number} index
 * @returns {boolean}
 */
export function duplicateLayer(index) {
  if (state.composition === null) return false
  if (state.composition.layers.length >= 5) return false
  if (index < 0 || index >= state.composition.layers.length) return false
  snapshot()
  const dup = m().clone({
    durationId: state.composition.durationId,
    scheme: state.composition.scheme,
    layers: [state.composition.layers[index]],
  })
  state.composition.layers.splice(index + 1, 0, dup.layers[0])
  markDirty(index + 1)
  while (state.dirty.length < state.composition.layers.length) state.dirty.push(false)
  state.palette = m().buildPalette(state.composition.scheme, state.composition.layers)
  publish(TOPICS.COMPOSITION)
  publish(TOPICS.SEED)
  return true
}

/**
 * Set the blend mode of a layer.
 *
 * @param {number} index
 * @param {number} blendId
 */
export function setBlend(index, blendId) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  state.composition.layers[index].blend = m().coerceBlend(blendId)
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Set the colour reference of a layer. Marks the layer dirty (colour is cached
 * in `prepared`).
 *
 * @param {number} index
 * @param {string} colorRef
 */
export function setColorRef(index, colorRef) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  state.composition.layers[index].color = colorRef
  markDirty(index)
  state.palette = m().buildPalette(state.composition.scheme, state.composition.layers)
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Set a layer's visibility (envelope, seed-persisted). Hiding skips the layer
 * in the painter without touching its params — the non-destructive alternative
 * to deleteLayer. Does NOT mark dirty: visibility is not cached geometry
 * (§6.3), so the prepare cache stays warm for re-show.
 *
 * @param {number} index
 * @param {boolean} visible
 */
export function setLayerVisible(index, visible) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  state.composition.layers[index].visible = visible === true
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Change a layer's type. The new layer gets default params for that type;
 * the envelope (blend, rngSeed, color, opacity) is preserved from the old
 * layer so the user does not lose their blend choice.
 *
 * @param {number} index
 * @param {number} typeId
 * @returns {boolean}
 */
export function setLayerType(index, typeId) {
  if (state.composition === null) return false
  if (index < 0 || index >= state.composition.layers.length) return false
  const newLayer = m().createLayer(typeId)
  if (newLayer === null) return false
  const old = state.composition.layers[index]
  snapshot()
  // Preserve envelope
  newLayer.blend = old.blend
  newLayer.rngSeed = old.rngSeed
  newLayer.color = old.color
  newLayer.opacity = old.opacity
  newLayer.visible = old.visible !== false
  state.composition.layers[index] = newLayer
  markDirty(index)
  state.palette = m().buildPalette(state.composition.scheme, state.composition.layers)
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
  return true
}

/**
 * Replace one layer with a freshly-randomized one (built by
 * `model/randomize.generateLayer` and passed in — core does not import model).
 * Snapshots for undo, marks the layer dirty (its static params / colour /
 * rngSeed changed → prepare cache invalidates, §6.3), rebuilds the palette,
 * and republishes. Does NOT reset the clock epoch: a single-layer reroll is a
 * live edit and preserves playback position (FR-10), unlike a full randomize.
 *
 * @param {number} index
 * @param {Layer} layer  The replacement layer (same type/position as `index`).
 * @returns {boolean}
 */
export function randomizeLayer(index, layer) {
  if (state.composition === null) return false
  if (index < 0 || index >= state.composition.layers.length) return false
  snapshot()
  state.composition.layers[index] = layer
  markDirty(index)
  state.palette = m().buildPalette(state.composition.scheme, state.composition.layers)
  publish(TOPICS.COMPOSITION)
  publish(TOPICS.SEED)
  return true
}

// ---------------------------------------------------------------------------
// Actions — per-parameter
// ---------------------------------------------------------------------------

/**
 * Set a **static** parameter value. Marks the layer dirty (static param
 * changes invalidate the prepare cache, §6.3).
 *
 * @param {number} index
 * @param {string} paramName
 * @param {ParamValue} value
 */
export function setParamStatic(index, paramName, value) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  state.composition.layers[index].params[paramName] = value
  markDirty(index)
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Set the range (min, max) of an animatable parameter.
 * Does NOT mark the layer dirty — animatable params vary within the loop and
 * cannot participate in cached geometry (§6.3).
 *
 * @param {number} index
 * @param {string} paramName
 * @param {number} min
 * @param {number} max
 */
export function setParamRange(index, paramName, min, max) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  const av = /** @type {AnimValue} */ (state.composition.layers[index].params[paramName])
  if (typeof av !== 'object' || av === null) return
  av.min = min
  av.max = max
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Set the `times` (cycles per loop) of an animatable parameter.
 * Does NOT mark the layer dirty.
 *
 * @param {number} index
 * @param {string} paramName
 * @param {number} times
 */
export function setParamTimes(index, paramName, times) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  const av = /** @type {AnimValue} */ (state.composition.layers[index].params[paramName])
  if (typeof av !== 'object' || av === null) return
  av.times = times
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Set the algorithm ID of an animatable parameter.
 * Does NOT mark the layer dirty.
 *
 * @param {number} index
 * @param {string} paramName
 * @param {number} algorithmId
 */
export function setParamAlgorithm(index, paramName, algorithmId) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  const av = /** @type {AnimValue} */ (state.composition.layers[index].params[paramName])
  if (typeof av !== 'object' || av === null) return
  av.algorithm = algorithmId
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Set the motion character for a layer. This is a model-level operation: the
 * caller passes the character and an rng function, and the model's `assign`
 * runs. The action wraps it with undo + publish.
 *
 * Until D5 wires `model/randomize.js`, this is called from the layer editor
 * (F2) which imports `model/motion.js` directly. The action here receives a
 * callback that does the actual assignment so that the `model → core` DAG
 * edge does not exist at import time.
 *
 * @param {number} index
 * @param {() => void} assignFn
 */
export function setMotionCharacter(index, assignFn) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  assignFn()
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Scale the `times` of every animatable param in a layer. Same injection
 * pattern as `setMotionCharacter`.
 *
 * @param {number} index
 * @param {() => void} speedFn
 */
export function setSpeed(index, speedFn) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  speedFn()
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Reroll the motion assignment for a layer. Same injection pattern.
 *
 * @param {number} index
 * @param {() => void} rerollFn
 */
export function rerollMotion(index, rerollFn) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  rerollFn()
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}

/**
 * Set the range (min, max) of the envelope opacity (architecture §5.4).
 * The envelope opacity lives on `layer.opacity`, not in `layer.params`, so
 * `setParamRange` cannot reach it. This action follows the same pattern:
 * snapshot, mutate, publish. Does NOT mark the layer dirty — opacity is
 * animatable and varies within the loop (§6.3).
 *
 * Added in F2 to wire the layer editor's envelope opacity band.
 *
 * @param {number} index
 * @param {number} min
 * @param {number} max
 */
export function setOpacityRange(index, min, max) {
  if (state.composition === null) return
  if (index < 0 || index >= state.composition.layers.length) return
  snapshot()
  const op = state.composition.layers[index].opacity
  op.min = min
  op.max = max
  publish(TOPICS.LAYER, index)
  publish(TOPICS.SEED)
}