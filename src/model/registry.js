// @ts-check
/**
 * Layer type registry (architecture §5.3, §8.2).
 *
 * **This is the one file a new layer type touches outside its own.** It is
 * also the *only* module permitted to import from `src/layers/`
 * (architecture §4 rule 3) — that restriction is what keeps every other
 * subsystem walking the declaration rather than the catalog.
 *
 * Layer type IDs 1–42 are append-only forever, same rule as algorithm and
 * blend IDs. `tests/registry.test.js` pins the exact ordering. Waves so
 * far: D1 (1), D2 (2–7), D3 (8–12), D4 (13–16), the double-catalog wave
 * (17–32), the glitch-effects wave (33–36 — role `glitch`, layers that
 * corrupt the composited frame below rather than draw imagery of their
 * own; see the layer files for the self-sampling contract), the omni-wave
 * glitch W2 (37–42 — six more self-sampling glitch types on the same
 * contract).
 */

import { PARAM_KINDS } from './params.js'
import * as rayRings from '../layers/ray-rings.js'
import * as nthRings from '../layers/nth-rings.js'
import * as layeredPoly from '../layers/layered-poly.js'
import * as encircledSpiral from '../layers/encircled-spiral.js'
import * as petalBloom from '../layers/petal-bloom.js'
import * as orbitDots from '../layers/orbit-dots.js'
import * as arcGates from '../layers/arc-gates.js'
import * as lineField from '../layers/line-field.js'
import * as moireGrid from '../layers/moire-grid.js'
import * as gridPulse from '../layers/grid-pulse.js'
import * as sineRibbons from '../layers/sine-ribbons.js'
import * as crosshatch from '../layers/crosshatch.js'
import * as fuzzFlare from '../layers/fuzz-flare.js'
import * as scanLines from '../layers/scan-lines.js'
import * as vignetteWash from '../layers/vignette-wash.js'
import * as grain from '../layers/grain.js'
import * as spiralWeb from '../layers/spiral-web.js'
import * as nestedSquares from '../layers/nested-squares.js'
import * as sunburst from '../layers/sunburst.js'
import * as pulseRings from '../layers/pulse-rings.js'
import * as burstStar from '../layers/burst-star.js'
import * as ribbonCoil from '../layers/ribbon-coil.js'
import * as prismShard from '../layers/prism-shard.js'
import * as checkerWave from '../layers/checker-wave.js'
import * as stippleField from '../layers/stipple-field.js'
import * as latticeWeave from '../layers/lattice-weave.js'
import * as concentricWaves from '../layers/concentric-waves.js'
import * as triangulation from '../layers/triangulation.js'
import * as lightLeak from '../layers/light-leak.js'
import * as softTint from '../layers/soft-tint.js'
import * as dotHaze from '../layers/dot-haze.js'
import * as stripeSweep from '../layers/stripe-sweep.js'
import * as sliceShift from '../layers/slice-shift.js'
import * as rgbSplit from '../layers/rgb-split.js'
import * as blockStatic from '../layers/block-static.js'
import * as syncRoll from '../layers/sync-roll.js'
import * as mirrorFold from '../layers/mirror-fold.js'
import * as interlaceComb from '../layers/interlace-comb.js'
import * as zoomEcho from '../layers/zoom-echo.js'
import * as smearStreak from '../layers/smear-streak.js'
import * as ghostDouble from '../layers/ghost-double.js'
import * as contrastCrush from '../layers/contrast-crush.js'

/**
 * @typedef {import('./params.js').LayerMeta} LayerMeta
 * @typedef {import('./params.js').ParamDecl} ParamDecl
 * @typedef {import('./params.js').Palette} Palette
 * @typedef {import('./params.js').Prepared} Prepared
 * @typedef {import('./params.js').Resolved} Resolved
 * @typedef {import('./params.js').Statics} Statics
 */

/**
 * The four exports every file in `src/layers/` provides, and nothing else
 * (architecture §5.1).
 *
 * @typedef {object} LayerModule
 * @property {LayerMeta} meta
 * @property {readonly ParamDecl[]} params
 * @property {(statics: Statics, palette: Palette, rng: () => number) => Prepared} prepare
 * @property {(ctx: CanvasRenderingContext2D, resolved: Resolved, prepared: Prepared, palette: Palette) => void} draw
 */

/** The four layer roles, in catalog order (FR-6). */
export const ROLES = Object.freeze(
  /** @type {readonly ('primary'|'secondary'|'overlay'|'glitch')[]} */ (['primary', 'secondary', 'overlay', 'glitch']),
)

const ROLE_SET = new Set(ROLES)

/** @type {Map<number, LayerModule>} */
const modules = new Map()

/**
 * `list()` result, rebuilt on registration rather than on every call.
 *
 * Registration happens entirely at module-import time, so this cache is
 * trivially correct — and `list()` is called by the add-layer picker and the
 * randomizer, neither of which should be allocating a sorted array to answer
 * a question whose answer changed last at page load.
 *
 * @type {readonly LayerModule[] | null}
 */
let listCache = null

/**
 * Reject a malformed layer module at import, with the reason.
 *
 * This throws rather than reporting, because a broken layer module is a
 * programmer error in source that ships — there is no user input path that can
 * cause it, and no recovery that makes sense. It fails at the registry line
 * rather than four sessions later inside `draw`.
 *
 * @param {unknown} mod
 * @returns {LayerModule}
 */
function validate(mod) {
  if (typeof mod !== 'object' || mod === null) {
    throw new Error('registry.register: expected a layer module object')
  }
  const m = /** @type {Partial<LayerModule>} */ (mod)
  const meta = m.meta
  if (typeof meta !== 'object' || meta === null) {
    throw new Error('registry.register: layer module has no meta')
  }
  const where = typeof meta.name === 'string' && meta.name.length > 0 ? `"${meta.name}"` : '(unnamed)'
  if (!Number.isInteger(meta.id) || meta.id < 1) {
    throw new Error(`registry.register ${where}: meta.id must be an integer >= 1, got ${String(meta.id)}`)
  }
  if (typeof meta.name !== 'string' || meta.name.length === 0) {
    throw new Error(`registry.register (id ${meta.id}): meta.name must be a non-empty string`)
  }
  if (!ROLE_SET.has(meta.role)) {
    throw new Error(`registry.register ${where}: meta.role must be one of ${ROLES.join(' | ')}, got ${String(meta.role)}`)
  }
  if (typeof meta.blurb !== 'string' || meta.blurb.length === 0) {
    throw new Error(`registry.register ${where}: meta.blurb must be a non-empty string`)
  }
  const wc = meta.worstCase
  if (
    typeof wc !== 'object' || wc === null ||
    !Number.isFinite(wc.pathOps) || !Number.isFinite(wc.drawCalls)
  ) {
    throw new Error(`registry.register ${where}: meta.worstCase must be { pathOps, drawCalls } (architecture §10.2)`)
  }
  if (typeof meta.fullCanvasOpaque !== 'boolean') {
    throw new Error(`registry.register ${where}: meta.fullCanvasOpaque must be a boolean`)
  }
  // Widened to `unknown` before the guard: see the matching note in
  // params.js's sEnum — Array.isArray does not narrow a `readonly T[]` union
  // cleanly, and this keeps the checker out of it.
  const params = /** @type {unknown} */ (m.params)
  if (!Array.isArray(params) || params.length === 0) {
    throw new Error(`registry.register ${where}: params must be a non-empty array`)
  }
  const seen = new Set()
  for (const p of params) {
    if (typeof p !== 'object' || p === null || !PARAM_KINDS.includes(p.kind)) {
      throw new Error(`registry.register ${where}: params must be declarations built by A() or S.*`)
    }
    if (seen.has(p.name)) {
      throw new Error(`registry.register ${where}: duplicate param name "${p.name}"`)
    }
    if (p.name === 'color' || p.name === 'scratch') {
      // Reserved `statics` keys injected by render/prepare.js (D4). A declared
      // param with either name would be silently overwritten there.
      throw new Error(`registry.register ${where}: param name "${p.name}" is reserved`)
    }
    seen.add(p.name)
  }
  if (typeof m.prepare !== 'function') {
    throw new Error(`registry.register ${where}: prepare must be a function`)
  }
  if (typeof m.draw !== 'function') {
    throw new Error(`registry.register ${where}: draw must be a function`)
  }
  return /** @type {LayerModule} */ (mod)
}

/**
 * Add a layer module to the catalog. Called once per type, below.
 *
 * @param {unknown} mod
 * @returns {void}
 */
export function register(mod) {
  const m = validate(mod)
  const existing = modules.get(m.meta.id)
  if (existing !== undefined) {
    throw new Error(
      `registry.register: layer type ID ${m.meta.id} is already taken by "${existing.meta.name}" — ` +
      'IDs are append-only and may never be reused (architecture §8.2)',
    )
  }
  modules.set(m.meta.id, m)
  listCache = null
}

/**
 * Look up a layer type.
 *
 * Returns `null` — never throws — for an unknown ID, because the caller that
 * matters is a decoded seed carrying a type this build has never heard of.
 * That layer is skipped and warned about, and the rest of the composition
 * renders (FR-18, architecture §9.5).
 *
 * @param {unknown} id
 * @returns {LayerModule|null}
 */
export function get(id) {
  if (typeof id !== 'number' || !Number.isInteger(id)) return null
  return modules.get(id) ?? null
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function has(id) {
  return get(id) !== null
}

/**
 * Every registered module, ascending by ID — which is catalog order (FR-6).
 * @returns {readonly LayerModule[]}
 */
export function list() {
  if (listCache === null) {
    const out = Array.from(modules.values())
    out.sort((a, b) => a.meta.id - b.meta.id)
    listCache = Object.freeze(out)
  }
  return listCache
}

/**
 * Every registered module of one role, ascending by ID. Drives the grouped
 * add-layer picker and the randomizer's role quotas (architecture §8.5).
 *
 * @param {string} role
 * @returns {LayerModule[]}
 */
export function byRole(role) {
  return list().filter((m) => m.meta.role === role)
}

/** @returns {number} */
export function count() {
  return modules.size
}

// ---------------------------------------------------------------------------
// The catalog
//
// One import (top of file — ES imports are top-level only) and one register()
// call per layer type, in ID order. D1: type 1. D2: 2–7. D3: 8–12. D4: 13–16.
// ---------------------------------------------------------------------------

register(rayRings)
register(nthRings)
register(layeredPoly)
register(encircledSpiral)
register(petalBloom)
register(orbitDots)
register(arcGates)
register(lineField)
register(moireGrid)
register(gridPulse)
register(sineRibbons)
register(crosshatch)
register(fuzzFlare)
register(scanLines)
register(vignetteWash)
register(grain)
register(spiralWeb)
register(nestedSquares)
register(sunburst)
register(pulseRings)
register(burstStar)
register(ribbonCoil)
register(prismShard)
register(checkerWave)
register(stippleField)
register(latticeWeave)
register(concentricWaves)
register(triangulation)
register(lightLeak)
register(softTint)
register(dotHaze)
register(stripeSweep)
register(sliceShift)
register(rgbSplit)
register(blockStatic)
register(syncRoll)
register(mirrorFold)
register(interlaceComb)
register(zoomEcho)
register(smearStreak)
register(ghostDouble)
register(contrastCrush)
