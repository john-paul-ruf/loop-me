# Design Spec — loop-me

*Derived from `specs/idea.md` and `specs/requirements.md`. This document owns UI layout, visual
language, and interaction behaviour. It does not choose the stack or the module structure —
that is Architect's call.*

---

## 0. Design Position

Three constraints shaped every decision here, and they pull against each other:

1. **The art is the product.** Chrome that competes with the canvas is a bug.
2. **There are hundreds of parameters.** Sixteen layer types, each with 4–7 parameters, most of
   them carrying four values (`min`, `max`, `times`, `algorithm`). Exposed naively this is a
   settings panel from hell.
3. **It has to work one-handed on a phone.**

The resolution is **progressive depth on a single surface**. Three levels, never more:

```
L0  Composition   duration · scheme · layer list · randomize · share · save
L1  Layer         type · blend · colour · motion character · speed · parameters
L2  Advanced      per-parameter min / max / cycles / curve      (collapsed by default)
```

Randomize lives outside the hierarchy entirely — it is pinned to a persistent action bar and
is one tap from every screen, including view-only.

### The one hard design problem

An animatable parameter is four numbers. Showing four numeric inputs per parameter would be
honest and unusable. Showing one slider would be usable and a lie.

**The answer is the live band.** Each animatable parameter renders as a dual-thumb range set on
the parameter's hard bounds — the band is where the value travels — with a **glowing cyan tick
that sits on the value the engine is resolving this frame, moving in real time**. Watch it for
two seconds and the four-value model explains itself without a word of documentation. `times`
and `algorithm` stay behind Advanced, because the band already shows you what they do.

This control is the centre of the design. If it works, the product is simple. If it doesn't,
nothing else rescues it.

---

## 1. Design Language

### Rendering constraint on the mocks

Mocks are **vanilla HTML + CSS**, no Tailwind, no CDN, no framework. The requirements forbid
third-party libraries "including CDN-delivered ones," and the app ships as buildless vanilla JS.
A mock built on a class vocabulary Coder cannot use is a mock that has to be translated twice.
`mocks/_tokens.css` is therefore written as production CSS and is intended to be **copied into
`src/` as the foundation stylesheet**, not reinterpreted.

### Colour

Chrome is near-black and deliberately desaturated so the canvas owns every saturated pixel on
screen. The single accent is pulled from the Neon Night built-in scheme, tying the UI to the
product's own palette without competing with it.

| Token | Value | Use | Contrast on `--ink-900` |
|---|---|---|---|
| `--ink-950` | `#07060B` | app backdrop, letterbox area | — |
| `--ink-900` | `#0E0D14` | dock / rail surface | — |
| `--ink-800` | `#16151E` | cards, inputs | — |
| `--ink-700` | `#1F1D29` | raised, hover | — |
| `--line` | `#2E2B3B` | hairlines | — |
| `--line-strong` | `#454154` | control borders | — |
| `--text` | `#F3F1F8` | body | 16.4:1 |
| `--text-dim` | `#A6A2B8` | secondary | 7.9:1 |
| `--text-faint` | `#8A8699` | labels — smallest permitted | 5.4:1 |
| `--accent` | `#FF2E88` | primary action | text on it uses `--accent-ink` at 8.1:1 |
| `--cyan` | `#00E5FF` | live values, focus ring | 11.2:1 |
| `--warn` | `#FFB300` | governor, cautions | 10.4:1 |
| `--danger` | `#FF6B82` | destructive | 6.6:1 |
| `--ok` | `#00FFA3` | confirmations | 13.9:1 |

All UI text clears WCAG 2.1 AA. The canvas is decorative and exempt, but carries a descriptive
`aria-label`.

**No state is ever carried by colour alone.** Selected chips add a `✓` glyph and a weight change;
the governor's fps dot is paired with a numeral; layer role dots are paired with the role spelled
out in text.

### Typography

System stack only — `ui-sans-serif, -apple-system, "Segoe UI", Roboto, …`, mono for seeds and
numerics. No webfonts: the page budget is 250 KB total and the app must make zero network
requests after load. A webfont would violate both.

| Token | Size | Use |
|---|---|---|
| `--f-xs` | 11px | eyebrow labels, uppercase, `.09em` tracking |
| `--f-sm` | 13px | helper text, metadata |
| `--f-md` | 15px | body, control labels |
| `--f-lg` | 18px | section titles |
| `--f-xl` | 24px | screen titles |
| `--f-2xl` | 34px | splash wordmark |

### Spacing, radius, elevation

- **Spacing:** 4px base — 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- **Radius:** 6 inputs · 10 cards & buttons · 16 sheet · 22 modal · 999 pills.
- **Elevation:** four levels — hairline, card lift, sheet lift (upward shadow), modal.
- **Touch targets:** 44 × 44 px minimum, enforced. Where a control is visually smaller — the
  22px slider thumb — the hit area is padded back out to 44px with a pseudo-element.

---

## 2. Layout

**One DOM, two arrangements**, switching at 960px. No duplicated markup, no separate mobile view.

```
< 960px  (phone, portrait)          >= 960px  (desktop)
┌─────────────────────┐             ┌──────────────┬────────────┐
│                     │             │              │            │
│   stage / canvas    │             │    stage     │    dock    │
│                     │             │   (canvas)   │  (rail)    │
├─────────────────────┤             │              │   384px    │
│  ▁▁▁ grabber ▁▁▁    │             │              │            │
│  [Randomize] ↗ ♥ ↺  │  ← pinned   │              │            │
│  scrollable dock    │             │              │            │
└─────────────────────┘             └──────────────┴────────────┘
```

- The canvas is `aspect-ratio: 1080/1920`, scaled to fit, letterboxed with the **active scheme's
  background colour** — not with UI grey. The letterbox is part of the composition.
- The dock is a bottom sheet on mobile (`max-height: 62dvh`, drag or tap the grabber between peek
  and expanded) and a fixed right rail on desktop. Same component, one media query.
- The action bar containing **Randomize** is pinned inside the dock and never scrolls away.
- `100dvh`, not `100vh` — mobile browser chrome must not clip the action bar.

**Why a bottom sheet and not a drawer or a modal:** thumb reach. The most-pressed control in the
product is Randomize; on a phone held one-handed it must sit in the bottom third. Everything else
arranges itself around that fact.

---

## 3. Component Inventory

| Component | Description | States |
|---|---|---|
| **Button** | primary / default / ghost / danger / icon; `--sm` variant | default, hover, active, focus-visible, disabled |
| **Segmented control** | 2–4 exclusive options (duration, colour source) | per-segment selected / unselected, focus |
| **Chip** | multi-option single-select in a wrap (blend mode, motion character) | selected (`✓` + fill + border), unselected, hover, focus |
| **Dual-thumb band** | *the core control* — animatable parameter | idle, dragging min, dragging max, live tick, focus per thumb |
| **Live tick** | cyan marker on the currently resolved value | moving, paused (still), hidden when layer opacity is 0 |
| **Stepper** | bounded integer (counts, cycles) | at min, mid, at max, disabled |
| **Slider** | single-value static parameter | default, dragging, focus |
| **Select** | layer type, algorithm — `optgroup` for grouping | default, focus, open |
| **Switch** | boolean static (`taper`, `filled`) | on, off, focus |
| **Checkbox** | splash suppression, confirmations | on, off, focus |
| **Text input / textarea** | scheme name, description, paste seed | default, focus, readonly, error |
| **Swatch** | one colour in a bucket | default, selected (double ring), removable (`✕`), add-slot (dashed) |
| **Scheme strip** | full palette preview as flush bars | default, selected |
| **Layer row** | drag grip · role dot · name · meta · ▲▼ | default, selected, dragging, top/bottom (arrow disabled) |
| **Disclosure** | Advanced sections | collapsed (default), expanded |
| **Bottom sheet / rail** | the dock | peek, expanded, dragging, desktop rail |
| **Banner** | inline info / warn / error | info, warn, error, dismissible |
| **Toast** | transient confirmation | visible, fading; always paired with `aria-live` |
| **Modal** | splash, add layer, schemes, share, gallery | open, focus-trapped |
| **Seed field** | mono readonly + copy + character meter | normal, near-limit (amber), over-limit (warn) |
| **Stage bar** | translucent overlay controls on the canvas | visible, faded (view-only) |
| **Status pill** | fps · elapsed / duration · layer count | ok, warned, paused |
| **Type card** | one of 16 layer types with a CSS impression | default, hover, focus |
| **Empty state** | gallery with nothing in it | — |

---

## 4. Screen Inventory

| Screen | Mock | Covers | Purpose |
|---|---|---|---|
| Splash — bare | `mocks/splash.html` | FR-0 | Flash-safety gate; first paint on every load |
| Splash — shared seed | `mocks/splash-seeded.html` | FR-0, FR-17 | Shared-loop notice, duration, reduced-motion note |
| Main view | `mocks/main.html` | FR-1, FR-2, FR-5, FR-16 | Canvas + composition controls; the default screen |
| Layer editor | `mocks/layer-editor.html` | FR-6, FR-10, FR-11 | Per-layer type, blend, colour, motion, parameters |
| Add layer | `mocks/add-layer.html` | FR-5, FR-6 | All 16 types grouped by role, with previews |
| Colour schemes | `mocks/schemes.html` | FR-7, FR-8 | Pick a built-in; author and edit custom schemes |
| Share & save | `mocks/share.html` | FR-12, FR-13, FR-14 | Copy link / seed, paste, save with description |
| Gallery | `mocks/gallery.html` | FR-14 | Saved seeds, text only, export / import |
| View only | `mocks/view-only.html` | FR-16, FR-17 | All chrome hidden, Pause preserved |
| States & edge cases | `mocks/states.html` | FR-15, FR-17, FR-18 | Governor, errors, fallbacks, toasts |
| Mock index | `mocks/index.html` | — | Directory; replaced by the clickable prototype |

---

## 5. User Flows

### Flow A — First open, no seed (the default path)

1. **Splash** paints. Nothing renders behind it; no timer runs. Decode and offscreen pre-warm
   happen while the user reads.
2. User presses **Enter** (or Space). Focus moves to the main view.
3. A randomized loop is already playing — never a blank canvas.
4. **Randomize** is under the thumb. This is the loop the whole product lives in: press,
   watch, press, watch.

### Flow B — Receiving a shared seed (the flow that must never fail)

1. Link opens → **splash with the shared-loop notice** and its duration. The recipient has never
   set a suppression preference, so they always see the warning. Suppression is per-device, never
   in a seed, never inferable from anything the sender controls.
2. Enter → the sender's exact composition, within 200 ms.
3. If it uses a custom scheme, an **offer** appears: "This loop came with its own palette — keep
   it?" Never added silently.
4. Randomize is right there. The recipient becomes a builder in one tap.

### Flow C — Found something, want to keep it

1. **♥ Save** → sheet with an optional description → saved.
2. Or **↗ Share** → Copy Link (primary) or Copy Seed → toast + `aria-live` confirmation.

### Flow D — Almost right, needs tuning

1. Tap a **layer row** → layer editor.
2. Swap **blend mode** — chips, immediate, live.
3. Change **Motion character** — one tap re-curves every animated value on the layer.
4. Drag a **band** — watch the live tick change what it does. Playback position never resets.
5. Unhappy? **↺ Undo**.

### Flow E — Going deeper

1. In the layer editor, expand **Advanced** on a single parameter.
2. Set `min` / `max` numerically, `cycles` 1–8, and pick one of 20 curves — the dropdown lists
   the current character's pool first, then all 20.
3. Hand-set values survive **Reroll motion**; changing the character replaces them (and the UI
   says so).

### Flow F — Too heavy for this device

1. Governor trips → amber banner naming the actual fps and suggesting removing a layer.
2. **Add layer** disables, with the reason as **visible text beneath it**, not a tooltip.
3. Randomize keeps working and biases toward fewer layers.
4. **The art never changes.** The banner is the only thing that happens.

---

## 6. Interaction Notes

### Motion character → algorithm pools *(design proposal — engine owns the final mapping)*

FR-11 requires every one of the 20 algorithms to belong to at least one pool. Proposed:

| Character | Pool | Reads as |
|---|---|---|
| **Calm** | `journeySin`, `journeySinSquared`, `journeyFlatTop`, `oceanTide` | slow, even, no events |
| **Breathing** | `breathing`, `journeySteepBell`, `invertedBell`, `journeyExpEnvelope` | swell and release |
| **Pulse** | `pulseWave`, `doublePeak`, `ripple`, `spiralOut` | regular beat |
| **Tidal** | `oceanTide`, `waveCrash`, `mountainRange`, `spiralIn` | long swells, uneven crests |
| **Heartbeat** | `heartbeat`, `doublePeak`, `elasticBounce`, `exponentialDecay` | double-thump then rest |
| **Chaotic** | `volcanic`, `butterfly`, `elasticBounce`, `waveCrash`, `ripple` | unpredictable, spiky |

All 20 covered; `oceanTide`, `doublePeak`, `elasticBounce`, `waveCrash` and `ripple` intentionally
appear in two pools where they genuinely read both ways.

### Live edits

Every control applies **live, without resetting playback position**. A parameter change is visible
within one loop cycle. Where a change forces pre-rendered geometry to rebuild (`rayCount`,
`ringCount`, `tileSize`), the rebuild happens off the visible frame — the user must never see a
flicker on a slider drag.

### Reorder

Drag by the grip **and** ▲▼ buttons on every row. The buttons are not a fallback — they are the
keyboard and screen-reader path, and the top row's ▲ and bottom row's ▼ are disabled rather than
silently inert. List order is stack order: **top row = top layer**, matching what the eye sees.

### Undo

A single-step ↺ in the action bar. Toast confirms ("Change undone") so it is never ambiguous
whether it fired. No redo — FR-10 requires only one level.

### Hover is never load-bearing

FR-16 forbids hover-dependent discovery. Consequences enforced throughout: no tooltips carry
unique information; every disabled control states its reason in adjacent visible text; the
view-only ghost bar sits at 28% opacity rather than 0, so it is discoverable on a touch device
with no pointer at all.

### Keyboard map

| Key | Action |
|---|---|
| `Enter` / `Space` | dismiss splash (focus starts there) |
| `Space` | play / pause (outside a text field) |
| `R` | randomize |
| `V` | toggle view-only |
| `Esc` | exit view-only · close modal · collapse sheet |
| `Tab` | focus, trapped inside modals and the splash |
| `←` `→` | move a focused slider thumb by one step |
| `Shift` + `←` `→` | move by ten steps |

### Focus

A single ring everywhere: `0 0 0 2px var(--ink-950), 0 0 0 4px var(--cyan)` — a dark spacer then a
bright ring, so it reads against both the dark chrome and the arbitrary colours of the canvas.
Never removed, on any element.

### Voice

Messages name what happened and what to do next, in the register of the person who built this for
himself. No codec, engine, or browser vocabulary in user-facing strings:

> "That link didn't survive the trip — the seed looks cut off. Some apps shorten long links."

not

> "Seed decode failed: unexpected end of base64url payload at offset 812."

---

## 7. Requirement Coverage

| Requirement | Where it is designed |
|---|---|
| FR-0 Splash & flash gate | `splash.html`, `splash-seeded.html` — blank behind, focus-trapped, no auto-dismiss |
| FR-1 Canvas & render loop | `.canvas-frame` 1080:1920 scaled, letterbox in scheme background |
| FR-2 Loop durations | Segmented control, three options, `main.html` |
| FR-3 Loop-safe engine | Surfaced as curve dropdowns in Advanced; §6 pools |
| FR-4 Deterministic randomness | No UI surface — invisible by design |
| FR-5 Layers & compositing | Layer list, 7 blend chips, add/delete/reorder |
| FR-6 Catalog & bounds | `add-layer.html` all 16; bounds printed under every track |
| FR-7 Colour schemes | `schemes.html`, scheme strips, bucket segmented control |
| FR-8 Custom schemes | `schemes.html` editor; recipient offer in `states.html` |
| FR-9 Randomize | Pinned in the action bar on every screen |
| FR-10 Tweak mode | `layer-editor.html`, live edits, ↺ undo |
| FR-11 Motion & Advanced | 6 character chips, Speed, Reroll, per-parameter Advanced collapsed |
| FR-12 Seed encoding | Seed field + character meter with amber near-limit state |
| FR-13 Share & load | `share.html` — Copy Link primary, paste accepts both forms |
| FR-14 Gallery | `gallery.html` — text only, inline delete confirm, export/import |
| FR-15 Governor | `states.html` — banner, disabled Add layer with visible reason |
| FR-16 UI shell | Three-level hierarchy, sheet/rail, view-only, 375px clean |
| FR-17 Motion sensitivity | Paused-with-Play state, Pause in every mode incl. view-only |
| FR-18 Errors | `states.html` — six cases, none a dead end |

### Accessibility checklist

- [x] All UI text ≥ 4.5:1 — table in §1
- [x] Visible focus ring on every interactive element, never removed
- [x] Full keyboard operability incl. slider thumbs and layer reorder
- [x] Touch targets ≥ 44 × 44 px, hit areas padded where visuals are smaller
- [x] No state conveyed by colour alone
- [x] Focus trapped in splash and modals; returned to main view on dismiss
- [x] Canvas labelled descriptively; decorative art exempt from contrast
- [x] `prefers-reduced-motion` → paused first frame with visible Play
- [x] No hover-only affordances
- [x] Toasts paired with `aria-live` announcements
- [x] Usable at 375px with no horizontal scroll

---

## 8. Open Design Questions

*None blocking implementation. Flagged for the polish phase:*

1. **Live-tick cost.** The tick must update per frame without touching layout. Intended as a
   `transform: translateX()` on a single element, written from the existing render loop — no
   separate timer, no reflow. If profiling says otherwise, the tick throttles to ~15 Hz before
   anything else is sacrificed; it is a readout, not an animation.
2. **Sheet height on short viewports.** 62dvh works down to about 640px tall. Below that the peek
   state may need to drop to the action bar alone. Confirm on a real small phone.
3. **Motion character preview.** Six names are learnable by trial but not self-evident. A tiny
   animated curve glyph on each chip would fix it at the cost of six more animating elements.
   Deferred to polish, pending frame budget.
4. **Layer role dots.** Currently redundant with the role text. If the meta line proves too dense
   at 375px, the dot survives and the word goes — but only if the dot then gains a text
   alternative elsewhere.

---

*Mocks are static. Working navigation between them arrives in the prototype phase.*
