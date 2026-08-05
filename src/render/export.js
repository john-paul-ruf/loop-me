// @ts-check
/**
 * One-loop video export via WebCodecs `VideoEncoder` + a minimal ISO BMFF
 * (fMP4) muxer (FR-19, architecture §6.1).
 *
 * Renders frames by calling `painter.paint()` directly at each frame index,
 * encodes them with `VideoEncoder` (H.264), muxes into a proper fragmented
 * MP4, and downloads the blob. This is **faster than realtime** — no rAF
 * waiting, no tab-visible requirement, no dropped frames.
 *
 * The output MP4 is a well-formed fragmented ISO BMFF file that QuickTime,
 * VLC, and every modern player can open. This replaces the earlier
 * `captureStream` + `MediaRecorder` approach whose Chrome MP4 output was
 * incompatible with QuickTime.
 *
 * Codec selection: H.264 Main 4.0 (`avc1.4D4028`) first — produces
 * universally-compatible MP4. Falls back to VP9 → WebM.
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
 * Pick the best available codec for offline WebCodecs encoding. H.264 Main
 * 4.0 produces a universally-compatible MP4; VP9 is the WebM fallback.
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
    })
    return r.supported === true
  } catch {
    return false
  }
}) {
  /** @type {CodecChoice[]} */
  const candidates = [
    { codec: 'avc1.4D4028', ext: 'mp4' },
    { codec: 'avc1.640028', ext: 'mp4' },
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
// ISO BMFF (fMP4) muxer — minimal but correct
// ---------------------------------------------------------------------------

/** @param {number[]} out @param {number[]} type @param {number[]} payload */
function box(out, type, payload) {
  const size = 8 + payload.length
  u32(out, size)
  out.push(...type, ...payload)
}

/** @param {number[]} out @param {number[]} type @param {number} version @param {number} flags @param {number[]} payload */
function fullbox(out, type, version, flags, payload) {
  const size = 12 + payload.length
  u32(out, size)
  out.push(...type)
  out.push(version & 0xFF, (flags >>> 16) & 0xFF, (flags >>> 8) & 0xFF, flags & 0xFF)
  out.push(...payload)
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
    ...[0x69, 0x73, 0x6F, 0x6D], // 'isom'
    ...[0x00, 0x00, 0x02, 0x00], // minor version 512
    ...[0x69, 0x73, 0x6F, 0x6D], // 'isom'
    ...[0x69, 0x73, 0x6F, 0x32], // 'iso2'
    ...[0x61, 0x76, 0x63, 0x31], // 'avc1'
    ...[0x6D, 0x70, 0x34, 0x31], // 'mp41'
  ])
  return out
}

const UNITY_MATRIX = [
  0x00010000, 0x00000000, 0x00000000,
  0x00000000, 0x00010000, 0x00000000,
  0x00000000, 0x00000000, 0x40000000,
]

/**
 * Build the moov box for fragmented MP4.
 * @param {number} timescale
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} avccData  AVCDecoderConfigurationRecord from the encoder
 * @returns {number[]}
 */
function buildMoov(timescale, width, height, avccData) {
  // mvhd
  /** @type {number[]} */
  const mvhdPayload = []
  u32(mvhdPayload, 0) // creation_time
  u32(mvhdPayload, 0) // modification_time
  u32(mvhdPayload, timescale)
  u32(mvhdPayload, 0) // duration (0 for fmp4 — actual duration in moof)
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
  u32(tkhdPayload, 0) // duration
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
  u32(mdhdPayload, 0) // duration
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

  // vmhd
  /** @type {number[]} */
  const vmhd = []
  fullbox(vmhd, [0x76, 0x6D, 0x68, 0x64], 0, 1, [0, 0, 0, 0])

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

  /** @type {number[]} */
  const stts = []
  fullbox(stts, [0x73, 0x74, 0x74, 0x73], 0, 0, [0, 0, 0, 0])
  /** @type {number[]} */
  const stsc = []
  fullbox(stsc, [0x73, 0x74, 0x73, 0x63], 0, 0, [0, 0, 0, 0])
  /** @type {number[]} */
  const stsz = []
  fullbox(stsz, [0x73, 0x74, 0x73, 0x7A], 0, 0, [0, 0, 0, 0, 0, 0, 0, 0])
  /** @type {number[]} */
  const stco = []
  fullbox(stco, [0x73, 0x74, 0x63, 0x6F], 0, 0, [0, 0, 0, 0])

  /** @type {number[]} */
  const stbl = []
  box(stbl, [0x73, 0x74, 0x62, 0x6C], [...stsd, ...stts, ...stsc, ...stsz, ...stco])
  /** @type {number[]} */
  const minf = []
  box(minf, [0x6D, 0x69, 0x6E, 0x66], [...vmhd, ...dinf, ...stbl])
  /** @type {number[]} */
  const mdia = []
  box(mdia, [0x6D, 0x64, 0x69, 0x61], [...mdhd, ...hdlr, ...minf])
  /** @type {number[]} */
  const trak = []
  box(trak, [0x74, 0x72, 0x61, 0x6B], [...tkhd, ...mdia])

  // mvex → trex
  /** @type {number[]} */
  const trexPayload = []
  u32(trexPayload, 1) // track_ID
  u32(trexPayload, 1) // default_sample_description_index
  u32(trexPayload, 0) // default_sample_duration
  u32(trexPayload, 0) // default_sample_size
  u32(trexPayload, 0) // default_sample_flags
  /** @type {number[]} */
  const trex = []
  fullbox(trex, [0x74, 0x72, 0x65, 0x78], 0, 0, trexPayload)
  /** @type {number[]} */
  const mvex = []
  box(mvex, [0x6D, 0x76, 0x65, 0x78], trex)

  /** @type {number[]} */
  const moov = []
  box(moov, [0x6D, 0x6F, 0x6F, 0x76], [...mvhd, ...trak, ...mvex])
  return moov
}

/**
 * Build the moof box for one fragment.
 *
 * @param {number} seqNum
 * @param {number} dataOffset  Byte offset from the start of the moof box to the first sample data in mdat.
 * @param {{ size: number, duration: number, isKeyframe: boolean }[]} samples
 * @returns {number[]}
 */
function buildMoof(seqNum, dataOffset, samples) {
  // mfhd
  /** @type {number[]} */
  const mfhdPayload = []
  u32(mfhdPayload, seqNum)
  /** @type {number[]} */
  const mfhd = []
  fullbox(mfhd, [0x6D, 0x66, 0x68, 0x64], 0, 0, mfhdPayload)

  // tfhd — default-base-is-moof flag
  /** @type {number[]} */
  const tfhdPayload = []
  u32(tfhdPayload, 1) // track_ID
  /** @type {number[]} */
  const tfhd = []
  fullbox(tfhd, [0x74, 0x66, 0x68, 0x64], 0, 0x020000, tfhdPayload)

  // tfdt (version 1) — baseMediaDecodeTime = 0 for first fragment
  /** @type {number[]} */
  const tfdtPayload = []
  u32(tfdtPayload, 0) // high
  u32(tfdtPayload, 0) // low
  /** @type {number[]} */
  const tfdt = []
  fullbox(tfdt, [0x74, 0x66, 0x64, 0x74], 1, 0, tfdtPayload)

  // trun — data-offset + sample-duration + sample-size + sample-flags
  // flags: 0x000001 (data-offset-present)
  //      | 0x000100 (sample-duration-present)
  //      | 0x000200 (sample-size-present)
  //      | 0x000400 (sample-flags-present)
  /** @type {number[]} */
  const trunPayload = []
  u32(trunPayload, samples.length) // sample_count
  u32(trunPayload, dataOffset) // data_offset
  for (const s of samples) {
    u32(trunPayload, s.duration)
  }
  for (const s of samples) {
    u32(trunPayload, s.size)
  }
  for (const s of samples) {
    // sample_flags: sample_depends_on is bits 24-23
    // 2 = does not depend on others (I-frame), 1 = depends on others (P-frame)
    u32(trunPayload, s.isKeyframe ? 0x02000000 : 0x01000000)
  }
  /** @type {number[]} */
  const trun = []
  fullbox(trun, [0x74, 0x72, 0x75, 0x6E], 0, 0x000701, trunPayload)

  /** @type {number[]} */
  const traf = []
  box(traf, [0x74, 0x72, 0x61, 0x66], [...tfhd, ...tfdt, ...trun])

  /** @type {number[]} */
  const moof = []
  box(moof, [0x6D, 0x6F, 0x6F, 0x66], [...mfhd, ...traf])
  return moof
}

/**
 * Build the mdat box wrapping all encoded chunks.
 * @param {Uint8Array[]} chunks
 * @returns {number[]}
 */
function buildMdat(chunks) {
  let total = 0
  for (const c of chunks) total += c.length
  const payload = new Array(total)
  let off = 0
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) payload[off++] = c[i]
  }
  /** @type {number[]} */
  const mdat = []
  box(mdat, [0x6D, 0x64, 0x61, 0x74], payload)
  return mdat
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
  out.push(...payload)
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
// startExport — render + encode + mux + download
// ---------------------------------------------------------------------------

/**
 * Render and export exactly one loop as a video file.
 *
 * @param {{
 *   durationSeconds: number,
 *   seed?: string | null,
 *   onProgress?: (pct: number) => void,
 *   onDone?: (filename: string) => void,
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
    .then((filename) => {
      if (cancelled) return
      running = false
      if (wasPlaying) state.playing = true
      onDone(filename)
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
 * @param {HTMLCanvasElement} cv
 * @param {{ durationSeconds: number, seed?: string | null }} opts
 * @param {number} outputFrames
 * @param {number} totalFrames
 * @param {(pct: number) => void} onProgress
 * @returns {Promise<string>}
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

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push(data)
      const m = /** @type {{ type?: string, decoderConfig?: { description?: ArrayBuffer } }} */ (meta)
      keyframeFlags.push(m.type === 'key')
      if (avccData === null && m.decoderConfig && m.decoderConfig.description) {
        avccData = new Uint8Array(m.decoderConfig.description)
      }
    },
    error: (e) => {
      throw new Error('encoder error: ' + e.message)
    },
  })

  encoder.configure({
    codec: codec.codec,
    width: WIDTH,
    height: HEIGHT,
    bitrate: 12_000_000,
    framerate: 30,
    avc: { format: 'avc' },
  })

  for (let i = 0; i < outputFrames; i++) {
    if (!running) {
      try { encoder.close() } catch {}
      throw new Error('export cancelled')
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

  await encoder.flush()
  encoder.close()
  onProgress(100)

  /** @type {Blob} */
  let blob
  if (codec.ext === 'mp4') {
    blob = buildMp4(chunks, keyframeFlags, avccData)
  } else {
    blob = buildWebm(chunks, keyframeFlags, 30)
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)

  return filename
}

/**
 * Build a complete fragmented MP4 file.
 *
 * @param {Uint8Array[]} chunks
 * @param {boolean[]} keyframeFlags
 * @param {Uint8Array | null} avccData
 * @returns {Blob}
 */
function buildMp4(chunks, keyframeFlags, avccData) {
  if (avccData === null) throw new Error('no decoder config from encoder')

  const timescale = 30000 // standard: 30000 ticks/sec, frame dur = 1000
  const frameDur = Math.round(timescale / 30) // 1000

  const samples = chunks.map((c, i) => ({
    size: c.length,
    duration: frameDur,
    isKeyframe: keyframeFlags[i],
  }))

  const ftyp = buildFtyp()
  // moof size is needed to calculate data_offset.
  // data_offset = ftyp.length + moov.length + moof.length + 8 (mdat header)
  // But moof contains the data_offset, creating a chicken-and-egg.
  // Solution: build moof with a placeholder data_offset, measure its length,
  // then rebuild with the correct offset. Since offset doesn't change the
  // byte length (always 4 bytes), the moof size is stable.
  const moovNoAvcc = buildMoov(timescale, WIDTH, HEIGHT, avccData)
  const moofPlaceholder = buildMoof(1, 0, samples)
  const dataOffset = ftyp.length + moovNoAvcc.length + moofPlaceholder.length + 8
  const moof = buildMoof(1, dataOffset, samples)
  const mdat = buildMdat(chunks)

  const file = [...ftyp, ...moovNoAvcc, ...moof, ...mdat]
  return new Blob([new Uint8Array(file)], { type: 'video/mp4' })
}