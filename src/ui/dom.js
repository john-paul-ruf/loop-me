// @ts-check
/**
 * DOM construction and focus management (architecture §12.3).
 *
 * This module owns the three things the architecture requires to be
 * implemented *once*, not scattered:
 *
 * 1. **`text()` — the single XSS chokepoint.** Every user-authored string
 *    (scheme names, gallery descriptions, decoded seed fragments) reaches
 *    the DOM through `textContent`, never through `innerHTML`. This is the
 *    one place in the app where that guarantee lives (architecture §12.1).
 *
 * 2. **`el()` — the element factory.** Builds DOM imperatively, sets
 *    attributes, appends children. No template strings, no `innerHTML`.
 *
 * 3. **The focus trap.** One implementation, used by the splash and every
 *    modal (architecture §12.3). Trap activation, Tab cycling, Shift+Tab
 *    back-cycling, and release — all here, so a modal that forgets to call
 *    `releaseFocusTrap` is the bug, not a hand-rolled trap that drifted.
 *
 * CSP compliance (§11.2): no `style=` attributes are ever set through these
 * helpers. Dynamic styling goes through `element.style.setProperty('--x', v)`,
 * which CSP does not govern.
 */

/**
 * Create an element, set attributes, append children.
 *
 * @param {string} tag Element tag name.
 * @param {Record<string, unknown>} [props] Attributes and special keys:
 *   - `class` → className
 *   - `text` → textContent (convenience, same as calling text() afterwards)
 *   - `dataset` → Object.assign(el.dataset, …)
 *   - `style` → Object of CSS custom properties → setProperty per key
 *   - `on` → { event: handler } → addEventListener per key
 *   - anything else → el.setAttribute(key, String(value))
 * @param {Node[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props, children) {
  const node = document.createElement(tag)

  if (props) {
    for (const key in props) {
      const value = props[key]

      switch (key) {
        case 'class':
          node.className = String(value)
          break
        case 'text':
          node.textContent = String(value)
          break
        case 'dataset':
          if (value && typeof value === 'object') {
            Object.assign(node.dataset, value)
          }
          break
        case 'style':
          if (value && typeof value === 'object') {
            for (const prop in value) {
              node.style.setProperty(prop, String(value[prop]))
            }
          }
          break
        case 'on':
          if (value && typeof value === 'object') {
            for (const evt in value) {
              node.addEventListener(evt, /** @type {EventListener} */ (value[evt]))
            }
          }
          break
        default:
          if (value === false || value === null || value === undefined) continue
          if (value === true) {
            node.setAttribute(key, key)
          } else {
            node.setAttribute(key, String(value))
          }
      }
    }
  }

  if (children) {
    for (const child of children) {
      if (child) node.appendChild(child)
    }
  }

  return node
}

/**
 * Set text on an existing node. This is the **single XSS chokepoint** —
 * `textContent` only, never `innerHTML`. Every user-authored string in
 * the app passes through here (architecture §12.1).
 *
 * @param {HTMLElement} node
 * @param {string} str
 */
export function text(node, str) {
  node.textContent = str
}

/**
 * Add an event listener and return a removal function.
 *
 * @param {EventTarget} target
 * @param {string} type
 * @param {EventListener} handler
 * @param {AddEventListenerOptions} [opts]
 * @returns {() => void}
 */
export function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts)
  return () => target.removeEventListener(type, handler, opts)
}

/**
 * Query selector — convenience wrapper, returns null if not found.
 *
 * @template {HTMLElement} T
 * @param {string} selector
 * @param {ParentNode} [parent]
 * @returns {T | null}
 */
export function qs(selector, parent) {
  return /** @type {T | null} */ (
    (parent ?? document).querySelector(selector)
  )
}

/**
 * Query all — convenience wrapper.
 *
 * @param {string} selector
 * @param {ParentNode} [parent]
 * @returns {HTMLElement[]}
 */
export function qsa(selector, parent) {
  return Array.from((parent ?? document).querySelectorAll(selector))
}

// ---------------------------------------------------------------------------
// Focus trap — the single implementation (architecture §12.3)
// ---------------------------------------------------------------------------

/** @typedef {() => void} ReleaseFn */

/**
 * Activate a focus trap on a container. Tab and Shift+Tab are intercepted
 * so focus cycles within the container's focusable elements only.
 *
 * The trap is designed for modals and the splash: it keeps Tab from escaping
 * into the page behind the scrim. On release, focus moves to a specified
 * element (typically the one that opened the modal, or the main view).
 *
 * @param {HTMLElement} container The element to trap focus inside.
 * @param {HTMLElement} [initialFocus] Element to focus on activation
 *   (defaults to the first focusable child).
 * @returns {ReleaseFn} Call to release the trap and restore normal Tab.
 */
export function trapFocus(container, initialFocus) {
  // Focusable selectors — native controls and anything with tabindex >= 0.
  // `inert` elements and `hidden` elements are excluded by the browser.
  const selector =
    'a[href],button:not([disabled]),input:not([disabled]),' +
    'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

  /**
   * Get all focusable descendants of the container, filtering out those
   * inside `[hidden]` subtrees or `inert` ancestors.
   * @returns {HTMLElement[]}
   */
  function focusable() {
    /** @type {HTMLElement[]} */
    const result = []
    const all = container.querySelectorAll(selector)
    for (const e of all) {
      // Skip if the element itself or an ancestor is hidden or inert.
      let node = e
      let skip = false
      while (node && node !== container) {
        if (node.hidden || node.hasAttribute('inert')) {
          skip = true
          break
        }
        node = node.parentElement
      }
      if (!skip && e.offsetParent !== null) {
        result.push(e)
      }
    }
    return result
  }

  // Focus the initial element or the first focusable one.
  if (initialFocus) {
    initialFocus.focus()
  } else {
    const first = focusable()[0]
    if (first) first.focus()
  }

  /**
   * Keydown handler — intercepts Tab to cycle within the container.
   * @param {KeyboardEvent} ev
   */
  function onKeydown(ev) {
    if (ev.key !== 'Tab') return

    const items = focusable()
    if (items.length === 0) {
      ev.preventDefault()
      return
    }

    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement

    if (ev.shiftKey) {
      // Shift+Tab: if on the first item (or outside container), wrap to last.
      if (active === first || !container.contains(active)) {
        ev.preventDefault()
        last.focus()
      }
    } else {
      // Tab: if on the last item (or outside container), wrap to first.
      if (active === last || !container.contains(active)) {
        ev.preventDefault()
        first.focus()
      }
    }
  }

  container.addEventListener('keydown', onKeydown, true)

  // Return the release function.
  return () => {
    container.removeEventListener('keydown', onKeydown, true)
  }
}

/**
 * Move focus to an element (convenience for focus restoration on modal close).
 *
 * @param {HTMLElement} target
 */
export function moveFocus(target) {
  target.focus()
}