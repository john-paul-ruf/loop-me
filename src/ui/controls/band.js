// @ts-check
/**
 * The dual-thumb band — the core control of the app (Designer §0,
 * architecture §12.3, §13 Q2).
 *
 * An animatable parameter is four values: min, max, cycles, curve. The
 * band shows the min–max travel range on the parameter's hard bounds,
 * with two thumbs the user drags. A live cyan tick (`tick.js`) shows
 * the value the engine is resolving right now.
 *
 * ## Implementation: native range inputs (Flag 5)
 *
 * Architecture §12.3 mandates **two stacked native `<input type="range">`
 * elements**, not a custom pointer-events widget. Native inputs bring
 * keyboard operability (arrow, Shift+arrow), screen-reader semantics,
 * and touch handling for free.
 *
 * The two inputs are visually transparent: their thumbs are invisible
 * (CSS sets the native thumb to transparent), and the **visible** thumbs
 * (`.track__thumb` divs) are positioned by JS from the input values.
 * The inputs sit above the visual layers in z-index so they catch all
 * pointer events.
 *
 * When min and max converge, the input whose thumb is nearer the cursor
 * wins — implemented via `clip-path`: each input covers the full track
 * width, but `clip-path` (`inset(...)`, split at the thumb midpoint
 * `--band-split`) clips each to its own half so only the nearer thumb is
 * hit. The min input has the higher z-index to break the tie on the
 * zero-width seam. This is the §13 Q2 concern; the clip-path split is
 * the resolution (supersedes the unreliable `pointer-events`-on-thumb
 * trick).
 *
 * The visible track elements (`.track__rail`, `.track__band`,
 * `.track__thumb`) are positioned via CSS custom properties
 * (`--band-left`, `--band-width`, `--thumb-left`) written by `update()`,
 * which CSP does not govern (architecture §11.2).
 *
 * No `innerHTML`, no `style=` attributes — all DOM through `dom.js`'s `el()`,
 * all dynamic values through `style.setProperty()`.
 */

import { el } from '../dom.js'
import { clamp } from '../../util/clamp.js'

/**
 * @typedef {import('../../model/params.js').AnimValue} AnimValue
 * @typedef {import('../../model/params.js').ParamDecl} ParamDecl
 */

/**
 * @typedef {object} BandControl
 * @property {HTMLElement} node   The `.track` element to append to the DOM.
 * @property {(av: AnimValue) => void} update  Set the band from an AnimValue.
 * @property {() => void} destroy  Remove event listeners.
 */

/**
 * Create a dual-thumb band control.
 *
 * @param {ParamDecl} decl   The animatable parameter declaration (provides hard bounds, step, unit).
 * @param {(av: AnimValue) => void} onChange  Called with the updated AnimValue on every thumb move.
 * @returns {BandControl}
 */
export function create(decl, onChange) {
  const min = decl.min
  const max = decl.max
  const step = decl.step

  // --- DOM structure ---
  // .track
  //   .track__rail
  //   .track__band      (positioned via --band-left / --band-width)
  //   .track__thumb      (min thumb, positioned via --thumb-left)
  //   .track__thumb      (max thumb)
  //   input.range-input--min   (transparent, native range)
  //   input.range-input--max   (transparent, native range)

  const minThumb = el('div', { class: 'track__thumb', 'aria-hidden': 'true' })
  const maxThumb = el('div', { class: 'track__thumb', 'aria-hidden': 'true' })

  const minInput = el('input', {
    class: 'range-input range-input--min',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    'aria-label': `${decl.label} minimum`,
    value: String(min),
  })

  const maxInput = el('input', {
    class: 'range-input range-input--max',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    'aria-label': `${decl.label} maximum`,
    value: String(max),
  })

  const rail = el('div', { class: 'track__rail' })
  const band = el('div', { class: 'track__band' })

  const node = el('div', { class: 'track' }, [
    rail,
    band,
    minThumb,
    maxThumb,
    minInput,
    maxInput,
  ])

  // --- Positioning ---
  /**
   * Convert a value to a percentage of the [min, max] range.
   * @param {number} v
   * @returns {number}
   */
  function toPct(v) {
    if (max === min) return 0
    return ((v - min) / (max - min)) * 100
  }

  /**
   * Clamp a value to [min, max] respecting the step.
   * @param {number} v
   * @returns {number}
   */
  function quantize(v) {
    const c = clamp(v, min, max)
    // Snap to step grid
    if (step > 0) {
      const snapped = Math.round((c - min) / step) * step + min
      return clamp(snapped, min, max)
    }
    return c
  }

  /**
   * Update the visual positions from the input values.
   * Writes CSS custom properties (CSP-safe).
   */
  function syncVisuals() {
    const minVal = parseFloat(/** @type {string} */ (minInput.value))
    const maxVal = parseFloat(/** @type {string} */ (maxInput.value))

    const minPct = toPct(minVal)
    const maxPct = toPct(maxVal)

    minThumb.style.setProperty('--thumb-left', minPct + '%')
    maxThumb.style.setProperty('--thumb-left', maxPct + '%')
    band.style.setProperty('--band-left', minPct + '%')
    band.style.setProperty('--band-width', (maxPct - minPct) + '%')

    // Each native input is clipped to its own half of the track (see
    // components.css §8). The split is the midpoint between the two thumbs, so
    // the min input owns [0..split] and the max input owns [split..100%] — both
    // thumbs stay grabbable, incl. max pinned at 100%. (architecture §12.3, §13 Q2)
    node.style.setProperty('--band-split', (minPct + maxPct) / 2 + '%')
  }

  // --- Enforce min <= max ---
  /**
   * If the min input exceeds max, swap them visually (don't actually swap
   * the inputs — just clamp). The user dragging min past max pushes max
   * up to meet it; dragging max below min pushes min down.
   */
  function onMinInput() {
    const minVal = parseFloat(/** @type {string} */ (minInput.value))
    const maxVal = parseFloat(/** @type {string} */ (maxInput.value))
    if (minVal > maxVal) {
      maxInput.value = String(minVal)
    }
    syncVisuals()
    emitChange()
  }

  function onMaxInput() {
    const minVal = parseFloat(/** @type {string} */ (minInput.value))
    const maxVal = parseFloat(/** @type {string} */ (maxInput.value))
    if (maxVal < minVal) {
      minInput.value = String(maxVal)
    }
    syncVisuals()
    emitChange()
  }

  /**
   * Build an AnimValue from the current input values and call onChange.
   * Preserves times and algorithm from the last update's value.
   * @type {AnimValue | null}
   */
  let lastValue = null

  function emitChange() {
    const minVal = quantize(parseFloat(/** @type {string} */ (minInput.value)))
    const maxVal = quantize(parseFloat(/** @type {string} */ (maxInput.value)))

    /** @type {AnimValue} */
    const av = {
      min: minVal,
      max: maxVal,
      times: lastValue ? lastValue.times : 1,
      algorithm: lastValue ? lastValue.algorithm : 0,
    }
    lastValue = av
    onChange(av)
  }

  minInput.addEventListener('input', onMinInput)
  maxInput.addEventListener('input', onMaxInput)

  // --- Public API ---

  /**
   * Set the band from an AnimValue.
   * @param {AnimValue} av
   */
  function update(av) {
    lastValue = av
    minInput.value = String(clamp(av.min, min, max))
    maxInput.value = String(clamp(av.max, min, max))
    syncVisuals()
  }

  /**
   * Remove event listeners.
   */
  function destroy() {
    minInput.removeEventListener('input', onMinInput)
    maxInput.removeEventListener('input', onMaxInput)
  }

  return { node, update, destroy }
}