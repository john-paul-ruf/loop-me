# Idea — loop-me

## One-Sentence Summary
loop-me is a buildless generative art toy that composes perfectly looping canvas animations from customizable layers, shareable as a single seed string.

## Problem
Generative art tools are either heavyweight — install a runtime, learn a framework, configure a build — or ephemeral, where you make something cool and it vanishes when you close the tab. There's no lightweight tool where you can mash "randomize," tweak a few knobs, and hand the exact result to a friend as a link. For someone who just wants to fuck around with algorithmic art, the barrier is either too high or the output is too unshareable.

## Vision
loop-me is a single web page. You open it and you're immediately watching a looping generative animation. The art is built from layers — up to five, stacked and composited — where each layer is a self-contained 2D canvas effect: radiating rays, concentric rings, spirals, soft flares, scan lines. Each layer carries its own blend mode, so layers can stack normally, glow additively, or cut against each other.

The secret sauce is loop-safe math. Every animatable parameter on every layer — position, radius, rotation, opacity, count, thickness — is driven by a loop-safe oscillation algorithm. The engine uses a library of ~20 algorithms (journey sin, breathing, heartbeat, volcanic, butterfly, ripple, ocean tide, spiral in/out) that take the current frame's position within the loop and return a value between a bounded min and max. Every algorithm is phase-aligned to the loop duration, so the last frame resolves back to the first. The loop is invisible. You can stare at it forever and never catch it restarting.

Color comes from schemes. A scheme is a set of colors split into three buckets — **color** (the vivid stuff), **neutral** (blacks, whites, grays), and **background**. Any layer parameter that takes a color either pulls at random from one of those buckets or is pinned to a specific hard-coded color. The canvas background is drawn from the scheme's background bucket. Four schemes ship built-in, and you can build your own.

You hit "randomize" and everything reshuffles — layers, blend modes, colors, parameters, algorithms. If something catches your eye, you dig in: reorder layers, swap blend modes, change the ray count, shift the scheme, retune a parameter. Every parameter is pre-bounded with a sensible min and max, so you can't break it — you can only explore the space of things that look good.

When you land on something you like, the whole composition encodes into one long seed string. Share it and anyone sees the identical loop. Save it to your local gallery with a note to yourself about what it is. No accounts, no backend, no build step. Just a GitHub Page that works.

Because a shared link can land in front of anyone, nothing moves until you say so. Every load opens on a still splash screen — the name, a line about what this is, and a plain warning that what follows flashes and moves. Nothing renders behind it; the canvas is blank until you hit Enter. Dismiss it for good on your own device if you want, but the person you send a seed to has never dismissed anything, so they always get the warning first. A share should never take someone out.

## Target User
- **Primary:** John, and anyone like him — people who enjoy generative art as a toy. Experimenting with parameters, chasing happy accidents, sending the good ones to friends. No art background or technical skill required.
- **Secondary:** Whoever receives a seed. Zero friction — open the link, watch the loop, hit randomize and start playing themselves.

## Key Features (high-level)
1. **Layer-based art engine** — up to 5 composable layers, each a distinct 2D canvas effect simplified from the my-nft-gen effect library. All parameters pre-bounded with min/max.
2. **Per-layer blend modes** — each layer sets its own canvas composite operation (normal, additive, screen, multiply, difference, etc.), encoded in the seed.
3. **Loop-safe oscillation algorithms** — ~20 frame-based algorithms driving every animatable parameter, each guaranteeing that frame 0 equals frame N. This is what makes the loops seamless.
4. **Color schemes with buckets** — 4 built-in schemes, each split into color / neutral / background buckets. Parameters pull randomly from a bucket or pin to a specific color. Users can author their own schemes, and custom schemes travel inside the shared seed.
5. **Randomize** — one button reshuffles the entire composition: layers, blends, colors, parameters, algorithms.
6. **Tweak mode** — reorder layers, swap blends, retune any bounded parameter, change schemes, adjust motion character.
7. **Loop durations** — 5s, 15s, 30s.
8. **Seed sharing** — the full composition encodes into one long string, carried in the URL. Decode is fast — the loop should be running near-instantly on open.
9. **Local gallery** — save seeds to local storage with an optional description, revisit them, copy them out to send to friends.
10. **Performance governor** — the engine watches frame rate, warns when the composition is too heavy for the device, and blocks adding more layers. It never silently alters the art.
11. **Entry splash & flash safety gate** — every load opens on a static warning screen with nothing rendering behind it. Animation begins only on Enter. Dismissible per device, so the sender opts out while every recipient still gets warned.
12. **Simple UI** — the interface stays easy and uncluttered despite the parameter depth. Randomize is always one tap away; depth lives behind an Advanced disclosure.
13. **Buildless deployment** — vanilla HTML/CSS/JS, no bundler, no dependencies, static GitHub Page.

## Canvas
Fixed internal render target of **1080×1920, portrait only**. The canvas scales to fit the viewport, letterboxed on wider screens. Every composition looks identical on a laptop and a phone because the coordinate space never changes — this is also what makes seeds truly portable.

## Layer Catalog (v1 proposal)
Layers fall into three roles. Randomize draws across roles so compositions read as structure + texture + mood rather than five of the same thing.

**Primary — center-anchored structure**
1. **Ray Rings** — rays radiating from center; count, length, thickness, inner radius.
2. **Nth Rings** — concentric circles; count, spacing, stroke weight.
3. **Layered Poly** — nested rotating polygons; side count, scale, rotation offset per ring.
4. **Encircled Spiral** — spiral arms winding outward; arm count, tightness, sweep.
5. **Petal Bloom** — ellipses arranged radially; petal count, length/width ratio, rotation.
6. **Orbit Dots** — dots travelling concentric circular paths at per-ring rates; ring count, dot count, radius.
7. **Arc Gates** — thick arc segments at several radii rotating independently; gap size, weight.

**Secondary — full-frame texture**
8. **Line Field** — parallel lines drifting; spacing, angle, weight.
9. **Moiré Grid** — two line grids overlaid at a slowly rotating relative angle. Cheap to draw, enormous visual payoff.
10. **Grid Pulse** — tiled cells pulsing in a spatial wave; cell size, wave direction.
11. **Sine Ribbons** — flowing polylines with oscillating amplitude and frequency; ribbon count, thickness.
12. **Crosshatch** — two crossing hatch sets; angle and weight animated.

**Overlay — final-pass mood**
13. **Fuzz Flare** — soft radial glow bursts built from radial gradients; burst count, radius, intensity.
14. **Scan Lines** — horizontal band overlay; band height, drift, opacity.
15. **Vignette Wash** — full-canvas gradient tint; direction, falloff, strength.
16. **Grain** — a noise tile generated once at load and re-blitted with animated offset and opacity. Never a per-pixel loop per frame.

**Performance rules that shaped this list:** no per-pixel manipulation during animation, no `shadowBlur` (glow comes from radial gradients plus additive blend), static geometry pre-rendered to offscreen canvases where the shape doesn't change, and per-layer element counts bounded so five layers stay inside a 16ms frame budget on a mid-range phone.

## Motion & The Algorithm UI
Every animatable parameter internally carries four values — min, max, cycle count, and its oscillation algorithm — and all four live in the seed. Exposing all of that directly would mean hundreds of dropdowns, which kills the simple-UI goal.

So the UI collapses it into **motion character**. Each layer gets one Motion picker with a handful of named characters — Calm, Breathing, Pulse, Tidal, Heartbeat, Chaotic — where each character maps to a curated pool of the ~20 algorithms. The engine deterministically assigns algorithms from that pool to the layer's parameters using the seed. A **Speed** control scales cycle counts across the layer, and **Reroll Motion** redraws the assignment within the chosen character.

Everything underneath stays reachable: an **Advanced** disclosure per layer exposes the per-parameter algorithm dropdowns for anyone who wants to hand-tune. Collapsed by default. Simple on the surface, deep when you go looking.

## Non-Goals
- **No real-time interaction.** You compose it, you watch it. No mouse or touch influence on the live animation.
- **No export.** No GIF, video, or image output. Live browser experience only.
- **No backend, accounts, or database.** Fully client-side. Gallery is local storage.
- **No external libraries or frameworks.** No npm, no bundler, no CDN. Pure vanilla JS.
- **No community platform.** No feeds, likes, comments, or profiles. Sharing is a string you send to a friend.
- **No 3D or WebGL.** 2D canvas only.
- **No landscape or responsive layout.** Portrait 1080×1920, scaled to fit.
- **No gallery thumbnails.** Saved entries are seed plus optional description.
- **No adaptive quality degradation.** The governor warns and limits; it never changes what the art looks like.
- **No faithful port of my-nft-gen.** Effects are inspiration, aggressively simplified for browser performance.

## Resolved Decisions
- **Orientation:** portrait 1080×1920 only, fixed internal resolution scaled to viewport.
- **Layer set:** the 16 effects above, spanning primary / secondary / overlay roles.
- **Algorithm exposure:** motion characters on the surface, per-parameter algorithm control behind an Advanced disclosure.
- **Performance governor:** rolling frame-rate detection, a warning to the user, and a block on adding further layers. Art is never silently degraded, because determinism is the whole point of a seed.
- **Custom schemes:** travel inside the seed so recipients see the author's exact colors.
- **Gallery:** seed plus an optional user-written description. No thumbnails.
- **Entry splash:** shown on every load with nothing animating behind it, carrying a photosensitivity warning. Suppressible per device via a "don't show again" checkbox — never per seed, so a share always warns its recipient.

## Open Questions
*None blocking. The following get settled during requirements:*
- Exact parameter list and min/max bounds per layer type.
- Seed encoding scheme and the resulting string length, especially with a custom color scheme embedded.
- Frame-rate threshold and sampling window that trips the performance warning.
- Which four color schemes ship built-in.
