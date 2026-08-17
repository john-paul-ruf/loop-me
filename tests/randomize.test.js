// @ts-check
/**
 * D5 — Randomize taste-rule and validity tests (FR-9, architecture §8.5).
 *
 * `generate()` is the engine behind Randomize. It is the sole source of fresh
 * compositions when no seed is present, and it is the fallback when a seed
 * fails to decode (FR-18). Its contract is FR-9: "Randomize produces a valid,
 * renderable composition every time."
 *
 * What this suite asserts:
 *
 *   - **Validity**: every `generate()` result passes `composition.validate()`.
 *   - **No blank / no all-one-colour**: 100 consecutive generate() calls have
 *     ≥ 1 layer whose resolved colour differs from the background (FR-9 AC).
 *   - **Variety**: 20 consecutive generate() calls yield ≥ 15 distinct
 *     layer-type multisets (FR-9 AC).
 *   - **Each taste rule individually**:
 *     1. Role quotas: 1–2 primary, 0–2 secondary, 0–2 overlay, total 2–5.
 *     2. At most one fullCanvasOpaque layer (tested with a synthetic opaque type).
 *     3. `difference` never at index 0.
 *     4. No layer's resolved colour equals the canvas background.
 *     5. Additive/screen overlay layers have times ≤ 2 on every A param.
 *   - **Governor block**: warned mode produces 2–3 layers.
 *   - **5-layer cap**: never exceeds 5.
 *
 * Imports `model/randomize.js`, `model/composition.js`, `model/registry.js`,
 * `model/schemes.js`, `model/blend.js`, `model/params.js`, `core/rng.js`,
 * `tests/harness.js`.
 */

import { suite, test, assert } from './harness.js'
import { generate, generateLayer } from '../src/model/randomize.js'
import { validate } from '../src/model/composition.js'
import { list, register } from '../src/model/registry.js'
import { resolveRef, BUILTINS } from '../src/model/schemes.js'
import {
  BLEND_DIFFERENCE, BLEND_MULTIPLY, BLEND_OVERLAY,
  BLEND_SOFT_LIGHT, BLEND_HUE, BLEND_LUMINOSITY,
  FLASHY_BLENDS,
} from '../src/model/blend.js'
import { A } from '../src/model/params.js'

/** @typedef {import('../src/model/params.js').Composition} Composition */
/** @typedef {import('../src/model/params.js').Layer} Layer */
/** @typedef {import('../src/model/params.js').AnimValue} AnimValue */
/** @typedef {import('../src/model/registry.js').LayerModule} LayerModule */

// ---------------------------------------------------------------------------
// Synthetic opaque layer type (ID 920) — to prove taste rule 2 is not vacuous.
// All 16 real types have fullCanvasOpaque: false; a seventeenth type may be
// true, and the rule must work when it is.
// ---------------------------------------------------------------------------

/** @type {LayerModule} */
const OPAQUE_TEST_LAYER = {
  meta: {
    id: 920,
    name: 'Opaque Test',
    role: 'overlay',
    blurb: 'Synthetic full-canvas opaque layer for taste-rule tests.',
    worstCase: { pathOps: 1, drawCalls: 1 },
    fullCanvasOpaque: true,
  },
  params: [
    A('intensity', 0.1, 1.0),
  ],
  prepare: () => ({}),
  draw: () => {},
}

try { register(OPAQUE_TEST_LAYER) } catch { /* already registered */ }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {Composition} c
 * @returns {string} Sorted type IDs joined — a multiset fingerprint.
 */
function typeMultiset(c) {
  return c.layers.map((l) => l.type).sort((a, b) => a - b).join(',')
}

// ---------------------------------------------------------------------------
// Validity (FR-9 AC: "valid, renderable composition every time")
// ---------------------------------------------------------------------------

suite('randomize — validity (FR-9)', () => {
  test('every generate() passes validate()', () => {
    for (let i = 0; i < 100; i++) {
      const c = generate()
      assert(validate(c), `generate() #${i} failed validate()`)
    }
  })

  test('every generate() has 1–5 layers', () => {
    for (let i = 0; i < 100; i++) {
      const c = generate()
      assert(c.layers.length >= 1 && c.layers.length <= 5,
        `generate() #${i} has ${c.layers.length} layers`)
    }
  })

  test('every generate() has a valid durationId', () => {
    for (let i = 0; i < 100; i++) {
      const c = generate()
      assert(c.durationId >= 0 && c.durationId <= 2,
        `durationId ${c.durationId} out of range`)
    }
  })

  test('every generate() has a valid built-in scheme', () => {
    // omni-wave S05: length-derived range so future BUILTINS appends need no pin bump.
    for (let i = 0; i < 100; i++) {
      const c = generate()
      assert(typeof c.scheme === 'number' && c.scheme >= 0 && c.scheme < BUILTINS.length,
        `scheme ${c.scheme} out of range [0, ${BUILTINS.length})`)
    }
  })

  test('generate() spreads across every built-in scheme in 200 runs', () => {
    // Distribution smoke — proves generate() actually samples the full BUILTINS
    // range, not a stale hardcoded subset. 200 runs against 8 built-ins with a
    // uniform draw is astronomically unlikely to miss any bucket; a bug that
    // hardcoded the pick range would leave visible gaps here.
    const seen = new Set()
    for (let i = 0; i < 200; i++) {
      seen.add(generate().scheme)
    }
    assert(seen.size === BUILTINS.length,
      `expected all ${BUILTINS.length} built-ins to appear in 200 runs; saw ${seen.size} (${[...seen].sort((a,b)=>a-b).join(',')})`)
  })

  test('every layer has a registered type', () => {
    for (let i = 0; i < 100; i++) {
      const c = generate()
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        assert(mod !== undefined, `layer type ${layer.type} not registered`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// No blank / no all-one-colour (FR-9 AC)
// ---------------------------------------------------------------------------

suite('randomize — no blank canvas (FR-9 AC)', () => {
  test('100 consecutive randomizes have a layer colour differing from background', () => {
    for (let i = 0; i < 100; i++) {
      const c = generate()
      const scheme = BUILTINS[c.scheme]
      const bg = scheme.backgrounds[0]
      let hasDifferent = false
      for (const layer of c.layers) {
        if (resolveRef(scheme, layer.color) !== bg) {
          hasDifferent = true
          break
        }
      }
      assert(hasDifferent,
        `generate() #${i}: every layer colour matches the background — all-one-colour canvas`)
    }
  })
})

// ---------------------------------------------------------------------------
// Variety (FR-9 AC: 20 consecutive → ≥ 15 distinct multisets)
// ---------------------------------------------------------------------------

suite('randomize — variety (FR-9 AC)', () => {
  test('20 consecutive randomizes yield ≥ 15 distinct layer-type multisets', () => {
    const seen = new Set()
    for (let i = 0; i < 20; i++) {
      seen.add(typeMultiset(generate()))
    }
    assert(seen.size >= 15,
      `only ${seen.size} distinct multisets from 20 randomizes — expected ≥ 15`)
  })
})

// ---------------------------------------------------------------------------
// Taste rule 1: role quotas
// ---------------------------------------------------------------------------

suite('randomize — taste rule 1: role quotas (§8.5)', () => {
  test('every generate() has 1–2 primary, 0–2 secondary, 0–2 overlay, 0–1 glitch, total 2–5', () => {
    for (let i = 0; i < 200; i++) {
      const c = generate()
      let p = 0, s = 0, o = 0, g = 0
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        if (!mod) continue
        if (mod.meta.role === 'primary') p++
        else if (mod.meta.role === 'secondary') s++
        else if (mod.meta.role === 'overlay') o++
        else if (mod.meta.role === 'glitch') g++
      }
      // p/s/o quotas are asserted over the NON-glitch remainder — the glitch
      // seat is a fourth budget line, not one that eats into p/s/o's bounds.
      assert(p >= 1 && p <= 2, `generate() #${i}: ${p} primary, expected 1–2`)
      assert(s >= 0 && s <= 2, `generate() #${i}: ${s} secondary, expected 0–2`)
      assert(o >= 0 && o <= 2, `generate() #${i}: ${o} overlay, expected 0–2`)
      assert(g >= 0 && g <= 1, `generate() #${i}: ${g} glitch, expected 0–1`)
      assert(c.layers.length >= 2 && c.layers.length <= 5,
        `generate() #${i}: ${c.layers.length} total, expected 2–5`)
    }
  })

  test('when a glitch layer is present it is last, at index ≥ 2, ≥ 2 non-glitch below', () => {
    // Glitch fires at ~35% in 3+-layer stacks; 300 runs makes at least one
    // occurrence overwhelmingly likely. This test also pins "never twice" —
    // exactly one glitch per composition when any is present.
    let sawGlitch = false
    for (let i = 0; i < 300; i++) {
      const c = generate()
      let glitchIndex = -1
      let glitchCount = 0
      for (let j = 0; j < c.layers.length; j++) {
        const mod = list().find((m) => m.meta.id === c.layers[j].type)
        if (mod && mod.meta.role === 'glitch') {
          glitchIndex = j
          glitchCount++
        }
      }
      if (glitchCount === 0) continue
      sawGlitch = true
      assert(glitchCount === 1,
        `generate() #${i}: ${glitchCount} glitch layers — glitch is 0–1 per composition`)
      assert(glitchIndex === c.layers.length - 1,
        `generate() #${i}: glitch at index ${glitchIndex}, expected last (${c.layers.length - 1})`)
      assert(glitchIndex >= 2,
        `generate() #${i}: glitch at index ${glitchIndex}, expected ≥ 2 (≥ 2 non-glitch below)`)
      let nonGlitchBelow = 0
      for (let j = 0; j < glitchIndex; j++) {
        const mod = list().find((m) => m.meta.id === c.layers[j].type)
        if (!mod || mod.meta.role !== 'glitch') nonGlitchBelow++
      }
      assert(nonGlitchBelow >= 2,
        `generate() #${i}: only ${nonGlitchBelow} non-glitch layers below the glitch`)
    }
    assert(sawGlitch,
      'no glitch layer appeared in 300 randomize runs — the quota may be broken')
  })

  test('governor warned mode produces 2–3 layers', () => {
    for (let i = 0; i < 100; i++) {
      const c = generate(true)
      assert(c.layers.length >= 2 && c.layers.length <= 3,
        `warned generate() #${i}: ${c.layers.length} layers, expected 2–3`)
    }
  })

  test('governor warned mode never emits a glitch layer', () => {
    // Rule 1 extension: glitch is excluded when the governor has warned —
    // self-blitting a full frame is the wrong response to a struggling loop.
    for (let i = 0; i < 200; i++) {
      const c = generate(true)
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        assert(!mod || mod.meta.role !== 'glitch',
          `warned generate() #${i}: emitted a glitch layer`)
      }
    }
  })

  test('5-layer cap is never exceeded', () => {
    for (let i = 0; i < 500; i++) {
      const c = generate()
      assert(c.layers.length <= 5,
        `generate() #${i}: ${c.layers.length} layers, cap is 5`)
    }
  })
})

// ---------------------------------------------------------------------------
// Taste rule 2: at most one fullCanvasOpaque layer
// ---------------------------------------------------------------------------

suite('randomize — taste rule 2: at most one opaque layer (§8.5)', () => {
  test('never more than one fullCanvasOpaque layer in a composition', () => {
    // The synthetic type 920 is opaque; generate() should filter it out
    // after the first opaque layer is picked. Run enough iterations to hit
    // the synthetic type at least sometimes (it joins the overlay pool).
    for (let i = 0; i < 500; i++) {
      const c = generate()
      let opaqueCount = 0
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        if (mod && mod.meta.fullCanvasOpaque) opaqueCount++
      }
      assert(opaqueCount <= 1,
        `generate() #${i}: ${opaqueCount} opaque layers, max is 1`)
    }
  })
})

// ---------------------------------------------------------------------------
// Taste rule 3: difference never at index 0
// ---------------------------------------------------------------------------

suite('randomize — taste rule 3: difference never at index 0 (§8.5)', () => {
  test('the bottom layer never has blend difference (5)', () => {
    for (let i = 0; i < 300; i++) {
      const c = generate()
      assert(c.layers[0].blend !== BLEND_DIFFERENCE,
        `generate() #${i}: bottom layer has difference blend`)
    }
  })

  test('non-bottom layers can have difference', () => {
    // Just verify difference is not universally excluded — at least one of
    // 300 generations should produce it somewhere above index 0.
    let foundDifference = false
    for (let i = 0; i < 300; i++) {
      const c = generate()
      for (let j = 1; j < c.layers.length; j++) {
        if (c.layers[j].blend === BLEND_DIFFERENCE) {
          foundDifference = true
          break
        }
      }
      if (foundDifference) break
    }
    // Not a hard assertion — difference is 1/7 probability on non-bottom
    // layers, and it may not appear in 300 tries. But it should, so we assert
    // with a generous margin. If this ever fails, it means the generator is
    // excluding difference everywhere, which would be wrong.
    // Actually with ~2 non-bottom layers × 1/7 blend each × 300 tries,
    // the probability of never seeing it is ~(6/7)^600 ≈ 0, so this should pass.
    assert(foundDifference, 'difference blend should appear on non-bottom layers')
  })
})

// ---------------------------------------------------------------------------
// Taste rule 4: colour ≠ background
// ---------------------------------------------------------------------------

suite('randomize — taste rule 4: colour ≠ background (§8.5)', () => {
  test('no layer has a resolved colour equal to the canvas background', () => {
    for (let i = 0; i < 300; i++) {
      const c = generate()
      const scheme = BUILTINS[c.scheme]
      const bg = scheme.backgrounds[0]
      for (const layer of c.layers) {
        const resolved = resolveRef(scheme, layer.color)
        assert(resolved !== bg,
          `generate() #${i}: layer colour ${resolved} equals background ${bg}`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Taste rule 5: flash safety — times ≤ 2 on additive/screen overlay layers
// ---------------------------------------------------------------------------

suite('randomize — taste rule 5: flash safety (FR-17 ≤ 3 Hz)', () => {
  test('flashy-blend overlay layers have times ≤ 2 on every A param (add/screen/color-dodge/lighten)', () => {
    for (let i = 0; i < 500; i++) {
      const c = generate()
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        if (!mod || mod.meta.role !== 'overlay') continue
        if (!FLASHY_BLENDS.includes(layer.blend)) continue

        // Envelope opacity
        assert(layer.opacity.times <= 2,
          `generate() #${i}: flashy overlay (blend ${layer.blend}) opacity times ${layer.opacity.times} > 2`)

        // Declared A params
        for (const decl of mod.params) {
          if (decl.kind !== 'A') continue
          const av = /** @type {AnimValue} */ (layer.params[decl.name])
          if (typeof av === 'object' && av !== null) {
            assert(av.times <= 2,
              `generate() #${i}: flashy overlay (blend ${layer.blend}) param "${decl.name}" times ${av.times} > 2`)
          }
        }
      }
    }
  })

  test('flashy-blend glitch layers have times ≤ 2 on every A param', () => {
    // Rule 5 extension: glitch is a self-blit of the composited frame, so its
    // strobing is still strobing — same cap as flashy overlays. Expected hit
    // rate per run ≈ P(glitch) · P(blend ∈ FLASHY) ≈ 0.26 · 4/11 ≈ 0.09, so
    // 500 runs land ~45 samples: the sawAny sanity pin passes overwhelmingly
    // if the cap is actually running.
    let sawAny = false
    for (let i = 0; i < 500; i++) {
      const c = generate()
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        if (!mod || mod.meta.role !== 'glitch') continue
        if (!FLASHY_BLENDS.includes(layer.blend)) continue
        sawAny = true

        // Envelope opacity
        assert(layer.opacity.times <= 2,
          `generate() #${i}: flashy glitch (blend ${layer.blend}) opacity times ${layer.opacity.times} > 2`)

        // Declared A params
        for (const decl of mod.params) {
          if (decl.kind !== 'A') continue
          const av = /** @type {AnimValue} */ (layer.params[decl.name])
          if (typeof av === 'object' && av !== null) {
            assert(av.times <= 2,
              `generate() #${i}: flashy glitch (blend ${layer.blend}) param "${decl.name}" times ${av.times} > 2`)
          }
        }
      }
    }
    assert(sawAny,
      'no flashy-blend glitch layer appeared in 500 randomize runs — cap coverage unproven')
  })

  test('non-flashy overlay layers can have times > 2 (rule only applies to FLASHY_BLENDS)', () => {
    let found = false
    for (let i = 0; i < 500; i++) {
      const c = generate()
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        if (!mod || mod.meta.role !== 'overlay') continue
        if (FLASHY_BLENDS.includes(layer.blend)) continue
        if (layer.opacity.times > 2) {
          found = true
          break
        }
      }
      if (found) break
    }
    // Not a hard assertion — but with ~0.5 probability of times > 2 on each
    // overlay envelope and 7/11 of overlays being non-flashy, this should hit
    // within 500 iterations.
    assert(found, 'a non-flashy overlay layer should get times > 2 somewhere')
  })

  test('soft-light / hue / luminosity overlays do NOT trip the cap (regression)', () => {
    // The three "not brightening" modes from the omni-wave S05 blend set —
    // they read colour, not intensity, so a full-loop opacity cycle is not
    // a strobe. Rule 5 must let them keep times > 2. Sanity: at least one
    // of the three should appear over 500 runs with times > 2 on any A
    // param (envelope opacity or declared).
    const NOT_FLASHY = [BLEND_SOFT_LIGHT, BLEND_HUE, BLEND_LUMINOSITY]
    let found = false
    for (let i = 0; i < 500 && !found; i++) {
      const c = generate()
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        if (!mod || mod.meta.role !== 'overlay') continue
        if (!NOT_FLASHY.includes(layer.blend)) continue
        if (layer.opacity.times > 2) { found = true; break }
        for (const decl of mod.params) {
          if (decl.kind !== 'A') continue
          const av = /** @type {AnimValue} */ (layer.params[decl.name])
          if (typeof av === 'object' && av !== null && av.times > 2) {
            found = true
            break
          }
        }
        if (found) break
      }
    }
    assert(found,
      'no soft-light/hue/luminosity overlay hit times > 2 in 500 runs — cap may be over-broad')
  })
})

// ---------------------------------------------------------------------------
// Glitch distribution smoke test (§8.5 rule 1 extension, tuning-observation)
// ---------------------------------------------------------------------------

suite('randomize — glitch distribution (§8.5 rule 1)', () => {
  test('~20–50% of 3+-layer compositions contain a glitch layer; never twice', () => {
    // The wantGlitch gate fires at p = 0.35 for every non-warned generation
    // whose `total` drew ≥ 3, so the empirical rate in the 3+-layer subset
    // should track that number. Bounds are loose (20–50%) to pin behaviour
    // rather than the exact probability — a re-tune in a future session should
    // land inside them if the change is a nudge and outside if it is a rewrite.
    //
    // With intRange(2, 5) uniform, ~75% of 300 runs are 3+-layer, so the
    // 3σ ≈ 0.09 around 0.35 sits comfortably inside 0.20–0.50.
    //
    // Seed-free: generate() uses Math.random() (module's documented exception).
    let denom = 0
    let numer = 0
    for (let i = 0; i < 300; i++) {
      const c = generate()
      if (c.layers.length < 3) continue
      denom++
      let g = 0
      for (const layer of c.layers) {
        const mod = list().find((m) => m.meta.id === layer.type)
        if (mod && mod.meta.role === 'glitch') g++
      }
      assert(g <= 1,
        `generate() #${i}: ${g} glitch layers — expected at most 1 (never twice)`)
      if (g === 1) numer++
    }
    assert(denom > 0,
      '300 runs produced zero 3+-layer compositions — extremely unlikely, investigate')
    const rate = numer / denom
    assert(rate >= 0.20 && rate <= 0.50,
      `glitch rate ${rate.toFixed(3)} in 3+-layer stacks (n=${denom}), expected 0.20–0.50`)
  })
})

// ---------------------------------------------------------------------------
// Determinism (FR-4): Math.random is only at the top — downstream is seeded
// ---------------------------------------------------------------------------

suite('randomize — determinism structure (FR-4)', () => {
  test('generate() returns a composition with every layer having a valid rngSeed', () => {
    // rngSeed 0 is legal (mulberry32(0) works), but a random uint32 should
    // produce nonzero seeds most of the time. This is a smoke test for the
    // seeding path, not a statistical assertion.
    for (let i = 0; i < 100; i++) {
      const c = generate()
      for (const layer of c.layers) {
        assert(typeof layer.rngSeed === 'number' && Number.isInteger(layer.rngSeed),
          `layer rngSeed is not a uint32`)
        assert(layer.rngSeed >= 0 && layer.rngSeed <= 0xFFFFFFFF,
          `layer rngSeed ${layer.rngSeed} out of uint32 range`)
      }
    }
  })

  test('two generate() calls produce different compositions (Math.random seeds differ)', () => {
    // This is probabilistic — two Math.random() calls produce different seeds
    // with overwhelming probability. If this ever fails, the seeding path is
    // broken.
    const a = generate()
    const b = generate()
    assert(typeMultiset(a) !== typeMultiset(b) || a.durationId !== b.durationId || a.scheme !== b.scheme,
      'two generate() calls produced identical compositions — Math.random seeding may be broken')
  })
})

// ---------------------------------------------------------------------------
// generateLayer — per-layer reroll (SESSION-03 / blend-trim-and-control-fixes)
// ---------------------------------------------------------------------------

suite('randomize — generateLayer (per-layer reroll)', () => {
  test('preserves the layer type and stack index', () => {
    for (let i = 0; i < 100; i++) {
      const c = generate()
      const scheme = BUILTINS[c.scheme]
      for (let idx = 0; idx < c.layers.length; idx++) {
        const before = c.layers[idx]
        const after = generateLayer(before, scheme, idx)
        assert(after.type === before.type,
          `generateLayer changed type at #${i}/${idx}`)
      }
    }
  })

  test('never produces a retired blend (multiply/overlay)', () => {
    for (let i = 0; i < 200; i++) {
      const c = generate()
      const scheme = BUILTINS[c.scheme]
      for (let idx = 0; idx < c.layers.length; idx++) {
        const l = generateLayer(c.layers[idx], scheme, idx)
        assert(l.blend !== BLEND_MULTIPLY && l.blend !== BLEND_OVERLAY,
          `generateLayer emitted a retired blend (${l.blend})`)
      }
    }
  })

  test('index 0 never gets difference; colour never equals background', () => {
    for (let i = 0; i < 200; i++) {
      const c = generate()
      const scheme = BUILTINS[c.scheme]
      const bg = scheme.backgrounds[0]
      const l0 = generateLayer(c.layers[0], scheme, 0)
      assert(l0.blend !== BLEND_DIFFERENCE, 'index-0 reroll got difference')
      for (let idx = 0; idx < c.layers.length; idx++) {
        const l = generateLayer(c.layers[idx], scheme, idx)
        assert(resolveRef(scheme, l.color) !== bg, 'reroll colour equals background')
      }
    }
  })

  test('produces a valid layer (survives composition.validate via swap-in)', () => {
    for (let i = 0; i < 100; i++) {
      const c = generate()
      const scheme = BUILTINS[c.scheme]
      const idx = 0
      c.layers[idx] = generateLayer(c.layers[idx], scheme, idx)
      assert(validate(c), `composition invalid after generateLayer #${i}`)
    }
  })
})