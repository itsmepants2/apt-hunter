// src/archive.js — archive data operations, merge logic, gallery mode
// NOTE: archive.js ↔ sync.js have a mutual import (circular). This is safe
// because every cross-module call occurs inside a function body — never at
// module evaluation time — so both modules are fully initialised before any
// exported function is invoked.
import { gistPull, getGhToken, getGistId } from './sync.js';
import { showToast, renderArchive, renderScorecard, renderGallery } from './ui.js';
import { loadEntries, saveEntry, deleteEntry } from './db.js';

// ── Constants ─────────────────────────────────────────────────────────────
export const STATUSES = [
  { key: 'contacted', label: 'Contactado',  emoji: '📞' },
  { key: 'toured',    label: 'Visitado',    emoji: '🚪' },
  { key: 'decided',   label: 'Decidido',    emoji: '✓'  },
];

// ── Storage helper (fails gracefully in sandboxed iframes) ────────────────
export const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } }
};

// ── Archive: filter state ─────────────────────────────────────────────────
export const archiveFilter = { sort: '', colonia: '', bedrooms: '', tipo: '' };

// ── Supabase entries cache (populated in background on module load) ────────
let _dbCache = null;
loadEntries().then(rows => { if (rows.length > 0) _dbCache = rows; }).catch(() => {});

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
  if (_dbCache !== null) return _dbCache;
  try { return JSON.parse(store.get('apt_hunter_archive') || '[]'); }
  catch { return []; }
}

export function saveToArchiveDirect(result, thumbnail) {
  const archive = loadArchive();
  const entry = {
    id: Date.now() + Math.random(),
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
    priceMxn: '', sizeSqm: '', neighborhood: '', amenities: '', extraPhotos: []
  };
  archive.unshift(entry);
  store.set('apt_hunter_archive', JSON.stringify(archive));
  saveEntry(entry);
  renderScorecard();
  return true;
}

export function saveArchiveField(id, key, value) {
  const archive = loadArchive();
  const idx = archive.findIndex(e => e.id === id);
  if (idx !== -1) {
    archive[idx][key] = value;
    store.set('apt_hunter_archive', JSON.stringify(archive));
    saveEntry(archive[idx]);
  }
}

export function saveArchivePhotoAdd(id, thumbDataUrl) {
  const archive = loadArchive();
  const idx = archive.findIndex(e => e.id === id);
  if (idx !== -1) {
    if (!archive[idx].extraPhotos) archive[idx].extraPhotos = [];
    archive[idx].extraPhotos.push(thumbDataUrl);
    store.set('apt_hunter_archive', JSON.stringify(archive));
    saveEntry(archive[idx]);
  }
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

// ── Gallery mode ───────────────────────────────────────────────────────────
export async function initGalleryMode(propertyId) {
  const galleryView = document.getElementById('galleryView');
  document.getElementById('appHeader').style.display = 'none';
  document.getElementById('topPanel').style.display = 'none';
  document.getElementById('tabsBottom').style.display = 'none';
  document.getElementById('scanView').style.display = 'none';
  document.getElementById('archiveView').style.display = 'none';
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
