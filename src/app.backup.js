// src/app.js — app state, init, event wiring, gist sync, analyze logic
import {
  callAnthropicMessages,
  extractListingFromText,
  fetchUrlViaWorker,
  ghListGists,
  ghGetGist,
  ghCreateGist,
  ghUpdateGist,
} from './services.js';

import {
  renderResults,
  renderUrlPreview,
  clearUrlPreview,
  renderScorecard,
  renderArchive,
  renderGallery,
  setLoading,
  showError,
  hideError,
  showToast,
  generateThumbnail,
  buildPhoneItem,
  htmlToText,
} from './ui.js';

// ── State ──────────────────────────────────────────────────────────────────
let imageBase64 = null;
let imageMime = 'image/jpeg';
let currentResult = null;
let currentThumbnail = null;
let urlPreviewData = null;  // {url, extracted, photos} — set by analyzeUrl()

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
export let mxnToUsdRate = null;

// ── Archive: persistence ──────────────────────────────────────────────────
export function loadArchive() {
  try { return JSON.parse(store.get('apt_hunter_archive') || '[]'); }
  catch { return []; }
}

export function saveToArchive(waNumber, displayNumber) {
  if (!currentResult) return;
  const archive = loadArchive();
  const entry = {
    id: Date.now(),
    date: new Date().toISOString(),
    thumbnail: currentThumbnail || null,
    address:   currentResult.address || null,
    type:      currentResult.type    || null,
    price:     currentResult.price   || null,
    extras:    currentResult.extras  || null,
    allPhones: (currentResult.phones || []).map(p => p.number || p),
    contactedNumber:  waNumber,
    contactedDisplay: displayNumber,
    whatsappMessage:  currentResult.whatsapp_message || '',
    status:       'spotted',
    notes:        '',
    bedrooms:     '',
    bathrooms:    '',
    parking:      '',
    priceMxn:     '',
    sizeSqm:      '',
    neighborhood: '',
    amenities:    '',
    extraPhotos:  []
  };
  archive.unshift(entry);
  store.set('apt_hunter_archive', JSON.stringify(archive));
  showToast('💾 Guardado en archivo ✓');
  gistPush();
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
  gistPush();
  renderScorecard();
  return true;
}

export function saveArchiveField(id, key, value) {
  const archive = loadArchive();
  const idx = archive.findIndex(e => e.id === id);
  if (idx !== -1) {
    archive[idx][key] = value;
    store.set('apt_hunter_archive', JSON.stringify(archive));
    gistPush();
  }
}

export function saveArchivePhotoAdd(id, thumbDataUrl) {
  const archive = loadArchive();
  const idx = archive.findIndex(e => e.id === id);
  if (idx !== -1) {
    if (!archive[idx].extraPhotos) archive[idx].extraPhotos = [];
    archive[idx].extraPhotos.push(thumbDataUrl);
    store.set('apt_hunter_archive', JSON.stringify(archive));
    gistPush();
  }
}

export function deleteArchiveEntry(id) {
  const archive = loadArchive().filter(e => e.id !== id);
  store.set('apt_hunter_archive', JSON.stringify(archive));
  gistPush();
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

// ── Gist sync ─────────────────────────────────────────────────────────────
const GIST_FILE = 'apt-hunter-archive.json';

export function getGhToken() { return store.get('apt_hunter_gh_token') || ''; }
export function getGistId()  { return store.get('apt_hunter_gist_id')  || ''; }

function updateSyncStatus() {
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

function mergeArchives(local, remote) {
  const byId = {};
  remote.forEach(e => { byId[e.id] = e; });
  local.forEach(e  => { byId[e.id] = e; });
  return Object.values(byId).sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function discoverGist() {
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

// ── Tab switching ──────────────────────────────────────────────────────────
export function switchTab(name) {
  const scanView    = document.getElementById('scanView');
  const archiveView = document.getElementById('archiveView');
  const topPanel    = document.getElementById('topPanel');

  // Sync active state on both tab bars
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });

  // Show/hide tab content views
  const perfilView  = document.getElementById('perfilView');
  scanView.style.display    = name === 'scan'    ? '' : 'none';
  archiveView.style.display = name === 'archive' ? '' : 'none';
  perfilView.style.display  = name === 'perfil'  ? '' : 'none';

  // Top panel: always visible on desktop (CSS handles it);
  // on mobile it shows only when scan tab is active
  topPanel.classList.toggle('tab-active', name === 'scan');

  if (name === 'archive') {
    renderArchive();
    gistPull();
  }
  if (name === 'perfil') renderPerfil();

  renderScorecard();
}

// ── Search Profile ─────────────────────────────────────────────────────────

const AMENIDADES_LABELS = {
  elevador:     'Elevador',
  terraza:      'Terraza',
  seguridad24h: 'Seguridad 24h',
  gimnasio:     'Gimnasio',
  alberca:      'Alberca',
  mascotas:     'Mascotas',
  amueblado:    'Amueblado',
};

const PERFIL_DEFAULT = {
  recamarasMin: 2,
  banosMin: 1,
  estacionamientoMin: 0,
  precioMax: null,
  tamanoMin: null,
  coloniasPreferidas: [],
  amenidades: { elevador: null, terraza: null, seguridad24h: null, gimnasio: null, alberca: null, mascotas: null, amueblado: null },
};

function renderColoniasChips(list) {
  const container = document.getElementById('coloniasChips');
  container.innerHTML = '';
  list.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'colonia-chip';
    chip.dataset.name = name;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    chip.appendChild(nameSpan);
    const x = document.createElement('button');
    x.className = 'chip-remove';
    x.textContent = '×';
    x.setAttribute('aria-label', `Eliminar ${name}`);
    x.addEventListener('click', () => chip.remove());
    chip.appendChild(x);
    container.appendChild(chip);
  });
}

function renderPerfil() {
  const raw = store.get('searchProfile');
  const saved = raw ? JSON.parse(raw) : {};
  const p = { ...PERFIL_DEFAULT, ...saved };
  p.amenidades = { ...PERFIL_DEFAULT.amenidades, ...(p.amenidades || {}) };

  document.getElementById('perfilValRecamaras').textContent = p.recamarasMin ?? 2;
  document.getElementById('perfilValBanos').textContent     = p.banosMin ?? 1;
  document.getElementById('perfilValEst').textContent       = p.estacionamientoMin ?? 0;
  document.getElementById('perfilPrecioMax').value          = p.precioMax != null ? p.precioMax : '';
  document.getElementById('perfilTamanoMin').value          = p.tamanoMin != null ? p.tamanoMin : '';

  renderColoniasChips(p.coloniasPreferidas || []);

  const amenContainer = document.getElementById('amenidadesRows');
  amenContainer.innerHTML = '';
  Object.entries(AMENIDADES_LABELS).forEach(([key, label]) => {
    const val = p.amenidades[key]; // null | 'want' | 'must'
    const row = document.createElement('div');
    row.className = 'amenidad-row';
    row.dataset.key = key;

    const lbl = document.createElement('span');
    lbl.className = 'amenidad-label';
    lbl.textContent = label;

    const toggle = document.createElement('div');
    toggle.className = 'tri-toggle';

    [['null', '—'], ['want', 'Quiero'], ['must', 'Imprescindible']].forEach(([v, text]) => {
      const btn = document.createElement('button');
      const isActive = (val === null && v === 'null') || (val === v);
      btn.className = 'tri-btn' + (isActive ? ' active' : '');
      btn.dataset.val = v;
      btn.textContent = text;
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('.tri-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      toggle.appendChild(btn);
    });

    row.appendChild(lbl);
    row.appendChild(toggle);
    amenContainer.appendChild(row);
  });
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

// ── CSV export ─────────────────────────────────────────────────────────────
function exportCSV() {
  const archive = loadArchive();
  if (!archive.length) { showToast('No hay entradas para exportar'); return; }

  const headers = ['Fecha','Estado','Tipo','Dirección/Detalles','Dirección','Precio letrero','Precio (MXN)','Precio (USD)','Tamaño (m²)','Tamaño (ft²)','Precio/m²','Precio/ft²','Colonia','Números encontrados','Número contactado','Recámaras','Baños','Estacionamientos','Amenidades','Notas','Fotos adicionales'];
  const statusLabel = k => STATUSES.find(s => s.key === k)?.label || k || '';
  const rows = archive.map(e => {
    const price  = parsePriceMxn(e.priceMxn);
    const sqmVal = parseFloat(e.sizeSqm);
    const sqft   = (sqmVal > 0) ? Math.round(sqmVal * 10.764) : '';
    const ppm2   = (price && sqmVal > 0) ? Math.round(price / sqmVal) : '';
    const ppsqft = (price && sqft)        ? Math.round(price / sqft)   : '';
    const priceUsd = (price && mxnToUsdRate) ? Math.round(price * mxnToUsdRate) : '';
    return [
      new Date(e.date).toLocaleString('es-MX'),
      statusLabel(e.status || 'spotted'),
      e.type    || '',
      [e.address, e.extras].filter(Boolean).join(' · '),
      e.streetAddress   || '',
      e.price           || '',
      e.priceMxn        || '',
      priceUsd          || '',
      e.sizeSqm         || '',
      sqft              || '',
      ppm2              || '',
      ppsqft            || '',
      e.neighborhood    || '',
      (e.allPhones || []).join('; '),
      e.contactedNumber || '',
      e.bedrooms        || '',
      e.bathrooms       || '',
      e.parking         || '',
      e.amenities       || '',
      e.notes           || '',
      (e.extraPhotos || []).length || '',
    ];
  });

  const csv = [headers, ...rows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `apt-hunter-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Shared system prompt ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un asistente experto en analizar letreros de apartamentos y propiedades en renta o venta.
Extrae toda la información relevante del letrero en la imagen y devuelve ÚNICAMENTE un objeto JSON con exactamente esta estructura:
{
  "phones": [
    {
      "number": "dígitos del número según las dos reglas siguientes",
      "position": "descripción de dónde aparece el número en el letrero, ej: 'texto grande', 'parte superior', 'parte inferior', 'texto pequeño'",
      "label": "etiqueta o nombre que acompaña al número si existe, ej: 'Ventas', 'Info', 'WhatsApp', 'Cel', o null si no hay",
      "countryCode": "ver reglas abajo"
    }
  ],
  "type": "Renta | Venta | Renta y Venta | Desconocido",
  "price": "precio si está visible, o null",
  "rooms": "número de habitaciones si está visible, o null",
  "address": "dirección o ubicación si está visible, o null",
  "extras": "otras características relevantes (amueblado, estacionamiento, etc.), o null",
  "contact_name": "nombre del contacto o agencia si aparece, o null",
  "whatsapp_message": "mensaje corto y natural en español para enviar por WhatsApp preguntando por el inmueble. Máx 2 oraciones. Menciona el tipo (renta/venta), precio si está disponible, y que te interesa más información."
}
REGLAS ESTRICTAS para los campos de cada teléfono:

REGLA A — 'countryCode': Solo ponlo si el letrero literalmente escribe un prefijo internacional con símbolo + o con "00" antes del número (ejemplos que SÍ cuentan: "+52", "+1", "0052", "001 55…"). Si el número en el letrero NO tiene + ni "00" antes, countryCode SIEMPRE es null, sin excepción. Los códigos de área (55, 33, 81, etc.) NO son códigos de país aunque coincidan con el código de algún país.

REGLA B — 'number':
  • Si countryCode NO es null: escribe SOLO los dígitos que vienen DESPUÉS del prefijo internacional. Ejemplo: letrero dice "+52 55 7919 0328" → countryCode="52", number="5579190328".
  • Si countryCode es null: copia TODOS los dígitos del número exactamente como aparecen, sin quitar ni agregar nada. Ejemplo: letrero dice "55 7919 0328" → countryCode=null, number="5579190328".

Si no hay números de teléfono visibles, devuelve phones como array vacío [].
Solo responde con el JSON, sin texto adicional.`;

// Resizes and compresses a dataURL so it fits within the API's ~5 MB base64 limit.
// Claude vision works well up to 1568 px on the longest side.
function compressForApi(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1568;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width  = Math.round(img.width  * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl); // fall back to original on error
    img.src = dataUrl;
  });
}

// Calls the API and returns the parsed result object. Throws on error.
async function analyzeImage(base64, mime) {
  // Compress before sending — large photos (>~3.75 MB) exceed the API limit
  const compressed = await compressForApi(`data:${mime};base64,${base64}`);
  const commaIdx = compressed.indexOf(',');
  base64 = compressed.slice(commaIdx + 1);
  mime   = 'image/jpeg';
  const payload = {
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
      { type: 'text',  text: 'Analiza este letrero de propiedad y extrae la información solicitada en JSON.' }
    ]}]
  };
  const data = await callAnthropicMessages(payload);
  const rawText = data?.content?.[0]?.text || '';
  const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) || rawText.match(/```\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : rawText;
  return JSON.parse(jsonStr.trim());
}

async function analyze() {
  if (!imageBase64) return showError('Primero sube o toma una foto.');

  setLoading(true);
  hideError();
  document.getElementById('results').classList.remove('visible');

  try {
    const result = await analyzeImage(imageBase64, imageMime);
    currentResult = result;
    renderResults(result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      showError('No se pudo parsear la respuesta de la API. Intenta de nuevo.');
    } else {
      showError(`Error: ${err.message}`);
    }
  } finally {
    setLoading(false);
  }
}

// ── URL import ─────────────────────────────────────────────────────────────

// Extract candidate property photo URLs from raw HTML.
function extractPhotosFromHtml(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const photos = [];
  const seen = new Set();

  function add(src) {
    if (!src) return;
    try {
      const abs = new URL(src, baseUrl).href;
      if (!seen.has(abs) && (abs.startsWith('http://') || abs.startsWith('https://'))) {
        seen.add(abs);
        photos.push(abs);
      }
    } catch { /* skip malformed URLs */ }
  }

  // 1 — og:image meta tags (most reliable on listing portals)
  doc.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"]')
    .forEach(el => add(el.getAttribute('content')));

  // 2 — JSON-LD image arrays
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
    try {
      const objs = [].concat(JSON.parse(el.textContent));
      objs.forEach(function walk(obj) {
        if (!obj || typeof obj !== 'object') return;
        [].concat(obj.image || []).forEach(img =>
          add(typeof img === 'string' ? img : (img.url || img.contentUrl)));
        if (obj['@graph']) [].concat(obj['@graph']).forEach(walk);
      });
    } catch { /* ignore malformed JSON-LD */ }
  });

  // 3 — <img> tags with declared large dimensions (fallback if portal has no meta)
  if (photos.length < 3) {
    doc.querySelectorAll('img[src]').forEach(el => {
      const src = el.getAttribute('src') || '';
      if (src.startsWith('data:')) return;
      const w = parseInt(el.getAttribute('width')  || '0');
      const h = parseInt(el.getAttribute('height') || '0');
      if ((w > 0 && w < 120) || (h > 0 && h < 120)) return;
      if (/logo|icon|sprite|placeholder|blank|pixel|track/i.test(src)) return;
      if (w >= 200 || h >= 200 || (!w && !h)) add(src);
    });
  }

  return photos.slice(0, 15);
}

async function analyzeUrl() {
  const urlImportInput  = document.getElementById('urlImportInput');
  const urlImportStatus = document.getElementById('urlImportStatus');
  const btnAnalyzeUrl   = document.getElementById('btnAnalyzeUrl');
  const url = urlImportInput.value.trim();
  if (!url) return;
  try { new URL(url); } catch {
    urlImportStatus.textContent = 'URL no válida';
    urlImportStatus.className = 'url-import-status err';
    return;
  }

  btnAnalyzeUrl.disabled = true;
  btnAnalyzeUrl.textContent = '…';
  urlImportStatus.className = 'url-import-status';
  urlImportStatus.textContent = 'Obteniendo página…';
  clearUrlPreview();
  urlPreviewData = null;

  try {
    const html = await fetchUrlViaWorker(url);
    urlImportStatus.textContent = 'Extrayendo datos con Claude…';
    const [extracted, photos] = await Promise.all([
      extractListingFromText(htmlToText(html)),
      Promise.resolve(extractPhotosFromHtml(html, url)),
    ]);
    urlPreviewData = { url, extracted, photos };
    renderUrlPreview(urlPreviewData);
    urlImportStatus.textContent = '';
  } catch (e) {
    urlImportStatus.textContent = `Error: ${e.message}`;
    urlImportStatus.className = 'url-import-status err';
  } finally {
    btnAnalyzeUrl.disabled = false;
    btnAnalyzeUrl.textContent = 'Analizar';
  }
}

// ── File handling ──────────────────────────────────────────────────────────
function handleFile(file) {
  const captureZone = document.getElementById('captureZone');
  const btnClear    = document.getElementById('btnClear');
  const btnAnalyze  = document.getElementById('btnAnalyze');
  const resultsEl   = document.getElementById('results');
  const fileCamera  = document.getElementById('fileCamera');
  const fileUpload  = document.getElementById('fileUpload');

  if (!file || !file.type.startsWith('image/')) return showError('Selecciona una imagen válida.');
  imageMime = file.type;
  const reader = new FileReader();
  reader.onload = ev => {
    const dataUrl = ev.target.result;
    imageBase64 = dataUrl.split(',')[1];
    generateThumbnail(dataUrl).then(thumb => { currentThumbnail = thumb; });
    // Show preview
    captureZone.innerHTML = `
      <img src="${dataUrl}" alt="preview">
      <div class="capture-overlay">
        <div class="capture-icon">🔄</div>
        <div style="color:#fff;font-size:0.85rem;">Cambiar foto</div>
      </div>`;
    captureZone.classList.add('has-image');
    btnClear.style.display = '';
    btnAnalyze.disabled = false;
    hideError();
    resultsEl.classList.remove('visible');
  };
  reader.readAsDataURL(file);
  // Reset file inputs so same file can be reselected
  fileCamera.value = '';
  fileUpload.value = '';
}

function clearImage() {
  const captureZone = document.getElementById('captureZone');
  const btnClear    = document.getElementById('btnClear');
  const btnAnalyze  = document.getElementById('btnAnalyze');
  const resultsEl   = document.getElementById('results');

  imageBase64 = null;
  currentThumbnail = null;
  currentResult = null;
  captureZone.innerHTML = `
    <div class="capture-icon">📷</div>
    <div class="capture-hint">Toca para subir foto</div>
    <div class="capture-overlay">
      <div class="capture-icon">🔄</div>
      <div style="color:#fff;font-size:0.85rem;">Cambiar foto</div>
    </div>`;
  captureZone.classList.remove('has-image');
  btnClear.style.display = 'none';
  btnAnalyze.disabled = true;
  resultsEl.classList.remove('visible');
  hideError();
}

// ── Bulk upload ─────────────────────────────────────────────────────────────
let bulkFiles = [];
let dropHandled = false;

const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif|tiff?)$/i;
function isLikelyImage(f) {
  const t = (f.type || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  if (!t) return IMAGE_EXTS.test(f.name || '');
  return false;
}

function updateBulkSelection(files) {
  const bulkCount        = document.getElementById('bulkCount');
  const bulkProgressWrap = document.getElementById('bulkProgressWrap');
  const bulkProgressFill = document.getElementById('bulkProgressFill');
  const bulkStatus       = document.getElementById('bulkStatus');
  const bulkFileList     = document.getElementById('bulkFileList');
  const btnBulkRun       = document.getElementById('btnBulkRun');

  const all  = Array.from(files);
  const imgs = all.filter(isLikelyImage);
  const skip = all.filter(f => !isLikelyImage(f));
  if (!all.length) return;
  bulkFiles = imgs;
  const total = all.length;
  bulkCount.textContent = `${total} archivo${total !== 1 ? 's' : ''} seleccionado${total !== 1 ? 's' : ''}${skip.length ? ` (${skip.length} no compatibles)` : ''}`;
  bulkCount.style.display = '';
  btnBulkRun.disabled = imgs.length === 0;
  // Render all file rows — images as pending, others as skipped
  bulkFileList.innerHTML = '';
  imgs.forEach(f => {
    const row = document.createElement('div');
    row.className = 'bulk-file-item fi-pending';
    row.id = `bfi-${CSS.escape(f.name + f.size)}`;
    row.innerHTML = `<span class="fi-icon">○</span><span class="fi-name">${escHtml(f.name)}</span>`;
    bulkFileList.appendChild(row);
  });
  skip.forEach(f => {
    const row = document.createElement('div');
    row.className = 'bulk-file-item fi-err';
    row.innerHTML = `<span class="fi-icon">⊘</span><span class="fi-name">${escHtml(f.name)}<span style="opacity:0.6"> — no es imagen</span></span>`;
    bulkFileList.appendChild(row);
  });
  bulkProgressWrap.style.display = '';
  bulkProgressFill.style.width = '0%';
  bulkStatus.textContent = imgs.length ? 'Listo para analizar.' : 'No se encontraron imágenes compatibles.';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init (runs after DOM ready — module scripts are deferred by default) ────
(function init() {
  // ── Element refs ──
  const captureZone       = document.getElementById('captureZone');
  const btnClear          = document.getElementById('btnClear');
  const fileCamera        = document.getElementById('fileCamera');
  const fileUpload        = document.getElementById('fileUpload');
  const btnAnalyze        = document.getElementById('btnAnalyze');
  const btnCsv            = document.getElementById('btnCsv');
  const ghTokenEl         = document.getElementById('ghToken');
  const saveGhTokenBtn    = document.getElementById('saveGhToken');
  const btnSync           = document.getElementById('btnSync');
  const btnSettings       = document.getElementById('btnSettings');
  const settingsPanel     = document.getElementById('settingsPanel');
  const settingsBackdrop  = document.getElementById('settingsBackdrop');
  const btnSettingsClose  = document.getElementById('btnSettingsClose');
  const scorecardToggle   = document.getElementById('scorecardToggle');
  const scorecardBody     = document.getElementById('scorecardBody');
  const urlImportInput    = document.getElementById('urlImportInput');
  const btnAnalyzeUrl     = document.getElementById('btnAnalyzeUrl');
  const bulkInput         = document.getElementById('bulkInput');
  const bulkDrop          = document.getElementById('bulkDrop');
  const btnBulkRun        = document.getElementById('btnBulkRun');
  const bulkProgressFill  = document.getElementById('bulkProgressFill');
  const bulkStatus        = document.getElementById('bulkStatus');
  const bulkFileList      = document.getElementById('bulkFileList');

  // ── Photo capture ──
  btnClear.addEventListener('click', clearImage);
  fileCamera.addEventListener('change', e => handleFile(e.target.files[0]));
  fileUpload.addEventListener('change', e => handleFile(e.target.files[0]));

  // Drag & drop on capture zone
  captureZone.addEventListener('dragover', e => { e.preventDefault(); captureZone.style.borderColor = '#2C3A4A'; });
  captureZone.addEventListener('dragleave', () => { captureZone.style.borderColor = ''; });
  captureZone.addEventListener('drop', e => {
    e.preventDefault();
    captureZone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // ── Analyze ──
  btnAnalyze.addEventListener('click', analyze);

  // ── URL import ──
  btnAnalyzeUrl.addEventListener('click', analyzeUrl);
  urlImportInput.addEventListener('keydown', e => { if (e.key === 'Enter') analyzeUrl(); });

  // ── Bulk upload ──
  bulkInput.addEventListener('change', () => {
    if (dropHandled) { dropHandled = false; return; }
    updateBulkSelection(bulkInput.files);
  });

  bulkDrop.addEventListener('dragover',  e => { e.preventDefault(); bulkDrop.classList.add('drag-over'); });
  bulkDrop.addEventListener('dragleave', () => bulkDrop.classList.remove('drag-over'));
  bulkDrop.addEventListener('drop', e => {
    e.preventDefault();
    bulkDrop.classList.remove('drag-over');
    dropHandled = true;
    setTimeout(() => { dropHandled = false; }, 500);
    if (e.dataTransfer.files.length) updateBulkSelection(e.dataTransfer.files);
  });

  btnBulkRun.addEventListener('click', async () => {
    const files = [...bulkFiles];
    if (!files.length) { showToast('Selecciona fotos primero.'); return; }

    btnBulkRun.disabled = true;
    let succeeded = 0, failed = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rowId = `bfi-${CSS.escape(f.name + f.size)}`;
      const row = document.getElementById(rowId);

      // Pause between requests to avoid rate limiting
      if (i > 0) await new Promise(r => setTimeout(r, 1000));

      bulkStatus.textContent = `Analizando ${i + 1} de ${files.length}…`;
      bulkProgressFill.style.width = `${(i / files.length) * 100}%`;
      if (row) { row.className = 'bulk-file-item fi-active'; row.querySelector('.fi-icon').textContent = '⟳'; }

      try {
        const dataUrl  = await readFileAsDataUrl(f);
        const base64   = dataUrl.split(',')[1];
        const mime     = (f.type && f.type.startsWith('image/')) ? f.type : 'image/jpeg';
        const [result, thumbnail] = await Promise.all([
          analyzeImage(base64, mime),
          generateThumbnail(dataUrl),
        ]);
        const saved = saveToArchiveDirect(result, thumbnail);
        if (!saved) throw new Error('No se pudo guardar (almacenamiento lleno)');
        if (row) { row.className = 'bulk-file-item fi-ok'; row.querySelector('.fi-icon').textContent = '✓'; }
        succeeded++;
      } catch (err) {
        if (row) {
          row.className = 'bulk-file-item fi-err';
          row.querySelector('.fi-icon').textContent = '✗';
          row.querySelector('.fi-name').textContent += ` — ${err.message}`;
        }
        failed++;
      }

      bulkProgressFill.style.width = `${((i + 1) / files.length) * 100}%`;
    }

    const summary = `✓ ${succeeded} guardada${succeeded !== 1 ? 's' : ''}${failed ? `  ·  ✗ ${failed} con error — revisa los detalles arriba` : ''}.`;
    bulkStatus.textContent = summary;
    bulkStatus.style.color = failed ? 'var(--error)' : 'var(--green)';
    btnBulkRun.disabled = false;
    if (succeeded > 0) {
      showToast(`${succeeded} foto${succeeded !== 1 ? 's' : ''} guardada${succeeded !== 1 ? 's' : ''} en el archivo ✓`);
      renderArchive();
    }
  });

  // ── Tab switching ──
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ── Perfil ──
  const coloniasInput  = document.getElementById('coloniasInput');
  const btnAddColonia  = document.getElementById('btnAddColonia');
  const btnSavePerfil  = document.getElementById('btnSavePerfil');

  function addColoniaChip(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = [...document.querySelectorAll('.colonia-chip')].map(c => c.dataset.name);
    if (existing.includes(trimmed)) { coloniasInput.value = ''; return; }
    const container = document.getElementById('coloniasChips');
    const chip = document.createElement('span');
    chip.className = 'colonia-chip';
    chip.dataset.name = trimmed;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = trimmed;
    chip.appendChild(nameSpan);
    const x = document.createElement('button');
    x.className = 'chip-remove';
    x.textContent = '×';
    x.setAttribute('aria-label', `Eliminar ${trimmed}`);
    x.addEventListener('click', () => chip.remove());
    chip.appendChild(x);
    container.appendChild(chip);
    coloniasInput.value = '';
  }

  coloniasInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addColoniaChip(coloniasInput.value); } });
  btnAddColonia.addEventListener('click', () => addColoniaChip(coloniasInput.value));

  document.querySelectorAll('.stepper').forEach(stepper => {
    stepper.addEventListener('click', e => {
      const btn = e.target.closest('.stepper-btn');
      if (!btn) return;
      const valEl = stepper.querySelector('.stepper-val');
      let val = parseInt(valEl.textContent, 10) || 0;
      if (btn.dataset.action === 'inc') val++;
      else if (btn.dataset.action === 'dec') val = Math.max(0, val - 1);
      valEl.textContent = val;
    });
  });

  btnSavePerfil.addEventListener('click', () => {
    const recamarasMin       = parseInt(document.getElementById('perfilValRecamaras').textContent, 10) || 0;
    const banosMin           = parseInt(document.getElementById('perfilValBanos').textContent,     10) || 0;
    const estacionamientoMin = parseInt(document.getElementById('perfilValEst').textContent,       10) || 0;
    const precioVal = document.getElementById('perfilPrecioMax').value;
    const tamanoVal = document.getElementById('perfilTamanoMin').value;
    const precioMax = precioVal !== '' ? Number(precioVal) : null;
    const tamanoMin = tamanoVal !== '' ? Number(tamanoVal) : null;
    const coloniasPreferidas = [...document.querySelectorAll('.colonia-chip')]
      .map(chip => chip.dataset.name).filter(Boolean);
    const amenidades = {};
    document.querySelectorAll('.amenidad-row').forEach(row => {
      const key = row.dataset.key;
      const v   = row.querySelector('.tri-btn.active')?.dataset.val;
      amenidades[key] = (v === 'null' || !v) ? null : v;
    });
    const profile = { recamarasMin, banosMin, estacionamientoMin, precioMax, tamanoMin, coloniasPreferidas, amenidades };
    store.set('searchProfile', JSON.stringify(profile));
    gistPush();
    showToast('Perfil guardado ✓');
  });

  // ── Scorecard toggle (mobile) ──
  scorecardToggle.addEventListener('click', () => {
    const expanded = scorecardBody.classList.toggle('expanded');
    scorecardToggle.textContent = expanded ? 'Ver resumen ▲' : 'Ver resumen ▼';
  });

  btnCsv.addEventListener('click', exportCSV);

  // ── Settings panel ──
  function openSettings() {
    ghTokenEl.value = getGhToken();
    settingsPanel.classList.add('open');
    settingsBackdrop.classList.add('open');
    if (!ghTokenEl.value) setTimeout(() => ghTokenEl.focus(), 260);
  }

  function closeSettings() {
    settingsPanel.classList.remove('open');
    settingsBackdrop.classList.remove('open');
  }

  btnSettings.addEventListener('click', openSettings);
  btnSettingsClose.addEventListener('click', closeSettings);
  settingsBackdrop.addEventListener('click', closeSettings);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

  // ── Gist token save ──
  const savedGhToken = getGhToken();
  if (savedGhToken) ghTokenEl.value = savedGhToken;
  updateSyncStatus();
  if (getGhToken() && !getGistId()) discoverGist();

  saveGhTokenBtn.addEventListener('click', async () => {
    const t = ghTokenEl.value.trim();
    if (!t) return showToast('Ingresa un token de GitHub primero');
    store.set('apt_hunter_gh_token', t);
    showToast('Token guardado ✓');
    updateSyncStatus();
    await discoverGist();
  });
  ghTokenEl.addEventListener('keydown', e => { if (e.key === 'Enter') saveGhTokenBtn.click(); });

  btnSync.addEventListener('click', async () => {
    btnSync.disabled = true;
    await gistPull();
    btnSync.disabled = false;
  });

  // ── Check for gallery mode on load ──
  const _galleryParam = new URLSearchParams(location.search).get('property');
  if (_galleryParam) initGalleryMode(_galleryParam);

  renderScorecard();

  // ── Exchange rate: MXN → USD ──
  fetch('https://api.frankfurter.app/latest?from=MXN&to=USD')
    .then(r => r.json())
    .then(d => { mxnToUsdRate = d.rates?.USD || null; })
    .catch(() => {});

  // ── PWA Service Worker ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
