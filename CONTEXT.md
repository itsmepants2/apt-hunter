# CONTEXT.md

Living state for Apt Hunter. `CLAUDE.md` is the durable spec; this file is the running diary.

**Last updated:** 2026-04-28 (Level 2 account-private archive, uncommitted at audit time)

## Current project state

- App is a vanilla-JS modular PWA hosted at `https://itsmepants2.github.io/apt-hunter`.
- Hash routing is live: `#/casa` (default), `#/archivo`, `#/perfil`. Legacy `?property=<id>` URLs normalize to `#/archivo?property=<id>` on boot.
- Sign-scan and URL-import flows both run through the full-viewport preview takeover (`src/preview.js`).
- Header `#btnAuth` is the only sign-in entry point. Authenticated state shows email + avatar dropdown with sign-out.
- `getSession()` has a 3s timeout (`src/auth.js`); unreachable Supabase no longer blocks startup.
- `src/store.js` is the only module allowed to touch `localStorage` directly.
- Working tree clean at a36eb8b.

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
- Cleanup of duplicate/blank Supabase rows accumulated by the Gist↔localStorage↔backfill loop (see "Recent emergency fixes" below). Live archive grew from 19 → 25 → 34 across two sign-in cycles before the loop was severed. Manual dashboard cleanup is the path.

## Recent emergency fixes

**Level 2 account-private archive (uncommitted).** Signed-in saves were dual-writing to Supabase + localStorage under a shared `apt_hunter_archive` key. After sign-out, `_dbCache` was cleared but localStorage still held the synced entry, so `renderArchive` re-rendered the entry against the persistence-model intent. Level 2 introduces a `pendingSync` boolean on local entries: every save site (`savePreviewEntry`, `saveToArchiveDirect`, `saveArchiveField`, `saveArchivePhotoAdd`) now writes optimistically with `pendingSync: true`, awaits `saveEntry()`, and clears the flag on confirmed Supabase success. On sign-out, `pruneSyncedFromLocal()` keeps only `pendingSync === true` entries so synced rows leave with the account while pending/local-only data survives for the next sign-in. `migrateLocalToSupabase` clears the flag on confirmed upload (via either `remoteIds.has(id)` or a truthy `saveEntry` return) and never produces duplicate rows because of stable UUIDs (49b937d) plus the `remoteIds` skip. The one-shot `dbReady` IIFE was replaced by a callable `refreshDbCache()` so each sign-in (cold-start or post-OAuth) re-fetches Supabase rows; the auth listener is now event-explicit (`SIGNED_IN`/`SIGNED_OUT`) and gated on a new `_initBackstopRun` flag so cold-start work isn't double-run. `saveEntry` early-returns null when no user is signed in, giving callers an honest success/failure signal. SW cache bumped to v25.

**Duplication loop stopped (d30bc9f).** Diagnostic identified that automatic `gistPull()` at the end of init reintroduced pre-49b937d float-id entries into localStorage, where `backfillLocalEntryIds` minted fresh UUIDs for them, then `migrateLocalToSupabase` uploaded those as new Supabase rows on the next sign-in cycle. d30bc9f removed the three auto-call sites (`gistPull` at end of init, `gistPush` in `savePreviewEntry`, `gistPush` in `btnSavePerfil`). `sync.js` and the Gist token settings UI are preserved — only the auto paths are off, so reverting per-callsite is one line each. Cycle-over-cycle count growth has stopped per live verification; pre-existing duplicate/blank rows in Supabase still need manual cleanup.

**Sign-out stale UI fixed (a36eb8b).** `_dbCache` is module-private in `src/archive.js` and was never reset on sign-out, so `loadArchive()`'s shadow-cache check kept returning the signed-in row count after sign-out (most visible in incognito where the migration short-circuits because local was empty, leaving `_dbCache` as the only data source). a36eb8b adds an exported `clearDbCache()` and the `SIGNED_OUT` branch in `src/app.js` now calls `clearDbCache(); clearArchiveView(); renderArchive(); updateHasEntries();` so the home prompt and Archivo view re-render against localStorage immediately, no hard reload needed. localStorage is intentionally not cleared — local-only entries persist across sign-out per the persistence model.

Prerequisites still load-bearing:

- **49b937d** (UUID stability): `crypto.randomUUID()` at creation in `saveToArchiveDirect` and both `savePreviewEntry` branches, plus an idempotent backfill in `src/app.js init()` for pre-fix float ids. Stable UUIDs are what make `saveEntry`'s upsert (`onConflict: 'id'`) idempotent across migration re-runs.
- **b6bcc59** (sidecar): `raw_extraction` JSON column in `src/db.js` round-trips fields without dedicated Supabase columns — `parking`, `streetAddress`, `sourceUrl`, `whatsappMessage`, `type`, `extras`, `allPhones`, `price`.

Persistence model post-Level-2:

- Unauthenticated: localStorage only. Entries carry `pendingSync: true` until a sign-in successfully uploads them.
- Authenticated: Supabase is source of truth. Local copy is an offline cache + retry buffer. Successful saves clear `pendingSync`; failed saves keep it. Sign-out runs `pruneSyncedFromLocal()` so synced rows leave with the account.
- Cross-device handoff: pending entries flush to Supabase on the next sign-in via `migrateLocalToSupabase`, deduped by UUID against `remoteIds`.

## Open architectural questions

Inherited from CLAUDE.md, none resolved yet:

- **Gist deprecation timing** — remove immediately, run in parallel, or keep as power-user export.
- **Geocoding strategy** — geocode on save, on first map render, or skip map view entirely.
- **Auth nudge strategy** — planned persistent "sync your archive" banner on Archivo for unauthed users; not yet implemented.

### Level 3 follow-up: user-keyed localStorage

Level 2 closes the most visible leak (synced entries no longer visible after sign-out) but leaves three corner cases that user-keyed localStorage would solve cleanly:

- **Cross-user contamination on shared device.** Pending entries that survive sign-out can be visible to a different user signing in next on the same device. `migrateLocalToSupabase` would then upload them under the new user's `user_id`. Today's mitigation is "the original user's pending entries become the new user's entries" — wrong but rarely hit on a personal-use device.
- **SIGNED_OUT-during-init race.** If a SIGNED_OUT event fires inside the init backstop's awaits, the listener is gated by `_initBackstopRun=false` and returns early, so `pruneSyncedFromLocal` never runs. localStorage retains synced entries and the post-init render shows them. Practically unreachable via UI (appShell hidden until init finishes) but reachable via server-side revocation, expired-token failure, or DevTools `signOut()`. Recovery is a single sign-in/sign-out cycle.
- **Pre-feature legacy entries.** Any entry created before Level 2 lacks the `pendingSync` field, so `pruneSyncedFromLocal` treats it as synced and drops it on first sign-out. Fine for the current clean-state scenario; would be data loss for any user carrying older local-only entries.

The Level 3 shape: storage key becomes `apt_hunter_archive::guest` for unauthed and `apt_hunter_archive::<uid>` for signed-in. A helper resolves the active key from `currentSession`. `_dbCache` becomes per-uid (Map keyed by uid, or always nuked on user-id change). One-time migration on first load: legacy `apt_hunter_archive` moves into the active-session's user-keyed slot, or to `::guest` if no session. After Level 3, sign-out is a key-switch with no destructive write — each user's data sits dormant under their own key, never visible cross-user, never lost on sign-out, no race window.

### Photo-delete + Level 2 interaction

[src/ui.js:587-600](src/ui.js:587) `deleteArchivePhoto` writes localStorage without calling `saveEntry`. Pre-Level-2 this was the long-standing "Photo delete button non-functional" issue (the deletion never propagated to Supabase). Post-Level-2 it's worse: the local entry diverges from Supabase but carries no `pendingSync` flag, so `pruneSyncedFromLocal` treats it as synced and drops it on sign-out. On the next sign-in, `refreshDbCache` re-fetches the Supabase row with the photo restored, silently undoing the user's deletion. Fix: route `deleteArchivePhoto` through a sync-tracked save path (call `saveEntry` after the local mutation, set/clear `pendingSync` on the result).

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

**`mis-niditos-v25`** — verified from `sw.js:1`. Bumped from v24 with the Level 2 account-private archive change (touches `app.js`, `archive.js`, `db.js`).

Note: SW cache bumps don't take effect until old controllers terminate. After a bump, close all Apt Hunter tabs (especially on iOS Safari) before re-verifying.

## Recent commits

```
a36eb8b Clear archive cache on sign out (export clearDbCache in src/archive.js; SIGNED_OUT branch in src/app.js now resets _dbCache + re-renders from localStorage; SW cache v24)
d30bc9f Disable automatic Gist sync (removed gistPull at end of init, gistPush in savePreviewEntry and btnSavePerfil in src/app.js; sync.js + Gist UI/settings preserved; SW cache v23)
80f4036 Fix mobile archive card layout (CSS-only mobile reflow in css/styles.css inside @media (max-width: 767px))
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

Themes since the last reset: preview-takeover rollout (2A/2B/2C), hash routing (step 3), store extraction to break circular imports, auth-state hardening (3s timeout, sign-out clearing view, avatar dropdown), emergency duplication-loop break and sign-out cache reset.

## Suggested next task

**Plan and verify manual Supabase row cleanup. Do not write cleanup code yet.**

After the d30bc9f loop break and a36eb8b sign-out fix, the live archive count is reportedly stable across sign-in/out cycles, but Supabase still holds the duplicate/blank rows accumulated by the prior loop (the user's account grew 19 → 25 → 34 before the loop was severed). Cleanup needs to happen in the Supabase dashboard, not in code, because:

- Auto-pruning from the app risks deleting legitimate entries if the canonical-source assumption is wrong.
- The blank "Sin título" rows may be a mix of: pre-49b937d orphan rows (saveEntry minted random UUIDs per save), gist-origin entries that round-tripped with sparse data, and post-loop duplicates with new UUIDs.
- The user (Steve) is the only person who can identify which rows are real properties vs. accidents.

The verification + planning task should produce:

1. A confirmation that the loop is fully stopped — three consecutive sign-out/sign-in cycles with stable counts on UI, localStorage, and Supabase.
2. A reconciliation list comparing the live `apt_hunter_archive` ids against the Supabase `entries` row ids, flagging:
   - rows in Supabase whose ids match localStorage (keep candidates)
   - rows in Supabase whose ids do not match localStorage (orphan candidates — likely cleanup targets)
   - rows with mostly null fields (`address`, `headline`, `notes`, `raw_extraction.sourceUrl` all empty) regardless of id (blank-row candidates)
3. A step-by-step manual cleanup plan the user executes in the Supabase dashboard (export CSV first, delete one row at a time, verify archive UI re-renders cleanly after each batch).

Do not write a `pruneOrphans()` helper. Do not auto-delete. The next Claude Code prompt should produce the reconciliation output and dashboard checklist; the deletes happen by hand.

## Suggested next Claude Code prompt

> Help me plan manual Supabase cleanup for the duplicate/blank rows left behind by the pre-d30bc9f duplication loop. **Do not edit source files. Do not write cleanup code. Do not delete Supabase rows.** Read `CONTEXT.md` and `CLAUDE.md` first.
>
> **Phase A — confirm the loop is fully stopped**
>
> 1. Close all Apt Hunter tabs. Open the live site fresh. Confirm `mis-niditos-v24` is the active SW.
> 2. Note current live archive count (UI), localStorage `apt_hunter_archive.length`, and Supabase `entries` row count for my account.
> 3. Run three sign-out / sign-in cycles back-to-back with no other actions. After each, record the three counts.
> 4. Expected: all three counts stable across all three cycles. If any grows, stop — the loop has another source and we re-diagnose before cleanup.
>
> **Phase B — reconciliation read-out**
>
> 5. Have me dump the full `apt_hunter_archive` from localStorage in DevTools.
> 6. Have me export the Supabase `entries` table for my user as CSV (dashboard → entries → filter by user_id → export).
> 7. Help me identify three sets:
>    - **Keep:** Supabase ids that match localStorage ids AND have non-trivial field content.
>    - **Orphans:** Supabase ids not in localStorage (likely from pre-49b937d random-UUID saves or the loop's UUID drift).
>    - **Blanks:** Supabase rows where `address`, `headline`, `notes`, `raw_extraction.sourceUrl` are all empty/null — regardless of id match.
> 8. Cross-reference by `created_at` and any preserved sidecar fields to catch edge cases (e.g. a row with content the user actually created but whose id drifted).
>
> **Phase C — manual cleanup checklist**
>
> 9. Walk me through dashboard cleanup: export CSV backup first, then delete orphans + blanks one batch at a time. After each batch, sign out and back in once and confirm the archive UI renders the expected count.
> 10. Stop when Supabase row count matches the localStorage canonical count and no Sin título cards remain.
>
> **Out of scope**
>
> - No auto-prune helper, no `cleanupSupabase()` function, no migration-time filtering. Cleanup is a one-time manual operation; future stability comes from d30bc9f + a36eb8b already in place.
>
> Report each phase's findings before proceeding to the next. If anything looks ambiguous (e.g. a row that looks blank but has a sidecar `sourceUrl`), flag it instead of recommending deletion.
