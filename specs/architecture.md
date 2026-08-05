# Architecture — loop-me

*Derived from `specs/idea.md`, `specs/requirements.md`, and `specs/design.md`. This document owns
the stack, module boundaries, dependency flow, wire formats, and deployment. It does not own UI
layout (Designer) or implementation (Coder). Where it constrains Coder, it says so explicitly.*

---

## 0. Architectural Position

The constraints in `specs/requirements.md` §Constraints do most of the choosing: buildless, no
libraries, 2D canvas, static hosting, single page. What remains genuinely open is the *internal*
shape, and three requirements drive nearly every decision below:

1. **Determinism outranks performance** (NFR/Determinism). No module may branch on device
   capability in a way that reaches the rendered pixels. The governor warns; it never adapts.
2. **A seventeenth layer type must touch nothing but its own file** (NFR/Maintainability). This is
   only achievable if each layer declares its parameters *as data* and every other subsystem —
   codec, randomizer, UI generator, resolver — walks that declaration. This single contract is the
   spine of the architecture.
3. **Nothing renders before the user enters** (FR-0). The boot sequence is a safety mechanism, not
   a loading strategy, and is specified as such in §7.

Everything else follows.

---

## 1. Stack Decision

| Layer | Technology | Rationale |
|---|---|---|
| Language | **Vanilla JavaScript, ES2022**, native ES modules (`<script type="module">`) | Buildless is a hard constraint. ES2022 (`structuredClone`, `at()`, class fields, top-level `await`) is fully available across the platform floor in NFR/Platform. |
| Type safety | **`// @ts-check` + JSDoc + `jsconfig.json`** | Editor- and CI-only. Catches exactly the class of bug this project is exposed to — codec shape drift, param-bounds mismatch — at zero runtime and zero build cost. `jsconfig.json` ships in the repo but is never served or executed. |
| Framework | **None** | Forbidden by constraint, and unnecessary: the DOM surface is ~20 live controls, not 2,000. |
| Module loading | **~55 static ES modules, all eager. No dynamic `import()`.** | Total JS ≈ 170 KB uncompressed, all of which loads *behind the splash*, which is human-paced (§7). Lazy-loading layer modules would save nothing measurable and would force `async` into the registry, codec, randomizer, and painter — four synchronous hot paths. |
| UI approach | **Imperative views + targeted DOM patching.** No VDOM, no templating, no reactive framework | The canvas owns the frame budget. Rebuilding 20 controls on every state change is affordable; the discipline that matters is not allocating *inside the render loop* (§6.4). |
| State management | **Single plain state object + topic-scoped pub/sub** (`core/state.js`) | Views subscribe to named topics (`composition`, `layer`, `playback`, `governor`, `seed`, `library`). Publishing is synchronous. ~60 lines. |
| Mutation | **All writes funnel through `core/actions.js`** | One writer means one place to snapshot undo, mark the prepare-cache dirty, and publish. Views never mutate state directly. |
| Undo | **`structuredClone` of the composition before each mutating action, depth 1** | FR-10 requires exactly one level. A 5-layer composition clones in well under a millisecond. |
| Randomness | **`mulberry32` seeded PRNG** (32-bit state, uint32 seed) | FR-4. Small, fast, well-distributed, trivially portable. `Math.random()` is banned from `src/` outside of *initial* seed generation for a brand-new composition (§8.3). |
| Styling | **Plain CSS, custom properties, one cascade layer per file** | `mocks/_tokens.css` is copied into `styles/_tokens.css` verbatim per Designer's §1. Not reinterpreted, not renamed. |
| Persistence | **`localStorage`**, behind a guarded wrapper | FR-8, FR-14. Wrapper degrades to a no-op in-memory store and raises `STORAGE_UNAVAILABLE` (FR-18) rather than throwing. |
| Compression | **`CompressionStream('deflate-raw')`** with an uncompressed fallback | FR-12. Available on every browser in the platform floor (Safari 16.4+ inclusive), but the `p` flag path is implemented and tested regardless, because FR-12 requires cross-device interoperability of both forms. |
| Test framework | **Hand-rolled ~70-line harness at `tests/index.html`**, run in a browser | See §1.1. |
| Build tool | **None** | Constraint. The repository contents are what GitHub Pages serves. There is no `dist/`. |
| Deployment | **GitHub Pages, served from the repository root, with `.nojekyll`** | See §11. |

### 1.1 Why the test harness is a browser page and not `node --test`

`node --test` is tempting — it is zero-install and ships with Node. It does not work here without
either adding `package.json` with `{"type": "module"}` or renaming every source file to `.mjs`.
The former introduces a package manifest to a project whose defining constraint is that it has no
package manifest; the latter is a rename tax on every module for the benefit of the test runner
alone. A browser harness has neither problem, and it can additionally test the modules that need a
real `CanvasRenderingContext2D`, `CompressionStream`, and `localStorage` — which is most of the
risky surface.

Running the tests requires serving the directory over HTTP (`python3 -m http.server`), because
`file://` blocks module loading and `fetch`. That is a dev convenience, not a build step: nothing
is generated, transformed, or emitted.

---

## 2. Alternatives Considered

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Type checking | JSDoc + `@ts-check` | TypeScript; nothing at all | TS needs a compiler — violates buildless. Nothing at all leaves the codec and the 16 param tables unchecked, which is precisely where silent breakage lives. |
| Module granularity | ~55 eager static modules | Single bundled file; dynamic `import()` per layer | One file is unnavigable at ~170 KB and makes the pluggability contract unenforceable. Dynamic import buys no meaningful load time (everything loads behind a human-paced splash) and poisons four sync hot paths with promises. |
| UI rendering | Imperative patching | Hand-rolled VDOM; `<template>` + full re-render | The live tick updates at 60 Hz — it *must* be a direct `style.setProperty` write on one node. Any diffing layer sits between the render loop and that write for no benefit. |
| Layer catalog metadata | Co-located with draw code (`layers/ray-rings.js` exports `meta` + `params` + `draw`) | Central `model/catalog.js` holding all 16 param tables | Co-location is what makes "add a file, add one registry line" literally true. Cost: you cannot read all 16 tables in one place. Mitigated by §5.2's generated summary being derivable in the test page. |
| Param declaration | Data (`params` array, positional) | Decorators; string DSL; per-layer bespoke UI | Positional data is simultaneously the codec's field order, the UI's control order, the randomizer's sample space, and the resolver's iteration order. One declaration, four consumers, zero duplication. |
| Seed serialization | JSON → deflate-raw → base64url | MessagePack/CBOR hand-roll; bit-packed binary; plain base64url JSON | A hand-rolled binary codec is ~300 lines of the most bug-prone code in the project for maybe 200 characters. JSON+deflate hits the 1,500-char target (§9.4) with a payload that stays inspectable in a console. |
| Seed API shape | **`async`** encode/decode | Sync encode with no compression | `CompressionStream` is stream-based; there is no synchronous deflate on the platform. Going sync means shipping uncompressed seeds, which misses FR-12's 1,500-character target by roughly 3×. Accepted consequence: the hash writer is a debounced async task and the seed field can show a `…` placeholder for one frame (§9.6). |
| Undo | Snapshot clone, depth 1 | Command/inverse pattern; immutable state tree | FR-10 wants one level. A command pattern means writing an inverse for all ~110 mutations. Clone is 1 line and cannot drift out of sync with the forward operation. |
| Prepare-cache invalidation | Automatic: any **static** param, colour ref, `rngSeed`, or scheme change | Per-module `invalidatesOn` declaration; hash-the-layer | Every parameter that forces a geometry rebuild (`rayCount`, `ringCount`, `tileSize`, `sides`, `cellSize`) is declared **S** in FR-6, and every **A** parameter by definition varies *within* a loop and therefore cannot participate in cached geometry. So the static/animatable split already *is* the invalidation boundary. No extra declaration, no way for a layer author to get it wrong. (§6.3) |
| Offline | No service worker in v1 | SW with precache | "Functions fully offline once loaded" (NFR/Platform) is already satisfied — there are zero network requests after load. A SW would add *cold* offline load and, with it, stale-version pain on a project with no build-time cache-busting. Flagged in §13. |
| Error surface | Coded errors → one strings module | Throwing raw `Error`s to the UI | Designer's §6 Voice forbids codec/engine vocabulary in user-facing strings. Codes keep the mapping in one auditable place. |

---

## 3. Repository Structure

```
/
├── index.html                   — the single page; splash markup is inline and static
├── .nojekyll                    — LOAD-BEARING, see §11.1
├── jsconfig.json                — editor type-checking config; never served
├── README.md
├── styles/
│   ├── _tokens.css              — copied verbatim from mocks/_tokens.css
│   ├── base.css                 — reset, typography, focus ring
│   ├── layout.css               — stage / dock / rail, the 960px switch
│   ├── components.css           — the Designer §3 inventory
│   └── screens.css              — splash, modals, panels
├── src/
│   ├── main.js                  — boot sequence and wiring; the only entry point
│   ├── version.js               — SCHEMA_VERSION and APP_VERSION, single source
│   ├── core/                    — depends on nothing
│   ├── model/                   — depends on core
│   ├── layers/                  — depends on core + model/params only
│   ├── render/                  — depends on core, model, layers
│   ├── seed/                    — depends on core, model
│   ├── store/                   — depends on core
│   ├── ui/                      — depends on everything
│   └── util/                    — depends on nothing
└── tests/
    ├── index.html               — the test page
    ├── harness.js               — assert / suite / reporter
    └── *.test.js
```

### 3.1 Module inventory

```
src/core/
├── state.js          — the store, topic pub/sub
├── actions.js        — every mutation; undo snapshot; cache invalidation
├── clock.js          — rAF loop, elapsed→frame, play/pause
├── rng.js            — mulberry32, uint32 seed helpers
├── algorithms.js     — the 20 loop-safe algorithms + the ID registry
├── value.js          — findValue(min, max, times, totalFrame, currentFrame, algorithm)
└── errors.js         — error codes, AppError, the reporter channel

src/model/
├── params.js         — the param declaration DSL: A(), S.int, S.num, S.bool, S.enum
├── registry.js       — layer type ID → module. The ONE file a new layer touches.
├── composition.js    — create / clone / validate / clamp / defaults
├── schemes.js        — 4 built-in schemes, colour-ref resolution
├── blend.js          — blend mode ID registry (7)
├── motion.js         — 6 characters → algorithm pools; assign, speed-scale, reroll
└── randomize.js      — role-aware, taste-constrained generation (FR-9)

src/layers/           — 16 files, one per type. ray-rings.js … grain.js
                        Each exports: meta, params, prepare(), draw()

src/render/
├── canvas.js         — 1080×1920 backing store, fit-scale, letterbox
├── resolve.js        — per-frame parameter resolution into preallocated slots
├── prepare.js        — offscreen / gradient / Path2D cache and its invalidation
├── painter.js        — background + per-layer composite, state hygiene, error fencing
└── governor.js       — rolling median frame interval, warn/clear hysteresis

src/seed/
├── base64url.js      — bytes ⇄ unpadded base64url
├── deflate.js        — CompressionStream wrapper, capability probe, fallback
├── codec.js          — composition ⇄ positional array ⇄ seed string
└── hash.js           — read hash on boot; debounced replaceState writer

src/store/
├── local.js          — guarded localStorage; availability probe; quota handling
├── prefs.js          — splash suppression, reduced-motion opt-in
├── gallery.js        — saved seeds, export/import (FR-14)
└── schemes-store.js  — custom scheme CRUD (FR-8)

src/ui/
├── dom.js            — el(), text(), focus trap, aria-live region
├── strings.js        — every user-facing string, in Designer's voice
├── shell.js          — stage/dock, view-only, keyboard map, sheet peek/expand
├── splash.js         — FR-0 gate
├── feedback.js       — toasts, banners, governor banner
├── controls/         — band.js, tick.js, chip.js, segmented.js, stepper.js,
│                       slider.js, switch.js, swatch.js, seed-field.js
└── panels/           — composition.js, layer-editor.js, add-layer.js,
                        schemes.js, share.js, gallery.js

src/util/
├── clamp.js, quantize.js, debounce.js, clipboard.js
```

---

## 4. Dependency Flow

```
                          ┌──────────┐
                          │   util   │  (pure, imported freely)
                          └──────────┘

  ┌──────┐      ┌───────┐      ┌────────┐
  │ core │ ───► │ model │ ───► │ layers │
  └──────┘      └───────┘      └────────┘
     │              │               │
     │              ▼               │
     │          ┌──────┐            │
     ├─────────►│ seed │            │
     │          └──────┘            │
     │              │               │
     │              ▼               ▼
     │          ┌──────────────────────┐
     ├─────────►│       render         │
     │          └──────────────────────┘
     │                    │
     ▼                    ▼
  ┌───────┐        ┌────────────┐
  │ store │ ─────► │     ui     │
  └───────┘        └────────────┘
                          │
                          ▼
                      ┌────────┐
                      │ main.js│
                      └────────┘
```

**Enforced rules — Coder must not violate these:**

1. `core/*` imports only `util/*`. It never imports `model`, `render`, `ui`, or the DOM.
2. **`layers/*` imports only `core/value.js`, `core/rng.js`, `model/params.js`, and `util/*`.**
   A layer module never imports state, never imports another layer, never reads the DOM, and
   never touches `document`. It is a pure function of (layer params, palette, frame).
3. `model/registry.js` is the *only* module that imports files from `layers/`.
4. `render/*` never imports `ui/*`. The live tick (Designer §0) is driven by `ui/controls/tick.js`
   subscribing to a frame callback published by `core/clock.js` — the painter does not know the
   tick exists.
5. `ui/*` never mutates state directly; it calls `core/actions.js`.
6. Circular imports are forbidden. The graph above is a DAG.

---

## 5. The Pluggability Contract

This is the most important section in the document. NFR/Maintainability requires that adding a
seventeenth layer type requires *no change* to the codec, the randomizer, or the UI. That holds
if and only if the following contract is honoured exactly.

### 5.1 The layer module interface

Every file in `src/layers/` exports exactly four things:

```js
// src/layers/arc-gates.js
import { A, S } from '../model/params.js'

/** @type {import('../model/params.js').LayerMeta} */
export const meta = {
  id: 7,                       // stable, append-only, never reused (§8.2)
  name: 'Arc Gates',
  role: 'primary',             // 'primary' | 'secondary' | 'overlay'
  blurb: 'Thick arc segments at several radii, rotating independently.',
  worstCase: { pathOps: 10, drawCalls: 10 },   // §10.2
  fullCanvasOpaque: false,     // consumed by the randomizer's taste rules (§8.3)
}

/** Positional. This array IS the seed field order, the UI control order,
 *  and the resolver's iteration order. APPEND ONLY. */
export const params = [
  S.int ('gateCount',  2,  10),
  A     ('arcSpan',   10, 170, { unit: '°' }),
  A     ('weight',     4,  60),
  S.int ('radiusStep', 40, 200),
  A     ('rotation',   0, 360, { unit: '°', wrap: true }),
  S.num ('rateSpread', 0.5, 3.0),
]

/** Build everything that does not change across the loop.
 *  Called once per (static params + colour + rngSeed + scheme) tuple. */
export function prepare(statics, palette, rng) { /* → prepared */ }

/** Called once per layer per frame. MUST NOT allocate. MUST NOT read state.
 *  ctx arrives with composite op, globalAlpha, and transform already set. */
export function draw(ctx, resolved, prepared, palette) { /* … */ }
```

`resolved` is a **preallocated, reused plain object** keyed by param name, refilled each frame by
`render/resolve.js`. Layer code reads `resolved.arcSpan` and gets a number. It never sees
`{min, max, times, algorithm}`.

### 5.2 What each subsystem derives from `params`

| Consumer | Derives |
|---|---|
| `seed/codec.js` | Field order and arity. An **A** param writes `[min, max, times, algorithmId]`; an **S** param writes one scalar. |
| `model/composition.js` | Defaults, and the clamp pass that repairs decoded seeds (FR-12, FR-18). |
| `model/randomize.js` | The sample space. Bounds come from the declaration; taste rules come from `meta`. |
| `render/resolve.js` | Which params to run through `findValue` and which to pass through. |
| `render/prepare.js` | The static/animatable split, which *is* the cache-invalidation boundary (§6.3). |
| `ui/panels/layer-editor.js` | One dual-thumb band per **A** param, one stepper/slider/switch per **S** param, bounds printed underneath (Designer §3, FR-6). |

### 5.3 Adding a seventeenth layer type

1. Create `src/layers/whatever.js` exporting `meta`, `params`, `prepare`, `draw`.
2. Add one line to `src/model/registry.js`.
3. Add its `id` to the pinned-ordering test in `tests/registry.test.js`.

Nothing else. If a proposed layer type cannot be expressed this way, that is a signal to change
the contract deliberately — not to special-case the layer.

### 5.4 The param DSL

```
A(name, min, max, opts?)          animatable → {min, max, times, algorithm}
S.int(name, min, max, opts?)      integer
S.num(name, min, max, opts?)      float, quantized to 3dp
S.bool(name, opts?)               boolean
S.enum(name, [values], opts?)     small closed set, encoded as index
```

`opts`: `{ label, unit, step, wrap, default }`. `wrap: true` marks angular params so the UI knows
360 and 0 are adjacent.

**Common params are on the layer envelope, not in `params`** — `type`, `blend`, `rngSeed`,
`color`, and `opacity` (A, 0.05–1.0) are declared once in `model/composition.js` and apply to
every layer (FR-6 "Common to every layer type"). They occupy fixed leading positions in the seed
(§9.2).

---

## 6. The Render Pipeline

### 6.1 Canvas and coordinate space (FR-1)

- The backing store is **always exactly 1080 × 1920**. `canvas.width/height` are set once and
  never change — not for DPR, not for viewport size.
- Fit-scaling is **pure CSS**: `aspect-ratio: 1080/1920; max-width: 100%; max-height: 100%`
  inside a flex-centred stage. No JS resize handler participates in scaling.
- Letterbox bars are the stage element's background, set to the active scheme's resolved
  background colour via a CSS custom property (`--stage-bg`) written whenever the scheme changes
  (FR-1, Designer §2).

Because the backing store is fixed, resizing the window cannot alter the composition — the
acceptance criterion is satisfied structurally rather than by careful coding.

### 6.2 The frame clock (`core/clock.js`)

```
tick(now):                                    // one rAF callback
  if (!playing) return
  elapsedMs   = now - epoch - pausedAccum
  durationSec = DURATIONS[composition.durationId]      // 5 | 15 | 30
  totalFrames = durationSec * 60
  currentFrame = ((elapsedMs / 1000) % durationSec) / durationSec * totalFrames   // fractional
  prepare.flushDirty()                        // rebuild any invalidated caches (§6.3)
  painter.paint(currentFrame, totalFrames)
  governor.sample(now)
  frameSubscribers.forEach(fn => fn(currentFrame, totalFrames))   // the live tick rides here
```

`currentFrame` is **fractional and derived from wall-clock time**, never incremented. A dropped
frame costs smoothness, never sync (FR-1). `totalFrames` is passed to `findValue` so algorithms
close the loop against the true period.

**Playback position is preserved across edits.** `epoch` is reset only on duration change (FR-2
requires re-render from frame 0) and on loading a different composition. A parameter edit does not
touch it (FR-10, Designer §6 "Live edits").

Pause sets `playing = false` and cancels the rAF handle entirely — no idle callback, no timer
(FR-17: "a paused page consumes negligible CPU"). Resume folds the paused interval into
`pausedAccum` so the loop continues from where it stopped.

### 6.3 Prepare cache and invalidation

`render/prepare.js` holds one `prepared` object per layer index. It is rebuilt when — and only
when — the layer's **static** params, colour ref, `rngSeed`, or the composition's scheme change.

The rule is automatic because of an alignment already present in FR-6: *every* parameter capable
of changing cached geometry (`rayCount`, `ringCount`, `sides`, `polyCount`, `cellSize`,
`tileSize`, `dotsPerRing`, `spacing`, `bandHeight`) is declared **S**, and no **A** parameter can
participate in cached geometry, because by definition it varies within the loop. So the
static/animatable split *is* the invalidation boundary. There is no per-layer declaration to get
wrong.

`core/actions.js` marks `dirty[index] = true` on any qualifying mutation. `flushDirty()` runs at
the top of the frame, before painting, building into a fresh detached offscreen canvas and
swapping the reference atomically — so a slider drag can never expose a half-built cache
(Designer §6).

Typical `prepared` contents: an `OffscreenCanvas` (or detached `<canvas>`) of static geometry, one
or more `Path2D` objects, `CanvasGradient` instances, a `CanvasPattern` for tiled overlays, and
the layer's resolved colour string.

### 6.4 The painter (`render/painter.js`)

```
paint(frame, totalFrames):
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, 1080, 1920)                    // background is NOT a layer (FR-5)

  for (i, layer of composition.layers):
    if (layer.errored) continue
    resolve(layer, frame, totalFrames, slots[i])    // fills a preallocated object
    ctx.save()
    ctx.globalCompositeOperation = BLEND_OPS[layer.blend]
    ctx.globalAlpha = slots[i].opacity
    try   { registry.get(layer.type).draw(ctx, slots[i], prepared[i], palette) }
    catch (e) { layer.errored = true; report(LAYER_DRAW_FAILED, i, e) }
    finally { ctx.restore() }

  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
```

Two things are deliberate here:

**Error fencing.** FR-18 requires that no unhandled exception can blank the canvas or stop the
loop. A `try/catch` per layer per frame costs nothing measurable in V8/JSC when nothing throws.
A throwing layer is marked `errored`, skipped from then on, and surfaced as a banner naming the
layer — a broken layer fails loudly in the UI and quietly in the pixels, rather than taking the
page down.

**State hygiene.** `save`/`restore` bracketing plus an explicit reset before and after the loop
means composite op, alpha, transform, `lineDash`, and `lineWidth` cannot leak between layers
(FR-5 acceptance criterion).

### 6.5 Zero-allocation rules inside the loop

NFR/Performance requires no memory growth over a ten-minute run. Binding rules for Coder:

- No object, array, or closure literals inside `draw`, `resolve`, or `paint`.
- No `CanvasGradient`, `Path2D`, or canvas creation inside `draw` — those belong in `prepare`.
- No string concatenation for colours per frame; resolved colour strings are cached in `prepared`.
- No `Array.prototype.map/filter/forEach` inside the frame path; indexed `for` loops only.
- `resolve()` writes into `slots[i]`, a per-layer object allocated once at composition load.
- `governor` uses two preallocated `Float64Array(90)` buffers and never sorts per frame (§6.6).

### 6.6 Performance governor (`render/governor.js`, FR-15)

- Ring buffer of **90** frame intervals in a preallocated `Float64Array`.
- The **median** is computed once per completed 90-frame window — not per frame — by copying into
  a second preallocated array and running an in-place quickselect. Per-frame cost is one
  subtraction and one store.
- A `warmupSkip` counter is set to **60** on any composition change; samples are ignored until it
  drains (FR-15).
- Enter WARN when the window median exceeds **34 ms** across **two consecutive** windows.
- Leave WARN when it drops below **30 ms** across **two consecutive** windows. The hysteresis gap
  is what prevents a single GC pause or a tab refocus from flapping the banner.
- On state change the governor publishes to the `governor` topic. `ui/feedback.js` renders the
  banner, `ui/panels/composition.js` disables **Add layer** with the reason as visible adjacent
  text (Designer §5 Flow F — *not* a tooltip), and `model/randomize.js` reads the flag to bias
  toward fewer layers.
- **The governor has no reference to the painter and cannot call into it.** This is how
  "rendered output is identical with the warning active and inactive" is guaranteed structurally
  rather than by discipline.

---

## 7. Boot Sequence — the FR-0 Safety Gate

FR-0 is a safety requirement, not a loading nicety. The sequence below is normative.

```
1. index.html parses.
   The splash is STATIC MARKUP IN THE HTML — wordmark, description, photosensitivity
   warning, "Don't show this again" checkbox, disabled Enter button. It needs zero JS to
   paint. This is what buys "time to splash paint < 300 ms" (NFR) with certainty.
   The <canvas> element is present but carries the `hidden` attribute.

2. <script type="module" src="src/main.js"> executes (implicitly deferred).

3. store/prefs.js  → read splash suppression + reduced-motion opt-in.
   seed/hash.js    → read location.hash.

4. Composition acquisition (async, behind the splash):
     hash present → await codec.decode(seed)
                    on failure → report to the error channel, fall through to randomize
     otherwise    → randomize.generate()

5. render/prepare.js pre-warms every layer's offscreen geometry.
   All of this draws into DETACHED canvases. The visible canvas is untouched and hidden.

6. Splash is finalized: if a seed was present, it now names the shared loop and its duration.
   Enter is enabled and focused; focus is trapped inside the splash.

7a. If suppression is set → step 8 runs immediately, without user action.
7b. Otherwise → wait. The splash does not animate, does not count down, does not auto-dismiss.
    Enter/Space activates.

8. Entry:
     - reveal the canvas
     - move focus to the main view
     - painter.paint(0, totalFrames)         ← the FIRST pixel ever drawn
     - if prefers-reduced-motion OR the user paused: STAY PAUSED, show Play (FR-17)
       else: clock.start()
```

**Invariants Coder must preserve:**

- `painter.paint()` is unreachable before step 8. `core/clock.js` exposes no auto-start.
- Suppression is read from `localStorage` only. It is never read from the hash, never encoded in a
  seed, and never derived from anything a sender controls (FR-0).
- If `localStorage` is unavailable, `prefs.get('suppressSplash')` returns `false` — the failure
  direction is *toward* the warning (FR-0).
- Reduced-motion pauses regardless of suppression state.
- Step 4's decode failure path never reaches step 8 with no composition. The fallback randomize is
  unconditional.

---

## 8. Stable Registries

Three ID spaces are **append-only forever**. Renumbering or removing an entry breaks every seed in
existence. Each is defined in exactly one file and pinned by a test that asserts the exact
ordering (FR-3, FR-6, NFR/Maintainability).

### 8.1 Algorithm IDs — `core/algorithms.js`

`0 journeySin · 1 journeySinSquared · 2 journeyExpEnvelope · 3 journeySteepBell ·
4 journeyFlatTop · 5 invertedBell · 6 doublePeak · 7 exponentialDecay · 8 elasticBounce ·
9 breathing · 10 pulseWave · 11 ripple · 12 heartbeat · 13 waveCrash · 14 volcanic ·
15 spiralOut · 16 spiralIn · 17 mountainRange · 18 oceanTide · 19 butterfly`

Each entry is `{ id, name, fn, phase }` where `phase` is the fixed deterministic offset from the
`my-nft-gen` source (FR-3). `core/value.js` is the single call site:

```
findValue(min, max, times, totalFrame, currentFrame, algorithmId) → number in [min, max]
```

Edge cases returning `min`: `max === min`, `totalFrame === 0`, `times === 0`.
Contract: `findValue(…, 0) === findValue(…, totalFrame)` within 1e-9, and all outputs are within
`[min, max]` inclusive across a full fractional sweep.

### 8.2 Layer type IDs — `model/registry.js`

`1`–`16` per FR-6, matching the catalog order exactly. `registry.js` maps ID → module and is the
only importer of `src/layers/`. An unknown ID in a decoded seed **skips that layer and warns**
rather than failing the composition (FR-18).

### 8.3 Blend mode IDs — `model/blend.js`

`0 normal(source-over) · 1 additive(lighter) · 2 screen · 3 multiply · 4 overlay ·
5 difference · 6 hard-light`

An unknown blend ID clamps to `0` (FR-18 "recoverable inconsistencies repaired silently").

### 8.4 Motion characters — `model/motion.js`

Not in the seed (FR-11: the seed stores only resolved per-parameter values), therefore **not**
append-only and freely revisable. Pools per Designer §6:

| Character | Pool |
|---|---|
| Calm | 0, 1, 4, 18 |
| Breathing | 9, 3, 5, 2 |
| Pulse | 10, 6, 11, 15 |
| Tidal | 18, 13, 17, 16 |
| Heartbeat | 12, 6, 8, 7 |
| Chaotic | 14, 19, 8, 13, 11 |

All 20 IDs covered; a test asserts the union is complete (FR-11). `assign(layer, character)` walks
the layer's **A** params in declaration order, drawing from the pool with the layer's PRNG.
`speed(layer, factor)` scales every `times` and clamps to 1–8. `reroll(layer)` re-runs `assign`
with an advanced PRNG state.

### 8.5 Randomizer taste rules — `model/randomize.js`

FR-9 requires taste, not just bounds. Encoded as explicit post-generation rejection rules:

1. Role quotas: 1–2 primary, 0–2 secondary, 0–2 overlay; total 2–5 (or fewer when the governor is
   warned).
2. At most one layer with `meta.fullCanvasOpaque === true`.
3. `difference` is never assigned to index 0.
4. A layer's colour bucket is never `background` when the resolved value would equal the resolved
   canvas background.
5. Full-canvas opacity params on additive/screen **overlay** layers get `times ≤ 2` — this is the
   flash-safety constraint from FR-17 (≤ 3 Hz on a 5 s loop).

`Math.random()` is permitted in exactly one place: drawing the initial `uint32` seed for a
brand-new composition. Everything downstream of that consumes `core/rng.js` in fixed order (FR-4).

---

## 9. Seed Codec (`src/seed/`)

### 9.1 Wire format

```
<version><flag><payload>

version : "1"                      — SCHEMA_VERSION from src/version.js
flag    : "z" compressed | "p" plain
payload : base64url, unpadded, alphabet [A-Za-z0-9-_]
```

The whole string is URL-safe with no escaping (FR-12).

### 9.2 Pre-encoding structure

A **positional array**, no object keys, order derived from the param declarations (§5.2):

```
[ schemaVersion, durationId, scheme, [ layer, layer, … ] ]

durationId        : 0 = 5s · 1 = 15s · 2 = 30s
scheme            : int (built-in index 0–3)
                  | [ name, [colors], [neutrals], [backgrounds] ]   (embedded custom)
layer             : [ typeId, blendId, rngSeed, colorRef, opacityA, …declaredParams ]
animatable param  : [ min, max, times, algorithmId ]
static param      : number | boolean | enumIndex
colorRef          : "c3" | "n1" | "b0"        bucket + selector
                  | "FF2E88"                  pinned literal, 6 hex chars
```

**Colour references encode as short strings, not integers.** `"c3"` / `"n1"` / `"b0"` name the
bucket and carry a selector; a pinned colour is bare 6-character hex. The two forms are
distinguished by shape — length 6 and all-hex means pinned, anything else is a bucket ref. Cost is
roughly three bytes per layer versus a packed integer, and it keeps the payload readable in a
console when something goes wrong. Resolution is `bucket[selector % bucket.length]`, which is what
makes "changing scheme re-resolves every layer's colours without altering any other parameter"
(FR-7) fall out for free, and what makes a pinned colour survive a scheme change untouched.

### 9.3 Quantization

Every float is quantized to **3 decimal places** before encoding (`util/quantize.js`). This is what
makes `decode(encode(c))` deep-equal `c` (FR-12) rather than merely close, and it materially
shortens the payload. Integers and booleans pass through. `rngSeed` is a `uint32`.

### 9.4 Pipeline

```
encode:  composition → toArray() → JSON.stringify → TextEncoder
                     → CompressionStream('deflate-raw')  → base64url → "1z…"
                     └─ unavailable/throws ──────────────→ base64url → "1p…"

decode:  "1z…" → version check → base64url decode
               → DecompressionStream('deflate-raw') → TextDecoder → JSON.parse
               → fromArray() → clamp/repair → Composition
```

Both are **`async`**. This is forced: `CompressionStream` is stream-based and the platform offers
no synchronous deflate. `deflate.js` probes capability once at module load and caches the result,
so the fallback decision costs nothing per call.

Size expectations (FR-12): typical 5-layer built-in-scheme composition **≤ 1,500 chars**; with an
embedded custom scheme **≤ 2,000**; a hard warning above **4,000**, surfaced in the seed field's
character meter (Designer §3, near-limit amber state).

### 9.5 Forward tolerance (FR-12, FR-18)

`fromArray()` is deliberately permissive in four specific ways and strict in exactly one:

| Situation | Behaviour |
|---|---|
| Unknown **trailing** array elements | Ignored — this is how a future layer gains a param without breaking old decoders. |
| Missing **trailing** elements | Filled from `opts.default` in the param declaration. |
| Number outside declared bounds | Clamped, not rejected. |
| Unknown blend ID | Clamps to `normal`. |
| Unknown layer type ID | That layer is **skipped** with a warning; the rest of the composition renders. |
| Unrecognized `version` | **Rejected** with a message naming the version mismatch. The only hard failure. |

Decoded values are treated as untrusted input throughout (NFR/Security): no `eval`, no `Function`,
no `innerHTML`. Custom scheme names and gallery descriptions reach the DOM only through
`dom.js`'s `text()` helper, which sets `textContent`.

### 9.6 Hash writer (`seed/hash.js`, FR-13)

- The seed lives in the hash fragment: `…/loop-me/#s=<seed>`. Never sent to a server.
- The writer is a **debounced async task**: 250 ms of idle after the last mutation, then encode,
  then `history.replaceState`. `replaceState` — never `pushState` — so a slider drag cannot flood
  browser history (FR-13).
- While an encode is in flight, the seed field shows a `…` placeholder for a frame or two. This is
  the one visible cost of the async codec and is accepted.
- The reader accepts a bare seed, a full URL, or either with surrounding whitespace (FR-13
  Paste Seed) by extracting `#s=` if present and trimming.

---

## 10. Performance Budgets

### 10.1 Page weight (NFR: < 250 KB uncompressed, total)

| Asset | Budget |
|---|---|
| `index.html` (incl. inline splash markup) | 14 KB |
| `styles/*.css` | 38 KB |
| `src/layers/*` (16 files) | 68 KB |
| `src/core` + `src/model` + `src/seed` | 46 KB |
| `src/render` + `src/store` + `src/util` | 22 KB |
| `src/ui/*` | 58 KB |
| **Total** | **246 KB** |

No images, no icon fonts, no webfonts (Designer §1). Icons are inline SVG or Unicode glyphs. If
the budget tightens, `src/ui` is where the slack is.

### 10.2 Per-layer worst-case draw cost

FR-6 requires each layer type to document its worst-case draw-call count at maximum bounds. This is
the architectural budget; `meta.worstCase` in each layer module must match this table, and the test
suite asserts it is present.

| # | Layer | Path ops @ max | Draw calls | Strategy |
|---|---|---|---|---|
| 1 | Ray Rings | 64 | 1–2 | One accumulated `Path2D`, single stroke/fill |
| 2 | Nth Rings | 24 arcs | 1 solid / 24 dashed | Dashed needs per-ring `setLineDash` |
| 3 | Layered Poly | 12 × 12 = 144 | 12 | One `Path2D`, re-stroked under 12 transforms |
| 4 | Encircled Spiral | 12 × 180 = 2,160 | 12 | Polyline per arm; cached in `prepare` when rotation is the only animated param |
| 5 | Petal Bloom | 36 × 4 = 144 ellipses | 1–4 | Accumulated `Path2D` per ring |
| 6 | Orbit Dots | 8 × 24 = 192 arcs | 8 | One `Path2D` fill per ring |
| 7 | Arc Gates | 10 | 10 | Per-gate stroke; independent rotation |
| 8 | Line Field | 80 | 1 | Single `Path2D` |
| 9 | Moiré Grid | ~750 | 2 | Two `Path2D` grids; the cheap-to-draw / high-payoff case |
| 10 | **Grid Pulse** | **2,304 rects** @ `cellSize` 30 | 1 | **Heaviest layer in the catalog.** Single accumulated `Path2D` fill. |
| 11 | Sine Ribbons | 12 × 200 = 2,400 | 12 | Polyline per ribbon |
| 12 | Crosshatch | ~600 | 2 | Two `Path2D` sets |
| 13 | Fuzz Flare | 8 | 8 | Cached `CanvasGradient` per burst. **No `shadowBlur` anywhere** (FR-6). |
| 14 | Scan Lines | 1 | 1 | One band tile → `CanvasPattern`, translated per frame |
| 15 | Vignette Wash | 1 | 1 | Cached gradient |
| 16 | Grain | 1 | 1 | Noise tile generated **once per composition** via `createImageData`, re-blitted with an offset (FR-6) |

The realistic worst case — five layers chosen from the top of this table — is where the governor
(§6.6) earns its place. Nothing here adapts; the user is simply told.

### 10.3 Timing targets

| Target | Budget | How it is met |
|---|---|---|
| Time to splash paint | < 300 ms | Splash is static HTML; no JS required to paint it (§7 step 1) |
| Enter → first frame | < 200 ms | Decode and pre-warm complete behind the splash (§7 steps 4–5) |
| Seed decode | < 50 ms | JSON + native deflate on a ~1.5 KB payload |
| Steady-state memory | < 150 MB, flat | §6.5 zero-allocation rules |

---

## 11. Deployment Architecture

- **Target:** GitHub Pages, `main` branch, `/` (root) source. No Actions workflow, no build step.
- **Build:** none. What is committed is what is served.
- **Runtime:** the browser. No server-side anything.
- **There is no `dist/`.** The pipeline's Deployer phase verifies and configures; it does not
  produce artifacts. Its report should confirm §11.1 and §11.2.

### 11.1 `.nojekyll` is load-bearing

GitHub Pages runs Jekyll by default, and **Jekyll silently excludes files and directories whose
names begin with `_`**. Designer's foundation stylesheet is `_tokens.css`. Without a `.nojekyll`
file at the repository root, that stylesheet 404s in production and the entire UI loads unstyled —
while working perfectly in local development. This is the single highest-probability deploy failure
in the project.

### 11.2 Content Security Policy

Delivered as a `<meta http-equiv="Content-Security-Policy">` in `index.html`, since Pages does not
allow custom headers:

```
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src 'none';
base-uri 'none';
form-action 'none';
```

`connect-src 'none'` **hard-enforces** the NFR "no network requests after initial page load" —
it becomes a property of the document rather than a promise in a review checklist.

Consequence for Coder: no `style="…"` attributes in markup and no `<style>` blocks. Dynamic
styling is done through `element.style.setProperty('--x', v)` via CSSOM, which CSP does not
govern. Designer's mocks use inline styles in places; those must be lifted into
`styles/components.css` during implementation.

### 11.3 Cache behaviour

GitHub Pages serves with a short cache TTL and ETags. With no build step there is no content-hash
cache-busting available, so a deploy may be picked up unevenly across modules for a few minutes.
Accepted: the app has no server contract to break, and a stale module paired with a fresh one is
at worst a visual glitch until reload. This is a direct cost of the buildless constraint and is
recorded rather than mitigated.

---

## 12. Cross-Cutting Concerns

### 12.1 Security posture

| Concern | Approach |
|---|---|
| Authentication | **None.** No accounts, no backend (idea §Non-Goals). |
| Authorization | **None.** All state is local to the device. |
| Data at rest | `localStorage`, unencrypted. Contents are seeds, descriptions, and palettes — no PII, nothing sensitive. |
| Data in transit | HTTPS via GitHub Pages for the page itself. **No application data is ever transmitted** — the hash fragment is not sent to servers, and `connect-src 'none'` makes that structural. |
| Untrusted input | Pasted seeds and imported gallery JSON are validated, clamped, and repaired (§9.5). No `eval`, no `Function`, no `innerHTML`, no `document.write`. |
| Third parties | None. No CDN, no analytics, no telemetry, no cookies, no webfonts. |
| XSS surface | User-authored strings (scheme names, gallery descriptions) reach the DOM only via `textContent`. |

### 12.2 Error taxonomy (`core/errors.js`, FR-18)

Every failure gets a code. `ui/strings.js` maps each code to a message in Designer's voice — no
codec, engine, or browser vocabulary reaches the user.

| Code | Trigger | Recovery |
|---|---|---|
| `SEED_VERSION` | Unrecognized version prefix | Banner naming the mismatch; fall back to randomize |
| `SEED_MALFORMED` | base64/inflate/JSON failure | Banner; fall back to randomize |
| `SEED_TRUNCATED` | Structurally short payload | Banner ("that link didn't survive the trip"); randomize |
| `SEED_TOO_LONG` | > 4,000 chars on encode | Warn before sharing; sharing still permitted |
| `LAYER_UNKNOWN_TYPE` | Unknown type ID in a seed | Skip that layer, warn, render the rest |
| `LAYER_DRAW_FAILED` | Exception inside `draw()` | Mark layer errored, skip it, banner, loop survives |
| `STORAGE_UNAVAILABLE` | `localStorage` throws or is absent | Disable Save with an explanation; everything else works |
| `STORAGE_QUOTA` | Quota exceeded on write | Explicit message, never a silent failure |
| `CLIPBOARD_UNAVAILABLE` | Clipboard API missing/denied | Fall back to a selected readonly input + "press ⌘C" |

The channel is a pub/sub topic, not `throw`. Reporting an error never unwinds the render loop.

### 12.3 Accessibility architecture

Design owns the visual treatment; architecture owns the mechanisms that make it enforceable:

- `ui/dom.js` provides the single focus-trap implementation used by the splash and all five
  modals — one implementation, one place to get it right.
- A single `aria-live="polite"` region is created once at boot; `ui/feedback.js` is the only writer.
  Every toast announces through it (Designer §3).
- The keyboard map (Designer §6) is registered once in `ui/shell.js` with a text-field guard, not
  scattered across panels.
- The dual-thumb band is built from **two stacked native `<input type="range">` elements**, not a
  custom pointer-events widget. Native inputs bring keyboard operability, arrow/shift-arrow
  stepping, and screen-reader semantics for free. Visual styling is entirely CSS. See §13.
- `prefers-reduced-motion` is read once at boot and re-read on `matchMedia` change; it gates
  `clock.start()`, never the rendered content.

---

## 13. Open Architectural Questions

1. **Service worker for cold offline load.** NFR/Platform's "functions fully offline once loaded"
   is already satisfied without one. A SW would add offline *cold start*, at the cost of
   stale-version management on a project with no cache-busting (§11.3). **Recommendation: defer.**
   Revisit if the app is used away from connectivity in practice.

2. **Dual-thumb band implementation.** Two stacked native `<input type="range">` elements is the
   accessible default (§12.3), but they need careful `pointer-events` and z-index handling so the
   thumb nearest the cursor wins when min and max converge. If that proves unworkable in Safari,
   the fallback is a custom control with explicit `role="slider"` + `aria-valuenow/min/max` and a
   hand-written key handler — more code, same semantics. Coder should build the native version
   first and report.

3. **Live-tick update cost.** Designer §8 flags this. Architecture's position: the tick subscribes
   to `clock.js`'s frame callback and writes one CSS custom property per visible band. If profiling
   shows cost, throttle the *subscriber* to ~15 Hz — never the render loop.

4. **`OffscreenCanvas` vs. detached `<canvas>` in `prepare`.** `OffscreenCanvas` is cleaner and
   available across the platform floor, but detached `<canvas>` is universally safe. Since prepare
   runs on the main thread either way, the difference is cosmetic. Coder's call; keep it behind
   `render/prepare.js` so it is a one-line change.

5. **Grid Pulse at minimum `cellSize`.** 2,304 rects (§10.2) is the catalog's worst case. If it
   alone cannot hold 60 fps on the reference phone, the correct fix is raising the declared
   `cellSize` minimum in FR-6 — a bounds change, not a rendering change. **Under no circumstances**
   may it be fixed by drawing fewer cells on slow devices; that breaks determinism, which outranks
   performance.

6. **Undo scope.** Currently the composition only. Whether scheme-library edits and gallery
   deletions should participate is a product question, not an architectural one — the mechanism
   supports either. Recorded so Coder does not decide it silently.
