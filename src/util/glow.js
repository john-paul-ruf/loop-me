// @ts-check
/**
 * Per-effect additive glow helpers (feature per-effect-glow).
 *
 * FR-6 AC: **NO `shadowBlur`** — glow is a radial `CanvasGradient` composited
 * with the `'lighter'` blend op, exactly the sanctioned technique
 * `fuzz-flare.js` already uses. §6.5: gradients are minted at prepare time
 * only; the draw-time blit allocates nothing and takes no closure.
 *
 * `util/*` is import-legal for layer modules (architecture §4 rule 2), so this
 * is the correct home — a `render/*` or `core/glow.js` helper would not be.
 *
 * ## Param convention (binding, appended LAST in every glowing layer)
 *
 *     A('glowStrength', 0, 1, { default: { min: 0, max: 0 } })
 *
 * `glowStrength` is appended LAST to each layer's `params` array (positional
 * seed order is append-only — §9.2/§9.5). Its declared default is glow-off, so
 * a pre-glow seed (missing the trailing field) decodes to `glow === 0` via
 * `clampComposition`, and `gs === 0` is a hard no-op in `draw`. Result: every
 * previously-shared seed renders **byte-identical**. New randomized art glows
 * because `randomize.js` samples the declared `[0, 1]` bounds, not the default.
 *
 * Exception: `fuzz-flare.js` (id 13) defaults to `{ min: 1, max: 1 }` — its
 * pre-glow output already WAS the glow, so its neutral (byte-identical) value
 * is 1, not 0.
 *
 * ## Canonical draw-time idiom (batches copy this verbatim)
 *
 *     // In draw(), BEFORE the layer's existing main marks — glow sits UNDER
 *     // the shape (drawn first, layered beneath in z-order).
 *     const gs = /** @type {number} *\/ (resolved.glowStrength)
 *     if (gs > 0) {
 *       const a0 = ctx.globalAlpha              // painter-set envelope alpha
 *       ctx.save()
 *       ctx.globalCompositeOperation = 'lighter' // additive
 *       ctx.globalAlpha = a0 * gs
 *       // technique-specific additive draw (wide re-stroke, or glowSprite blits)
 *       ctx.restore()                            // restores blend + alpha for the marks
 *     }
 *
 * ## `worstCase` bump
 *
 * Every glowing layer raises its declared `meta.worstCase.drawCalls` and
 * `.pathOps` to cover the additive sub-pass. The bump is per-technique
 * (wide re-stroke doubles stroke calls; per-sprite blit adds one drawCall per
 * blit) — declared honestly, verified by the tests/layers.test.js glow suite.
 *
 * This module imports nothing.
 */

/**
 * Mint a unit-radius radial glow gradient (opaque centre → transparent rim) in
 * the layer's own colour, against a scratch context. Call **once** in
 * `prepare()`, cache on the `Prepared` object, and pass to `glowSprite` in
 * `draw()`.
 *
 * The gradient is unit-radius (0 → 1) so the caller controls the on-canvas
 * size with a transform scale in `glowSprite` — no allocation per frame.
 *
 * @param {(w: number, h: number) => HTMLCanvasElement} scratch
 *   The `statics.scratch` factory injected by `render/prepare.js` (D4).
 * @param {string} hex
 *   Resolved `'#RRGGBB'` (i.e. `statics.color`).
 * @returns {CanvasGradient}
 */
export function glowGradient(scratch, hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const sctx = /** @type {CanvasRenderingContext2D} */ (scratch(1, 1).getContext('2d'))
  const grad = sctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`)
  grad.addColorStop(0.4, `rgba(${r},${g},${b},0.5)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  return grad
}

/**
 * Additive blit of a unit-radius glow gradient, scaled to radius `rad` at
 * `(cx, cy)`. Absolute transform — the painter's per-layer save/restore fence
 * resets it after the layer draws (§6.4).
 *
 * Caller must have already set `globalCompositeOperation = 'lighter'` and the
 * desired `globalAlpha` (see the canonical draw-time idiom in the file
 * header). Allocation-free, closure-free (§6.5).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasGradient} gradient
 * @param {number} cx
 * @param {number} cy
 * @param {number} rad
 */
export function glowSprite(ctx, gradient, cx, cy, rad) {
  ctx.setTransform(rad, 0, 0, rad, cx, cy)
  ctx.fillStyle = gradient
  ctx.fillRect(-1, -1, 2, 2)
}
