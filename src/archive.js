// src/archive.js — archive data operations, merge logic, gallery mode
// NOTE: archive.js ↔ sync.js have a mutual import (circular). This is safe
// because every cross-module call occurs inside a function body — never at
// module evaluation time — so both modules are fully initialised before any
// exported function is invoked.
import { gistPull, getGhToken, getGistId } from './sync.js';
import { showToast, renderArchive, renderScorecard, renderGallery } from './ui.js';
import { loadEntries, saveEntry, deleteEntry } from './db.js';
import { getSession } from './auth.js';
import { store } from './store.js';

// ── Constants ─────────────────────────────────────────────────────────────
export const STATUSES = [
  { key: 'contacted', label: 'Contactado',  emoji: '📞' },
  { key: 'toured',    label: 'Visitado',    emoji: '🚪' },
  { key: 'decided',   label: 'Decidido',    emoji: '✓'  },
];

// ── Storage helper (fails gracefully in sandboxed iframes) ────────────────
export { store } from './store.js';

// ── Archive: filter state ─────────────────────────────────────────────────
export const archiveFilter = { sort: '', colonia: '', bedrooms: '', tipo: '' };

// ── Supabase entries cache ─────────────────────────────────────────────────
// _dbCache shadows the signed-in user's Supabase rows. Refreshed on sign-in
// (cold-start or same-tab) via refreshDbCache. Cleared on sign-out so the
// signed-out render can't read another user's data.
let _dbCache = null;

export async function refreshDbCache() {
  const session = await getSession();
  if (!session) { _dbCache = null; return; }
  const rows = await loadEntries();
  _dbCache = rows.length > 0 ? rows : null;
}

export function clearDbCache() {
  _dbCache = null;
}

// On sign-out, drop synced/account-private entries from localStorage and keep
// only entries the local device hasn't successfully uploaded yet (pendingSync).
// Account-private data lives on Supabase and re-hydrates via refreshDbCache on
// next sign-in.
export function pruneSyncedFromLocal() {
  const raw = store.get('apt_hunter_archive');
  if (!raw) return;
  let archive;
  try { archive = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(archive)) return;
  const pending = archive.filter(e => e.pendingSync === true);
  store.set('apt_hunter_archive', JSON.stringify(pending));
}

// ── Exchange rate: MXN → USD ──────────────────────────────────────────────
export let mxnToUsdRate = null;
fetch('https://apt-hunter-proxy.stevebryant.workers.dev/fx')
  .then(r => r.json())
  .then(d => {
    mxnToUsdRate = d.rates?.USD || null;
    renderArchive();
  })
  .catch(() => {});

// ── Archive: persistence ──────────────────────────────────────────────────
export function loadArchive() {
  // Cache only shadows localStorage when it holds authoritative non-empty
  // Supabase data — match the write side at refreshDbCache's `rows.length > 0` guard.
  if (_dbCache !== null && _dbCache.length > 0) return _dbCache;
  try { return JSON.parse(store.get('apt_hunter_archive') || '[]'); }
  catch { return []; }
}

export async function saveToArchiveDirect(result, thumbnail) {
  const archive = loadArchive();
  const entry = {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    thumbnail:        thumbnail || null,
    address:          result.address   || null,
    type:             result.type      || null,
    price:            result.price     || null,
    extras:           result.extras    || null,
    allPhones:        (result.phones || []).map(p => p.number || p),
    contactedNumber:  null,
    contactedDisplay: null,
    whatsappMessage:  result.whatsapp_message || '',
    status: 'spotted', notes: '', bedrooms: '', bathrooms: '', parking: '',
    priceMxn: '', sizeSqm: '', neighborhood: '', amenities: '', extraPhotos: [],
    pendingSync: true,
  };
  archive.unshift(entry);
  store.set('apt_hunter_archive', JSON.stringify(archive));
  const ok = await saveEntry(entry);
  if (ok) {
    delete entry.pendingSync;
    store.set('apt_hunter_archive', JSON.stringify(archive));
  }
  renderScorecard();
  return true;
}

export async function saveArchiveField(id, key, value) {
  const archive = loadArchive();
  const idx = archive.findIndex(e => e.id === id);
  if (idx === -1) return;
  archive[idx][key] = value;
  store.set('apt_hunter_archive', JSON.stringify(archive));
  const ok = await saveEntry(archive[idx]);
  if (ok) delete archive[idx].pendingSync;
  else archive[idx].pendingSync = true;
  store.set('apt_hunter_archive', JSON.stringify(archive));
}

export async function saveArchivePhotoAdd(id, thumbDataUrl) {
  const archive = loadArchive();
  const idx = archive.findIndex(e => e.id === id);
  if (idx === -1) return;
  if (!archive[idx].extraPhotos) archive[idx].extraPhotos = [];
  archive[idx].extraPhotos.push(thumbDataUrl);
  store.set('apt_hunter_archive', JSON.stringify(archive));
  const ok = await saveEntry(archive[idx]);
  if (ok) delete archive[idx].pendingSync;
  else archive[idx].pendingSync = true;
  store.set('apt_hunter_archive', JSON.stringify(archive));
}

export function deleteArchiveEntry(id) {
  const archive = loadArchive().filter(e => e.id !== id);
  store.set('apt_hunter_archive', JSON.stringify(archive));
  deleteEntry(id);
  renderArchive();
  renderScorecard();
}

export function parsePriceMxn(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return isNaN(n) || n === 0 ? null : n;
}

// ── File utilities ─────────────────────────────────────────────────────────
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ── Merge helper ──────────────────────────────────────────────────────────
export function mergeArchives(local, remote) {
  const byId = {};
  remote.forEach(e => { byId[e.id] = e; });
  local.forEach(e  => { byId[e.id] = e; });
  return Object.values(byId).sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ── localStorage → Supabase migration / sync retry ────────────────────────
// Runs on every sign-in. Uploads pending-sync entries, clears their flag on
// success, leaves them flagged on failure for the next attempt. Always rewrites
// the merged offline cache so refresh-while-signed-in still has data to render.
// _migrationPromise dedupes within a session epoch (cleared on sign-out via
// resetMigrationPromise so the next sign-in gets a fresh attempt).
let _migrationPromise = null;

export function resetMigrationPromise() {
  _migrationPromise = null;
}

export function migrateLocalToSupabase() {
  if (_migrationPromise) return _migrationPromise.then(() => 0);
  _migrationPromise = (async () => {
    const raw = store.get('apt_hunter_archive');
    let local;
    try { local = raw ? JSON.parse(raw) : []; } catch { local = []; }
    if (!Array.isArray(local)) local = [];

    const remote = await loadEntries();
    const remoteIds = new Set(remote.map(e => e.id));

    let migrated = 0;
    for (const entry of local) {
      if (remoteIds.has(entry.id)) {
        delete entry.pendingSync;
        continue;
      }
      const ok = await saveEntry(entry);
      if (ok) {
        migrated++;
        delete entry.pendingSync;
      } else {
        entry.pendingSync = true;
      }
    }

    const merged = mergeArchives(local, remote);
    store.set('apt_hunter_archive', JSON.stringify(merged));
    _dbCache = merged.length > 0 ? merged : null;
    return migrated;
  })();
  return _migrationPromise;
}

// ── Gallery mode ───────────────────────────────────────────────────────────
export async function initGalleryMode(propertyId) {
  const galleryView = document.getElementById('galleryView');
  document.getElementById('appHeader').style.display = 'none';
  document.getElementById('tabsBottom').style.display = 'none';
  galleryView.style.display = 'block';
  galleryView.innerHTML = '<p style="text-align:center;padding:48px 0;color:var(--text-muted);">Cargando…</p>';

  // Try localStorage first
  let entry = loadArchive().find(e => String(e.id) === String(propertyId));

  // Pull from Gist if not found locally
  if (!entry && getGhToken() && getGistId()) {
    await gistPull();
    entry = loadArchive().find(e => String(e.id) === String(propertyId));
  }

  if (!entry) {
    galleryView.innerHTML = '<div style="text-align:center;padding:48px 0;color:var(--text-muted);">'
      + '📭<br><br>Propiedad no encontrada.<br>'
      + '<small>Abre primero el archivo en este dispositivo para sincronizar.</small></div>';
    return;
  }

  renderGallery(entry);
}
