// @ts-check
/**
 * feedback.js — dismissible governor banner (FR-15 extension) plus the
 * `activeBanners` dangling-key fix (layer-hide-and-fps-dismiss SESSION-02).
 *
 * First direct suite for `src/ui/feedback.js`. Mount discipline mirrors
 * `panel.test.js`: detached DOM per test, `initFeedback` with fresh mounts,
 * and a teardown that restores `state.governorWarned` and re-inits with a
 * scratch mount to drain module state + unsubscribe the previous listener.
 *
 * The governor path is driven purely via `state.governorWarned = …` +
 * `publish(TOPICS.GOVERNOR, true, <fps>)`. `render/governor.js` is never
 * imported — feedback.js's contract is with the topic, not the module.
 */

import { suite, test, assert, assertEq } from './harness.js'
import { state, publish, TOPICS } from '../src/core/state.js'
import { report, CLIPBOARD_UNAVAILABLE } from '../src/core/errors.js'
import { initFeedback } from '../src/ui/feedback.js'

/**
 * Attach fresh mounts and wire `initFeedback` to them.
 * @returns {{ feedbackEl: HTMLElement, liveEl: HTMLElement }}
 */
function mount() {
  const feedbackEl = document.createElement('div')
  feedbackEl.id = 'feedback-fixture'
  document.body.appendChild(feedbackEl)
  const liveEl = document.createElement('div')
  liveEl.id = 'live-fixture'
  document.body.appendChild(liveEl)
  initFeedback(feedbackEl, liveEl)
  return { feedbackEl, liveEl }
}

/**
 * Reset the governor flag, then re-init `feedback.js` against a detached
 * scratch node so its subscriptions/latch/banners are drained before the
 * next test mounts its own DOM.
 * @param {HTMLElement} feedbackEl
 * @param {HTMLElement} liveEl
 */
function unmount(feedbackEl, liveEl) {
  state.governorWarned = false
  const scratch = document.createElement('div')
  initFeedback(scratch, scratch)
  feedbackEl.remove()
  liveEl.remove()
}

suite('feedback — dismissible governor banner (FR-15 ext, S02)', () => {
  test('warn publish creates one .banner--warn with a Dismiss button', () => {
    const { feedbackEl, liveEl } = mount()
    try {
      state.governorWarned = true
      publish(TOPICS.GOVERNOR, true, 21)
      const banners = feedbackEl.querySelectorAll('.banner--warn')
      assertEq(banners.length, 1, 'exactly one warn banner')
      const dismiss = banners[0].querySelector('button[aria-label="Dismiss"]')
      assert(dismiss !== null, 'the banner carries a Dismiss button')
    } finally { unmount(feedbackEl, liveEl) }
  })

  test('the fps figure from publish args appears in the banner body', () => {
    const { feedbackEl, liveEl } = mount()
    try {
      state.governorWarned = true
      publish(TOPICS.GOVERNOR, true, 27)
      const bodyDivs = feedbackEl.querySelectorAll('.banner--warn .banner__body div')
      // The second child of .banner__body is the message; the first is the title.
      const bodyText = bodyDivs[bodyDivs.length - 1]?.textContent ?? ''
      assert(bodyText.includes('27'), 'body should mention "27" fps: ' + bodyText)
    } finally { unmount(feedbackEl, liveEl) }
  })

  test('clicking Dismiss removes the governor banner from the DOM', () => {
    const { feedbackEl, liveEl } = mount()
    try {
      state.governorWarned = true
      publish(TOPICS.GOVERNOR, true, 20)
      const dismiss = /** @type {HTMLButtonElement | null} */ (
        feedbackEl.querySelector('.banner--warn button[aria-label="Dismiss"]')
      )
      assert(dismiss !== null, 'Dismiss button exists before click')
      dismiss.click()
      assertEq(
        feedbackEl.querySelectorAll('.banner--warn').length,
        0,
        'banner is gone after Dismiss',
      )
    } finally { unmount(feedbackEl, liveEl) }
  })

  test('latch: another publish while still warned does NOT re-create the banner', () => {
    const { feedbackEl, liveEl } = mount()
    try {
      state.governorWarned = true
      publish(TOPICS.GOVERNOR, true, 20)
      const dismiss = /** @type {HTMLButtonElement} */ (
        feedbackEl.querySelector('.banner--warn button[aria-label="Dismiss"]')
      )
      dismiss.click()
      // Governor is still hot; the next window's decision republishes true.
      publish(TOPICS.GOVERNOR, true, 22)
      assertEq(
        feedbackEl.querySelectorAll('.banner--warn').length,
        0,
        'latched — no re-show within the same hot episode',
      )
    } finally { unmount(feedbackEl, liveEl) }
  })

  test('reset: cooling clears the latch, a new hot episode warns again', () => {
    const { feedbackEl, liveEl } = mount()
    try {
      state.governorWarned = true
      publish(TOPICS.GOVERNOR, true, 20)
      const dismiss = /** @type {HTMLButtonElement} */ (
        feedbackEl.querySelector('.banner--warn button[aria-label="Dismiss"]')
      )
      dismiss.click()
      // Governor cools — this is what must reset the latch.
      state.governorWarned = false
      publish(TOPICS.GOVERNOR, false, 40)
      // A new hot episode arrives.
      state.governorWarned = true
      publish(TOPICS.GOVERNOR, true, 24)
      assertEq(
        feedbackEl.querySelectorAll('.banner--warn').length,
        1,
        'new episode re-warns',
      )
    } finally { unmount(feedbackEl, liveEl) }
  })

  test('aria-live: showing the governor banner writes its title', () => {
    const { feedbackEl, liveEl } = mount()
    try {
      state.governorWarned = true
      publish(TOPICS.GOVERNOR, true, 19)
      const titleEl = feedbackEl.querySelector('.banner--warn .banner__title')
      const title = titleEl?.textContent ?? ''
      assert(title.length > 0, 'banner has a title')
      assertEq(liveEl.textContent, title, 'live region matches the banner title')
    } finally { unmount(feedbackEl, liveEl) }
  })
})

suite('feedback — activeBanners dangling-key fix (S02)', () => {
  test('a dismissed non-persistent error banner can be re-reported', () => {
    const { feedbackEl, liveEl } = mount()
    try {
      // CLIPBOARD_UNAVAILABLE is non-persistent (STORAGE_UNAVAILABLE and
      // STORAGE_QUOTA are the only persistent codes), so its banner is
      // dismissible. errors.test.js's idiom for driving the channel is
      // simply report(<code>).
      report(CLIPBOARD_UNAVAILABLE)
      assertEq(
        feedbackEl.querySelectorAll('.banner').length,
        1,
        'the error banner shows on the first report',
      )
      const dismiss = /** @type {HTMLButtonElement | null} */ (
        feedbackEl.querySelector('.banner button[aria-label="Dismiss"]')
      )
      assert(dismiss !== null, 'a non-persistent error banner is dismissible')
      dismiss.click()
      assertEq(
        feedbackEl.querySelectorAll('.banner').length,
        0,
        'Dismiss removes the banner',
      )
      // Before the fix: the activeBanners key survived the dismiss and
      // this second report was silently suppressed for the whole session.
      report(CLIPBOARD_UNAVAILABLE)
      assertEq(
        feedbackEl.querySelectorAll('.banner').length,
        1,
        'a later report of the same code reopens the banner',
      )
    } finally { unmount(feedbackEl, liveEl) }
  })
})
