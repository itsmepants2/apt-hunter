// src/sync.js — Gist sync: pull, push, token/ID helpers
// NOTE: sync.js ↔ archive.js have a mutual import (circular). This is safe
// because every cross-module call occurs inside a function body — never at
// module evaluation time — so both modules are fully initialised before any
// exported function is invoked.
import { store, loadArchive, mergeArchives } from './archive.js';
import { renderArchive, renderScorecard } from './ui.js';
import {
  ghListGists,
  ghGetGist,
  ghCreateGist,
  ghUpdateGist,
} from './services.js';

const GIST_FILE = 'apt-hunter-archive.json';

export function getGhToken() { return store.get('apt_hunter_gh_token') || ''; }
export function getGistId()  { return store.get('apt_hunter_gist_id')  || ''; }

export function updateSyncStatus() {
  const syncStatus = document.getElementById('syncStatus');
  const token = getGhToken();
  const gistId = getGistId();
  if (!token) {
    syncStatus.textContent = 'Sin token — sincronización desactivada.';
  } else if (!gistId) {
    syncStatus.textContent = 'Token guardado. Gist se creará al guardar la primera propiedad.';
  } else {
    syncStatus.textContent = `Gist: ${gistId.slice(0, 10)}…`;
  }
}

export async function discoverGist() {
  const syncStatus = document.getElementById('syncStatus');
  const token = getGhToken();
  if (!token || getGistId()) return; // already have an ID
  syncStatus.textContent = 'Buscando Gist existente…';
  try {
    let page = 1;
    while (true) {
      const gists = await ghListGists(token, page);
      if (!gists.length) break;
      const match = gists.find(g => g.files && g.files[GIST_FILE]);
      if (match) {
        store.set('apt_hunter_gist_id', match.id);
        updateSyncStatus();
        await gistPull();
        return;
      }
      if (gists.length < 100) break;
      page++;
    }
    syncStatus.textContent = 'No se encontró Gist. Se creará al guardar la primera propiedad.';
  } catch (e) {
    syncStatus.textContent = `Error al buscar Gist: ${e.message}`;
  }
}

export async function gistPull() {
  const syncStatus = document.getElementById('syncStatus');
  const token = getGhToken();
  const gistId = getGistId();
  if (!token || !gistId) return;
  syncStatus.textContent = 'Sincronizando…';
  try {
    const data = await ghGetGist(token, gistId);
    const content = data.files?.[GIST_FILE]?.content;
    if (!content) { syncStatus.textContent = 'Gist vacío.'; return; }
    const parsed = JSON.parse(content);
    // Back-compat: old Gists stored a bare array; new format is { listings, searchProfile }
    const remoteListings = Array.isArray(parsed) ? parsed : (parsed.listings ?? []);
    if (!Array.isArray(parsed) && parsed.searchProfile !== undefined) {
      store.set('searchProfile', JSON.stringify(parsed.searchProfile));
    }
    const merged = mergeArchives(loadArchive(), remoteListings);
    store.set('apt_hunter_archive', JSON.stringify(merged));
    renderArchive();
    renderScorecard();
    syncStatus.textContent = `Sincronizado · ${new Date().toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})}`;
  } catch (e) {
    syncStatus.textContent = `Error al sincronizar: ${e.message}`;
  }
}

export async function gistPush() {
  const syncStatus = document.getElementById('syncStatus');
  const token = getGhToken();
  if (!token) return;
  try {
    let gistId = getGistId();

    // Pull first to avoid overwriting the other device's new entries
    if (gistId) {
      try {
        const data = await ghGetGist(token, gistId);
        const content = data.files?.[GIST_FILE]?.content;
        if (content) {
          const parsed = JSON.parse(content);
          const remoteListings = Array.isArray(parsed) ? parsed : (parsed.listings ?? []);
          const merged = mergeArchives(loadArchive(), remoteListings);
          store.set('apt_hunter_archive', JSON.stringify(merged));
        }
      } catch { /* ignore pull errors — push what we have */ }
    }

    const searchProfile = (() => {
      try { return JSON.parse(store.get('searchProfile') || 'null'); } catch { return null; }
    })();
    const archiveJson = JSON.stringify({ listings: loadArchive(), searchProfile });

    if (!gistId) {
      const created = await ghCreateGist(token, 'Apt Hunter archive', GIST_FILE, archiveJson);
      store.set('apt_hunter_gist_id', created.id);
      updateSyncStatus();
    } else {
      await ghUpdateGist(token, gistId, GIST_FILE, archiveJson);
    }
    syncStatus.textContent = `Sincronizado · ${new Date().toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})}`;
  } catch (e) {
    syncStatus.textContent = `Error al guardar en Gist: ${e.message}`;
  }
}
