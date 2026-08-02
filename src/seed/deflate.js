// @ts-check
/**
 * deflate-raw compression behind a capability probe (architecture §9.4).
 *
 * `CompressionStream` is stream-based and the platform offers no synchronous
 * deflate, so both directions are `async`. Capability is probed **once at
 * module load** and cached — the probe actually constructs a
 * `CompressionStream('deflate-raw')`, because an engine can expose the
 * constructor while rejecting that specific format. The codec consults
 * `canDeflate()` to choose the `z` flag or fall through to the `p`
 * passthrough; both paths ship and both are tested regardless of what the
 * local engine supports (architecture §1).
 *
 * Imports nothing.
 */

/**
 * Probe once. Constructing with `'deflate-raw'` throws on engines that only
 * know `'gzip'`/`'deflate'`, which is exactly the case the probe must catch.
 *
 * @returns {boolean}
 */
function probe() {
  try {
    // Both directions must exist: encoding on this engine is pointless if
    // this same build could not decode its own output.
    void new CompressionStream('deflate-raw')
    void new DecompressionStream('deflate-raw')
    return true
  } catch {
    return false
  }
}

const CAPABLE = probe()

/**
 * Can this engine run the `z` path?
 *
 * @returns {boolean}
 */
export function canDeflate() {
  return CAPABLE
}

/**
 * Pump `bytes` through a TransformStream and collect the output.
 *
 * `Response` is the shortest correct way to drain a ReadableStream into an
 * ArrayBuffer on every target engine — no hand-rolled reader loop to get
 * subtly wrong.
 *
 * @param {Uint8Array} bytes
 * @param {CompressionStream | DecompressionStream} transform
 * @returns {Promise<Uint8Array>}
 */
async function pump(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/**
 * Compress with deflate-raw. Throws if the engine is incapable — callers
 * check `canDeflate()` first; the codec's `p` fallback is the recovery, not
 * a try/catch here.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export function deflate(bytes) {
  if (!CAPABLE) {
    return Promise.reject(new Error('deflate-raw is unavailable on this engine'))
  }
  return pump(bytes, new CompressionStream('deflate-raw'))
}

/**
 * Decompress deflate-raw. Rejects on an incapable engine **and** on a
 * corrupted or truncated stream — the codec maps both to `SEED_MALFORMED`.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export function inflate(bytes) {
  if (!CAPABLE) {
    return Promise.reject(new Error('deflate-raw is unavailable on this engine'))
  }
  return pump(bytes, new DecompressionStream('deflate-raw'))
}
