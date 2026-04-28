# CONTEXT.md

Living state for Apt Hunter. `CLAUDE.md` is the durable spec; this file is the running diary.

**Last updated:** 2026-04-27 (at commit d00c623)

## Current project state

- App is a vanilla-JS modular PWA hosted at `https://itsmepants2.github.io/apt-hunter`.
- Hash routing is live: `#/casa` (default), `#/archivo`, `#/perfil`. Legacy `?property=<id>` URLs normalize to `#/archivo?property=<id>` on boot.
- Sign-scan and URL-import flows both run through the full-viewport preview takeover (`src/preview.js`).
- Header `#btnAuth` is the only sign-in entry point. Authenticated state shows email + avatar dropdown with sign-out.
- `getSession()` has a 3s timeout (`src/auth.js`); unreachable Supabase no longer blocks startup.
- `src/store.js` is the only module allowed to touch `localStorage` directly.
- Working tree clean at e3131c0.

## Auth-migration step status

**Implemented in d00c623.** Silent localStorage → Supabase migration runs after sign-in or session restore via `migrateLocalToSupabase()` in `src/archive.js`. Both render paths in `src/app.js` (the `onAuthStateChange` SIGN_IN branch and the end-of-init backstop, gated on `currentSession`) call it; a once-per-page-load promise cache ensures it runs exactly once.

Behaviour:

- Reads the local archive; short-circuits when empty.
- Fetches remote via `loadEntries()`; skips any local entry whose UUID is already on Supabase.
- Upserts local-only entries via `saveEntry()` — stable UUIDs (49b937d) + `raw_extraction` sidecar (b6bcc59) make the upsert lossless and idempotent.
- Merges local + remote with `mergeArchives` (local-wins on id collision) and writes the union to `localStorage`. Updates `_dbCache` to match.
- Toast `Archivo sincronizado ✓` fires only when `migrated > 0`. Silent for already-in-sync, fresh-device-pull-down, and unauthenticated cases. Failed upserts stay in localStorage and retry on the next sign-in; no error toast.

Deferred / not done:

- Cleanup of pre-49b937d orphan Supabase rows (rows created by past buggy saves before stable UUIDs landed). They appear as duplicates in the merged view; manual cleanup via the Supabase dashboard is the path.

Prerequisites still load-bearing:

- **49b937d** (UUID stability): `crypto.randomUUID()` at creation in `saveToArchiveDirect` and both `savePreviewEntry` branches, plus an idempotent backfill in `src/app.js init()` for pre-fix float ids. Stable UUIDs are what make `saveEntry`'s upsert (`onConflict: 'id'`) idempotent across migration re-runs.
- **b6bcc59** (sidecar): `raw_extraction` JSON column in `src/db.js` round-trips fields without dedicated Supabase columns — `parking`, `streetAddress`, `sourceUrl`, `whatsappMessage`, `type`, `extras`, `allPhones`, `price`.

Persistence model post-migration:

- Unauthenticated: localStorage only.
- Authenticated: localStorage + Supabase via `saveEntry()`. Sign-in migrates pre-auth local-only entries up and pulls remote-only entries down via the merged-view write.

## Open architectural questions

Inherited from CLAUDE.md, none resolved yet:

- **Gist deprecation timing** — remove immediately, run in parallel, or keep as power-user export.
- **Geocoding strategy** — geocode on save, on first map render, or skip map view entirely.
- **Auth nudge strategy** — planned persistent "sync your archive" banner on Archivo for unauthed users; not yet implemented.

## Known bugs

Carried over from CLAUDE.md "Known Issues To Check Current Context For". Status here is **unverified** — none have been re-checked against current code at e3131c0:

- `'spotted'` status cosmetic mismatch — unverified
- Photo delete button non-functional — unverified
- Photo grid inner corners not rounded at intersections — unverified
- Placeholder avatar in photo grids for URL-imported entries — unverified
- `+null` display in contact field — unverified
- `gistPush()` only firing on initial create and profile save — unverified
- Mobile toast not fully disappearing after appearing once — unverified
- Hero image not extending to rightmost screen edge — unverified

Needs Steve confirmation on which (if any) are still live.

## Service worker cache version

**`mis-niditos-v22`** — verified from `sw.js:1`. Bumped from v21 in commit d00c623 alongside the silent migration because `app.js` is in the precache list.

Note: SW cache bumps don't take effect until old controllers terminate. After a bump, close all Apt Hunter tabs (especially on iOS Safari) before re-verifying.

## Recent commits

```
d00c623 Add silent Supabase archive migration (migrateLocalToSupabase in src/archive.js, called from both render paths; SW cache v22)
27e0823 Update context after UUID stability fix
49b937d Stabilize local entry ids (crypto.randomUUID at creation + idempotent backfill in app.js init; SW cache v21)
7cc394b Update context after sidecar fix
b6bcc59 Preserve Supabase sidecar fields (raw_extraction JSON round-trip in src/db.js)
596a2e7 Populate project context (this file)
e3131c0 docs: fix CLAUDE.md formatting, add CONTEXT.md stub, correct commands and file map
a9e7762 Add Claude Code project instructions
d4929d3 fix: import store in archive.js so loadArchive can read localStorage
70d374e feat: hash routing + Casa/Archivo/Perfil top-level destinations (step 3)
526a094 chore: retire dead #authView splash, sign-in lives on #btnAuth alone
f162a44 fix: 3s timeout around getSession() so unreachable Supabase doesn't block startup
a6fe36a fix: route loadScoringProfile through store.get
3e02e4a feat: retire #uploadCol; sign-scan capture goes through #btnCameraHero into the takeover (step 2C)
a5f54c7 feat: sign-scan flow uses preview takeover (step 2B)
75fec2b chore: honest toast copy until archive redesign (step 4)
d62bce2 fix: loadArchive falls through to localStorage when _dbCache is empty
d1ccf87 chore: bump SW cache to v13 (missed in 2A)
b65997e feat: full-viewport preview takeover for URL import (step 2A)
```

Themes since the last reset: preview-takeover rollout (2A/2B/2C), hash routing (step 3), store extraction to break circular imports, auth-state hardening (3s timeout, sign-out clearing view, avatar dropdown).

## Suggested next task

Live-site verification of the silent localStorage → Supabase migration landed in d00c623. The change touches auth, save paths, localStorage, Supabase, service worker, and module loading — every category CLAUDE.md flags as requiring phone verification on the deployed GitHub Pages site. Static checks (`node --check`, syntax pass) and preview-server runs cannot exercise the auth-gated round trip because Supabase OAuth doesn't complete on localhost.

The verification needs to confirm:

- SW v22 is actually serving the new code (iOS Safari can hold old controllers across cache bumps).
- Fresh sign-in with local-only entries uploads them, fires the toast, and produces matching Supabase rows with `raw_extraction` sidecar fields populated.
- Returning users with already-synced data see no re-toast.
- A second device pulls remote entries down silently.
- Edits after migration update existing Supabase rows in place (no new duplicates).
- Pre-49b937d orphan rows are not touched.

If any check fails, the failure mode points at which prerequisite is misbehaving: SW v22 cache (`sw.js`), UUID stability (49b937d), `raw_extraction` sidecar (b6bcc59), or migration logic (d00c623). Diagnose before patching, per CLAUDE.md.

## Suggested next Claude Code prompt

> Walk me through live-site verification of the silent migration landed in d00c623. **Do not edit any source files. Do not run any code-changing tools.** Read `CONTEXT.md` and `CLAUDE.md` for context, then guide me through the checklist below. I'll report what I see on the phone after each step; you interpret results and flag issues. If a step fails, hypothesise the most likely cause from the prerequisite chain (SW v22 cache, UUID stability in 49b937d, `raw_extraction` sidecar in b6bcc59, or migration logic in d00c623), but do not patch — we diagnose first.
>
> **Pre-flight (SW)**
>
> 1. Close all Apt Hunter tabs. Open `https://itsmepants2.github.io/apt-hunter`. Web Inspector → Application → Service Workers → confirm the active worker reports cache `mis-niditos-v22`.
>
> **Fresh sign-in (canonical migration case)**
>
> 2. While **signed out**, save 2–3 entries via sign-scan and URL import. Confirm they appear in the archive UI.
> 3. Inspect localStorage `apt_hunter_archive`. Confirm every `id` is a UUID string. Note the count and ids.
> 4. Open the Supabase `entries` dashboard. Note any pre-existing rows for this account.
> 5. Click `#btnAuth`, complete Google sign-in.
> 6. **Expected:** toast `Archivo sincronizado ✓`. Archive UI shows the same entries.
> 7. Reload the Supabase dashboard. Confirm new rows match the local UUIDs from step 3, with `raw_extraction` populated — visible fields: `parking`, `streetAddress`, `sourceUrl`, `whatsappMessage`, `type`, `extras`, `allPhones`, `price`.
> 8. Reload the page. **No re-toast.** Archive renders the same entries.
>
> **Returning user (already in sync)**
>
> 9. Sign out, then sign back in. **No toast.** Archive renders normally.
>
> **Cross-device pull**
>
> 10. On a second device — or after clearing localStorage on the same one — sign in. localStorage is populated from Supabase via the merged-view write. Archive shows the entries from step 2. **No toast** (no upload happened, only a pull-down).
>
> **Edit after migration (UUID stability sanity)**
>
> 11. Edit one field on a migrated entry; blur. Reload the Supabase dashboard. Confirm the existing row was updated in place — no new duplicate row.
>
> **Edge cases**
>
> 12. Empty local + empty Supabase: sign in fresh. No errors, no toast.
> 13. Network blip during migration: simulate offline mid-flow if possible. `saveEntry` returns null for failed entries; they stay in localStorage with their UUIDs. Re-sign-in retries them silently. No error toast.
>
> **Pre-49b937d orphans (do not delete)**
>
> 14. Confirm any pre-existing duplicate rows in Supabase remain untouched. They appear as duplicate cards in the merged view; cleanup is the deferred path.
>
> Report results step-by-step. Highlight any unexpected behavior.
