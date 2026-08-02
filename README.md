# loop-me

Endless looping generative art in a single page. Mash randomize, tweak what you like, send the
good ones to a friend — the whole composition travels in the URL.

---

## Quick start

```bash
# Clone and serve
git clone <repo-url>
cd loop-me
python3 -m http.server 8000
```

Open <http://localhost:8000/> in a browser.

There is nothing to install (`npm install` is a no-op — there are no dependencies), nothing to
compile, and nothing to build. What is committed is exactly what is served.

> **`npm start`** works too — it runs the same `python3 -m http.server` via `package.json`.
> The `package.json` exists only for that convenience script and for editor/CI discovery.

## Running the tests

Serve the repository root as above and open <http://localhost:8000/tests/>.

The test harness is ~150 lines in `tests/harness.js`, and the page *is* the runner — it runs in
a browser rather than under `node --test` because a browser gets a real `CanvasRenderingContext2D`,
`CompressionStream`, and `localStorage` for free, which is most of the risky surface. There are
~315 assertions across 14 suites covering the PRNG, loop-safe algorithms, composition model,
codec round-trips, render pipeline, all 16 layer types, randomize taste rules, the clock, the
store, the registry, and accessibility.

## Type checking

Types are JSDoc plus `// @ts-check`, verified against `jsconfig.json`:

```bash
npx -y typescript --noEmit -p jsconfig.json
```

Editor- and CI-only. Nothing is emitted, `jsconfig.json` is never served, and TypeScript is not
a dependency of the running app.

---

## How this prototype was created

loop-me was built by an **agent pipeline** — a sequence of specialised AI agents, each producing
one layer of the project, each reading the prior layer's output before writing its own.

### The pipeline

| Phase | Agent | What it produced |
|---|---|---|
| **idea** | Spec | `specs/idea.md` — the one-sentence pitch, the layer catalog, the motion model, the non-goals |
| **requirements** | Spec | `specs/requirements.md` — 18 functional requirements (FR-0 through FR-18), each with bounds and acceptance criteria |
| **design** | Designer | `specs/design.md` + 11 HTML mocks in `mocks/` — the visual source of truth (splash, main view, layer editor, schemes, gallery, share, add-layer, view-only, states, seeded splash) |
| **architecture** | Architect | `specs/architecture.md` — 13 sections covering the stack, module DAG, boot sequence, render pipeline, codec, CSP, accessibility, and 13 open questions with answers |
| **database** | DB | `specs/database.md` — a localStorage keyspace proposal (the project has no server-side database) |
| **build** | Coder | ~55 ES modules across 18 sessions, turning the specs and mocks into a working app |

### What the build looked like

The build was broken into **18 sessions** across **6 phases**, each session completable in one
sitting and each leaving the project in a state that (if executed) would load in a browser with
no console errors:

| Phase | Sessions | What landed |
|---|---|---|
| **A — Scaffolding** | 1 | `index.html` (static splash + CSP), 5 stylesheets, 4 utility modules, test harness, `.nojekyll`, `jsconfig.json` |
| **B — Types** | 1 | Param DSL (`A`/`S` factories), 7-blend-mode table, empty layer registry, 9-code error taxonomy with pub/sub |
| **C — Data & engine** | 5 | PRNG → 20 loop-safe algorithms → value engine → composition model → colour schemes → motion characters → state/actions/clock → localStorage layer → seed codec (base64url + deflate + 200-composition round-trip property test) |
| **D — Render & layers** | 5 | Canvas/resolve/prepare/painter/governor pipeline → all 16 layer types (7 primaries, 5 secondaries, 4 overlays) → randomize with 5 taste rules |
| **E — UI components** | 2 | DOM factory, string table, feedback (banners/toasts/aria-live) → 9 control factories (dual-thumb band, live tick, chips, steppers, sliders, switches, swatches, seed field) |
| **F — Wiring** | 4 | Shell + splash + boot sequence → layer editor (generated from param declarations) → 4 modals (add-layer, schemes, share, gallery) → view-only mode + a11y tests + closing audits |

### Constraints that shaped the code

Every agent operated under the same hard rules:

- **No build step.** No bundler, no minifier, no transpiler, no CSS preprocessor. What is committed
  is what is served — vanilla ES2022 with native ES modules, ~55 static imports, no dynamic
  `import()`.
- **No dependencies.** Not even CDN-delivered ones. Zero `node_modules`, zero `<script src>`.
- **No backend.** Fully client-side. The gallery is localStorage. Sharing is a URL hash.
- **No `innerHTML`.** All DOM construction goes through a single `el()` factory in `src/ui/dom.js`
  that sets `textContent`, never `innerHTML`. This is the XSS chokepoint.
- **No `style=` attributes.** A Content Security Policy on `index.html` hard-enforces this.
  Dynamic values go through `element.style.setProperty('--x', v)`, which CSP does not govern.
- **One `Math.random()` call.** In the entire `src/` tree, `Math.random()` appears exactly once:
  `model/randomize.js`, for the initial uint32 seed. Everything downstream is deterministic via
  `mulberry32(seed)`.
- **Zero allocation on the frame path.** The render pipeline's `paint`/`resolve`/`draw` functions
  allocate no objects, arrays, closures, `Path2D`s, gradients, or patterns per frame. Everything
  is preallocated in `prepare` and mutated in place.
- **`registry.js` is the only importer of `src/layers/`.** No other module in `src/` or `tests/`
  directly imports a layer file. The registry's `register()` validates every module's shape and
  rejects duplicate IDs at import time.

### The dependency DAG

```
util/*          ← leaf utilities (clamp, quantize, debounce, clipboard)
    ↑
core/*          ← state, actions, clock, rng, algorithms, value, errors
    ↑
model/*         ← params DSL, registry, composition, schemes, blend, motion, randomize
    ↑
layers/*        ← 16 layer files, imported only by registry.js
    ↑
render/*        ← canvas, resolve, prepare, painter, governor
    ↑
seed/*          ← base64url, deflate, codec, hash
    ↑
store/*         ← local, prefs, gallery, schemes-store
    ↑
ui/*            ← dom, strings, feedback, shell, splash, controls/, panels/
    ↑
main.js         ← the only entry point, the wiring layer
```

`core/*` never imports `model/*` at module-load time (it receives model functions via dependency
injection at boot). `render/*` never imports `ui/*`. No circular imports.

### What the mocks are for

The 11 HTML files in `mocks/` are Designer's static wireframes — the visual source of truth. Every
CSS class, every DOM structure, every user-facing string in the app was transcribed from these
mocks, not invented. The mocks are not shipped; they are reference material.

`styles/_tokens.css` was copied from `mocks/_tokens.css` verbatim (minus two blocks Designer's own
comments mark as mock-only). The other four stylesheets carry only what the mocks put in per-page
`<style>` blocks or inline `style=` attributes — lifted into external files to comply with the CSP.

### Honest limitations of this prototype

- **The 20 loop-safe algorithms are derived, not ported.** The original reference (`my-nft-gen`)
  was unreachable during the build. The curve shapes are interpretations of their names; the phase
  offsets follow a golden-ratio staggering rule. Every composition will look different from what
  the reference would render — valid, but different. Swapping in the real curves is a one-table
  edit in `core/algorithms.js` and breaks no existing seed (seeds store algorithm IDs, not formulae).
- **Nothing has been executed.** The build environment did not permit command execution across 18
  sessions. ~315 assertions were authored and zero were observed to pass. Every session's verification
  was static: import resolution, export matching, DAG compliance, banned-construct grep, and
  hand-derivation of numeric properties. The single highest-value action is opening `/tests/` in a
  browser.
- **The app ships over its 250 KB page-weight budget.** The overage is entirely comment density in
  the early-phase modules (`core/`, `model/`, `seed/`, `store/`) — JSDoc carried the verification
  load in a build that could not execute anything, and with no build step every comment ships.
  A comment-strip pass would recover ~80–100 KB; the decision is the builder's.

---

## Why there is no build step

It is a hard requirement, not a preference: no build tooling, no third-party libraries, not even
CDN-delivered ones. Consequences that show up throughout the codebase:

- Vanilla ES2022 with native ES modules — ~55 static modules, all eager, no dynamic `import()`.
- No framework, no bundler, no minifier, no CSS preprocessor.
- Type safety comes from JSDoc annotations checked by the TypeScript language service, never from
  compiled TypeScript.
- The page-weight budget (250 KB uncompressed, everything included) is enforced by reading, not by
  a bundle analyzer.

## `.nojekyll` is load-bearing — never delete it

GitHub Pages runs Jekyll by default, and **Jekyll silently excludes files whose names begin with an
underscore**. The foundation stylesheet is `styles/_tokens.css`.

Without the empty `/.nojekyll` file at the repository root, that stylesheet 404s in production and
the entire UI loads unstyled — *while working perfectly in local development*, because
`python3 -m http.server` does not run Jekyll.

## Content Security Policy

`index.html` carries a `<meta http-equiv="Content-Security-Policy">` with `default-src 'none'` and
`connect-src 'none'`. The second one hard-enforces "no network requests after initial page load" —
it becomes a property of the document rather than a promise in a review checklist.

Two rules follow for anyone editing this codebase:

- **No `style="…"` attributes and no `<style>` blocks**, in HTML or in DOM built by JS. Dynamic
  values go through `element.style.setProperty('--x', v)`, which CSP does not govern.
- **No `eval`, no `Function`, no `innerHTML`.** User- and seed-authored strings reach the DOM only
  through `src/ui/dom.js`'s `text()` helper, which sets `textContent`.

---

## Layout

```
index.html          the single page; splash markup is inline and static
.nojekyll           see above
package.json        convenience scripts only (npm start → python3 -m http.server)
jsconfig.json       editor type-checking config; never served
styles/             _tokens.css (copied from the mocks) + four screen-level sheets
src/
  main.js           boot sequence and wiring; the only entry point
  core/             state, actions, clock, rng, algorithms, value, errors
  model/            params DSL, registry, composition, schemes, blend, motion, randomize
  layers/           16 files, one per layer type
  render/           canvas, resolve, prepare, painter, governor
  seed/             base64url, deflate, codec, hash
  store/            localStorage wrappers
  ui/               dom, strings, shell, splash, feedback, controls/, panels/
  util/             clamp, quantize, debounce, clipboard
tests/              index.html + harness.js + *.test.js
specs/              idea, requirements, design, architecture, database, build plan
mocks/              Designer's static HTML wireframes — the visual source of truth
```

`specs/build-plan.md` tracks what was built, session by session, with verification notes and
deviation records for every task.

## Deployment

GitHub Pages, `main` branch, `/` (root) source. No Actions workflow, no build step, no `dist/`.
Push and it is live.

**Live site:** <https://john-paul-ruf.github.io/loop-me/>