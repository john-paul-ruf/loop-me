// @ts-check
/**
 * Version constants — the single source (architecture §9.1).
 *
 * `SCHEMA_VERSION` is the leading character of every seed string
 * (`<version><flag><payload>`, architecture §9.1) and the first element of the
 * pre-encoding positional array (§9.2). It is a *string* because that is what
 * the wire format carries: `"1z…"` is parsed by taking `seed[0]`, not by
 * arithmetic.
 *
 * Bumping it invalidates every seed in existence — decode rejects an
 * unrecognized version outright, the one hard failure in an otherwise
 * forward-tolerant codec (architecture §9.5). Adding a layer type, adding a
 * trailing parameter, or adding a blend mode does *not* require a bump: those
 * are absorbed by the append-only ID rule and by trailing-element tolerance.
 * Reordering or removing anything does.
 *
 * `APP_VERSION` is human-facing only. Nothing branches on it, nothing encodes
 * it, and it may move freely without touching a single seed.
 */

/** Seed wire-format version. Append-only semantics; see the note above. */
export const SCHEMA_VERSION = '1'

/** Human-facing build version. Never encoded, never compared. */
export const APP_VERSION = '0.1.0'
