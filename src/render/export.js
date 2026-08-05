// @ts-check
/**
 * One-loop video export via WebCodecs `VideoEncoder` + a progressive ISO BMFF
 * muxer (FR-19, architecture §6.1).
 *
 * Renders frames by calling `painter.paint()` directly at each frame index,
 * encodes them with `VideoEncoder` (H.264), muxes into a progressive MP4
 * (ftyp → moov → mdat), and hands the resulting `Blob` to the caller. This is
 * **faster than realtime** — no rAF waiting, no tab-visible requirement, no
 * dropped frames.
 *
 * The caller triggers the download via `downloadBlob()` from a user gesture
 * (click handler). Doing it at the end of an async encode does not work:
 * browsers drop programmatic `<a download>` clicks once transient user
 * activation has expired (the original export bug).
 *
 * The output is a progressive (non-fragmented) MP4 with full per-sample tables
 * (stts/stsc/stsz/stco/stss) — the layout QuickTime Player requires for a
 * local file. Fragmented MP4 (fMP4) is rejected by Apple's local-file parser.
 *
 * Codec selection: H.264 High 5.1 (`avc1.640033`) first — safely above 1080×1920
 * level boundaries. Falls back through Main 5.1, High 5.2, 4.0 variants, then
 * VP9 → WebM.
 *
 * Imports `./canvas.js`, `./painter.js`, `./prepare.js`,
 * `../core/state.js` (render → render sibling and render → core are
 * legal §4 edges). The CSP is untouched: blob `<a download>` is not
 * governed by `connect-src`.
 */

import { getCanvas, WIDTH, HEIGHT } from './canvas.js'
import { paint } from './painter.js'
import { flushDirty } from './prepare.js'
import { state } from '../core/state.js'

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

/**
 * @param {string} mime
 * @returns {'mp4' | 'webm'}
 */
export function extensionFor(mime) {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
}

/**
 * Build a seed-tagged filename: `loop-me-15s-a1b2c3d4.mp4`. The seed prefix
 * is the first 8 chars of the seed string (filename-safe base64url), or
 * 'loop' when the seed is null/empty/short.
 *
 * @param {number} durationSeconds
 * @param {string | null} seed
 * @param {'mp4' | 'webm'} ext
 * @returns {string}
 */
export function buildFilename(durationSeconds, seed, ext) {
  const prefix = seed && seed.length >= 8 ? seed.slice(0, 8) : 'loop'
  return 'loop-me-' + durationSeconds + 's-' + prefix + '.' + ext
}

/**
 * @typedef {{ codec: string, ext: 'mp4' | 'webm' }} CodecChoice
 */

/**
 * Pick the best available codec for offline WebCodecs encoding. H.264 High
 * 5.1 produces a universally-compatible MP4 that comfortably handles the
 * 1080×1920 backing store at level 4.0's boundary; lower-level candidates
 * are kept as fallbacks. VP9 is the WebM fallback.
 *
 * @param {(c: string) => Promise<boolean>} [isSupported]
 * @returns {Promise<CodecChoice | null>}
 */
export async function pickCodec(isSupported = async (c) => {
  if (typeof VideoEncoder === 'undefined') return false
  try {
    const r = await VideoEncoder.isConfigSupported({
      codec: c,
      width: WIDTH,
      height: HEIGHT,
      bitrate: 12_000_000,
      framerate: 30,
      avc: { format: 'avc' },
    })
    return r.supported === true
  } catch {
    return false
  }
}) {
  /** @type {CodecChoice[]} */
  const candidates = [
    { codec: 'avc1.640033', ext: 'mp4' }, // High 5.1 — 1080×1920 safe
    { codec: 'avc1.4D4033', ext: 'mp4' }, // Main 5.1
    { codec: 'avc1.640034', ext: 'mp4' }, // High 5.2
    { codec: 'avc1.4D4028', ext: 'mp4' }, // Main 4.0 — borderline for 1080×1920
    { codec: 'avc1.640028', ext: 'mp4' }, // High 4.0 — borderline
    { codec: 'vp09.00.10.08', ext: 'webm' },
  ]
  for (const c of candidates) {
    if (await isSupported(c.codec)) return c
  }
  return null
}

/**
 * Is video export supported in this browser?
 *
 * @returns {boolean}
 */
export function isExportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

// ---------------------------------------------------------------------------
// ISO BMFF muxer — progressive (non-fragmented) MP4
//
// QuickTime Player rejects fragmented MP4 (fMP4) as a local file: fMP4 is a
// streaming/HLS container, and Apple's local-file parser requires a
// progressive layout — `ftyp → moov (with full sample tables) → mdat`. The
// moov carries the real per-sample boxes (stts/stsc/stsz/stco/stss), and
// mdat is one big chunk with all encoded bytes back-to-back. This is the
// format FFmpeg's `+faststart` produces and what every NLE exports.
// ---------------------------------------------------------------------------

/** @param {number[]} out @param {number[]} type @param {number[]} payload */
function box(out, type, payload) {
  const size = 8 + payload.length
  u32(out, size)
  pushN(out, type)
  if (payload.length > 0) pushN(out, payload)
}

/** @param {number[]} out @param {number[]} type @param {number} version @param {number} flags @param {number[]} payload */
function fullbox(out, type, version, flags, payload) {
  const size = 12 + payload.length
  u32(out, size)
  pushN(out, type)
  out.push(version & 0xFF, (flags >>> 16) & 0xFF, (flags >>> 8) & 0xFF, flags & 0xFF)
  if (payload.length > 0) pushN(out, payload)
}

/**
 * Push an array of bytes into `out` without spreading — `out.push(...big)`
 * blows the call stack when payload is the entire video stream (millions of
 * bytes). Falls back to a loop for any non-trivial size.
 * @param {number[]} out
 * @param {number[] | Uint8Array} bytes
 */
function pushN(out, bytes) {
  const n = bytes.length
  if (n === 0) return
  if (n < 65536) {
    // Small arrays: spread is fastest and safe under the argument limit.
    out.push(...bytes)
    return
  }
  for (let i = 0; i < n; i++) out.push(bytes[i])
}

/** @param {number[]} out @param {number} v */
function u32(out, v) {
  out.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF)
}

/** @param {number[]} out @param {number} v */
function u16(out, v) {
  out.push((v >>> 8) & 0xFF, v & 0xFF)
}

/** @returns {number[]} ftyp box bytes */
function buildFtyp() {
  /** @type {number[]} */
  const out = []
  box(out, [0x66, 0x74, 0x79, 0x70], [
    ...[0x69, 0x73, 0x6F, 0x6D], // 'isom' — major brand
    ...[0x00, 0x00, 0x02, 0x00], // minor version 512
    ...[0x69, 0x73, 0x6F, 0x6D], // 'isom' — compatible
    ...[0x61, 0x76, 0x63, 0x31], // 'avc1' — compatible
    ...[0x6D, 0x70, 0x34, 0x31], // 'mp41' — compatible
  ])
  return out
}

const UNITY_MATRIX = [
  0x00010000, 0x00000000, 0x00000000,
  0x00000000, 0x00010000, 0x00000000,
  0x00000000, 0x00000000, 0x40000000,
]

/**
 * @typedef {{ size: number, isKeyframe: boolean }} Sample
 */

/**
 * Build the moov box for a progressive (non-fragmented) MP4. All sample
 * tables live here — there is no moof/trun. This is what QuickTime expects
 * for a local file.
 *
 * @param {number} timescale
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} avccData  AVCDecoderConfigurationRecord from the encoder
 * @param {number} duration      Total duration in timescale units
 * @param {number} frameDur      Per-frame duration in timescale units
 * @param {Sample[]} samples     One entry per encoded frame
 * @param {number} mdatOffset    Byte offset of the mdat payload from file start
 * @returns {number[]}
 */
function buildMoov(timescale, width, height, avccData, duration, frameDur, samples, mdatOffset) {
  // mvhd
  /** @type {number[]} */
  const mvhdPayload = []
  u32(mvhdPayload, 0) // creation_time
  u32(mvhdPayload, 0) // modification_time
  u32(mvhdPayload, timescale)
  u32(mvhdPayload, duration) // duration in timescale units (non-zero for QT)
  u32(mvhdPayload, 0x00010000) // rate = 1.0
  u16(mvhdPayload, 0x0100) // volume = 1.0
  u16(mvhdPayload, 0) // reserved
  for (let i = 0; i < 8; i++) mvhdPayload.push(0) // reserved
  for (const m of UNITY_MATRIX) u32(mvhdPayload, m)
  for (let i = 0; i < 24; i++) mvhdPayload.push(0) // pre_defined
  u32(mvhdPayload, 2) // next_track_ID
  /** @type {number[]} */
  const mvhd = []
  fullbox(mvhd, [0x6D, 0x76, 0x68, 0x64], 0, 0, mvhdPayload)

  // tkhd
  /** @type {number[]} */
  const tkhdPayload = []
  u32(tkhdPayload, 0) // creation_time
  u32(tkhdPayload, 0) // modification_time
  u32(tkhdPayload, 1) // track_ID
  u32(tkhdPayload, 0) // reserved
  u32(tkhdPayload, duration) // duration in movie timescale
  for (let i = 0; i < 8; i++) tkhdPayload.push(0) // reserved
  u16(tkhdPayload, 0) // layer
  u16(tkhdPayload, 0) // alternate_group
  u16(tkhdPayload, 0) // volume (0 for video)
  u16(tkhdPayload, 0) // reserved
  for (const m of UNITY_MATRIX) u32(tkhdPayload, m)
  u32(tkhdPayload, width << 16)  // width  16.16 fixed-point
  u32(tkhdPayload, height << 16) // height 16.16 fixed-point
  /** @type {number[]} */
  const tkhd = []
  fullbox(tkhd, [0x74, 0x6B, 0x68, 0x64], 0, 3, tkhdPayload)

  // mdhd
  /** @type {number[]} */
  const mdhdPayload = []
  u32(mdhdPayload, 0) // creation_time
  u32(mdhdPayload, 0) // modification_time
  u32(mdhdPayload, timescale)
  u32(mdhdPayload, duration) // duration in media timescale
  u16(mdhdPayload, 0x55C4) // language = 'und'
  u16(mdhdPayload, 0) // pre_defined
  /** @type {number[]} */
  const mdhd = []
  fullbox(mdhd, [0x6D, 0x64, 0x68, 0x64], 0, 0, mdhdPayload)

  // hdlr
  const hdlrPayload = [
    0x00, 0x00, 0x00, 0x00, // pre_defined
    0x76, 0x69, 0x64, 0x65, // handler_type = 'vide'
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x00, 0x00, 0x00, 0x00, // reserved
    0x56, 0x69, 0x64, 0x65, 0x6F, 0x48, 0x61, 0x6E, 0x64, 0x6C, 0x65, 0x72, 0x00, // 'VideoHandler\0'
  ]
  /** @type {number[]} */
  const hdlr = []
  fullbox(hdlr, [0x68, 0x64, 0x6C, 0x72], 0, 0, hdlrPayload)

  // vmhd — video media header: graphicsmode + opcolor (3 × u16)
  /** @type {number[]} */
  const vmhdPayload = [0, 0, 0, 0, 0, 0, 0, 0] // graphicsmode=0, opcolor=0,0,0
  /** @type {number[]} */
  const vmhd = []
  fullbox(vmhd, [0x76, 0x6D, 0x68, 0x64], 0, 1, vmhdPayload)

  // dinf → dref
  /** @type {number[]} */
  const drefEntry = []
  fullbox(drefEntry, [0x75, 0x72, 0x6C, 0x20], 0, 1, []) // 'url ', flags=1 (self-contained)
  /** @type {number[]} */
  const drefPayload = []
  u32(drefPayload, 1) // entry_count
  drefPayload.push(...drefEntry)
  /** @type {number[]} */
  const dref = []
  fullbox(dref, [0x64, 0x72, 0x65, 0x66], 0, 0, drefPayload)
  /** @type {number[]} */
  const dinf = []
  box(dinf, [0x64, 0x69, 0x6E, 0x66], dref)

  // stsd with avc1 + avcC
  /** @type {number[]} */
  const avc1Payload = []
  for (let i = 0; i < 6; i++) avc1Payload.push(0) // reserved
  u16(avc1Payload, 1) // data_ref_index
  for (let i = 0; i < 16; i++) avc1Payload.push(0) // pre_defined + reserved
  u16(avc1Payload, width)
  u16(avc1Payload, height)
  u32(avc1Payload, 0x00480000) // horizresolution = 72 dpi
  u32(avc1Payload, 0x00480000) // vertresolution = 72 dpi
  u32(avc1Payload, 0) // reserved
  u16(avc1Payload, 1) // frame_count
  avc1Payload.push(0) // compressorname length = 0
  for (let i = 0; i < 31; i++) avc1Payload.push(0) // compressorname padding
  u16(avc1Payload, 0x0018) // depth = 24
  u16(avc1Payload, 0xFFFF) // pre_defined = -1
  /** @type {number[]} */
  const avcC = []
  box(avcC, [0x61, 0x76, 0x63, 0x43], Array.from(avccData)) // 'avcC'
  avc1Payload.push(...avcC)
  /** @type {number[]} */
  const avc1 = []
  box(avc1, [0x61, 0x76, 0x63, 0x31], avc1Payload)

  /** @type {number[]} */
  const stsdPayload = []
  u32(stsdPayload, 1) // entry_count
  stsdPayload.push(...avc1)
  /** @type {number[]} */
  const stsd = []
  fullbox(stsd, [0x73, 0x74, 0x73, 0x64], 0, 0, stsdPayload)

  // stts — time-to-sample: one run of N frames at frameDur each.
  /** @type {number[]} */
  const sttsPayload = []
  u32(sttsPayload, 1) // entry_count
  u32(sttsPayload, samples.length) // sample_count
  u32(sttsPayload, frameDur) // sample_delta
  /** @type {number[]} */
  const stts = []
  fullbox(stts, [0x73, 0x74, 0x74, 0x73], 0, 0, sttsPayload)

  // stsc — sample-to-chunk: all samples in one chunk.
  /** @type {number[]} */
  const stscPayload = []
  u32(stscPayload, 1) // entry_count
  u32(stscPayload, 1) // first_chunk
  u32(stscPayload, samples.length) // samples_per_chunk
  u32(stscPayload, 1) // sample_description_index
  /** @type {number[]} */
  const stsc = []
  fullbox(stsc, [0x73, 0x74, 0x73, 0x63], 0, 0, stscPayload)

  // stsz — sample sizes, one entry per frame.
  /** @type {number[]} */
  const stszPayload = []
  u32(stszPayload, 0) // sample_size (0 → per-sample below)
  u32(stszPayload, samples.length) // sample_count
  for (const s of samples) u32(stszPayload, s.size)
  /** @type {number[]} */
  const stsz = []
  fullbox(stsz, [0x73, 0x74, 0x73, 0x7A], 0, 0, stszPayload)

  // stco — chunk offset: one chunk, located at mdatOffset.
  /** @type {number[]} */
  const stcoPayload = []
  u32(stcoPayload, 1) // entry_count
  u32(stcoPayload, mdatOffset) // chunk_offset
  /** @type {number[]} */
  const stco = []
  fullbox(stco, [0x73, 0x74, 0x63, 0x6F], 0, 0, stcoPayload)

  // stss — sync sample table (keyframe indices). 1-based.
  /** @type {number[]} */
  const keyframeIdx = []
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].isKeyframe) keyframeIdx.push(i + 1)
  }
  /** @type {number[]} */
  const stss = []
  if (keyframeIdx.length > 0) {
    /** @type {number[]} */
    const stssPayload = []
    u32(stssPayload, keyframeIdx.length)
    for (const idx of keyframeIdx) u32(stssPayload, idx)
    fullbox(stss, [0x73, 0x74, 0x73, 0x73], 0, 0, stssPayload)
  }

  /** @type {number[][]} */
  const stblChildren = keyframeIdx.length > 0
    ? [stsd, stts, stss, stsc, stsz, stco]
    : [stsd, stts, stsc, stsz, stco]
  /** @type {number[]} */
  const stbl = []
  box(stbl, [0x73, 0x74, 0x62, 0x6C], stblChildren.reduce((acc, b) => { pushN(acc, b); return acc }, []))
  /** @type {number[]} */
  const minf = []
  box(minf, [0x6D, 0x69, 0x6E, 0x66], [vmhd, dinf, stbl].reduce((acc, b) => { pushN(acc, b); return acc }, []))
  /** @type {number[]} */
  const mdia = []
  box(mdia, [0x6D, 0x64, 0x69, 0x61], [mdhd, hdlr, minf].reduce((acc, b) => { pushN(acc, b); return acc }, []))
  /** @type {number[]} */
  const trak = []
  box(trak, [0x74, 0x72, 0x61, 0x6B], [tkhd, mdia].reduce((acc, b) => { pushN(acc, b); return acc }, []))

  /** @type {number[]} */
  const moov = []
  box(moov, [0x6D, 0x6F, 0x6F, 0x76], [mvhd, trak].reduce((acc, b) => { pushN(acc, b); return acc }, []))
  return moov
}

/**
 * Build the mdat box wrapping all encoded chunks. The payload offset within
 * the file is `mdatOffset`; stco in moov points to the first byte of payload
 * (i.e. `mdatOffset + 8` for the box header).
 * @param {Uint8Array[]} chunks
 * @returns {Uint8Array}
 */
function buildMdat(chunks) {
  let total = 0
  for (const c of chunks) total += c.length
  const payload = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    payload.set(c, off)
    off += c.length
  }
  return payload
}

// ---------------------------------------------------------------------------
// WebM muxer (VP9 fallback, minimal EBML)
// ---------------------------------------------------------------------------

/** @param {number[]} out @param {number} v EBML VINT-uint */
function ebmlId(out, v) {
  if (v < 0x80) { out.push(0x81, v) }
  else if (v < 0x4000) { out.push(0x82, (v >> 8) & 0xFF, v & 0xFF) }
  else if (v < 0x200000) { out.push(0x83, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF) }
  else { out.push(0x84, (v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF) }
}

/** @param {number[]} out @param {number} id @param {number[]} payload */
function ebmlEl(out, id, payload) {
  ebmlId(out, id)
  ebmlId(out, payload.length)
  pushN(out, payload)
}

/** @param {number[]} out @param {number} id @param {number} val */
function ebmlUint(out, id, val) {
  ebmlId(out, id)
  if (val < 0x80) { ebmlId(out, 1); out.push(val & 0xFF) }
  else if (val < 0x10000) { ebmlId(out, 2); out.push((val >> 8) & 0xFF, val & 0xFF) }
  else { ebmlId(out, 4); u32(out, val) }
}

/**
 * @param {Uint8Array[]} chunks
 * @param {boolean[]} keyframeFlags
 * @param {number} frameRate
 * @returns {Blob}
 */
function buildWebm(chunks, keyframeFlags, frameRate) {
  const tcScale = Math.round(1_000_000_000 / frameRate) // ns per tick
  /** @type {number[]} */
  const out = []

  // EBML header
  /** @type {number[]} */
  const eh = []
  ebmlUint(eh, 0x4286, 1) // EBMLVersion
  ebmlUint(eh, 0x42F7, 1) // EBMLReadVersion
  ebmlUint(eh, 0x42F2, 4) // EBMLMaxIDLength
  ebmlUint(eh, 0x42F3, 8) // EBMLMaxSizeLength
  ebmlEl(eh, 0x4282, [0x77, 0x65, 0x62, 0x6D]) // DocType = "webm"
  ebmlUint(eh, 0x4287, 4) // DocTypeVersion
  ebmlUint(eh, 0x4285, 2) // DocTypeReadVersion
  ebmlEl(out, 0x1A45DFA3, eh)

  // Segment (unknown size)
  ebmlId(out, 0x18538067)
  out.push(0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)

  // Segment Info
  /** @type {number[]} */
  const info = []
  ebmlUint(info, 0x2AD7B1, tcScale) // TimecodeScale
  ebmlEl(info, 0x4D80, [0x6C, 0x6F, 0x6F, 0x70, 0x2D, 0x6D, 0x65]) // MuxingApp
  ebmlEl(info, 0x5741, [0x6C, 0x6F, 0x6F, 0x70, 0x2D, 0x6D, 0x65]) // WritingApp
  ebmlEl(out, 0x1549A966, info)

  // Tracks
  /** @type {number[]} */
  const te = []
  ebmlUint(te, 0xD7, 1)   // TrackNumber
  ebmlUint(te, 0x73C5, 1) // TrackUID
  ebmlUint(te, 0x83, 1)   // TrackType = video
  ebmlUint(te, 0x9C, 0)   // FlagLacing = 0
  /** @type {number[]} */
  const vid = []
  ebmlUint(vid, 0xB0, WIDTH)  // PixelWidth
  ebmlUint(vid, 0xBA, HEIGHT) // PixelHeight
  ebmlEl(te, 0xE0, vid)       // Video
  ebmlEl(te, 0x86, [0x56, 0x5F, 0x56, 0x50, 0x39]) // CodecID = "V_VP9"
  /** @type {number[]} */
  const tracksPayload = []
  ebmlEl(tracksPayload, 0xAE, te) // TrackEntry
  ebmlEl(out, 0x1654AE6B, tracksPayload) // Tracks

  // Single cluster with all frames
  /** @type {number[]} */
  const clusterPayload = []
  ebmlUint(clusterPayload, 0xE7, 0) // Cluster Timecode = 0
  for (let i = 0; i < chunks.length; i++) {
    // SimpleBlock: track=1, timecode=int16, flags, data
    /** @type {number[]} */
    const block = []
    ebmlId(block, 0x81) // track number VINT = 1
    u16(block, i & 0x7FFF) // relative timecode
    block.push(keyframeFlags[i] ? 0x80 : 0x00) // flags: keyframe
    for (let j = 0; j < chunks[i].length; j++) block.push(chunks[i][j])
    ebmlEl(clusterPayload, 0xA3, block) // SimpleBlock
  }
  ebmlEl(out, 0x1F43B675, clusterPayload)

  return new Blob([new Uint8Array(out)], { type: 'video/webm' })
}

// ---------------------------------------------------------------------------
// Frame rendering — paint a specific frame independent of the rAF loop
// ---------------------------------------------------------------------------

/**
 * @param {number} frame  Integer frame index (0 to totalFrames-1).
 * @param {number} totalFrames
 */
function paintFrame(frame, totalFrames) {
  flushDirty()
  paint(frame, totalFrames)
}

// ---------------------------------------------------------------------------
// Recording state
// ---------------------------------------------------------------------------

let running = false

// ---------------------------------------------------------------------------
// startExport — render + encode + mux (download is the caller's job; see
// downloadBlob). Triggering `<a download>` from async code does not work:
// Chrome drops programmatic downloads once transient user activation
// has expired, which always happens during the multi-second encode.
// ---------------------------------------------------------------------------

/**
 * Render and export exactly one loop as a video blob.
 *
 * The download is **not** triggered here: long-running async encoding
 * exhausts the browser's transient user-activation, so a programmatic
 * `<a download>` click at the end is silently dropped by Chrome. Instead,
 * the blob + filename are returned via `onDone` and the caller must trigger
 * the download from a fresh user gesture (e.g. a "Save video" button click).
 *
 * @param {{
 *   durationSeconds: number,
 *   seed?: string | null,
 *   onProgress?: (pct: number) => void,
 *   onDone?: (blob: Blob, filename: string) => void,
 *   onError?: (message: string) => void,
 * }} opts
 * @returns {{ cancel: () => void } | null} null if unsupported or already running.
 */
export function startExport(opts) {
  const onProgress = opts.onProgress ?? (() => {})
  const onDone = opts.onDone ?? (() => {})
  const onError = opts.onError ?? (() => {})

  if (running) {
    onError('an export is already in progress')
    return null
  }
  const cv = getCanvas()
  if (cv === null) {
    onError('canvas not mounted')
    return null
  }

  const totalFrames = opts.durationSeconds * 60
  const outputFrames = Math.floor(totalFrames / 2) // 30fps from 60fps internal
  if (outputFrames <= 0) {
    onError('duration too short')
    return null
  }

  running = true
  let cancelled = false

  const wasPlaying = state.playing
  if (wasPlaying) state.playing = false

  runWebCodecsExport(cv, opts, outputFrames, totalFrames, onProgress)
    .then(({ blob, filename }) => {
      if (cancelled) return
      running = false
      if (wasPlaying) state.playing = true
      onDone(blob, filename)
    })
    .catch((err) => {
      if (cancelled) {
        running = false
        if (wasPlaying) state.playing = true
        return
      }
      if (wasPlaying) state.playing = true
      running = false
      onError(err instanceof Error ? err.message : String(err))
    })

  function cancel() {
    if (!running) return
    cancelled = true
    if (wasPlaying) state.playing = true
    running = false
  }

  return { cancel }
}

/**
 * Trigger a blob download synchronously from a user gesture. Must be called
 * inside a click/keypress handler — browsers drop programmatic `<a download>`
 * clicks when transient user activation has expired (the export bug).
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * @param {HTMLCanvasElement} cv
 * @param {{ durationSeconds: number, seed?: string | null }} opts
 * @param {number} outputFrames
 * @param {number} totalFrames
 * @param {(pct: number) => void} onProgress
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
async function runWebCodecsExport(cv, opts, outputFrames, totalFrames, onProgress) {
  const codec = await pickCodec()
  if (codec === null) {
    throw new Error('no supported video codec for WebCodecs encoding')
  }

  const filename = buildFilename(opts.durationSeconds, opts.seed ?? null, codec.ext)

  /** @type {Uint8Array[]} */
  const chunks = []
  /** @type {boolean[]} */
  const keyframeFlags = []
  /** @type {Uint8Array | null} */
  let avccData = null
  /** @type {any} */
  let encoderError = null

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push(data)
      // Keyframe status is on the chunk itself, NOT on the metadata.
      // EncodedVideoChunkMetadata has no `type` field.
      keyframeFlags.push(chunk.type === 'key')
      const m = /** @type {{ decoderConfig?: { description?: ArrayBuffer } }} */ (meta)
      if (avccData === null && m.decoderConfig && m.decoderConfig.description) {
        avccData = new Uint8Array(m.decoderConfig.description)
      }
    },
    error: (e) => {
      // Capture, don't throw — WebCodecs runs this on a separate task, so a
      // throw here would be an uncaught exception that leaves the await
      // chain (and thus onDone/onError) hanging forever.
      encoderError = e
    },
  })

  try {
    encoder.configure({
      codec: codec.codec,
      width: WIDTH,
      height: HEIGHT,
      bitrate: 12_000_000,
      framerate: 30,
      avc: { format: 'avc' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error('configure failed: ' + msg)
  }

  try {
    for (let i = 0; i < outputFrames; i++) {
      if (!running) {
        try { encoder.close() } catch {}
        throw new Error('export cancelled')
      }
      if (encoderError) {
        throw new Error('encoder error: ' + encoderError.message)
      }

      // Back-pressure: if the encoder's internal queue is deep, wait for it
      // to drain before queueing more. Without this, long videos fill the
      // queue and `flush()` can stall.
      while (encoder.encodeQueueSize > 8) {
        if (encoderError) {
          throw new Error('encoder error: ' + encoderError.message)
        }
        await new Promise((r) => setTimeout(r, 4))
      }

      paintFrame(i * 2, totalFrames) // sample every other 60fps frame

      const frame = new VideoFrame(cv, {
        timestamp: Math.round((i / 30) * 1_000_000), // microseconds
        duration: Math.round(1_000_000 / 30),
      })
      encoder.encode(frame, { keyFrame: i === 0 })
      frame.close()

      onProgress(Math.min(99, Math.round(((i + 1) / outputFrames) * 100)))
      await new Promise((r) => setTimeout(r, 0)) // yield to encoder
    }

    if (encoderError) {
      throw new Error('encoder error: ' + encoderError.message)
    }

    await encoder.flush()
    encoder.close()
    onProgress(100)

    if (encoderError) {
      throw new Error('encoder error: ' + encoderError.message)
    }
  } finally {
    try { if (encoder.state !== 'closed') encoder.close() } catch {}
  }

  /** @type {Blob} */
  let blob
  if (codec.ext === 'mp4') {
    blob = buildMp4(chunks, keyframeFlags, avccData)
  } else {
    blob = buildWebm(chunks, keyframeFlags, 30)
  }

  return { blob, filename }
}

/**
 * Build a complete progressive (non-fragmented) MP4 file.
 *
 * Layout: `ftyp → moov (full sample tables) → mdat`.
 * This is the format QuickTime Player requires for a local file — fMP4
 * (ftyp → moov → moof → mdat) is rejected by Apple's local-file parser.
 *
 * The stco box in moov must point to the first byte of sample data inside
 * mdat. Since mdat comes after moov, we build moov twice: once with a
 * placeholder offset to measure its size, then again with the real offset.
 * The offset is always a 4-byte u32, so moov's size is stable between passes.
 *
 * @param {Uint8Array[]} chunks
 * @param {boolean[]} keyframeFlags
 * @param {Uint8Array | null} avccData
 * @returns {Blob}
 */
function buildMp4(chunks, keyframeFlags, avccData) {
  if (avccData === null) throw new Error('no decoder config from encoder')

  const timescale = 30000
  const frameDur = Math.round(timescale / 30)
  const totalDuration = chunks.length * frameDur

  /** @type {Sample[]} */
  const samples = chunks.map((c, i) => ({
    size: c.length,
    isKeyframe: keyframeFlags[i],
  }))

  const ftyp = buildFtyp()

  // Pass 1: placeholder offset to measure moov size.
  const moovTemp = buildMoov(timescale, WIDTH, HEIGHT, avccData, totalDuration, frameDur, samples, 0)
  // mdat payload starts after ftyp + moov + 8-byte mdat box header.
  const mdatPayloadOffset = ftyp.length + moovTemp.length + 8

  // Pass 2: rebuild moov with the correct stco offset.
  const moov = buildMoov(timescale, WIDTH, HEIGHT, avccData, totalDuration, frameDur, samples, mdatPayloadOffset)
  const mdatPayload = buildMdat(chunks)

  const mdatBoxSize = 8 + mdatPayload.length
  const totalLen = ftyp.length + moov.length + mdatBoxSize
  const file = new Uint8Array(totalLen)
  let off = 0
  file.set(ftyp, off);       off += ftyp.length
  file.set(moov, off);       off += moov.length
  // mdat box header — write directly into the Uint8Array
  file[off] = (mdatBoxSize >>> 24) & 0xFF; off++
  file[off] = (mdatBoxSize >>> 16) & 0xFF; off++
  file[off] = (mdatBoxSize >>> 8) & 0xFF; off++
  file[off] = mdatBoxSize & 0xFF; off++
  file[off] = 0x6D; off++
  file[off] = 0x64; off++
  file[off] = 0x61; off++
  file[off] = 0x74; off++
  file.set(mdatPayload, off)
  return new Blob([file], { type: 'video/mp4' })
}