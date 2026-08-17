// @ts-check
/**
 * Role-aware, taste-constrained composition generation (FR-9, architecture §8.5).
 *
 * `generate()` produces a complete new composition — layer count, types,
 * ordering, blend modes, all parameter values, motion assignments, and scheme
 * selection — in one call. It is the engine behind the Randomize button.
 *
 * ## The five taste rules (architecture §8.5)
 *
 * Encoded as explicit post-generation repair, not rejection-and-retry (a retry
 * loop is non-deterministic in length and can deadlock on a degenerate input):
 *
 * 1. **Role quotas**: 1–2 primary, 0–2 secondary, 0–2 overlay, total 2–5
 *    (or 2–3 when the governor is warned). Glitch is seasoning on top of that
 *    — 0 or 1, and only when the stack has at least 3 layers total, only when
 *    the governor has NOT warned (a full-canvas self-blit is the wrong medicine
 *    for a struggling frame), and only if `byRole('glitch')` is non-empty
 *    (`core/rng.js` `pick()` throws on `[]`). Enforced by construction; when
 *    present, glitch is appended LAST so it sits atop the finished frame —
 *    index 0 is structurally impossible for it (see rule 3).
 * 2. **At most one `fullCanvasOpaque` layer**: when picking overlay types, if
 *    an opaque layer is already in the stack, filter the pool to exclude opaque
 *    types. All 16 current types are `false`, so this is vacuous today but
 *    correct for a future opaque type.
 * 3. **`difference` never at index 0**: the bottom layer never gets blend 5
 *    (difference), which inverts colours against the background and reads as
 *    a glitch rather than structure. Enforced at generation: index 0 draws
 *    from [0,1,2,3,4,6], excluding 5.
 * 4. **Colour ≠ background**: a layer's resolved colour must not equal the
 *    resolved canvas background. The randomizer draws from the `c` and `n`
 *    buckets only (never `b`), and repairs any residual collision.
 * 5. **Flash safety (FR-17)**: full-canvas opacity params on additive/screen
 *    **overlay** and **glitch** layers get `times ≤ 2`. Since the randomizer
 *    cannot know which declared params drive full-canvas alpha (that knowledge
 *    lives in `draw`), the conservative approach caps **every** A param's
 *    `times` to ≤ 2 on additive/screen overlay/glitch layers — including the
 *    envelope opacity. Glitch is a self-blit of the composited frame, so its
 *    strobing is still strobing. At `times` 2 on a 5 s loop, that is 0.4 Hz,
 *    well below the 3 Hz ceiling.
 *
 * ## `Math.random()` — sole entropy source, confined to this module
 *
 * `Math.random()` is the sole entropy source and lives **only in this module**,
 * at the two generation entry points — `generate()` (whole composition) and
 * `generateLayer()` (one layer). Both are user-triggered fresh randomizations;
 * neither is on the seed-**decode** path, so FR-4's cross-device determinism of
 * shared seeds is unaffected. Everything downstream of the drawn uint32 seed is
 * `mulberry32`-deterministic.
 *
 * The composition-level rng stream draws in a fixed order — durationId,
 * scheme, total, then (conditionally, when non-warned + total ≥ 3 + a
 * non-empty glitch pool) the `wantGlitch` gate, then primary/secondary/overlay
 * type and layer draws. Adding the `wantGlitch` draw here shifted the stream
 * for the non-warned + total ≥ 3 case relative to pre-glitch behaviour; that
 * is legal (generate() is not on the seed-decode path, so FR-4's shared-seed
 * determinism is unaffected) but future edits must still respect append-only
 * ordering within this function to keep future seeds stable if this stream is
 * ever reused for one.
 *
 * Imports `core/rng.js`, `core/algorithms.js`, `model/registry.js`,
 * `model/composition.js`, `model/schemes.js`, `model/motion.js`,
 * `model/blend.js`, `util/quantize.js`.
 *
 * This is a `model` module — it depends on `core`, `model`, and `util`
 * (architecture §4). It does not import `layers/*` directly (registry does
 * that) and does not import `render/*` or `ui/*`.
 */

import { mulberry32, uint32, pick, intRange, range } from '../core/rng.js'
import { ALGORITHM_COUNT } from '../core/algorithms.js'
import { byRole, get as getLayer } from './registry.js'
import { createLayer } from './composition.js'
import { BUILTINS, resolveRef } from './schemes.js'
import { assign, CHARACTERS } from './motion.js'
import { BLEND_NORMAL, BLEND_ADDITIVE, BLEND_SCREEN, BLEND_DIFFERENCE, SELECTABLE_BLENDS } from './blend.js'
import { q3 } from '../util/quantize.js'

// Bottom-layer blends: the selectable set minus difference (taste rule 3,
// architecture §8.5). Excluding retired modes falls out for free.
const BOTTOM_BLENDS = SELECTABLE_BLENDS.filter((b) => b !== BLEND_DIFFERENCE)

/**
 * @typedef {import('./params.js').Composition} Composition
 * @typedef {import('./params.js').Layer} Layer
 * @typedef {import('./params.js').AnimValue} AnimValue
 * @typedef {import('./params.js').ParamDecl} ParamDecl
 * @typedef {import('./params.js').ParamValue} ParamValue
 * @typedef {import('./registry.js').LayerModule} LayerModule
 */

// ---------------------------------------------------------------------------
// Colour ref generation (taste rule 4)
// ---------------------------------------------------------------------------

/**
 * Pick a colour reference from the `c` or `n` bucket (never `b` — background
 * colours are for backgrounds, not layers). Verify the resolved colour does
 * not equal the canvas background (taste rule 4); if it does, fall back to the
 * other bucket.
 *
 * @param {() => number} rng
 * @param {import('./params.js').Scheme} scheme
 * @returns {string} A colour ref like `'c3'` or `'n1'`.
 */
function pickColorRef(rng, scheme) {
  const bg = scheme.backgrounds[0]
  const bucket = pick(rng, ['c', 'n'])
  const arr = bucket === 'c' ? scheme.colors : scheme.neutrals
  const selector = intRange(rng, 0, arr.length - 1)
  const ref = bucket + selector
  if (resolveRef(scheme, ref) === bg) {
    // Collision — try the other bucket at index 0
    const otherBucket = bucket === 'c' ? 'n' : 'c'
    const otherArr = otherBucket === 'c' ? scheme.colors : scheme.neutrals
    if (otherArr.length > 0 && resolveRef(scheme, otherBucket + '0') !== bg) {
      return otherBucket + '0'
    }
    // Both buckets collide (degenerate scheme): pin a vivid colour
    return 'FF2E88'
  }
  return ref
}

// ---------------------------------------------------------------------------
// Parameter randomization
// ---------------------------------------------------------------------------

/**
 * Randomize every declared parameter within its bounds.
 *
 * A params get a random `[min, max]` within `[decl.min, decl.max]` (min ≤ max),
 * a `times` in `[1, 8]`, and an algorithm in `[0, ALGORITHM_COUNT-1]`. Static
 * params get a random value within their declared range/enum/bool set.
 *
 * Values are 3dp-quantized where applicable (FR-12) so a generated composition
 * round-trips through the codec without drift.
 *
 * @param {() => number} rng
 * @param {Layer} layer
 * @param {readonly ParamDecl[]} params
 * @returns {void}
 */
function randomizeParams(rng, layer, params) {
  for (const decl of params) {
    if (decl.kind === 'A') {
      const lo = range(rng, decl.min, decl.max)
      const hi = range(rng, lo, decl.max)
      /** @type {AnimValue} */
      const av = {
        min: q3(lo),
        max: q3(hi),
        times: intRange(rng, 1, 8),
        algorithm: intRange(rng, 0, ALGORITHM_COUNT - 1),
      }
      layer.params[decl.name] = av
    } else if (decl.kind === 'int') {
      layer.params[decl.name] = intRange(rng, decl.min, decl.max)
    } else if (decl.kind === 'num') {
      layer.params[decl.name] = q3(range(rng, decl.min, decl.max))
    } else if (decl.kind === 'bool') {
      layer.params[decl.name] = rng() < 0.5
    } else if (decl.kind === 'enum') {
      const vs = decl.values
      if (vs !== null && vs.length > 0) {
        layer.params[decl.name] = vs[intRange(rng, 0, vs.length - 1)]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Layer construction
// ---------------------------------------------------------------------------

/**
 * Build one randomized layer of the given type.
 *
 * The composition-level PRNG (`rng`) drives every choice: blend, rngSeed,
 * colour, opacity, all params, and the motion character. The per-layer PRNG
 * (`mulberry32(rngSeed)`) drives `assign()` for the algorithm pool draws —
 * these are independent streams that each start fresh from `rngSeed`, so the
 * consumption order within `assign` and within `prepare` are the contracts
 * that matter for cross-device determinism (FR-4).
 *
 * @param {() => number} rng
 * @param {LayerModule} mod
 * @param {import('./params.js').Scheme} scheme
 * @param {number} index - position in the layer stack (0 = bottom)
 * @returns {Layer}
 */
function makeLayer(rng, mod, scheme, index) {
  const layer = createLayer(mod.meta.id)
  if (layer === null) {
    // Should not happen — the type comes from the registry's own pool.
    throw new Error(`randomize: createLayer returned null for type ${mod.meta.id}`)
  }

  // Envelope: blend — taste rule 3 (difference not at index 0), retired modes
  // (multiply/overlay) never produced (SELECTABLE_BLENDS).
  layer.blend = index === 0 ? pick(rng, BOTTOM_BLENDS) : pick(rng, SELECTABLE_BLENDS)

  // Envelope: rngSeed — a uint32 from the composition-level stream
  layer.rngSeed = uint32(rng)

  // Envelope: colour — from c/n buckets, never the background (rule 4)
  layer.color = pickColorRef(rng, scheme)

  // Envelope: opacity — random range within [0.05, 1.0]
  const opLo = range(rng, 0.05, 0.5)
  const opHi = range(rng, opLo, 1.0)
  layer.opacity = {
    min: q3(opLo),
    max: q3(opHi),
    times: intRange(rng, 1, 4),
    algorithm: intRange(rng, 0, ALGORITHM_COUNT - 1),
  }

  // Declared parameters
  randomizeParams(rng, layer, mod.params)

  // Motion character + algorithm assignment
  const character = pick(rng, CHARACTERS)
  assign(layer, character, mulberry32(layer.rngSeed))

  return layer
}

// ---------------------------------------------------------------------------
// Post-generation taste rules (rules 2, 4, 5)
// ---------------------------------------------------------------------------

/**
 * Apply the post-generation taste rules (3 belt-and-suspenders, 4, 5) to ONE
 * layer at position `i`. Rule 2 (opaque quota) is a stack-level constraint and
 * stays in generate()'s type picker; it does not apply to a single reroll.
 *
 * @param {Layer} layer
 * @param {number} i - stack position (0 = bottom)
 * @param {import('./params.js').Scheme} scheme
 * @returns {void}
 */
function applyLayerTasteRules(layer, i, scheme) {
  const bg = scheme.backgrounds[0]

  // Rule 3 (belt-and-suspenders): difference not at index 0
  if (i === 0 && layer.blend === BLEND_DIFFERENCE) layer.blend = BLEND_NORMAL

  // Rule 4: resolved colour must not equal the canvas background
  if (resolveRef(scheme, layer.color) === bg) {
    if (resolveRef(scheme, 'c0') !== bg) layer.color = 'c0'
    else if (resolveRef(scheme, 'n0') !== bg) layer.color = 'n0'
    else layer.color = 'FF2E88'
  }

  // Rule 5: flash safety — additive/screen overlay AND glitch layers cap
  // every A param (incl. envelope opacity) at times ≤ 2 (FR-17). Glitch layers
  // self-blit the composited frame, so their strobing is still strobing.
  // generateLayer()'s per-layer reroll runs this same function, so a user
  // choosing glitch and picking additive/screen manually gets capped too.
  const mod = getLayer(layer.type)
  if (mod === null) return
  if (mod.meta.role !== 'overlay' && mod.meta.role !== 'glitch') return
  if (layer.blend !== BLEND_ADDITIVE && layer.blend !== BLEND_SCREEN) return
  if (layer.opacity.times > 2) layer.opacity.times = 2
  for (const decl of mod.params) {
    if (decl.kind !== 'A') continue
    const av = /** @type {AnimValue} */ (layer.params[decl.name])
    if (typeof av === 'object' && av !== null && av.times > 2) av.times = 2
  }
}

/**
 * Apply the taste rules across the whole stack (rules 3, 4, 5). Rule 2 is
 * handled during type selection; rule 1 by construction. See §8.5.
 *
 * @param {Layer[]} layers
 * @param {import('./params.js').Scheme} scheme
 * @returns {void}
 */
function applyTasteRules(layers, scheme) {
  for (let i = 0; i < layers.length; i++) {
    applyLayerTasteRules(layers[i], i, scheme)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete randomized composition.
 *
 * Draws the initial uint32 seed for the composition-level PRNG via
 * `Math.random()` — one of two generation entry points in this module.
 * Everything downstream is deterministic given that seed (FR-4).
 *
 * @param {boolean} [governorWarned=false] - when true, bias toward fewer layers
 *   (2–3 instead of 2–5) per FR-15 / architecture §8.5 rule 1.
 * @returns {Composition}
 */
export function generate(governorWarned = false) {
  // The sole Math.random() in generate() — the composition-level seed (FR-4).
  // generateLayer() has its own, also in this module — neither is on the decode path.
  const seed = Math.floor(Math.random() * 4294967296) >>> 0
  const rng = mulberry32(seed)

  // Duration and scheme (always a built-in; custom schemes are user-authored)
  const durationId = intRange(rng, 0, 2)
  const schemeIndex = intRange(rng, 0, BUILTINS.length - 1)
  const scheme = BUILTINS[schemeIndex]

  // Role quotas (rule 1): 1–2 primary, 0–2 secondary, 0–2 overlay, total 2–5
  // (or 2–3 when the governor warns).
  const total = intRange(rng, 2, governorWarned ? 3 : 5)

  // Rule 1 extension: glitch is seasoning — 0–1, only in a 3+ stack, never
  // when the governor warns (full-canvas self-blits are the wrong medicine),
  // and only if the catalog actually has glitch types (empty-pool guard:
  // core/rng.js pick() throws on []). The p/s/o split then operates on the
  // (total - wantGlitch) remainder; glitch is appended LAST so the stack
  // order is primary → secondary → overlay → glitch (glitch corrupts a
  // finished frame — index 0 is structurally impossible for it, see rule 3).
  const glitchPool = byRole('glitch')
  const wantGlitch =
    !governorWarned && total >= 3 && glitchPool.length > 0 && rng() < 0.35 ? 1 : 0
  const psoTotal = total - wantGlitch

  let primaryCount = intRange(rng, 1, 2)
  if (primaryCount > psoTotal) primaryCount = psoTotal
  let remaining = psoTotal - primaryCount
  let secondaryCount = intRange(rng, 0, Math.min(2, remaining))
  let overlayCount = remaining - secondaryCount
  if (overlayCount > 2) {
    secondaryCount += overlayCount - 2
    overlayCount = 2
  }

  // Build layer list: primary first (structure), then secondary (texture),
  // then overlay (mood), then optional glitch (frame corruption). This
  // ordering is the draw order (index 0 = bottom).
  const primTypes = byRole('primary')
  const secTypes = byRole('secondary')
  const ovlTypes = byRole('overlay')

  /** @type {Layer[]} */
  const layers = []

  // Rule 2: track whether we already have a fullCanvasOpaque layer
  let opaqueUsed = false

  /**
   * Pick a type from a role pool, filtering out opaque types if one is
   * already in the stack (rule 2).
   *
   * @param {readonly LayerModule[]} pool
   * @returns {LayerModule}
   */
  function pickType(pool) {
    const available = opaqueUsed
      ? pool.filter((m) => !m.meta.fullCanvasOpaque)
      : pool
    const chosen = available.length > 0
      ? pick(rng, available)
      : pick(rng, pool) // fallback: all types in this role are opaque
    if (chosen.meta.fullCanvasOpaque) opaqueUsed = true
    return chosen
  }

  for (let i = 0; i < primaryCount; i++) {
    layers.push(makeLayer(rng, pickType(primTypes), scheme, layers.length))
  }
  for (let i = 0; i < secondaryCount; i++) {
    layers.push(makeLayer(rng, pickType(secTypes), scheme, layers.length))
  }
  for (let i = 0; i < overlayCount; i++) {
    layers.push(makeLayer(rng, pickType(ovlTypes), scheme, layers.length))
  }
  if (wantGlitch === 1) {
    // Glitch is always LAST (rule 1 extension) — it self-samples the
    // composited frame beneath it. pickType keeps the rule-2 opaque tally
    // honest for future opaque glitch types (all four current types have
    // fullCanvasOpaque: false).
    layers.push(makeLayer(rng, pickType(glitchPool), scheme, layers.length))
  }

  // Post-generation taste rules (rules 4 and 5; rule 3 belt-and-suspenders)
  applyTasteRules(layers, scheme)

  return { durationId, scheme: schemeIndex, layers }
}

/**
 * Reroll a SINGLE layer, preserving its type and stack position while drawing
 * a fresh blend, rngSeed, colour, opacity, every parameter, and motion
 * character. This is the engine behind Randomize when the single-layer editor
 * is open; the all-layer view still calls `generate()`.
 *
 * Entropy: one `Math.random()` — confined to this module (see the module
 * header). Type is preserved so repeated presses explore variations of the
 * same layer. An unknown type (should never happen for a live layer) returns
 * the layer untouched.
 *
 * @param {Layer} layer   The layer to reroll (its `type` is kept).
 * @param {import('./params.js').Scheme} scheme  The resolved active scheme.
 * @param {number} index  Stack position (0 = bottom) — drives taste rule 3.
 * @returns {Layer}
 */
export function generateLayer(layer, scheme, index) {
  const mod = getLayer(layer.type)
  if (mod === null) return layer
  const seed = Math.floor(Math.random() * 4294967296) >>> 0
  const rng = mulberry32(seed)
  const fresh = makeLayer(rng, mod, scheme, index)
  applyLayerTasteRules(fresh, index, scheme)
  return fresh
}