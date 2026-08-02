// @ts-check
/**
 * The live cyan tick — the value the engine is resolving right now
 * (Designer §0, architecture §13 Q3).
 *
 * Subscribes to `clock.onFrame` and writes **one CSS custom property**
 * (`--tick-x`) consumed by `.track__now`'s `transform: translateX()`.
 * No layout read, no reflow, no separate timer (architecture §6.2:
 * frame subscribers ride the rAF loop).
 *
 * The tick is hidden (not removed) when the layer's opacity resolves to 0,
 * so the band does not reflow as the tick comes and goes (Designer §3).
 *
 * This control is unique: it does not take an `onChange` callback (it is
 * read-only) and it does not return a visible interactive node. It returns
 * the `.track__now` element for the caller to place inside the `.track`,
 * plus `update(frame, totalFrames)` and `destroy()` lifecycle methods.
 *
 * The tick's position is computed from `findValue` — the same function the
 * render pipeline uses — so the tick and the pixel are always in sync.
 */

import { el } from '../dom.js'
import { findValue } from '../../core/value.js'

/**
 * @typedef {import('../../model/params.js').AnimValue} AnimValue
 * @typedef {import('../../model/params.js').ParamDecl} ParamDecl
 */

/**
 * @typedef {object} TickControl
 * @property {HTMLElement} node   The `.track__now` element.
 * @property {(av: AnimValue) => void} setValue  Set the AnimValue to track.
 * @property {(frame: number, totalFrames: number) => void} update  Position the tick.
 * @property {() => void} destroy  Remove the frame subscription.
 */

/**
 * Create a live tick control.
 *
 * @param {ParamDecl} decl   The animatable parameter declaration.
 * @param {(fn: (frame: number, totalFrames: number) => void) => () => void} onFrame
 *   Frame subscription function (e.g. `clock.onFrame`).
 * @returns {TickControl}
 */
export function create(decl, onFrame) {
  const node = el('div', { class: 'track__now', 'aria-hidden': 'true' })

  /** @type {AnimValue | null} */
  let av = null

  /** @type {number} */
  const min = decl.min
  /** @type {number} */
  const max = decl.max

  /**
   * Set the AnimValue to track.
   * @param {AnimValue} value
   */
  function setValue(value) {
    av = value
  }

  /**
   * Position the tick for one frame.
   * @param {number} frame
   * @param {number} totalFrames
   */
  function update(frame, totalFrames) {
    if (av === null || totalFrames <= 0 || max === min) {
      node.classList.add('track__now--hidden')
      return
    }

    const resolved = findValue(av.min, av.max, av.times, totalFrames, frame, av.algorithm)

    // Hide when the value resolves to 0 opacity (the envelope alpha).
    // This check is for the opacity param specifically: when opacity.max
    // is 0, the layer is invisible and the tick should hide.
    if (av.max <= 0) {
      node.classList.add('track__now--hidden')
      return
    }

    const pct = ((resolved - min) / (max - min)) * 100

    // --tick-x is in px relative to the track's own width.
    // The track element's width is the reference; we measure it once.
    // Using percentage of the parent .track element's content box.
    // The CSS rule uses translateX(var(--tick-x)), so --tick-x must be px.
    const trackWidth = node.parentElement ? node.parentElement.clientWidth : 0
    const px = (pct / 100) * trackWidth

    node.style.setProperty('--tick-x', px + 'px')
    node.classList.remove('track__now--hidden')
  }

  // Subscribe to frame updates.
  const unsub = onFrame(update)

  /**
   * Remove the frame subscription.
   */
  function destroy() {
    unsub()
  }

  return { node, setValue, update, destroy }
}