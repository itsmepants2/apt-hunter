# CONTEXT.md

Living state for Apt Hunter. `CLAUDE.md` is the durable spec; this file is the running diary.

**Last updated:** 2026-04-27 (at commit a36eb8b)

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

**Duplication loop stopped (d30bc9f).** Diagnostic identified that automatic `gistPull()` at the end of init reintroduced pre-49b937d float-id entries into localStorage, where `backfillLocalEntryIds` minted fresh UUIDs for them, then `migrateLocalToSupabase` uploaded those as new Supabase rows on the next sign-in cycle. d30bc9f removed the three auto-call sites (`gistPull` at end of init, `gistPush` in `savePreviewEntry`, `gistPush` in `btnSavePerfil`). `sync.js` and the Gist token settings UI are preserved — only the auto paths are off, so reverting per-callsite is one line each. Cycle-over-cycle count growth has stopped per live verification; pre-existing duplicate/blank rows in Supabase still need manual cleanup.

**Sign-out stale UI fixed (a36eb8b).** `_dbCache` is module-private in `src/archive.js` and was never reset on sign-out, so `loadArchive()`'s shadow-cache check kept returning the signed-in row count after sign-out (most visible in incognito where the migration short-circuits because local was empty, leaving `_dbCache` as the only data source). a36eb8b adds an exported `clearDbCache()` and the `SIGNED_OUT` branch in `src/app.js` now calls `clearDbCache(); clearArchiveView(); renderArchive(); updateHasEntries();` so the home prompt and Archivo view re-render against localStorage immediately, no hard reload needed. localStorage is intentionally not cleared — local-only entries persist across sign-out per the persistence model.

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

**`mis-niditos-v24`** — verified from `sw.js:1`. Bumped from v22 across the two emergency fixes (d30bc9f Gist auto-sync disable, a36eb8b sign-out cache clear) since both touched `app.js` which is precached.

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
