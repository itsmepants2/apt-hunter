# CONTEXT.md

Living state for Apt Hunter. `CLAUDE.md` is the durable spec; this file is the running diary.

**Last updated:** 2026-04-27 (at commit e3131c0)

## Current project state

- App is a vanilla-JS modular PWA hosted at `https://itsmepants2.github.io/apt-hunter`.
- Hash routing is live: `#/casa` (default), `#/archivo`, `#/perfil`. Legacy `?property=<id>` URLs normalize to `#/archivo?property=<id>` on boot.
- Sign-scan and URL-import flows both run through the full-viewport preview takeover (`src/preview.js`).
- Header `#btnAuth` is the only sign-in entry point. Authenticated state shows email + avatar dropdown with sign-out.
- `getSession()` has a 3s timeout (`src/auth.js`); unreachable Supabase no longer blocks startup.
- `src/store.js` is the only module allowed to touch `localStorage` directly.
- Working tree clean at e3131c0.

## Auth-migration step status

**Not started.** No code path migrates localStorage entries into Supabase on sign-in.

- `onAuthStateChange` in `src/app.js:343` only re-renders the archive when a session arrives.
- `mergeArchives` in `src/archive.js` is used by `src/sync.js` for Gist sync, not for sign-in migration.
- Persistence today is dual-path: unauthed → localStorage only; authed → both localStorage and Supabase via `saveEntry()` in `src/db.js`.
- Planned (per CLAUDE.md): silent merge on sign-in, with optional one-time confirmation toast. No "found N properties, import?" prompt.

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

**`mis-niditos-v20`** — verified from `sw.js:1`.

Note: SW cache bumps don't take effect until old controllers terminate. After a bump, close all Apt Hunter tabs (especially on iOS Safari) before re-verifying.

## Recent commits

```
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

Design the silent localStorage → Supabase migration before implementing it.

Decisions to surface for Steve before any code is written:
- Conflict resolution: when an entry exists in both localStorage and Supabase with the same id but different fields, which wins? Last-write-wins by `updatedAt`, local-wins, remote-wins, or per-field merge?
- Entry identity: are localStorage entry ids stable enough to dedupe against Supabase, or does merge need a content fingerprint?
- Trigger point: run on every `SIGNED_IN` event, only on the first sign-in per device, or only when `_dbCache` is empty?
- Failure mode: if the Supabase write fails partway, do we retry, leave localStorage as the source of truth, or surface an error?
- Toast behavior: confirmation toast on every successful migration, only on first migration per device, or never (silent)?
- Reuse vs. new helper: does `mergeArchives` in `src/archive.js` (currently used by Gist sync) fit the sign-in shape, or is a separate helper cleaner?

Deliverable for the design step: a short doc (or addendum here) capturing the chosen answers, then a follow-up prompt to implement.

## Suggested next Claude Code prompt

> Read-only design pass for the silent localStorage → Supabase migration on sign-in. **Do not implement anything; do not edit any source files.** Read `src/app.js` (especially `onAuthStateChange` around line 343), `src/archive.js` (loadArchive, mergeArchives, _dbCache, dbReady), `src/db.js` (saveEntry), `src/sync.js` (how mergeArchives is currently consumed), and `src/auth.js`. Then produce a short design proposal that answers each open question in CONTEXT.md's Suggested next task: conflict resolution, entry identity, trigger point, failure mode, toast behavior, and whether to reuse `mergeArchives` or add a new helper. For each answer, cite the file/line evidence behind your recommendation, name the alternative you considered, and flag anything that needs my decision before code is written. Output the proposal as a reply in this conversation — do not write it to a new file unless I ask.
