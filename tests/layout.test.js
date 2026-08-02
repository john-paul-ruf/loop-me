// @ts-check
/**
 * Layout contract tests — the dock sheet/rail split.
 *
 * Below 960px the dock is a bottom sheet; at >=960px it is a full-height
 * side rail (_tokens.css §3, `max-height: none`). The sheet-state
 * modifiers in layout.css (.dock--peek, .dock--expanded, .dock--dragging)
 * must be scoped to the mobile breakpoint: media queries add no
 * specificity, and layout.css loads after _tokens.css, so an UNSCOPED
 * `.dock--expanded { max-height: 62dvh }` out-cascades the desktop rail
 * override and caps the rail at 62% of the viewport (the "clipped
 * sidebar" bug). These tests assert stylesheet STRUCTURE via CSSOM, so
 * they hold at any harness window size.
 */

import { suite, test, assert, assertEq } from './harness.js'

/**
 * Load a stylesheet into the harness page if it is not already linked.
 * @param {string} href
 * @returns {Promise<void>}
 */
function loadCss(href) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`link[href="${href}"]`)) {
      resolve()
      return
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`failed to load ${href}`))
    document.head.appendChild(link)
  })
}

/**
 * The components.css entry in document.styleSheets.
 * @returns {CSSStyleSheet}
 */
function componentsSheet() {
  /** @type {CSSStyleSheet | null} */
  let found = null
  for (const sheet of document.styleSheets) {
    if (sheet.href !== null && sheet.href.endsWith('/styles/components.css')) found = sheet
  }
  assert(found !== null, 'components.css is in document.styleSheets')
  return found
}

/**
 * The layout.css entry in document.styleSheets. Same-origin, so its
 * cssRules are readable — no try/catch skip; fail loudly if absent.
 * @returns {CSSStyleSheet}
 */
function layoutSheet() {
  /** @type {CSSStyleSheet | null} */
  let found = null
  for (const sheet of document.styleSheets) {
    if (sheet.href !== null && sheet.href.endsWith('/styles/layout.css')) found = sheet
  }
  assert(found !== null, 'layout.css is in document.styleSheets')
  return found
}

/** @typedef {{ rule: CSSStyleRule, insideMobileMedia: boolean }} DockStateRule */

/**
 * Every style rule in layout.css whose selector names a dock sheet state,
 * with whether it sits inside a `max-width` media rule.
 * @returns {DockStateRule[]}
 */
function dockStateRules() {
  /** @type {DockStateRule[]} */
  const out = []
  /**
   * @param {CSSRuleList} rules
   * @param {boolean} insideMobileMedia
   */
  function walk(rules, insideMobileMedia) {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule) {
        walk(rule.cssRules, insideMobileMedia || rule.conditionText.includes('max-width'))
      } else if (rule instanceof CSSStyleRule && /\.dock--(peek|expanded|dragging)/.test(rule.selectorText)) {
        out.push({ rule, insideMobileMedia })
      }
    }
  }
  walk(layoutSheet().cssRules, false)
  return out
}

suite('layout', () => {
  test('layout.css loads in the harness', async () => {
    await loadCss('../styles/layout.css')
    assert(layoutSheet().cssRules.length > 0, 'layout.css has at least one rule')
  })

  test('dock sheet states are scoped to a max-width media rule', () => {
    const states = dockStateRules()
    assert(states.length > 0, 'layout.css declares the dock sheet states')
    const unscoped = states.filter((s) => !s.insideMobileMedia)
    assert(
      unscoped.length === 0,
      `dock state rule(s) outside a max-width media rule: ${unscoped.map((s) => s.rule.selectorText).join(', ')}`,
    )
  })

  test('the mobile sheet cap itself still exists', () => {
    const states = dockStateRules()
    assert(
      states.some((s) => s.rule.selectorText === '.dock--expanded' && s.rule.style.maxHeight === '62dvh'),
      '.dock--expanded { max-height: 62dvh } exists (the sheet cap was not deleted)',
    )
    assert(
      states.some((s) => s.rule.selectorText === '.dock--peek .dock__scroll' && s.rule.style.display === 'none'),
      '.dock--peek .dock__scroll { display: none } exists (peek still hides the panel)',
    )
  })

  test('the desktop rail re-lift exists at min-width: 960px', () => {
    // _tokens.css §3 (the >=960px rail block) precedes its own §4 sheet
    // base rules, so §4's `max-height: 62dvh` and grabber `display: block`
    // win on desktop at equal specificity. layout.css restates the lift in
    // a min-width media rule (SESSION-01); deleting it re-caps the rail.
    let dockLifted = false
    let grabberHidden = false
    for (const rule of layoutSheet().cssRules) {
      if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('min-width')) continue
      for (const inner of rule.cssRules) {
        if (!(inner instanceof CSSStyleRule)) continue
        if (inner.selectorText === '.dock' && inner.style.maxHeight === 'none') dockLifted = true
        if (inner.selectorText === '.dock__grabber' && inner.style.display === 'none') grabberHidden = true
      }
    }
    assert(dockLifted, 'a min-width media rule in layout.css re-lifts .dock { max-height: none }')
    assert(grabberHidden, 'a min-width media rule in layout.css hides .dock__grabber on desktop')
  })
})

suite('components — range band hit target', () => {
  test('.range-input is pointer-events:auto (native drag restored)', async () => {
    await loadCss('../styles/components.css')
    const input = document.createElement('input')
    input.type = 'range'
    input.className = 'range-input range-input--max'
    document.body.appendChild(input)
    const pe = getComputedStyle(input).pointerEvents
    input.remove()
    assertEq(pe, 'auto',
      '.range-input must be pointer-events:auto so native dragging works')
  })

  test('.range-input--min/--max carry a clip-path split (components.css)', async () => {
    await loadCss('../styles/components.css')
    let minClip = ''
    let maxClip = ''
    for (const rule of componentsSheet().cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue
      if (rule.selectorText === '.range-input--min') minClip = rule.style.getPropertyValue('clip-path')
      if (rule.selectorText === '.range-input--max') maxClip = rule.style.getPropertyValue('clip-path')
    }
    assert(minClip.includes('inset') && minClip.includes('band-split'),
      '.range-input--min clips to the left half via --band-split')
    assert(maxClip.includes('inset') && maxClip.includes('band-split'),
      '.range-input--max clips to the right half via --band-split')
  })

  test('.range-input rule exists in components.css (not accidentally deleted)', async () => {
    await loadCss('../styles/components.css')
    let found = false
    for (const rule of componentsSheet().cssRules) {
      if (rule instanceof CSSStyleRule && rule.selectorText === '.range-input') {
        found = true
        break
      }
    }
    assert(found, '.range-input rule exists in components.css')
  })
})
