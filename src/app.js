// src/app.js — state, initialization, tab switching
import {
  store,
  loadArchive,
  initGalleryMode,
  readFileAsDataUrl,
  saveToArchiveDirect,
} from './archive.js';

import {
  getGhToken,
  getGistId,
  gistPull,
  gistPush,
  updateSyncStatus,
  discoverGist,
} from './sync.js';

import {
  currentResult,
  currentThumbnail,
  bulkFiles,
  analyze,
  analyzeUrl,
  handleFile,
  clearImage,
  analyzeImage,
  updateBulkSelection,
} from './analyze.js';

import { exportCSV } from './csv.js';

import {
  renderResults,
  renderScorecard,
  renderArchive,
  generateThumbnail,
  showToast,
  buildPhoneItem,
} from './ui.js';

// ── Save to archive (uses scan-state from analyze.js) ─────────────────────
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
  let dropHandled = false;

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

  // ── PWA Service Worker ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
