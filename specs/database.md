Confirmed — I read both specs and they agree with you. There is no database in this project:

- **Architecture §1** — Persistence is `localStorage` behind a guarded wrapper. No server, no backend (§12.1: "Authentication: **None.** No accounts, no backend").
- **Architecture §11** — Static hosting on GitHub Pages, no build step, no `dist/`, `connect-src 'none'` in the CSP hard-forbids any network call after load.
- **Requirements NFR/Security** — "No network requests after initial page load… Local storage only, and only for gallery entries and custom schemes."

So: **no engine, no tables, no `src/migrations/`, no seed data.** Writing SQL here would be inventing infrastructure the architecture explicitly refuses.

But there *is* a persistence contract, and it's currently undefined. Three modules write to `localStorage` — `store/prefs.js`, `store/gallery.js`, `store/schemes-store.js` — and nothing in any spec says what keys they use, what shape the values take, or what happens when a future version finds an old blob. Coder would have to invent that, and invent it three times. That's exactly the gap this phase should close.

**Proposal:** write `specs/database.md` as a *client storage contract* rather than a schema doc. Contents:

| Section | What it pins down |
|---|---|
| **Engine** | Explicit "none" finding, with the citations above, so no later phase re-litigates it |
| **Keyspace** | Namespaced keys — `loopme:v`, `loopme:prefs`, `loopme:gallery`, `loopme:schemes` — one owning module each, no shared writers |
| **Record shapes** | Field tables for each blob: types, required/optional, bounds. Gallery entry = `{id, seed, description?, createdAt}`; custom scheme = `{id, name, colors[1–8], neutrals[1–8], backgrounds[1–8]}` per FR-8 |
| **Versioning** | `loopme:v` integer, distinct from `SCHEMA_VERSION` (seed wire format). Forward-tolerant reads mirroring architecture §9.5 — repair and clamp, never discard a user's gallery |
| **Capacity budget** | 200 entries × ~1.5 KB seed ≈ 300 KB against a ~5 MB origin quota, with the `STORAGE_QUOTA` path from §12.2 |
| **Access patterns** | The read/write shapes each module needs — newest-first gallery listing, prefs read at boot step 3, scheme CRUD — and why no index structure is warranted (whole-blob JSON parse at ~300 KB is well inside budget) |
| **Integrity rules** | Gallery entries never reference a scheme by ID; the seed carries embedded colours, which is what makes FR-8's "deleting a custom scheme doesn't break a saved entry" true structurally |
| **Migrations** | A short "none exist, and here is how to add one if `loopme:v` ever increments" note |

No migration files, no `src/` writes. One spec file.

**Shall I write `specs/database.md` with that content?**