// @ts-check
/**
 * Every user-facing string, in Designer's voice (§6 Voice).
 *
 * Architecture §12.2: "ui/strings.js maps each code to a message in
 * Designer's voice — keeping the mapping in exactly one auditable place is
 * what stops codec, engine and browser vocabulary leaking into a banner."
 *
 * Designer §6 Voice: messages "name what happened and what to do next, in
 * the register of the person who built this for himself. No codec, engine,
 * or browser vocabulary in user-facing strings."
 *
 * This module exports no functions — it is a data table. Every string the
 * UI can show lives here, keyed by a stable key. The error-code → message
 * map is one section of it.
 *
 * Strings with interpolation placeholders use `{n}` markers — the caller
 * replaces them with `strings.fmt(...)`. This keeps the template and the
 * values in the same mental space without concatenating in the caller.
 */

// ---------------------------------------------------------------------------
// Error code → message map (architecture §12.2, all nine codes)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ErrorMessage
 * @property {string} title One-line headline.
 * @property {string} body What happened and what to do next, in plain language.
 * @property {'info'|'warn'|'error'} level Banner style.
 */

/** @type {Record<string, ErrorMessage>} */
export const ERRORS = {
  SEED_VERSION: {
    title: 'This loop needs a newer loop-me',
    body: 'It was made with version {v} and this page is version {c}. Reload the page to pick up the latest, then try again.',
    level: 'error',
  },
  SEED_MALFORMED: {
    title: 'That link didn\'t survive the trip',
    body: 'The seed looks garbled — it may have been mangled by a URL shortener or chat app. Ask for it again, or paste the seed on its own. Here\'s a fresh random one in the meantime.',
    level: 'error',
  },
  SEED_TRUNCATED: {
    title: 'That link didn\'t survive the trip',
    body: 'The seed looks cut off — some apps shorten long links. Ask for it again, or paste the seed on its own. Here\'s a fresh random one in the meantime.',
    level: 'error',
  },
  SEED_TOO_LONG: {
    title: 'This link is very long',
    body: 'At {n} characters, some chat apps may cut it short. Send the seed on its own if it doesn\'t open for them.',
    level: 'warn',
  },
  LAYER_UNKNOWN_TYPE: {
    title: 'One layer was made with an effect this page doesn\'t have',
    body: 'Everything else is playing normally. It\'ll look slightly different from what the sender saw.',
    level: 'warn',
  },
  LAYER_DRAW_FAILED: {
    title: 'A layer hit a snag',
    body: '“{name}” stopped drawing. The rest of the loop is fine — try removing that layer or randomize a fresh one.',
    level: 'warn',
  },
  STORAGE_UNAVAILABLE: {
    title: 'Your browser isn\'t letting this page store anything',
    body: 'Private browsing, usually. Copy the link instead; it holds the whole loop by itself.',
    level: 'warn',
  },
  STORAGE_QUOTA: {
    title: 'No room left to save',
    body: 'Your gallery has hit this browser\'s storage limit. Export it as a backup, then delete a few to make room.',
    level: 'warn',
  },
  CLIPBOARD_UNAVAILABLE: {
    title: 'Copying isn\'t available here',
    body: 'We\'ve selected it for you — press \u2318C / Ctrl+C to copy.',
    level: 'info',
  },
}

/**
 * Generic fallback for an unmapped code — the UI boundary uses
 * `core/errors.js`'s `isErrorCode` to check first, but a safety net is a
 * safety net.
 */
export const UNKNOWN_ERROR = {
  title: 'Something went wrong',
  body: 'The loop is still running. If it looks wrong, try randomize.',
  level: 'error',
}

// ---------------------------------------------------------------------------
// Toast strings
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
export const TOASTS = {
  linkCopied: 'Link copied',
  seedCopied: 'Seed copied',
  saved: 'Saved to gallery',
  schemeSaved: 'Scheme saved',
  undone: 'Change undone',
  layerDeleted: 'Layer removed',
  layerDuplicated: 'Layer duplicated',
  exportDone: 'Video saved \u2014 check your downloads.',
  exportFailed: 'Export failed \u2014 nothing was saved.',
}

// ---------------------------------------------------------------------------
// Splash strings (mocks/splash.html, mocks/splash-seeded.html)
// ---------------------------------------------------------------------------

export const SPLASH = {
  tagline: 'Endless looping generative art. Mash randomize, tweak what you like, send the good ones to a friend.',
  sharedTitle: 'Someone shared a loop with you',
  /** `{dur}` → '15-second', `{n}` → layer count */
  sharedMeta: 'A {dur}-second loop \u00b7 {n} layers \u00b7 ready to play',
  warnHeading: 'Before you go in',
  warnBody: 'What comes next flashes, strobes and moves quickly, with high-contrast colour. If you are sensitive to flashing lights, or you get migraines or seizures from moving images, please don\'t continue.',
  reducedMotion: 'Your device asks for reduced motion, so this will open paused on a single still frame. There\'s a Play button when you want it.',
  suppress: 'Don\'t show this again on this device',
  footnote: 'This setting is saved on this device only. Anyone you share a loop with still sees this warning first.',
  enter: 'Enter',
}

// ---------------------------------------------------------------------------
// Composition panel strings (mocks/main.html)
// ---------------------------------------------------------------------------

export const COMPOSITION = {
  durationLabel: 'Loop duration',
  durations: ['5s', '15s', '30s'],
  schemeLabel: 'Colour scheme',
  layersLabel: 'Layers',
  addLayer: 'Add layer',
  /** `{name}` → layer display name */
  deleteLayer: 'Delete {name}',
  seedField: 'Seed',
  gallery: 'Gallery',
  pasteSeed: 'Paste seed',
  showWelcome: 'Show welcome screen',
  /** Governor disables Add layer with visible reason (design §5 Flow F). */
  addLayerBlocked: 'Paused while your device is struggling. Remove a layer and this comes back.',
  /** Add layer disabled at the FR-5 five-layer cap. */
  addLayerFull: 'That\u2019s the 5-layer max. Remove a layer to add another.',
}

// ---------------------------------------------------------------------------
// Layer editor strings (mocks/layer-editor.html)
// ---------------------------------------------------------------------------

export const LAYER_EDITOR = {
  back: 'Back',
  blendLabel: 'Blend mode',
  colorLabel: 'Colour',
  colorSource: 'Source',
  motionLabel: 'Motion character',
  speedLabel: 'Speed',
  reroll: 'Reroll',
  duplicate: 'Duplicate',
  delete: 'Delete',
  advanced: 'Advanced',
  minLabel: 'Min',
  maxLabel: 'Max',
  cyclesLabel: 'Cycles',
  curveLabel: 'Curve',
  typeLabel: 'Layer type',
}

// ---------------------------------------------------------------------------
// Share panel strings (mocks/share.html)
// ---------------------------------------------------------------------------

export const SHARE = {
  title: 'Share this loop',
  linkLabel: 'Link',
  seedLabel: 'Seed only',
  copyLink: 'Copy Link',
  copySeed: 'Copy',
  linkHint: 'The loop lives entirely in the link. Nothing is uploaded anywhere.',
  saveLabel: 'Save to your gallery',
  saveButton: 'Save',
  savePlaceholder: 'What is this one? (optional)',
  pasteLabel: 'Open someone else\'s',
  pasteButton: 'Load',
  pastePlaceholder: 'Paste a seed or a full link',
  pasteHint: 'A bare seed or a whole URL both work. Extra spaces are fine.',
  customSchemeBaked: 'Your scheme \u201c{name}\u201d is baked in',
  customSchemeBakedBody: 'Whoever opens this sees your exact colours.',
  exportLabel: 'Download video',
  /** `{duration}` → loop seconds */
  exportButton: 'Export video ({duration}s)',
  /** `{pct}` → 0\u2013100 */
  exportRecording: 'Encoding\u2026 {pct}%',
  exportSave: 'Save video',
  exportHint: 'Saves one full loop \u2014 1080\u00d71920, ready for TikTok or Reels. Works in seconds.',
  exportReadyHint: 'Ready \u2014 click to save to your downloads.',
  exportUnsupported: 'Video export isn\u2019t available in this browser.',
}

// ---------------------------------------------------------------------------
// Gallery panel strings (mocks/gallery.html)
// ---------------------------------------------------------------------------

export const GALLERY = {
  title: 'Gallery',
  searchPlaceholder: 'Search your descriptions',
  countSuffix: 'saved \u00b7 newest first',
  load: 'Load',
  copyLink: 'Copy link',
  editDescription: 'Edit description',
  addDescription: 'Add a description',
  delete: 'Delete',
  deleteConfirm: 'Delete this? The seed is gone unless you copied it.',
  deleteKeep: 'Keep',
  deleteConfirmButton: 'Delete',
  export: 'Export',
  import: 'Import',
  empty: 'Nothing saved yet \u2014 hit \u2665 on something you like.',
  storageHint: 'Saved on this device only. Export writes a JSON file you can carry to another one.',
}

// ---------------------------------------------------------------------------
// Schemes panel strings (mocks/schemes.html)
// ---------------------------------------------------------------------------

export const SCHEMES = {
  title: 'Colour schemes',
  chooseTab: 'Choose',
  editTab: 'Edit',
  save: 'Save this scheme',
  delete: 'Delete',
  namePlaceholder: 'Scheme name',
  colorsBucket: 'Colours',
  neutralsBucket: 'Neutrals',
  backgroundsBucket: 'Backgrounds',
  addColour: 'Add colour',
  recipientOfferTitle: 'This loop came with its own palette',
  /** `{name}` → scheme name */
  recipientOfferBody: '\u201c{name}\u201d \u2014 keep it for your own loops?',
  noThanks: 'No thanks',
}

// ---------------------------------------------------------------------------
// Add layer strings (mocks/add-layer.html)
// ---------------------------------------------------------------------------

export const ADD_LAYER = {
  title: 'Add a layer',
  roleLabels: {
    primary: 'Primary',
    secondary: 'Secondary',
    overlay: 'Overlay',
  },
}

// ---------------------------------------------------------------------------
// Governor banner (mocks/states.html, FR-15)
// ---------------------------------------------------------------------------

export const GOVERNOR = {
  /** `{fps}` → measured fps */
  title: 'This one\'s heavy for your device',
  body: 'It\'s running at about {fps} fps. The art still looks exactly as it should \u2014 it\'s just not as smooth here. Try removing a layer.',
}

// ---------------------------------------------------------------------------
// View-only strings (mocks/view-only.html)
// ---------------------------------------------------------------------------

export const VIEW_ONLY = {
  pause: 'Pause',
  randomize: 'Randomize',
  restore: 'Restore controls',
  hint: 'Tap anywhere for controls \u00b7 Esc to exit',
}

// ---------------------------------------------------------------------------
// Stage status (mocks/main.html)
// ---------------------------------------------------------------------------

export const STATUS = {
  fps: '{n} fps',
  noFps: '\u2014 fps',
  layers: '{n} layers',
  noLayers: '0 layers',
  elapsed: '{cur}s / {dur}s',
  warnedDotLabel: 'Warned',
  okDotLabel: 'OK',
  pausedDotLabel: 'Paused',
}

// ---------------------------------------------------------------------------
// Misc UI strings
// ---------------------------------------------------------------------------

export const MISC = {
  close: 'Close',
  play: 'Play',
  pause: 'Pause',
  randomize: 'Randomize',
  undo: 'Undo last change',
  share: 'Share',
  save: 'Save to gallery',
  viewOnly: 'Hide all controls (view only)',
  menu: 'Menu',
  collapse: 'Collapse controls',
  expand: 'Expand controls',
}

// ---------------------------------------------------------------------------
// Stagebar menu strings (no mock — modal follows mocks/add-layer.html's idiom)
// ---------------------------------------------------------------------------

export const MENU = {
  title: 'Menu',
  gallery: 'Gallery',
  pasteSeed: 'Paste seed',
  editSchemes: 'Edit schemes',
  showWelcome: 'Show welcome screen',
  close: 'Close',
}

// ---------------------------------------------------------------------------
// Format helper — simple {placeholder} replacement
// ---------------------------------------------------------------------------

/**
 * Replace `{key}` placeholders in a template string with values.
 * Not a full formatter — deliberately minimal, no escaping needed because
 * the result goes through `text()` (textContent) before reaching the DOM.
 *
 * @param {string} template
 * @param {Record<string, string|number>} values
 * @returns {string}
 */
export function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = values[key]
    return v === undefined ? match : String(v)
  })
}