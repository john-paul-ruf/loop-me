# Requirements — loop-me

*Derived from `specs/idea.md`. Tech-agnostic: this document specifies **what** loop-me does, not how it is built. Stack, module layout, and file structure are Architect's call; UI layout and visual design are Designer's.*

---

## Functional Requirements

### FR-0: Entry Splash & Flash Safety Gate

- **User story:** As someone opening a link a friend sent me, I want to know what I'm about to look at before it starts moving, so that I'm not ambushed by flashing.
- **Detail:** Every load — bare page or shared seed — shows a **static splash screen before any animation begins**. The render loop does not start and the canvas paints nothing behind the splash. A warning displayed over a running animation is decorative, not protective.
- **Detail:** Splash content: the product name, one line on what it is, a plainly-worded **photosensitivity and motion warning** (flashing, high-contrast strobing, rapid movement), and a primary **Enter** action. When the URL carries a seed, the splash also indicates that a shared loop is waiting and names its duration.
- **Detail:** The splash itself does not animate, does not count down, and does not auto-dismiss. It waits for the user.
- **Detail:** A **"Don't show this again on this device"** checkbox suppresses the splash on subsequent loads. The preference is stored in local storage and is therefore **per-device**: a first-time recipient of a shared seed has never set it and always sees the warning. Suppression is never carried in a seed, never in the URL, and never inferred from anything a sender controls.
- **Detail:** A **Show welcome screen** action in the UI restores the splash for users who dismissed it. If local storage is unavailable, the splash shows every load — failing toward the warning, never away from it.
- **Detail:** When the splash is suppressed, all other FR-0 protections still apply: reduced-motion still loads paused (FR-17), and rendering still begins only after the composition is fully decoded and pre-warmed.
- **Detail:** Entering with `prefers-reduced-motion: reduce` lands on a **paused** first frame per FR-17, not a playing loop — regardless of the suppression preference.
- **Detail:** The app decodes the seed and pre-warms offscreen geometry **while the splash is up**, so Enter is instant rather than the splash costing the user time.
- **Acceptance criteria:**
  - [ ] On a device that has not suppressed it, the splash is the first paint on every load, including a shared-seed URL.
  - [ ] No canvas frame renders and no animation timer runs until the user enters.
  - [ ] The splash carries an explicit photosensitivity warning in non-technical language.
  - [ ] With a seed in the URL, the splash indicates a shared loop and its duration.
  - [ ] Checking "Don't show this again" suppresses the splash on subsequent loads on that device only.
  - [ ] A device that has suppressed the splash still shows it after the preference is cleared, and a "Show welcome screen" action exists to restore it.
  - [ ] With local storage unavailable, the splash appears on every load.
  - [ ] Enter is keyboard-reachable and activates on Enter/Space; focus is trapped within the splash while it is open and moves to the main view on dismiss.
  - [ ] Entering with reduced-motion set yields a paused first frame.
  - [ ] Time from Enter to first rendered frame is under **200 ms** on a warm cache.

### FR-1: Canvas & Render Loop

- **User story:** As a viewer, I want the animation to look identical on my phone and my laptop, so that a seed someone sends me shows me exactly what they saw.
- **Detail:** The composition renders to a fixed internal coordinate space of **1080 × 1920 (portrait)**. The canvas element is scaled to fit the viewport while preserving aspect ratio, letterboxed with the scheme's background color on any viewport whose ratio differs.
- **Detail:** The animation timeline is **frame-based but time-driven**. Total frames for a loop = `duration × 60`. The current frame is computed from elapsed wall-clock time as a **fractional** value (`(elapsed % duration) / duration × totalFrames`), not by incrementing a counter. This makes playback independent of display refresh rate and immune to dropped frames — a stutter loses smoothness, never sync.
- **Acceptance criteria:**
  - [ ] Internal render resolution is exactly 1080 × 1920 regardless of device or DPI.
  - [ ] The same seed produces visually identical output on a 60Hz laptop and a 120Hz phone.
  - [ ] Dropping frames causes no drift: at elapsed time T the rendered frame is always `(T mod duration)`-derived.
  - [ ] Resizing the browser window rescales the canvas without altering the composition.
  - [ ] Letterbox bars use the active scheme's background color.

### FR-2: Loop Durations

- **User story:** As a builder, I want to choose how long my loop runs, so that I can make something punchy or something slow and hypnotic.
- **Detail:** Exactly three durations are selectable: **5s, 15s, 30s** (300, 900, 1800 frames at 60fps). Duration is part of the composition and travels in the seed.
- **Acceptance criteria:**
  - [ ] Exactly three duration options exist; no custom durations.
  - [ ] Changing duration re-renders from frame 0 without altering any other parameter.
  - [ ] The rendered frame at `t = duration` is pixel-identical to the frame at `t = 0`.
  - [ ] Duration round-trips through seed encode/decode.

### FR-3: Loop-Safe Value Engine

- **User story:** As a viewer, I want to never catch the loop restarting, so that I can stare at it indefinitely.
- **Detail:** Every animatable parameter resolves through a single value function: `findValue(min, max, times, totalFrame, currentFrame, algorithm)` returning a number in `[min, max]`. The engine implements the loop-safe algorithm library from `my-nft-gen`:

  `journeySin`, `journeySinSquared`, `journeyExpEnvelope`, `journeySteepBell`, `journeyFlatTop`, `invertedBell`, `doublePeak`, `exponentialDecay`, `elasticBounce`, `breathing`, `pulseWave`, `ripple`, `heartbeat`, `waveCrash`, `volcanic`, `spiralOut`, `spiralIn`, `mountainRange`, `oceanTide`, `butterfly` — 20 total.

- **Detail:** Each algorithm carries a fixed deterministic phase offset (as in the source implementation) so that layers using different algorithms peak at staggered times.
- **Detail:** Edge cases return `min`: `max === min`, `totalFrame === 0`, or `times === 0`.
- **Detail:** Algorithms are referenced in the seed by **stable integer ID**. IDs are append-only forever — an algorithm may never be renumbered or removed, or existing seeds break.
- **Acceptance criteria:**
  - [ ] All 20 algorithms are implemented and individually selectable.
  - [ ] For every algorithm, `findValue(…, currentFrame = 0)` equals `findValue(…, currentFrame = totalFrame)` within 1e-9.
  - [ ] For every algorithm, all returned values lie within `[min, max]` inclusive across a full frame sweep.
  - [ ] Fractional `currentFrame` inputs are supported and produce continuous output.
  - [ ] Algorithm ID ↔ name mapping is defined in one place and covered by a test asserting the exact ordering.

### FR-4: Deterministic Randomness

- **User story:** As a friend receiving a seed, I want to see the same art the sender saw, so that sharing means anything at all.
- **Detail:** No use of `Math.random()` anywhere in composition generation or rendering. All randomness comes from a **seeded PRNG** (e.g. a 32-bit integer-state generator) initialized from an integer carried in the composition.
- **Detail:** Any value derived at render time rather than stored — flare positions, per-ring phase spreads, grain tile pattern — must derive from the composition's PRNG stream, in a fixed consumption order.
- **Acceptance criteria:**
  - [ ] Decoding the same seed twice in the same session produces byte-identical composition objects.
  - [ ] The same seed on two different browsers produces the same rendered frame (visually verified).
  - [ ] `Math.random()` does not appear in any render or generation path.

### FR-5: Layer System & Compositing

- **User story:** As a builder, I want to stack effects and control how they blend, so that I can get glow, cutouts, and depth instead of flat overlays.
- **Detail:** A composition holds **1 to 5 layers**, drawn in array order (index 0 = bottom). The background is filled first from the scheme's background bucket and is **not** a layer.
- **Detail:** Each layer carries its own **blend mode**, applied as the canvas composite operation before drawing: `normal` (source-over), `additive` (lighter), `screen`, `multiply`, `overlay`, `difference`, `hard-light`. Composite state is reset to `source-over` between layers.
- **Detail:** Each layer carries a global **opacity** (animatable, 0.05–1.0).
- **Detail:** The same layer type may appear more than once in a composition with different parameters.
- **Acceptance criteria:**
  - [ ] Composition supports 1–5 layers; adding beyond 5 is blocked.
  - [ ] Layers can be reordered, and reordering visibly changes compositing.
  - [ ] A layer can be deleted; deleting the last remaining layer is blocked.
  - [ ] Each of the 7 blend modes is selectable per layer and produces distinct visual output.
  - [ ] Canvas state (composite op, alpha, transform) does not leak between layers.

### FR-6: Layer Catalog & Parameter Bounds

- **User story:** As a builder, I want a range of effects with knobs that can't produce garbage, so that every twist of a control gives me something that still looks good.
- **Detail:** Sixteen layer types across three roles. Each layer type declares its parameters with hard min/max bounds. **Animatable** parameters (marked *A*) store four values in the seed — `min`, `max`, `times` (cycles per loop, 1–8), and `algorithm` — and resolve per frame through FR-3. **Static** parameters (marked *S*) store a single value.
- **Detail:** Layer types are referenced in the seed by **stable integer ID**, append-only, same rule as algorithms.
- **Detail:** All colors are **scheme references** (see FR-7), never raw values in a layer, unless explicitly pinned.

**Common to every layer type**

| Param | Kind | Bounds |
|---|---|---|
| `type` | S | one of 16 layer type IDs |
| `blend` | S | one of 7 blend modes |
| `opacity` | A | 0.05 – 1.0 |
| `color` | S | scheme reference |
| `rngSeed` | S | uint32 — drives derived positions within this layer |

**Primary — center-anchored structure**

| # | Layer | Parameters (bounds) |
|---|---|---|
| 1 | **Ray Rings** | `rayCount` S 3–64 · `innerRadius` A 0–400 · `length` A 40–900 · `thickness` A 1–24 · `rotation` A 0–360° · `taper` S bool |
| 2 | **Nth Rings** | `ringCount` S 2–24 · `spacing` A 10–160 · `strokeWeight` A 1–20 · `radiusOffset` A 0–200 · `dashCount` S 0–48 (0 = solid) |
| 3 | **Layered Poly** | `polyCount` S 1–12 · `sides` S 3–12 · `baseRadius` A 60–700 · `scaleStep` S 0.50–0.95 · `rotation` A 0–360° · `rotationStep` S −30–30° · `strokeWeight` A 1–16 |
| 4 | **Encircled Spiral** | `armCount` S 1–12 · `tightness` A 0.05–1.0 · `sweep` A 90–1440° · `strokeWeight` A 1–14 · `rotation` A 0–360° |
| 5 | **Petal Bloom** | `petalCount` S 3–36 · `ringCount` S 1–4 · `petalLength` A 60–800 · `petalWidth` A 10–300 · `rotation` A 0–360° · `filled` S bool |
| 6 | **Orbit Dots** | `ringCount` S 1–8 · `dotsPerRing` S 1–24 · `baseRadius` A 60–800 · `ringGap` S 40–220 · `dotRadius` A 2–30 · `rateSpread` S 0.5–3.0 |
| 7 | **Arc Gates** | `gateCount` S 2–10 · `arcSpan` A 10–170° · `weight` A 4–60 · `radiusStep` S 40–200 · `rotation` A 0–360° · `rateSpread` S 0.5–3.0 |

**Secondary — full-frame texture**

| # | Layer | Parameters (bounds) |
|---|---|---|
| 8 | **Line Field** | `lineCount` S 4–80 · `angle` A 0–180° · `weight` A 1–20 · `offset` A 0–200 |
| 9 | **Moiré Grid** | `spacing` S 8–60 · `relativeAngle` A 0–45° · `weight` S 1–4 · `drift` A 0–120 |
| 10 | **Grid Pulse** | `cellSize` S 30–240 · `waveAngle` A 0–360° · `waveFreq` S 1–6 · `cellScale` A 0.1–1.0 · `filled` S bool |
| 11 | **Sine Ribbons** | `ribbonCount` S 1–12 · `amplitude` A 20–500 · `frequency` A 0.5–6.0 · `thickness` A 2–60 · `phaseSpread` S 0–1 |
| 12 | **Crosshatch** | `angleA` A 0–180° · `angleB` A 0–180° · `spacing` A 10–120 · `weight` A 1–10 |

**Overlay — final-pass mood**

| # | Layer | Parameters (bounds) |
|---|---|---|
| 13 | **Fuzz Flare** | `burstCount` S 1–8 · `radius` A 100–900 · `intensity` A 0.05–1.0 · `spread` S 0–1 (position scatter) |
| 14 | **Scan Lines** | `bandHeight` S 2–40 · `gap` S 2–40 · `drift` A 0–1920 · `opacity` A 0.02–0.60 |
| 15 | **Vignette Wash** | `mode` S radial\|linear · `angle` A 0–360° · `falloff` A 0.1–1.0 · `strength` A 0.05–0.90 |
| 16 | **Grain** | `tileSize` S 128\|256 · `opacity` A 0.02–0.35 · `driftX` A 0–256 · `driftY` A 0–256 |

- **Acceptance criteria:**
  - [ ] All 16 layer types are implemented and individually selectable.
  - [ ] Every parameter clamps to its declared bounds; out-of-range values in a decoded seed are clamped, not rejected.
  - [ ] No user-reachable control can drive a layer to render nothing at all, or to render a full-canvas opaque fill that hides everything beneath it.
  - [ ] `Grain` generates its noise tile once per composition and re-blits it — no per-pixel work per frame.
  - [ ] `Fuzz Flare` glow is produced with radial gradients; `shadowBlur` is not used anywhere.
  - [ ] Layer types whose geometry is static across the loop pre-render to an offscreen canvas once.
  - [ ] Each layer type has a documented worst-case draw-call count at maximum bounds.

### FR-7: Color Schemes

- **User story:** As a builder, I want colors that work together without me picking them, so that randomize gives me something coherent instead of mud.
- **Detail:** A **scheme** is a named set of colors in three buckets: **color** (vivid), **neutral** (blacks/whites/grays), **background**. A layer's `color` parameter is a **scheme reference**: either a bucket (`color` / `neutral` / `background`) plus an index resolved through the layer's PRNG, or a **pinned** literal hex.
- **Detail:** The canvas background is drawn from the active scheme's `background` bucket.
- **Detail:** Four schemes ship built-in (**proposed — open to veto**):

| Scheme | color | neutral | background |
|---|---|---|---|
| **Neon Night** | `#FF2E88` `#00E5FF` `#7C4DFF` `#00FFA3` `#FFD400` | `#FFFFFF` `#B0B6C0` `#2A2E37` | `#07060D` `#120B1F` |
| **Solar Flare** | `#FF6B00` `#FFB300` `#E4002B` `#FFE066` `#FF3D57` | `#F5EFE0` `#8A7F6B` `#241C12` | `#120A05` `#1E0D06` |
| **Deep Sea** | `#00C2A8` `#2E7DFF` `#5EEAD4` `#0E7490` `#A5F3FC` | `#E8F1F5` `#64748B` `#111C26` | `#03080E` `#061826` |
| **Bone & Ink** | `#C0492B` `#8C6A3F` `#3F5E5A` `#A8452C` | `#EDE6D8` `#9A9287` `#3A3733` `#141312` | `#0E0D0C` `#EDE6D8` |

- **Acceptance criteria:**
  - [ ] Four built-in schemes are available and switchable.
  - [ ] Changing scheme re-resolves every layer's colors without altering any other parameter.
  - [ ] A pinned color survives a scheme change unchanged.
  - [ ] Every bucket in every built-in scheme is non-empty.
  - [ ] Scheme selection round-trips through seed encode/decode.

### FR-8: Custom Schemes

- **User story:** As a builder, I want to make my own palette and have my friend see my exact colors, so that my composition isn't repainted on their screen.
- **Detail:** Users can create, name, edit, and delete custom schemes. Each bucket accepts **1–8 colors**; every bucket must hold at least one.
- **Detail:** Custom schemes persist in local storage **and are embedded in full inside any seed that uses one**, so a recipient with no copy of the scheme still sees the author's colors.
- **Detail:** Opening a seed carrying an embedded custom scheme does **not** silently add it to the recipient's library; the recipient is offered an explicit "Save this scheme" action.
- **Acceptance criteria:**
  - [ ] A custom scheme can be created, named, edited, deleted, and selected.
  - [ ] Each bucket enforces 1–8 colors and rejects an empty bucket.
  - [ ] A seed using a custom scheme renders with the author's exact colors on a device that has never seen that scheme.
  - [ ] Custom schemes survive a page reload.
  - [ ] Deleting a custom scheme that a saved gallery entry depends on does not break that entry (the seed carries the colors).

### FR-9: Randomize

- **User story:** As a builder, I want one button that gives me something new and interesting, so that exploring costs me nothing.
- **Detail:** Randomize generates a complete new composition: layer count, layer types, ordering, blend modes, all parameter values, all motion assignments, and scheme selection.
- **Detail:** Randomize is **role-aware**. It draws across the primary/secondary/overlay roles rather than sampling all 16 types uniformly, so a result reads as structure + texture + mood. Proposed shape: 1–2 primary, 0–2 secondary, 0–2 overlay, total 2–5 layers.
- **Detail:** Randomize is **taste-constrained**, not merely bounded: it avoids combinations known to produce a flat or unreadable result — e.g. not stacking multiple full-canvas opaque overlays, not assigning `difference` to the bottom layer, not selecting a layer color from the same bucket as the background.
- **Detail:** Randomize is available at all times, in one tap, from the main view.
- **Acceptance criteria:**
  - [ ] Randomize produces a valid, renderable composition every time.
  - [ ] 100 consecutive randomizes produce no blank canvas and no all-one-color canvas.
  - [ ] Randomize respects the 5-layer cap and the performance governor's block state (FR-15).
  - [ ] Randomize never selects a layer color equal to the resolved background color.
  - [ ] Results vary — 20 consecutive randomizes yield at least 15 distinct layer-type multisets.

### FR-10: Tweak Mode

- **User story:** As a builder, I want to fine-tune something I almost like, so that a near-miss becomes exactly what I wanted.
- **Detail:** Every element of the composition is editable after generation: add layer (type picker), delete layer, reorder layers, change blend mode, change scheme, change duration, and adjust every parameter of every layer within its declared bounds.
- **Detail:** Edits apply **live** — the running animation reflects the change without a restart, unless the change requires re-deriving pre-rendered geometry, in which case the rebuild is imperceptible.
- **Detail:** An **Undo** of the last edit is available. Full history is not required.
- **Acceptance criteria:**
  - [ ] Every parameter in FR-6 is reachable and adjustable through the UI.
  - [ ] Controls cannot be driven outside declared bounds.
  - [ ] A parameter change is visible within one loop cycle without resetting playback position.
  - [ ] Undo restores the immediately previous composition state.
  - [ ] Any edit invalidates the current seed string and regenerates it.

### FR-11: Motion Character & Advanced Algorithm Control

- **User story:** As a builder, I want to say "make this one breathe" without learning twenty algorithm names, so that the tool stays simple while still being deep.
- **Detail:** Each layer exposes a single **Motion** control with named characters — **Calm, Breathing, Pulse, Tidal, Heartbeat, Chaotic** — where each character maps to a curated subset of the 20 algorithms. Selecting a character deterministically assigns algorithms from that pool to the layer's animatable parameters using the layer's PRNG.
- **Detail:** A **Speed** control scales the `times` value across all of that layer's animatable parameters (proposed range ×0.25 – ×3, clamped so each resulting `times` stays within 1–8).
- **Detail:** A **Reroll Motion** action redraws the assignment within the currently selected character.
- **Detail:** An **Advanced** disclosure per layer, collapsed by default, exposes per-parameter control of `min`, `max`, `times`, and `algorithm` directly. Hand-set values survive character rerolls only until the character is changed.
- **Detail:** The seed always stores the resolved per-parameter values — never the character name — so a hand-tuned layer and a character-generated layer are indistinguishable to the decoder.
- **Acceptance criteria:**
  - [ ] Six motion characters are selectable per layer and produce visibly different pacing.
  - [ ] Every one of the 20 algorithms belongs to at least one character pool.
  - [ ] Reroll Motion produces a different assignment within the same character (or reports that the pool is exhausted).
  - [ ] Advanced disclosure exposes min/max/times/algorithm for every animatable parameter of the layer.
  - [ ] A composition hand-tuned via Advanced round-trips through the seed with no loss.
  - [ ] Advanced is collapsed on first load.

### FR-12: Seed Encoding & Decoding

- **User story:** As a builder, I want to copy one string that captures everything, so that sharing is a paste and nothing else.
- **Detail:** A seed is a single URL-safe string encoding the **entire composition**: version, duration, scheme (built-in index or fully embedded custom scheme), and every layer with every parameter.
- **Detail:** Proposed format (**open to veto**):

  ```
  <version><flag><payload>

  version : "1"
  flag    : "z" = compressed, "p" = plain
  payload : base64url, unpadded
  ```

  The pre-encoding structure is a **positional array** — no object keys — in a canonical order derived from the layer type's declared parameter list:

  ```
  [ schemaVersion, durationId, scheme, [ layer, layer, … ] ]

  scheme            = builtinIndex (int)  |  [name, [colors], [neutrals], [backgrounds]]
  layer             = [ typeId, blendId, rngSeed, param, param, … ]
  animatable param  = [ min, max, times, algorithmId ]
  static param      = number | bool | string
  ```

  Serialized to JSON, then compressed with the platform's native deflate facility where available (`flag = "z"`), otherwise emitted uncompressed (`flag = "p"`), then base64url-encoded.

- **Detail:** All floating-point values are **quantized to 3 decimal places** before encoding. This guarantees byte-identical round-trips and materially shortens the string.
- **Detail:** Colors encode as 6-digit hex without the `#`.
- **Detail:** Decoding is **forward-tolerant**: unknown trailing array elements are ignored, missing trailing elements take documented defaults, and out-of-bounds numbers clamp. A seed with an unrecognized `version` is rejected with a clear message (FR-18).
- **Acceptance criteria:**
  - [ ] `decode(encode(c))` deep-equals `c` for every composition, after 3-decimal quantization.
  - [ ] A typical 5-layer composition on a built-in scheme encodes to **≤ 1,500 characters**; with an embedded custom scheme, **≤ 2,000**.
  - [ ] Hard ceiling: any seed exceeding 4,000 characters triggers a warning to the user before sharing.
  - [ ] The seed string contains only `A–Z a–z 0–9 - _` and requires no URL escaping.
  - [ ] Decode of a valid seed completes in **< 50 ms** on a mid-range phone.
  - [ ] A seed produced on a device without native compression decodes correctly on one with it, and vice versa.
  - [ ] Round-trip is covered by a property test over randomly generated compositions.

### FR-13: Share & Load by URL

- **User story:** As a builder, I want to send a link and have my friend just see it, so that there's no explaining involved.
- **Detail:** The seed is carried in the **URL hash fragment** (`…/loop-me/#s=<seed>`). The hash keeps the seed off any server and avoids GitHub Pages routing entirely.
- **Detail:** A **Copy Link** action copies the full shareable URL; a **Copy Seed** action copies the bare seed string. Both give visible confirmation.
- **Detail:** A **Paste Seed** input accepts either a bare seed or a full URL and loads it.
- **Detail:** The URL hash updates as the composition changes, so the address bar is always shareable. Hash updates must not create a browser history entry per keystroke.
- **Detail:** Loading with no hash starts on a randomized composition, not a blank canvas.
- **Detail:** Every load — seeded or bare — passes through the entry splash first (FR-0). The composition is decoded and pre-warmed behind the splash; rendering begins on Enter.
- **Acceptance criteria:**
  - [ ] Opening a URL containing a valid seed renders that exact composition once the splash is dismissed.
  - [ ] A shared-seed URL never begins animating before the user enters.
  - [ ] Copy Link and Copy Seed both work on desktop and mobile browsers, with a fallback if the clipboard API is unavailable.
  - [ ] Paste Seed accepts a bare seed, a full URL, and either with surrounding whitespace.
  - [ ] Editing a parameter updates the hash without flooding browser history.
  - [ ] Opening the bare page with no hash shows a running randomized loop after the splash is dismissed.

### FR-14: Local Gallery

- **User story:** As a builder, I want to keep the ones I liked, so that I can come back to them and send them later.
- **Detail:** A **Save** action stores the current seed to local storage with an **optional user-written description** and a creation timestamp.
- **Detail:** The gallery lists saved entries — description (or a truncated seed if none), duration, and date. Each entry supports **Load**, **Copy Link**, **Rename/Edit description**, and **Delete**.
- **Detail:** No thumbnails. Entries are text only.
- **Detail:** Entries are ordered newest-first. A capacity of **at least 200 entries** is supported.
- **Detail:** Gallery contents are exportable and importable as a JSON blob, so a user can move their collection between devices or back it up. *(Note: this is a text blob of seeds, not an art export — it does not conflict with the no-export non-goal.)*
- **Acceptance criteria:**
  - [ ] Save stores seed + optional description + timestamp, and the entry survives a reload.
  - [ ] Load restores the exact composition, including a custom scheme embedded in the seed.
  - [ ] Description is optional; saving without one works.
  - [ ] Delete removes the entry and asks for confirmation.
  - [ ] 200 saved entries load and list without perceptible delay.
  - [ ] Local storage quota exhaustion produces a clear message, not a silent failure.
  - [ ] Gallery export produces a JSON file; importing it restores every entry.

### FR-15: Performance Governor

- **User story:** As a builder on a phone, I want to be told when my composition is too heavy, so that I can back off — and I want the art to look the same as it does on a laptop regardless.
- **Detail:** The engine samples frame intervals over a rolling window and computes a **median**, not a mean, so a single GC pause doesn't trip it.
- **Detail:** Thresholds (original 20 ms / 18 ms proposal **vetoed 2026-08-04** — the warning must not appear unless the app is genuinely under 30 fps): window of **90 frames**; enter the warning state when the median frame interval exceeds **34 ms** (< ~29 fps) across **two consecutive** windows; leave it when the median drops below **30 ms** (> ~33 fps) across two consecutive windows. Sampling ignores the first **60 frames** after any composition change, to skip warm-up.
- **Detail:** In the warning state: a dismissible banner explains that the composition is heavy on this device, **Add Layer is disabled** with an explanatory tooltip, and Randomize biases toward fewer layers.
- **Detail:** The governor **never alters rendering**. It does not reduce element counts, drop to 30 fps, lower resolution, or skip layers. Determinism is the product; a seed that renders differently on a slow device is a broken seed.
- **Acceptance criteria:**
  - [ ] A deliberately heavy composition trips the warning on a throttled device within ~10 seconds.
  - [ ] A single dropped frame or a tab refocus does not trip the warning.
  - [ ] Add Layer is disabled and explained while warned; it re-enables when performance recovers.
  - [ ] Rendered output is identical with the governor warning active and inactive.
  - [ ] Frame-interval sampling itself costs no measurable frame time.

### FR-16: UI Shell

- **User story:** As someone who just opened the page, I want to understand it in five seconds, so that I start playing instead of reading.
- **Detail:** The canvas is the primary surface. Controls are secondary and must not permanently obscure the composition — a **view-only mode** hides all chrome.
- **Detail:** **Randomize is always one tap away** from the main view, on both desktop and mobile.
- **Detail:** Layer editing is progressive: composition-level controls (duration, scheme, randomize, share, save) at the top level; per-layer controls one level in; per-parameter algorithm controls behind Advanced.
- **Detail:** The interface must be usable one-handed on a phone in portrait.
- **Acceptance criteria:**
  - [ ] Randomize is reachable in one interaction from the default view on both form factors.
  - [ ] A view-only mode hides all UI chrome and is dismissible without a page reload.
  - [ ] All controls are operable on a 375 px-wide viewport without horizontal scrolling.
  - [ ] Advanced controls are collapsed by default.
  - [ ] No control requires hover to discover or operate.

### FR-17: Motion Sensitivity & Flash Safety

- **User story:** As a viewer sensitive to flashing, I want the page not to hurt me, so that I can look at it at all.
- **Detail:** No animation runs before the user passes the entry splash (FR-0), which carries the photosensitivity warning. FR-17 governs behaviour from that point on.
- **Detail:** When `prefers-reduced-motion: reduce` is set, entering lands **paused on a single static frame** with a visible Play control. The user can still opt in.
- **Detail:** Additive and screen blending across five layers with fast oscillation can produce strobing. The engine constrains high-frequency full-canvas luminance swings: randomize will not assign high `times` values to full-canvas opacity parameters on additively blended overlay layers.
- **Detail:** A **Pause** control is always available.
- **Acceptance criteria:**
  - [ ] With reduced-motion set, the page loads paused with an obvious Play control.
  - [ ] Pause and Play are available in every mode, including view-only.
  - [ ] Randomize does not produce full-canvas luminance flashing above 3 Hz.
  - [ ] Pausing stops all animation work; a paused page consumes negligible CPU.

### FR-18: Invalid Input & Error Handling

- **User story:** As someone who pasted a mangled seed, I want to be told what happened, so that I'm not staring at a blank page wondering if it's broken.
- **Detail:** Malformed, truncated, or unknown-version seeds produce a clear, non-technical message and fall back to a fresh randomized composition rather than a blank canvas or a stuck state.
- **Detail:** Recoverable inconsistencies — out-of-range numbers, unknown blend mode, missing trailing parameters — are repaired silently via clamping and documented defaults.
- **Detail:** Unavailable local storage (private browsing, quota) disables Save with an explanation; the rest of the app keeps working.
- **Acceptance criteria:**
  - [ ] A truncated seed shows a readable error and a working randomized composition.
  - [ ] A seed with a future version number is rejected with a message naming the version mismatch.
  - [ ] An unknown layer type ID in a seed skips that layer and warns, rather than failing the whole composition.
  - [ ] No unhandled exception can leave the canvas blank or the render loop stopped.
  - [ ] With local storage blocked, the app loads, renders, randomizes, and shares normally.

---

## Non-Functional Requirements

**Performance**
- Sustained **60 fps** on a modern laptop and a mid-range phone (reference targets: 2020-era mid-range Android, iPhone 11) for a typical 3-layer composition.
- Worst case — 5 layers at maximum parameter bounds — must remain **above 30 fps** on the reference phone.
- **Time to splash paint: < 300 ms** on a warm cache. **Time from Enter to first rendered frame: < 200 ms**, since decode and pre-warm happen behind the splash; seed decode alone **< 50 ms**.
- Total transferred page weight **under 250 KB**, uncompressed, including all code and assets.
- Steady-state memory under 150 MB; no growth over a 10-minute run (no per-frame allocation of canvases, gradients, or arrays that can be cached).

**Determinism**
- A given seed produces visually identical output across browsers, devices, refresh rates, and sessions. This outranks performance: no optimization may alter rendered output based on device capability.

**Security & Privacy**
- No network requests after initial page load. No analytics, no telemetry, no third-party requests.
- No cookies. Local storage only, and only for gallery entries and custom schemes.
- Seed data is never transmitted — the hash fragment is not sent to any server.
- Pasted seeds are untrusted input: decoded values are validated and clamped, never used to construct executable code (no `eval`, no `Function`, no `innerHTML` from decoded content).

**Accessibility**
- WCAG 2.1 AA for all UI chrome: 4.5:1 text contrast, visible focus indicators, full keyboard operability, labeled controls.
- The generative canvas is decorative and exempt from contrast requirements, but carries a descriptive accessible label.
- `prefers-reduced-motion` honored per FR-17.
- The entry splash (FR-0) traps focus while open, is fully keyboard-operable, and returns focus to the main view on dismiss.
- Touch targets at least 44 × 44 px.
- No control depends on color alone to convey state.

**Platform**
- Evergreen desktop browsers (last two major versions of Chrome, Firefox, Safari, Edge) and mobile Safari 16.4+ / Chrome Android.
- Portrait 1080×1920 render target, scaled to fit; landscape viewports letterbox.
- Functions fully offline once loaded.

**Maintainability**
- Layer types are pluggable: adding a seventeenth layer type requires declaring its parameters and draw routine, with no change to the seed codec, the randomizer, or the UI generation.
- Algorithm IDs and layer type IDs are append-only and covered by a test that pins their exact ordering.
- Parameter bounds are declared as data, not scattered through UI and render code.

---

## Constraints

- **Buildless.** No bundler, no transpiler, no package manager, no build step of any kind. The repository contents are what GitHub Pages serves.
- **No third-party libraries or frameworks**, including CDN-delivered ones. Native browser APIs only. (Native platform APIs such as the canvas 2D context, local storage, and the platform compression facility are not "libraries" and are permitted.)
- **2D canvas only.** No WebGL, no WebGPU, no SVG-based rendering.
- **Static hosting.** No server, no build pipeline, no environment variables, no secrets.
- **Single-page.** No routing beyond the hash fragment.
- **Solo builder, hobby project.** Scope decisions should favor shipping something fun over completeness.

---

## Dependencies

- **GitHub Pages** — static hosting.
- **Canvas 2D API** — all rendering.
- **Local Storage API** — gallery and custom schemes.
- **Clipboard API** — copy seed/link, with a manual-selection fallback.
- **Platform compression API** — seed compression, with an uncompressed fallback path.
- **`my-nft-gen` loop-safe algorithm implementations** — ported directly as the value engine; the source is the reference for correctness.

---

## Assumptions

- Users open the page on a device capable of 60 fps 2D canvas rendering at 1080×1920 internal resolution.
- Seeds are shared through channels that preserve long strings intact (messaging apps, email). Aggressive link-shorteners or platforms that truncate URLs may break sharing; this is accepted.
- Nobody needs to migrate old seeds when new layer types are added — append-only IDs make old seeds continue to work, and that is sufficient.
- Local storage is available in the common case; private browsing degrades gracefully rather than being a supported target.
- The user is the primary audience. Discoverability, onboarding, and hand-holding are secondary to getting to something interesting fast.
- The 16 proposed layer types are a starting catalog, not a fixed contract — the pluggable architecture assumes the list will grow.

---

## Deferred (explicitly out of v1, recorded so they're not re-litigated)

- **Short seeds.** A composition produced by randomize and never tweaked could in principle be expressed as a ~10-character PRNG seed, with the long form used only after editing. Real benefit for the common path, but it doubles the codec surface and couples every future change to PRNG stability. Revisit once the layer catalog stops moving.
- **Gallery thumbnails.** Ruled out in the idea phase.
- **Any art export** — GIF, video, image. Ruled out in the idea phase.
- **Real-time interaction.** Ruled out in the idea phase.
- **Adaptive quality degradation.** Ruled out — it breaks determinism.

---

## Glossary

- **Algorithm:** One of 20 loop-safe oscillation functions that map a frame position within the loop to a value between a min and a max, guaranteeing that the last frame resolves back to the first.
- **Animatable parameter:** A layer parameter stored as `{min, max, times, algorithm}` and resolved per frame, rather than as a single fixed value.
- **Blend mode:** The canvas composite operation applied when drawing a layer over everything beneath it.
- **Bucket:** One of the three color groups within a scheme — `color`, `neutral`, `background`.
- **Composition:** The complete state of a piece — duration, scheme, and the ordered list of layers with all their parameters. What a seed encodes.
- **Governor:** The frame-rate monitor that warns the user and blocks adding layers when a composition is too heavy for the current device, without ever changing what is rendered.
- **Layer:** One instance of a layer type with its own parameters, blend mode, opacity, and color reference. A composition holds 1–5.
- **Layer type:** One of the 16 catalog effects (Ray Rings, Moiré Grid, Grain, …).
- **Motion character:** A named preset (Calm, Breathing, Pulse, Tidal, Heartbeat, Chaotic) that maps to a curated pool of algorithms, letting a user set a layer's pacing without choosing algorithms individually.
- **Phase offset:** A fixed per-algorithm constant that staggers when different algorithms peak, so layers don't pulse in unison.
- **Scheme:** A named palette split into the three buckets. Four ship built-in; users can author their own, which travel embedded inside the seed.
- **Scheme reference:** How a layer names a color — a bucket to draw from, or a pinned literal hex.
- **Seed:** The single URL-safe string encoding an entire composition. The unit of sharing.
- **Splash:** The static entry screen shown before any animation, carrying the photosensitivity warning and the Enter action. Suppressible per device, never per seed.
- **Static parameter:** A layer parameter that holds one fixed value for the whole loop.
- **Times:** The number of oscillation cycles a parameter completes over one loop.
