# CLAUDE.md

## Project Purpose

Apt Hunter is a personal-use PWA for Steve’s apartment search in Mexico City. It is branded in-product as **Mis Niditos**.

The app supports a Mexico City-specific apartment-hunting workflow:

- Photographing physical apartment listing signs on buildings
- Extracting listing/contact details from those signs via AI vision
- Saving properties into an archive for later review
- Streamlining WhatsApp outreach
- Importing listings from URLs, especially portals like EasyBroker and Inmuebles24

The current goal is validation before investing in a native app. Do not overbuild toward a commercial/native architecture unless explicitly asked.

Primary principle:

> Validate the PWA workflow before investing in native development.

## Hosting and Deployment

Production app:

- `https://itsmepants2.github.io/apt-hunter`

Cloudflare Worker proxy:

- `https://apt-hunter-proxy.stevebryant.workers.dev`

The app is hosted on GitHub Pages. The Worker is deployed separately.

## Stack

Current stack:

- Vanilla HTML/CSS/JavaScript
- Modular JS in `src/`
- GitHub Pages
- Cloudflare Worker API proxy
- Supabase for auth and future primary database
- GitHub Gist for current sync, transitional
- PWA manifest + service worker

External APIs/services:

- Anthropic via Cloudflare Worker
- Frankfurter FX via Cloudflare Worker
- Supabase
- GitHub Gist

UX reference:

- Zillow Favorites for the archive destination

## Claude Code Role

Claude Code does implementation work:

- Read files
- Edit files
- Run commands
- Commit changes
- Push changes

Do not make design or product decisions silently. If a prompt contains unresolved product, UX, auth, storage, navigation, or architecture choices, surface them before implementing.

## How Claude Code Should Work

Before making changes:

- Read this file.
- Read `CONTEXT.md` or `context.md` if present.
- Inspect relevant files before editing.
- Re-read source after major refactors instead of relying on memory.
- Explain the existing pattern before proposing changes.
- Identify the smallest safe change.
- Do not start with a broad rewrite.

While making changes:

- Keep each change single-purpose.
- One feature or bug fix per prompt.
- Do not bundle adjacent fixes unless explicitly asked.
- Do not introduce new dependencies without explaining why.
- Preserve existing behavior unless the task says otherwise.
- Follow existing naming, file, routing, storage, and state-management patterns.
- Prefer surgical changes over clever abstractions.

After making changes:

- Summarize what changed.
- List files changed.
- Run relevant checks if possible.
- Say clearly if verification was static-only.
- Provide manual verification steps.
- Commit and push after every completed change unless instructed otherwise.
- Update `CONTEXT.md` / `context.md` if asked.

## Architecture Overview

The app uses a modular vanilla JS architecture.

### File Map

| Path | Purpose |
|---|---|
| `index.html` | DOM shell: header, `#headerNav`, main views, `#previewView`, `#galleryView`, `#tabsBottom` |
| `css/styles.css` | Main stylesheet; beige/cream visual theme |
| `src/app.js` | Entry point: init, refs, click wiring, route registration, `savePreviewEntry`, service worker registration |
| `src/router.js` | Leaf router module: `initRouter`, `navigateTo`, `currentRoute`, `applyRoute`; no imports from app/ui |
| `src/ui.js` | DOM render functions: archive, scorecard, archive cards, gallery, phone items, etc. |
| `src/archive.js` | Archive CRUD, `_dbCache`, `loadArchive`, archive filter state, gallery init, `STATUSES` |
| `src/analyze.js` | Sign-scan and URL import flows, Anthropic vision extraction, photo helpers, `resetScanState` |
| `src/preview.js` | Preview takeover lifecycle: `openPreview`, `updatePreview`, `closePreview`, render; owns `#tabsBottom` hide/show during takeover |
| `src/services.js` | External HTTP calls: Worker, Anthropic, FX, Gist |
| `src/sync.js` | Gist pull/push/discover |
| `src/db.js` | Supabase data layer; no-ops without session |
| `src/auth.js` | Supabase OAuth wrappers; `getSession()` has 3s timeout and returns null on timeout |
| `src/supabase.js` | Supabase client init via `esm.sh` |
| `src/scoring.js` | Pure scoring engine |
| `src/csv.js` | CSV export |
| `src/store.js` | Pure localStorage wrapper; `store.get` / `store.set`; no imports |
| `src/profile.js` | Empty placeholder |
| `worker/src/index.js` | Cloudflare Worker routes: `/anthropic`, `/fx`, `/fetch` |
| `manifest.json` | PWA manifest; `start_url` and `scope` are `/apt-hunter/` |
| `sw.js` | Service worker |

### Dead But Not Deleted

These files are old monolith backups and should not be treated as current source:

- `index.backup.html`
- `src/app.backup.js`

Exclude them from grep audits when possible:

```bash
--exclude='*.backup.*'

Persistence Model

Persistence is dual-path by design.

Unauthenticated Users

Unauthed users save to localStorage only, via the store wrapper in src/store.js.

Local saves must work without auth.

Authenticated Users

Authed users save to both localStorage and Supabase.

Writes go to both via saveEntry() in db.js.

Archive Loading

dbReady IIFE in archive.js populates _dbCache from Supabase only when there is a session.

If there is no session:

_dbCache stays null
loadArchive() falls through to localStorage
Auth Model

Current auth philosophy:

Local saves work without auth.
Anyone landing on the site can scan or paste a URL and save a result.
There is no unauthenticated quota and no time bomb.
The auth pitch is: sync + don’t lose this archive.
Auth should feel valuable after the user has invested effort building an archive.
Sign-in silently merges localStorage entries into Supabase.
Do not show a “we found 4 properties, import them?” prompt.
A one-time confirmation toast after silent migration is acceptable.
Casa, Archivo, and Perfil are always reachable.
Auth nudges are contextual, not interruptive.

Current sign-in behavior:

Header #btnAuth is the live sign-in entry point.
When unauthenticated, it renders “Iniciar sesión”.
Clicking it calls signInWithGoogle().
When authenticated, it renders email + avatar.
Clicking authenticated state opens dropdown with #btnSignOut.

OAuth callback:

Production callback works via Supabase detectSessionInUrl: true.
onAuthStateChange listener in app.js handles session arrival.
redirectTo is the live GitHub Pages URL.
Callback only resolves on production, not localhost.

Important runtime rule:

getSession() has a 3s Promise.race timeout.
On timeout, it returns null.
All callers treat timeout as no-session.
This prevents preview-server runtime from hanging when Supabase is unreachable.

App shell visibility:

Path 1: onAuthStateChange callback when session arrives.
Path 2: unconditional end-of-init backstop.
The unconditional backstop ensures unauthenticated users see the home view.
Navigation Model

The app uses hash routing on the /apt-hunter/ base path.

Empty hash defaults to:

#/casa
Views
View	DOM ID	Route	Trigger
Casa	#homeView	#/casa	Default route, Casa tab
Archivo	#archiveView	#/archivo	Archivo tab
Perfil	#perfilView	#/perfil	Perfil tab
Preview takeover	#previewView	n/a overlay	URL extract or camera capture
Gallery	#galleryView	n/a overlay, ?property=<id>	Tap property card photo
Settings	#settingsPanel	n/a overlay	Gear button

Navigation rules:

Hash routing uses /apt-hunter/ base path.
?property=<id> is preserved orthogonally.
Gallery overlay can open over whatever route is current.
Legacy /apt-hunter/?property=42 URLs normalize to #/archivo?property=42 on boot.
Bottom tab bar is visible below 768px.
Header nav is visible at 768px and above.
#tabsBottom hides during preview takeover.
Preview takeover hide/show hooks live in preview.js.
popstate handler closes gallery on browser back.
Storage Model

All localStorage access in src/*.js must flow through:

store.get(...)
store.set(...)

Direct localStorage.* calls are not allowed outside src/store.js.

Known Storage Keys
Key	Purpose
localStorage.apt_hunter_archive	Saved property entries; primary local archive
localStorage.searchProfile	Match/search profile
localStorage.apt_hunter_gh_token	Gist token
localStorage.apt_hunter_gist_id	Discovered Gist ID
localStorage.apt_hunter_last_cc	Last-used WhatsApp country code
localStorage.apt_hunter_supabase_url	Supabase URL
localStorage.apt_hunter_supabase_key	Supabase anon key; public by design, protected by RLS
sb-*	Supabase auth session state

Rules:

Do not rename storage keys without migration.
Do not introduce new storage keys unless necessary.
Document new storage keys here.
Keep src/store.js a pure leaf module with no imports.
Service Worker and Cache Rules

Important:

Do not append version query strings to JS files.
Do not cachebust ES module imports with ?v=.
ES modules are deduped by resolved URL.
If index.html references app.js?v=N while another module imports app.js, the browser instantiates two separate module records and top-level code can run twice.
Use service worker cache version bumps to invalidate JS.
CSS cachebusting is acceptable if already part of the project pattern.
When changing cache behavior, explain exactly what changes and how to verify deployed behavior.

Service worker verification notes:

SW cache bumps do not take effect until old SW controllers terminate.
iOS Safari with persistent open tabs can hold old controllers.
After SW bump, close all Apt Hunter tabs before re-verifying on phone.
API Security
Anthropic API key must live only in the Cloudflare Worker.
Never expose the Anthropic key in browser code.
Frankfurter FX also routes through the Worker to avoid CORS.
Supabase anon key may be public by design, assuming RLS protects data.
Spec Discipline

When implementing from a prompt:

Treat locked decisions as binding.
Put unresolved decisions back to Steve before coding.
Preserve field shapes exactly.
If creating or modifying entry objects, list every field and source.
If removing old UI, files, or selectors, identify exactly what was removed.
Do not say “remove old capture chrome” without naming the actual IDs/selectors/files.
Avoid changing unrelated flows.
Do not add adjacent cleanup unless explicitly asked.
One prompt equals one feature or bug fix.
Diagnostic Discipline

When live behavior contradicts a “verified” report:

Do not attempt a fix immediately.
First run a read-only diagnostic phase.
State the hypothesis explicitly.
Gather evidence from file reads, grep, deployed source, or runtime inspection.
Answer numbered diagnostic questions.
Do not patch during diagnostic phase.
End with synthesis identifying the most likely root cause.

Static analysis on memory is unreliable across refactors. Re-read source.

Known failure mode:

Quoting from memory of pre-refactor code can hide bugs.

When diagnosing deployed behavior, verify against deployed code, not memory.

Useful deployed-source check from iPhone Web Inspector console:

fetch('https://itsmepants2.github.io/apt-hunter/src/MODULE.js')
  .then(r => r.text())
  .then(console.log)

Replace MODULE.js with the relevant module.

Live-site debugging should be time-boxed. If repeated diagnostic rounds conflict with deployed behavior, the issue may live in module interaction or runtime state. Consider a workaround or defer into a planned refactor rather than grinding indefinitely.

Verification Discipline

Verification must be observable and testable.

Good verification examples:

Pick a sign photo.
Confirm takeover opens within 2 seconds.
Confirm photo appears in strip.
Confirm save button is enabled.
Confirm unauthenticated save persists after reload.
Confirm authenticated save writes to localStorage and Supabase.
Confirm gallery opens from an archive card.
Confirm browser back closes gallery.

Weak verification examples:

“Confirm it works.”
“Looks good.”
“Should be fixed.”
“Static review passed.”

If runtime verification is not possible, say so directly and explain what was checked instead.

Live-Site Verification

Live-site verification on phone is load-bearing for changes touching:

Auth
Routing
Save paths
localStorage
Supabase
Service worker behavior
Module loading
Camera/photo flows

Preview server verification is useful but not authoritative for module-load-order, service-worker, auth-flow, or deployed mobile behavior bugs.

Fresh-Origin Verification

Fresh-origin verification beats hard reload alone after JS-module changes.

Use:

Different port, or
?cachebust=N on the page URL

Browser resolved-module maps are per-origin and can survive reloads in subtle ways.

iPhone Web Inspector

For phone debugging:

iPhone: Settings → Safari → Advanced → Web Inspector
Mac Safari: Settings → Advanced → Show features for web developers
Connect iPhone via USB
Foreground the Apt Hunter tab on phone
Mac Safari → Develop → [iPhone name] → [tab]
Coding and Module Rules
src/router.js should remain a leaf-style routing module.
src/store.js should remain a pure localStorage wrapper with no imports.
src/archive.js and src/sync.js have a mutual circular import that is currently safe because cross-calls are inside function bodies.
Do not introduce top-level cross-module side effects without understanding module load order.
ES module namespace exports are immutable.
Monkey-patching imported module namespace functions does not work reliably.
Use Sources-panel breakpoints or fresh imports for runtime tracing.
Claude Code Behavioral Rules

Claude Code should:

Read relevant modules in full before changes.
Show before/after for CSS work.
Verify visual changes with preview server before reporting done, unless not observable in browser.
Skip preview verification only with explicit reasoning.
Commit and push after every completed change unless told otherwise.
Keep the live GitHub Pages site current.
Use git commits as the rollback mechanism.
Prefer one feature or bug fix per commit.
Commands

Use the actual project scripts from package.json when available.

Before listing or running commands, inspect package.json.

Common command categories to identify:

# Install dependencies
npm install

# Start local dev / preview
[inspect package.json]

# Run tests
[inspect package.json]

# Run lint
[inspect package.json]

# Build
[inspect package.json]

Do not invent commands that are not supported by the repo.

Known Current State

Current state should live in CONTEXT.md or context.md.

Claude Code should read that file when present for:

Auth-migration step status
Open bugs
Open architectural questions
Current service worker cache version
Recent commits
Suggested next task

Do not treat this CLAUDE.md as the running project diary.

Known Open Architectural Questions

These questions are not fully resolved unless current context says otherwise.

Gist Deprecation Timing

Once Supabase is primary, decide whether Gist should:

Be removed immediately
Run in parallel temporarily
Stay as a power-user export forever

This affects whether Gist UI/settings are removed quickly or slowly.

Geocoding Strategy

Entries currently store address strings, not lat/lng.

A map-based archive view requires deciding whether to:

Geocode on save
Geocode on first map render
Skip map view
Auth Nudge Strategy

Header sign-in button is always available.

Planned contextual nudge:

Persistent “sync your archive” banner on Archivo when unauthenticated

Do not introduce more interruptive auth gates unless explicitly decided.

Known Issues To Check Current Context For

These may already be fixed. Check CONTEXT.md / current code before acting.

'spotted' status cosmetic mismatch
Photo delete button non-functional
Photo grid inner corners not rounded at intersections
Placeholder avatar in photo grids for URL-imported entries
+null display in contact field
gistPush() only firing on initial create and profile save
Mobile toast not fully disappearing after appearing once
Hero image not extending to rightmost screen edge
Things Not To Do
Do not rewrite large parts of the app unless explicitly asked.
Do not bundle multiple features into one change.
Do not make product/design decisions silently.
Do not claim runtime verification from static inspection.
Do not append ?v= to JS module URLs.
Do not access localStorage directly outside src/store.js.
Do not expose API keys in browser code.
Do not treat backup monolith files as current source.
Do not add new architectural patterns unless necessary.
Do not allow Claude Code enthusiasm to carry work past a verification gap.