// src/ui.js — all render/DOM functions
import {
  store,
  STATUSES,
  loadArchive,
  saveArchiveField,
  saveArchivePhotoAdd,
  saveArchivePhotoDelete,
  deleteArchiveEntry,
  parsePriceMxn,
  readFileAsDataUrl,
  mxnToUsdRate,
  archiveFilter,
  initGalleryMode,
} from './archive.js';

import { navigateTo } from './router.js';


import { scoreEntry } from './scoring.js';

// ── Scoring constants ──────────────────────────────────────────────────────
const CRITERION_LABELS = {
  recamaras:       'Recámaras',
  banos:           'Baños',
  estacionamiento: 'Estacionamiento',
  precio:          'Precio',
  tamano:          'Tamaño',
  colonias:        'Colonia',
  elevador:        'Elevador',
  terraza:         'Terraza / Balcón',
  seguridad24h:    'Seguridad 24h',
  gimnasio:        'Gimnasio',
  alberca:         'Alberca',
  mascotas:        'Mascotas',
  amueblado:       'Amueblado',
};

// ── Scoring adapters (archive fields → scoring engine fields) ──────────────
function loadScoringProfile() {
  try {
    const raw = JSON.parse(store.get('searchProfile') || 'null');
    if (!raw) return null;
    return {
      recamaras:        raw.recamarasMin,
      banos:            raw.banosMin,
      estacionamiento:  raw.estacionamientoMin,
      precio:           raw.precioMax,
      tamano:           raw.tamanoMin,
      coloniasPreferidas: raw.coloniasPreferidas || [],
      ...(raw.amenidades || {}),
    };
  } catch { return null; }
}

function toScoringEntry(e) {
  return {
    recamaras:       e.bedrooms,
    banos:           e.bathrooms,
    estacionamiento: e.parking,
    precio:          parsePriceMxn(e.priceMxn),
    tamano:          e.sizeSqm,
    colonia:         e.neighborhood,
    amenidades:      e.amenities,
  };
}

function buildBreakdownSection(sr) {
  const profile = loadScoringProfile();
  const { total, breakdown } = sr;

  function idealLabel(key) {
    if (!profile) return '—';
    switch (key) {
      case 'recamaras':
        return profile.recamaras != null ? `≥ ${profile.recamaras} rec.` : '—';
      case 'banos':
        return profile.banos != null ? `≥ ${profile.banos} baños` : '—';
      case 'estacionamiento':
        return profile.estacionamiento != null ? `≥ ${profile.estacionamiento}` : '—';
      case 'precio':
        return profile.precio != null
          ? `≤ $${Number(profile.precio).toLocaleString('es-MX')}`
          : '—';
      case 'tamano':
        return profile.tamano != null ? `≥ ${profile.tamano} m²` : '—';
      case 'colonias':
        return profile.coloniasPreferidas?.length
          ? profile.coloniasPreferidas.join(', ')
          : '—';
      default: {
        const pref = profile[key];
        return pref === 'must' ? 'must-have' : pref === 'want' ? 'deseable' : '—';
      }
    }
  }

  const section = document.createElement('div');
  section.className = 'score-breakdown';

  const headerColor = total >= 75 ? '#4caf50' : total >= 50 ? '#ff9800' : '#f44336';
  const header = document.createElement('div');
  header.className = 'breakdown-header';
  header.innerHTML = `<span style="color:${headerColor}">🎯 Match ${total}%</span>`;
  section.appendChild(header);

  const table = document.createElement('table');
  table.className = 'breakdown-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th></th>
        <th>Criterio</th>
        <th>Ideal</th>
        <th>Propiedad</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  function statusEmoji(score, max) {
    if (max === 3 && score !== 3) return '❌';
    if (score >= max)              return '✅';
    if (score > 0)                 return '⚠️';
    return '❌';
  }

  Object.entries(breakdown).forEach(([key, { score, max, label }]) => {
    if (max === 0) return;

    const tr = document.createElement('tr');
    if (max === 3 && score !== 3) tr.className = 'breakdown-must-miss';

    tr.innerHTML = `
      <td class="bd-status">${statusEmoji(score, max)}</td>
      <td class="bd-criterion">${escHtml(CRITERION_LABELS[key] ?? key)}</td>
      <td class="bd-ideal">${escHtml(idealLabel(key))}</td>
      <td class="bd-actual">${escHtml(label)}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

// ── Thumbnail ──────────────────────────────────────────────────────────────
export function generateThumbnail(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MAX_W = 200;
      const scale = Math.min(1, MAX_W / img.width);
      const tc = document.createElement('canvas');
      tc.width  = Math.round(img.width  * scale);
      tc.height = Math.round(img.height * scale);
      tc.getContext('2d').drawImage(img, 0, 0, tc.width, tc.height);
      resolve(tc.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ── Country-code helpers ───────────────────────────────────────────────────
export const CC_PRESETS = [
  { code: '52', flag: '🇲🇽', label: '+52 México' },
  { code: '1',  flag: '🇺🇸', label: '+1 EE.UU./CA' },
  { code: 'other', flag: '🌍', label: 'Otro…' },
];

export const WA_SVG_SM = `<svg style="width:16px;height:16px;flex-shrink:0" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

export const WA_SVG_LG = `<svg class="wa-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

export function buildWaNumber(localDigits, cc) {
  return String(cc).replace(/\D/g, '') + String(localDigits).replace(/\D/g, '');
}

export function getDefaultCC() {
  return store.get('apt_hunter_last_cc') || '52';
}

export function saveCC(cc) {
  if (cc) store.set('apt_hunter_last_cc', cc);
}

// Build a full phone item (either a big button or a card with optional CC picker)
// onContact(waNum, displayNumber) is invoked when the user picks this contact —
// caller is responsible for any archive save / takeover-close side effects.
export function buildPhoneItem(p, waMessage, isSingle, onContact) {
  const localDigits = String(p.number || '').replace(/\D/g, '');
  const metaParts   = [p.label, p.position].filter(Boolean);
  const msg         = encodeURIComponent(waMessage);

  // Helper: make the final wa.me anchor
  // skipSave=true when the caller already invoked onContact (CC picker flow)
  function makeWaLink(cc, bigBtn, skipSave = false) {
    const waNum = buildWaNumber(localDigits, cc);
    const href = `https://wa.me/${waNum}?text=${msg}`;
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (!skipSave) {
      a.addEventListener('click', () => onContact(waNum, p.number));
    }
    if (bigBtn) {
      a.className = 'wa-btn';
      a.innerHTML = `${WA_SVG_LG} WhatsApp · ${escHtml(p.number)}`;
    } else {
      a.className = 'phone-card-btn';
      a.innerHTML = `${WA_SVG_SM} Enviar`;
    }
    return a;
  }

  if (p.countryCode) {
    // Country code known from the sign → show link directly
    if (isSingle) return makeWaLink(p.countryCode, true);
    // Multi-number card
    const card = document.createElement('div');
    card.className = 'phone-card';
    const info = document.createElement('div');
    info.className = 'phone-card-info';
    info.innerHTML = `<div class="phone-card-number">📞 ${escHtml(p.number)}</div>`
      + (metaParts.length ? `<div class="phone-card-meta">${escHtml(metaParts.join(' · '))}</div>` : '');
    card.appendChild(info);
    card.appendChild(makeWaLink(p.countryCode, false));
    return card;
  }

  // No country code detected → show CC picker card
  const defaultCC = getDefaultCC();
  const isCustomCC = defaultCC !== '52' && defaultCC !== '1';

  const card = document.createElement('div');
  card.className = 'phone-card phone-card-col';

  const info = document.createElement('div');
  info.className = 'phone-card-info';
  info.innerHTML = `<div class="phone-card-number">📞 ${escHtml(p.number)}</div>`
    + (metaParts.length ? `<div class="phone-card-meta">${escHtml(metaParts.join(' · '))}</div>` : '')
    + `<div class="phone-card-meta" style="font-style:italic;margin-top:2px;">Selecciona el código de país</div>`;

  // Select element
  const select = document.createElement('select');
  select.className = 'cc-select';
  CC_PRESETS.forEach(({ code, flag, label }) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${flag} ${label}`;
    if (code === defaultCC || (isCustomCC && code === 'other')) opt.selected = true;
    select.appendChild(opt);
  });

  // Text input for "Other"
  const otherInput = document.createElement('input');
  otherInput.type = 'text';
  otherInput.className = 'cc-other-input';
  otherInput.placeholder = 'ej. 34';
  otherInput.style.display = isCustomCC ? '' : 'none';
  if (isCustomCC) otherInput.value = defaultCC;

  select.addEventListener('change', () => {
    otherInput.style.display = select.value === 'other' ? '' : 'none';
  });

  // Confirm button
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'cc-confirm-btn';
  confirmBtn.innerHTML = `${WA_SVG_SM} Abrir WhatsApp`;

  confirmBtn.addEventListener('click', () => {
    let cc = select.value;
    if (cc === 'other') {
      cc = otherInput.value.trim().replace(/\D/g, '');
      if (!cc) { showToast('Ingresa un código de país válido'); return; }
    }
    saveCC(cc);
    const waNum = buildWaNumber(localDigits, cc);
    onContact(waNum, p.number);
    // Replace picker row with persistent link (no double-save on re-click)
    const link = makeWaLink(cc, false, true);
    pickerRow.replaceWith(link);
    window.open(link.href, '_blank', 'noopener,noreferrer');
  });

  const pickerRow = document.createElement('div');
  pickerRow.className = 'cc-picker-row';
  pickerRow.appendChild(select);
  pickerRow.appendChild(otherInput);
  pickerRow.appendChild(confirmBtn);

  card.appendChild(info);
  card.appendChild(pickerRow);
  return card;
}

// ── Helpers ────────────────────────────────────────────────────────────────
export function showToast(msg) {
  const toastEl = document.getElementById('toast');
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Scorecard ──────────────────────────────────────────────────────────────
export function renderScorecard() {
  const scorecardBody = document.getElementById('scorecardBody');
  const archive = loadArchive();
  const total = archive.length;

  document.getElementById('scorecard').style.display = total === 0 ? 'none' : '';
  document.getElementById('btnCsv').style.display    = total === 0 ? 'none' : '';
  if (total === 0) { scorecardBody.innerHTML = ''; return; }

  // Average priceMxn
  const prices = archive
    .map(e => parseFloat(String(e.priceMxn || '').replace(/[^0-9.]/g, '')))
    .filter(n => !isNaN(n) && n > 0);
  const avgPrice = prices.length
    ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    : null;

  // Average price per m²
  const perSqm = archive
    .map(e => {
      const p = parseFloat(String(e.priceMxn || '').replace(/[^0-9.]/g, ''));
      const s = parseFloat(String(e.sizeSqm  || '').replace(/[^0-9.]/g, ''));
      return (p > 0 && s > 0) ? p / s : null;
    })
    .filter(n => n !== null);
  const avgPerSqm = perSqm.length
    ? Math.round(perSqm.reduce((a, b) => a + b, 0) / perSqm.length)
    : null;

  // Best value neighborhood (≥2 entries, lowest avg price/m²)
  const byNhd = {};
  archive.forEach(e => {
    if (!e.neighborhood) return;
    const p = parseFloat(String(e.priceMxn || '').replace(/[^0-9.]/g, ''));
    const s = parseFloat(String(e.sizeSqm  || '').replace(/[^0-9.]/g, ''));
    if (!(p > 0) || !(s > 0)) return;
    const k = e.neighborhood.trim();
    (byNhd[k] = byNhd[k] || []).push(p / s);
  });
  let bestNhd = null, bestAvg = Infinity;
  Object.entries(byNhd).forEach(([name, vals]) => {
    if (vals.length < 2) return;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg < bestAvg) { bestAvg = avg; bestNhd = name; }
  });

  const fmt = n => n.toLocaleString('es-MX');

  scorecardBody.innerHTML = `
    <div class="stat-tile">
      <div class="stat-tile-label">Propiedades</div>
      <div class="stat-tile-value">${total}</div>
      <div class="stat-tile-sub">rastreadas</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile-label">Precio prom.</div>
      <div class="stat-tile-value">${avgPrice !== null ? '$' + fmt(avgPrice) : '—'}</div>
      <div class="stat-tile-sub">MXN / mes</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile-label">Precio / m²</div>
      <div class="stat-tile-value">${avgPerSqm !== null ? '$' + fmt(avgPerSqm) : '—'}</div>
      <div class="stat-tile-sub">promedio</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile-label">Mejor zona</div>
      <div class="stat-tile-value" style="font-size:${bestNhd && bestNhd.length > 10 ? '1rem' : '1.4rem'}">${escHtml(bestNhd || '—')}</div>
      <div class="stat-tile-sub">${bestNhd ? 'menor precio/m²' : 'sin datos suficientes'}</div>
    </div>
  `;
}

// ── Archive rendering ──────────────────────────────────────────────────────
export function renderArchive() {
  const archiveList  = document.getElementById('archiveList');
  const archiveTitle = document.getElementById('archiveTitle');
  const archive = loadArchive();
  const count = archive.length;

  // Load profile once for the whole render pass
  const scoringProfile = loadScoringProfile();
  const hasProfile = scoringProfile !== null;
  archiveTitle.textContent = count
    ? `Archivo · ${count} propiedad${count !== 1 ? 'es' : ''}`
    : 'Archivo';

  // ── Filter bar ──
  const filtersEl = document.getElementById('archiveFilters');
  filtersEl.innerHTML = '';

  if (count > 0) {
    const colonias = [...new Set(archive.map(e => e.neighborhood).filter(Boolean))].sort();
    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';

    // Default sort to mejor-match when a profile exists and user hasn't chosen a sort yet
    if (hasProfile && archiveFilter.sort === '') archiveFilter.sort = 'mejor-match';

    // Sort
    const sortSel = document.createElement('select');
    sortSel.className = 'filter-select';
    [
      { value: 'mejor-match', label: 'Mejor match' },
      { value: '',            label: 'Orden: más reciente' },
      { value: 'price-asc',   label: 'Precio (menor a mayor)' },
      { value: 'price-desc',  label: 'Precio (mayor a menor)' },
      { value: 'ppm2-asc',    label: 'Precio/m² (menor a mayor)' },
      { value: 'ppm2-desc',   label: 'Precio/m² (mayor a menor)' },
      { value: 'rooms',       label: 'Recámaras' },
    ].forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      if (value === archiveFilter.sort) opt.selected = true;
      sortSel.appendChild(opt);
    });
    sortSel.addEventListener('change', () => { archiveFilter.sort = sortSel.value; renderArchive(); });

    // Colonia
    const coloniaSel = document.createElement('select');
    coloniaSel.className = 'filter-select';
    const colAll = document.createElement('option');
    colAll.value = ''; colAll.textContent = 'Colonia: todas';
    coloniaSel.appendChild(colAll);
    colonias.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === archiveFilter.colonia) opt.selected = true;
      coloniaSel.appendChild(opt);
    });
    coloniaSel.addEventListener('change', () => { archiveFilter.colonia = coloniaSel.value; renderArchive(); });

    // Bedrooms
    const bedroomsSel = document.createElement('select');
    bedroomsSel.className = 'filter-select';
    [{ value: '', label: 'Recámaras: todas' }, { value: '1', label: '1 rec.' },
     { value: '2', label: '2 rec.' }, { value: '3', label: '3 rec.' }, { value: '4+', label: '4+ rec.' }]
      .forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        if (value === archiveFilter.bedrooms) opt.selected = true;
        bedroomsSel.appendChild(opt);
      });
    bedroomsSel.addEventListener('change', () => { archiveFilter.bedrooms = bedroomsSel.value; renderArchive(); });

    // Tipo
    const tipoSel = document.createElement('select');
    tipoSel.className = 'filter-select';
    [{ value: '', label: 'Tipo: todos' }, { value: 'Renta', label: 'Renta' }, { value: 'Venta', label: 'Venta' }]
      .forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        if (value === archiveFilter.tipo) opt.selected = true;
        tipoSel.appendChild(opt);
      });
    tipoSel.addEventListener('change', () => { archiveFilter.tipo = tipoSel.value; renderArchive(); });

    // Clear
    const clearBtn = document.createElement('button');
    clearBtn.className = 'filter-clear';
    clearBtn.textContent = 'Limpiar filtros';
    clearBtn.addEventListener('click', () => {
      archiveFilter.sort = ''; archiveFilter.colonia = '';
      archiveFilter.bedrooms = ''; archiveFilter.tipo = '';
      renderArchive();
    });

    filterRow.appendChild(sortSel);
    filterRow.appendChild(coloniaSel);
    filterRow.appendChild(bedroomsSel);
    filterRow.appendChild(tipoSel);
    filterRow.appendChild(clearBtn);
    filtersEl.appendChild(filterRow);
  }

  // ── Apply filters + sort ──
  let filtered = [...archive];

  if (archiveFilter.colonia)
    filtered = filtered.filter(e => e.neighborhood === archiveFilter.colonia);

  if (archiveFilter.bedrooms) {
    if (archiveFilter.bedrooms === '4+')
      filtered = filtered.filter(e => parseInt(e.bedrooms) >= 4);
    else
      filtered = filtered.filter(e => String(e.bedrooms) === archiveFilter.bedrooms);
  }

  if (archiveFilter.tipo)
    filtered = filtered.filter(e => (e.type || '').toLowerCase().includes(archiveFilter.tipo.toLowerCase()));

  if (archiveFilter.sort === 'price-asc') {
    filtered.sort((a, b) => {
      const pa = parsePriceMxn(a.priceMxn), pb = parsePriceMxn(b.priceMxn);
      if (pa === null && pb === null) return 0;
      return pa === null ? 1 : pb === null ? -1 : pa - pb;
    });
  } else if (archiveFilter.sort === 'price-desc') {
    filtered.sort((a, b) => {
      const pa = parsePriceMxn(a.priceMxn), pb = parsePriceMxn(b.priceMxn);
      if (pa === null && pb === null) return 0;
      return pa === null ? 1 : pb === null ? -1 : pb - pa;
    });
  } else if (archiveFilter.sort === 'ppm2-asc' || archiveFilter.sort === 'ppm2-desc') {
    const ppm2 = e => {
      const p = parsePriceMxn(e.priceMxn), s = parseFloat(e.sizeSqm);
      return (p && s) ? p / s : null;
    };
    const dir = archiveFilter.sort === 'ppm2-asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const pa = ppm2(a), pb = ppm2(b);
      if (pa === null && pb === null) return 0;
      return pa === null ? 1 : pb === null ? -1 : (pa - pb) * dir;
    });
  } else if (archiveFilter.sort === 'rooms') {
    filtered.sort((a, b) => {
      const ra = parseInt(a.bedrooms), rb = parseInt(b.bedrooms);
      if (isNaN(ra) && isNaN(rb)) return 0;
      return isNaN(ra) ? 1 : isNaN(rb) ? -1 : ra - rb;
    });
  }

  // Pre-compute scores for all filtered entries (one profile load, above)
  const scoreMap = new Map();
  filtered.forEach(e => {
    scoreMap.set(e.id, scoreEntry(toScoringEntry(e), scoringProfile));
  });

  if (archiveFilter.sort === 'mejor-match') {
    filtered.sort((a, b) => {
      const sa = scoreMap.get(a.id)?.total;
      const sb = scoreMap.get(b.id)?.total;
      if (sa === null && sb === null) return 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa;
    });
  }

  if (count === 0) {
    archiveList.innerHTML = '<div class="archive-empty">📭<br>No hay propiedades guardadas aún.<br>Escanea un letrero o pega un URL para empezar.</div>';
    return;
  }
  archiveList.innerHTML = '';
  if (filtered.length === 0) {
    archiveList.innerHTML = '<div class="archive-empty">🔍<br>Ninguna propiedad coincide con los filtros.</div>';
    return;
  }
  filtered.forEach(entry => archiveList.appendChild(buildArchiveCard(entry, scoreMap.get(entry.id))));
}

// ── Sign-out: clear rendered archive without touching localStorage ────────
export function clearArchiveView() {
  document.getElementById('archiveList').innerHTML = '';
  document.getElementById('archiveFilters').innerHTML = '';
  document.getElementById('archiveTitle').textContent = 'Archivo';
  document.getElementById('scorecardBody').innerHTML = '';
  document.getElementById('scorecard').style.display = 'none';
  document.getElementById('btnCsv').style.display = 'none';
  document.getElementById('homeView').classList.remove('has-entries');

  const galleryView = document.getElementById('galleryView');
  if (galleryView.style.display === 'block') {
    galleryView.style.display = 'none';
    galleryView.innerHTML = '';
    document.getElementById('appHeader').style.display = '';
    document.getElementById('tabsBottom').style.display = '';
  }
}

export async function deleteArchivePhoto(entryId, photoSrc, onSuccess) {
  if (!confirm('¿Eliminar esta foto?')) return;
  const changed = await saveArchivePhotoDelete(entryId, photoSrc);
  if (changed && onSuccess) onSuccess();
}

export function makeDeleteBtn(entryId, photoSrc, onSuccess) {
  const btn = document.createElement('button');
  btn.className = 'photo-delete-btn';
  btn.title = 'Eliminar foto';
  btn.textContent = '×';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    deleteArchivePhoto(entryId, photoSrc, onSuccess);
  });
  return btn;
}

export function buildArchiveCard(entry, scoreResult = null) {
  const card = document.createElement('div');
  card.className = 'archive-card';

  // Resolve score — use passed-in result or compute fresh (e.g. add-photo rerender)
  const sr = scoreResult ?? scoreEntry(toScoringEntry(entry), loadScoringProfile());

  const dateStr = new Date(entry.date).toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const detailParts = [entry.type, entry.price, entry.address, entry.extras].filter(Boolean);
  const allPhonesStr = (entry.allPhones || []).join(', ');

  // ── Headline (first element in card) ──
  function generateHeadline(e) {
    const beds = e.bedrooms ? `${e.bedrooms} recámara${e.bedrooms == 1 ? '' : 's'}` : null;
    const col  = (e.neighborhood || '').trim() || null;
    const tipo = (e.type || '').trim() || null;
    if (beds && col)  return `${beds} en ${col}`;
    if (beds && tipo) return `${beds} · ${tipo}`;
    if (col)          return `Propiedad en ${col}`;
    return 'Sin título';
  }

  const headlineInput = document.createElement('input');
  headlineInput.type = 'text';
  headlineInput.className = 'archive-headline';
  headlineInput.placeholder = 'Sin título';
  headlineInput.value = entry.headline != null ? entry.headline : generateHeadline(entry);
  headlineInput.addEventListener('blur', () => {
    const trimmed = headlineInput.value.trim();
    if (!trimmed) {
      const regen = generateHeadline(entry);
      headlineInput.value = regen;
      saveArchiveField(entry.id, 'headline', regen);
    } else {
      saveArchiveField(entry.id, 'headline', trimmed);
    }
  });
  // ── Photos section: real estate two-column grid ──
  const photosSection = document.createElement('div');
  const allPhotos = [entry.thumbnail, ...(entry.extraPhotos || [])].filter(Boolean);

  const photoGrid = document.createElement('div');
  photoGrid.className = 'archive-photo-grid';

  const reRenderCard = () => {
    const fresh = loadArchive().find(x => x.id === entry.id) || entry;
    card.replaceWith(buildArchiveCard(fresh, scoreResult));
  };

  // Left column: main photo
  const mainCol = document.createElement('div');
  mainCol.className = 'archive-photo-main';
  if (allPhotos.length > 0) {
    const mainImg = document.createElement('img');
    mainImg.src = allPhotos[0];
    mainImg.alt = 'Foto principal';
    mainImg.addEventListener('click', () => {
      history.pushState({ property: entry.id }, '', `${location.pathname}#/archivo?property=${entry.id}`);
      initGalleryMode(entry.id);
    });
    // Hide cell if image fails to load (broken src / avatar placeholder)
    mainImg.addEventListener('error', () => { mainCol.style.display = 'none'; });
    mainCol.appendChild(mainImg);
    mainCol.appendChild(makeDeleteBtn(entry.id, allPhotos[0], reRenderCard));
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'archive-photo-placeholder';
    placeholder.textContent = '🏠';
    mainCol.appendChild(placeholder);
  }
  photoGrid.appendChild(mainCol);

  // Right column: 2×2 grid of up to 4 additional photos (desktop only via CSS)
  if (allPhotos.length > 1) {
    const sideCol = document.createElement('div');
    sideCol.className = 'archive-photo-side';
    const sidePhotos = allPhotos.slice(1, 5);
    sidePhotos.forEach((src, i) => {
      const cell = document.createElement('div');
      cell.className = 'archive-photo-cell';
      const img = document.createElement('img');
      img.src = src;
      img.alt = `Foto ${i + 2}`;
      // Hide cell if image fails to load
      img.addEventListener('error', () => { cell.style.display = 'none'; });
      cell.appendChild(img);
      // "Ver todas" overlay on the last visible cell when more photos exist
      if (i === sidePhotos.length - 1 && allPhotos.length > 5) {
        const overlay = document.createElement('div');
        overlay.className = 'archive-photo-overlay';
        overlay.textContent = `Ver todas (${allPhotos.length})`;
        overlay.addEventListener('click', () => {
          history.pushState({ property: entry.id }, '', `${location.pathname}#/archivo?property=${entry.id}`);
          initGalleryMode(entry.id);
        });
        cell.appendChild(overlay);
      } else {
        cell.addEventListener('click', () => {
          history.pushState({ property: entry.id }, '', `${location.pathname}#/archivo?property=${entry.id}`);
          initGalleryMode(entry.id);
        });
      }
      cell.appendChild(makeDeleteBtn(entry.id, src, reRenderCard));
      sideCol.appendChild(cell);
    });
    photoGrid.appendChild(sideCol);
  }
  photosSection.appendChild(photoGrid);

  // "Ver todas" button — mobile only (hidden on desktop via CSS)
  if (allPhotos.length > 1) {
    const verBtn = document.createElement('button');
    verBtn.className = 'archive-ver-todas-btn';
    verBtn.textContent = `Ver todas (${allPhotos.length})`;
    verBtn.addEventListener('click', () => {
      history.pushState({ property: entry.id }, '', `${location.pathname}#/archivo?property=${entry.id}`);
      initGalleryMode(entry.id);
    });
    photosSection.appendChild(verBtn);
  }

  const heroWrapper = document.createElement('div');
  heroWrapper.className = 'card-hero-wrapper';
  heroWrapper.appendChild(photosSection);
  heroWrapper.appendChild(headlineInput);
  card.appendChild(heroWrapper);

  // ── Stats bar (score + key fields display) ──
  const statsBar = document.createElement('div');
  statsBar.className = 'card-stats-bar';

  // ── Price + Colonia (far left) ──
  const priceEl = document.createElement('div');
  priceEl.className = 'stat-item stat-price-col';
  const priceMxnNum = parsePriceMxn(entry.priceMxn);
  if (priceMxnNum) {
    const mxnFormatted = '$' + priceMxnNum.toLocaleString('es-MX');
    const usdNum = mxnToUsdRate ? Math.round(priceMxnNum * mxnToUsdRate) : null;
    const usdStr = usdNum !== null
      ? (usdNum >= 1000 ? `~$${Math.round(usdNum / 1000)}k USD` : `~$${usdNum} USD`)
      : '';
    priceEl.innerHTML = `<div class="stat-value">${escHtml(mxnFormatted)}</div>`
      + (usdStr ? `<div class="stat-price-usd">${escHtml(usdStr)}</div>` : '')
      + `<div class="stat-label">${escHtml(entry.neighborhood || '—')}</div>`;
  } else {
    priceEl.innerHTML = `<div class="stat-value">—</div><div class="stat-label">${escHtml(entry.neighborhood || '—')}</div>`;
  }

  const statsGrid = document.createElement('div');
  statsGrid.className = 'stats-grid';

  const statItems = [
    { value: entry.bedrooms ?? '—', label: 'Recámaras' },
    { value: entry.bathrooms ?? '—', label: 'Baños' },
    { value: entry.sizeSqm ? `${entry.sizeSqm} m²` : '—', label: entry.sizeSqm ? `${Math.round(entry.sizeSqm * 10.764)} ft²` : '' },
  ];

  statItems.forEach(({ value, label }) => {
    const item = document.createElement('div');
    item.className = 'stat-item';
    item.innerHTML = `<div class="stat-value">${escHtml(String(value))}</div><div class="stat-label">${escHtml(label)}</div>`;
    statsGrid.appendChild(item);
  });

  // ── Score (far right) ──
  const scoreEl = document.createElement('div');
  scoreEl.className = 'stats-score';
  if (sr !== null && sr.total !== null) {
    const scoreColor = sr.total >= 75 ? '#4caf50' : sr.total >= 50 ? '#ff9800' : '#f44336';
    scoreEl.innerHTML = `<div class="stats-score-number-row"><span class="stats-score-number" style="color:${scoreColor}">${sr.total}</span><span class="stats-score-denom">/100</span></div>`;
  } else {
    scoreEl.innerHTML = `<div class="stats-score-number-row"><span class="stats-score-number" style="color:var(--text-muted)">—</span></div>`;
  }
  const scoreLabel = document.createElement('div');
  scoreLabel.className = 'stat-label';
  scoreLabel.textContent = 'SCORE TOTAL';
  scoreEl.appendChild(scoreLabel);

  const statsBarRight = document.createElement('div');
  statsBarRight.className = 'stats-bar-right';
  statsBarRight.appendChild(statsGrid);
  statsBarRight.appendChild(scoreEl);

  statsBar.appendChild(priceEl);
  statsBar.appendChild(statsBarRight);
  card.appendChild(statsBar);

  // ── Match breakdown ──
  if (sr !== null && sr.total !== null) {
    card.appendChild(buildBreakdownSection(sr));
  }

  // ── Amenity pills ──
  if (entry.amenities && entry.amenities.trim()) {
    const AMENIDAD_MAP = {
      elevador:    { label: 'Elevador',      icon: '🛗' },
      terraza:     { label: 'Terraza',       icon: '🌿' },
      seguridad24h:{ label: 'Seguridad 24h', icon: '🔒' },
      gimnasio:    { label: 'Gimnasio',      icon: '🏋️' },
      alberca:     { label: 'Alberca',       icon: '🏊' },
      mascotas:    { label: 'Mascotas',      icon: '🐾' },
      amueblado:   { label: 'Amueblado',     icon: '🛋️' },
    };

    const AMENIDAD_KEYWORDS_UI = {
      elevador:    ['elevador'],
      terraza:     ['terraza', 'balcón', 'balcon'],
      seguridad24h:['seguridad 24', 'seguridad24'],
      gimnasio:    ['gimnasio', 'gym'],
      alberca:     ['alberca'],
      mascotas:    ['mascota', 'pets', 'pet-friendly'],
      amueblado:   ['amueblado', 'amoblado', 'furnished'],
    };

    const raw = entry.amenities.toLowerCase();
    const matched = new Set();

    Object.entries(AMENIDAD_KEYWORDS_UI).forEach(([key, keywords]) => {
      if (keywords.some(kw => raw.includes(kw))) matched.add(key);
    });

    const tokens = entry.amenities.split(',').map(t => t.trim()).filter(Boolean);
    const unknownTokens = tokens.filter(token => {
      const tl = token.toLowerCase();
      return !Object.values(AMENIDAD_KEYWORDS_UI).flat().some(kw => tl.includes(kw));
    });

    if (matched.size > 0 || unknownTokens.length > 0) {
      const pillRow = document.createElement('div');
      pillRow.className = 'amenity-pills';

      matched.forEach(key => {
        // Skip if already shown in the score breakdown table
        if (sr !== null && sr.breakdown?.[key]?.max > 0) return;

        const { label, icon } = AMENIDAD_MAP[key];
        const pill = document.createElement('span');
        pill.className = 'amenity-pill amenity-pill--known';
        pill.textContent = `${icon} ${label}`;
        pillRow.appendChild(pill);
      });

      unknownTokens.forEach(token => {
        const pill = document.createElement('span');
        pill.className = 'amenity-pill amenity-pill--unknown';
        pill.textContent = token;
        pillRow.appendChild(pill);
      });

      if (pillRow.children.length > 0) card.appendChild(pillRow);
    }
  }

  // ── Info row (date, detail, phones) ──
  const top = document.createElement('div');
  top.className = 'archive-card-top';
  const info = document.createElement('div');
  info.className = 'archive-info';
  info.innerHTML =
    `<div class="archive-date">${escHtml(dateStr)}</div>`
    + (detailParts.length ? `<div class="archive-detail">${escHtml(detailParts.join(' · '))}</div>` : '')
    + (allPhonesStr ? `<div class="archive-phones">📞 ${escHtml(allPhonesStr)}</div>` : '')
    + (entry.contactedNumber ? `<div class="archive-contacted">Contactado: <span>+${escHtml(String(entry.contactedNumber))}</span></div>` : '');
  top.appendChild(info);
  card.appendChild(top);

  // ── Status stepper ──
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  const currentStatusIdx = STATUSES.findIndex(s => s.key === (entry.status || 'contacted'));
  STATUSES.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.className = 'status-step'
      + (i === currentStatusIdx ? ' active' : i < currentStatusIdx ? ' past' : '');
    btn.innerHTML = `${s.emoji}<br>${s.label}`;
    btn.addEventListener('click', () => {
      saveArchiveField(entry.id, 'status', s.key);
      statusBar.querySelectorAll('.status-step').forEach((b, j) => {
        b.className = 'status-step'
          + (j === i ? ' active' : j < i ? ' past' : '');
      });
    });
    statusBar.appendChild(btn);
  });
  card.appendChild(statusBar);

  // ── Collapsible details section ──
  const detailsToggle = document.createElement('button');
  detailsToggle.className = 'btn-details-toggle';
  detailsToggle.innerHTML = '＋ Ver y editar detalles';

  const detailsBody = document.createElement('div');
  detailsBody.className = 'details-body';
  detailsBody.hidden = true;

  detailsToggle.addEventListener('click', () => {
    const open = !detailsBody.hidden;
    detailsBody.hidden = open;
    detailsToggle.innerHTML = open
      ? '＋ Ver y editar detalles'
      : '－ Ocultar detalles';
  });

  card.appendChild(detailsToggle);
  card.appendChild(detailsBody);

  // ── Property fields ──
  const fieldDefs = [
    { key: 'bedrooms',     label: '# Recámaras',  type: 'number', placeholder: '—' },
    { key: 'bathrooms',    label: '# Baños',      type: 'number', placeholder: '—' },
    { key: 'parking',      label: '# Estacion.',  type: 'number', placeholder: '—' },
    { key: 'priceMxn',     label: 'Precio (MXN)', type: 'text',   placeholder: '15,000/mes' },
    { key: 'sizeSqm',      label: 'Tamaño (m²)',  type: 'number', placeholder: '—' },
    { key: 'streetAddress', label: 'Dirección',   type: 'text',   placeholder: 'Calle, número…', wide: true },
    { key: 'neighborhood', label: 'Colonia',       type: 'text',   placeholder: 'Col. Roma…' },
    { key: 'amenities',    label: 'Amenidades',    type: 'text',   placeholder: 'Gym, alberca, roof…', wide: true },
  ];

  if (!entry.sourceUrl) {
    // ── URL extractor row ──
    const urlRow = document.createElement('div');
    urlRow.className = 'listing-url-row';

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'listing-url-input';
    urlInput.placeholder = 'Pegar URL del anuncio…';

    const extractBtn = document.createElement('button');
    extractBtn.className = 'btn-extract';
    extractBtn.textContent = 'Extraer';

    urlRow.appendChild(urlInput);
    urlRow.appendChild(extractBtn);
    card.appendChild(urlRow);

    const urlStatus = document.createElement('div');
    urlStatus.className = 'url-extract-status';
    card.appendChild(urlStatus);

    // Wire up URL extraction
    async function runExtract() {
      const { fetchUrlViaWorker, extractListingFromText } = await import('./services.js');
      const url = urlInput.value.trim();
      if (!url) return;

      extractBtn.disabled = true;
      extractBtn.textContent = '…';
      urlStatus.className = 'url-extract-status';
      urlStatus.textContent = 'Obteniendo página…';

      try {
        const pageText = htmlToText(await fetchUrlViaWorker(url));
        urlStatus.textContent = 'Analizando con Claude…';
        const extracted = await extractListingFromText(pageText);

        const EXTRACT_KEYS = ['priceMxn', 'sizeSqm', 'bedrooms', 'bathrooms', 'parking', 'amenities', 'neighborhood'];
        let filled = 0;
        EXTRACT_KEYS.forEach(key => {
          const val = extracted[key];
          if (val != null && String(val).trim() && fieldInputs[key]) {
            fieldInputs[key].value = String(val).trim();
            saveArchiveField(entry.id, key, fieldInputs[key].value);
            filled++;
          }
        });

        urlStatus.className = 'url-extract-status ok';
        urlStatus.textContent = filled
          ? `✓ ${filled} campo${filled !== 1 ? 's' : ''} extraído${filled !== 1 ? 's' : ''}. Revisa y corrige si es necesario.`
          : 'No se encontraron campos reconocibles en el anuncio.';
      } catch (e) {
        urlStatus.className = 'url-extract-status err';
        urlStatus.textContent = `Error: ${e.message}`;
      } finally {
        extractBtn.disabled = false;
        extractBtn.textContent = 'Extraer';
      }
    }

    extractBtn.addEventListener('click', runExtract);
    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') runExtract(); });
  }

  // ── Property fields ──
  const fieldsRow = document.createElement('div');
  fieldsRow.className = 'archive-fields';

  const fieldInputs = {};
  fieldDefs.forEach(({ key, label, type, placeholder, wide }) => {
    const wrap = document.createElement('div');
    wrap.className = 'archive-field' + (wide ? ' wide' : '');

    const lbl = document.createElement('div');
    lbl.className = 'archive-field-label';
    lbl.textContent = label;

    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'archive-field-input';
    inp.placeholder = placeholder;
    inp.value = entry[key] || '';
    if (type === 'number') inp.min = '0';
    inp.addEventListener('blur', () => saveArchiveField(entry.id, key, inp.value));

    fieldInputs[key] = inp;
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    fieldsRow.appendChild(wrap);
  });

  detailsBody.appendChild(fieldsRow);

  // ── Computed pricing summary row ──
  const computedRow = document.createElement('div');
  computedRow.className = 'archive-computed-row';

  function updateComputedRow() {
    const price = parsePriceMxn(fieldInputs.priceMxn?.value);
    const sqmVal = parseFloat(fieldInputs.sizeSqm?.value);
    computedRow.innerHTML = '';
    if (!price || !sqmVal || sqmVal <= 0) return;

    const sqft    = Math.round(sqmVal * 10.764);
    const ppm2    = price / sqmVal;
    const ppsqft  = price / sqft;
    const priceUsd = mxnToUsdRate ? Math.round(price * mxnToUsdRate) : null;

    const fmt = (n, loc) => Math.round(n).toLocaleString(loc || 'es-MX');
    const items = [
      { label: 'Precio USD',  value: priceUsd !== null ? `$${priceUsd.toLocaleString('en-US')}` : '—' },
      { label: 'Tamaño ft²',  value: sqft.toLocaleString('en-US') + ' ft²' },
      { label: 'Precio / m²', value: `$${fmt(ppm2)} MXN` },
      { label: 'Precio / ft²', value: priceUsd !== null ? `$${(ppsqft * mxnToUsdRate).toFixed(2)} USD` : `$${fmt(ppsqft)} MXN` },
    ];

    items.forEach(({ label, value }) => {
      const item = document.createElement('div');
      item.className = 'archive-computed-item';
      const lbl = document.createElement('div');
      lbl.className = 'archive-computed-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'archive-computed-value';
      val.textContent = value;
      item.appendChild(lbl);
      item.appendChild(val);
      computedRow.appendChild(item);
    });
  }

  updateComputedRow();
  // Re-compute when price or size change
  if (fieldInputs.priceMxn) fieldInputs.priceMxn.addEventListener('blur', updateComputedRow);
  if (fieldInputs.sizeSqm)  fieldInputs.sizeSqm.addEventListener('blur', updateComputedRow);
  detailsBody.appendChild(computedRow);

  // ── Bottom row: notes + delete ──
  const bottom = document.createElement('div');
  bottom.className = 'archive-card-bottom';

  const textarea = document.createElement('textarea');
  textarea.className = 'archive-notes';
  textarea.placeholder = 'Agregar notas…';
  textarea.value = entry.notes || '';
  textarea.rows = 2;
  textarea.addEventListener('blur', () => saveArchiveField(entry.id, 'notes', textarea.value));

  const shareBtn = document.createElement('button');
  shareBtn.className = 'btn-share';
  shareBtn.title = 'Compartir galería';
  shareBtn.textContent = '🔗';
  shareBtn.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}#/archivo?property=${entry.id}`;
    navigator.clipboard.writeText(url).then(() => showToast('URL copiada ✓'))
      .catch(() => showToast(url)); // fallback: show URL in toast
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-delete';
  delBtn.title = 'Eliminar';
  delBtn.textContent = '🗑';
  delBtn.addEventListener('click', () => deleteArchiveEntry(entry.id));

  // Add-photo button (moved from old strip to bottom row)
  const addLabel = document.createElement('label');
  addLabel.className = 'archive-add-photo-label';
  addLabel.title = 'Agregar foto';
  addLabel.textContent = '+ Foto';
  const addInput = document.createElement('input');
  addInput.type = 'file';
  addInput.accept = 'image/*';
  addInput.style.display = 'none';
  addInput.addEventListener('change', async () => {
    const file = addInput.files[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const thumbSrc = await generateThumbnail(dataUrl);
    if (!thumbSrc) return;
    saveArchivePhotoAdd(entry.id, thumbSrc);
    addInput.value = '';
    // Re-render the card to show the new photo in the grid
    const newCard = buildArchiveCard(loadArchive().find(e => e.id === entry.id) || entry);
    card.replaceWith(newCard);
  });
  addLabel.appendChild(addInput);

  bottom.appendChild(textarea);
  bottom.appendChild(addLabel);
  // "Ver anuncio" — only for URL-imported entries
  if (entry.sourceUrl) {
    const viewBtn = document.createElement('a');
    viewBtn.className = 'btn-view-listing';
    viewBtn.href = entry.sourceUrl;
    viewBtn.target = '_blank';
    viewBtn.rel = 'noopener noreferrer';
    viewBtn.title = 'Ver anuncio original';
    viewBtn.textContent = '↗ Ver';
    bottom.appendChild(viewBtn);
  }
  bottom.appendChild(shareBtn);
  bottom.appendChild(delBtn);
  card.appendChild(bottom);
  return card;
}

// ── Gallery view ───────────────────────────────────────────────────────────
export function renderGallery(entry) {
  const galleryView = document.getElementById('galleryView');
  galleryView.innerHTML = '';

  // Back button
  const back = document.createElement('button');
  back.className = 'btn btn-ghost gallery-back';
  back.textContent = '← Volver al archivo';
  back.addEventListener('click', () => {
    galleryView.style.display = 'none';
    galleryView.innerHTML = '';
    document.getElementById('appHeader').style.display = '';
    document.getElementById('tabsBottom').style.display = '';
    navigateTo('#/archivo');
  });
  galleryView.appendChild(back);

  // Status badge
  const statusDef = STATUSES.find(s => s.key === (entry.status || 'contacted')) || STATUSES[0];
  const badge = document.createElement('div');
  badge.className = 'gallery-status-badge';
  badge.textContent = `${statusDef.emoji} ${statusDef.label}`;
  galleryView.appendChild(badge);

  // Title + subtitle
  const title = document.createElement('div');
  title.className = 'gallery-title';
  title.textContent = entry.address || entry.type || 'Propiedad';
  galleryView.appendChild(title);

  const subtitleParts = [entry.type, entry.priceMxn || entry.price, entry.neighborhood].filter(Boolean);
  if (subtitleParts.length) {
    const sub = document.createElement('div');
    sub.className = 'gallery-subtitle';
    sub.textContent = subtitleParts.join(' · ');
    galleryView.appendChild(sub);
  }

  // Photos: hero + thumbnail grid
  const allPhotos = [entry.thumbnail, ...(entry.extraPhotos || [])].filter(Boolean);
  const reRenderGallery = () => {
    const fresh = loadArchive().find(x => x.id === entry.id);
    if (fresh && [fresh.thumbnail, ...(fresh.extraPhotos || [])].filter(Boolean).length) {
      renderGallery(fresh);
    } else {
      galleryView.style.display = 'none';
      galleryView.innerHTML = '';
      document.getElementById('appHeader').style.display = '';
      document.getElementById('tabsBottom').style.display = '';
      navigateTo('#/archivo');
    }
  };

  if (allPhotos.length) {
    const heroWrap = document.createElement('div');
    heroWrap.className = 'gallery-hero-wrap';
    const hero = document.createElement('img');
    hero.className = 'gallery-hero';
    hero.src = allPhotos[0];
    hero.alt = 'Foto principal';
    heroWrap.appendChild(hero);
    heroWrap.appendChild(makeDeleteBtn(entry.id, allPhotos[0], reRenderGallery));
    galleryView.appendChild(heroWrap);

    if (allPhotos.length > 1) {
      const grid = document.createElement('div');
      grid.className = 'gallery-photos-grid';
      allPhotos.forEach((src, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'gallery-photo-wrap';
        const img = document.createElement('img');
        img.className = 'gallery-photo';
        img.src = src;
        img.title = `Foto ${i + 1}`;
        img.addEventListener('click', () => { hero.src = src; window.scrollTo({top: 0, behavior: 'smooth'}); });
        wrap.appendChild(img);
        wrap.appendChild(makeDeleteBtn(entry.id, src, reRenderGallery));
        grid.appendChild(wrap);
      });
      galleryView.appendChild(grid);
    }
  } else {
    const ph = document.createElement('div');
    ph.className = 'gallery-hero-placeholder';
    ph.textContent = '🏠';
    galleryView.appendChild(ph);
  }

  // Details card
  const detailDefs = [
    { label: 'Tipo',           value: entry.type },
    { label: 'Precio (MXN)',   value: entry.priceMxn },
    { label: 'Precio letrero', value: entry.price },
    { label: 'Tamaño',         value: entry.sizeSqm ? `${entry.sizeSqm} m²` : null },
    { label: 'Colonia',        value: entry.neighborhood },
    { label: 'Recámaras',      value: entry.bedrooms },
    { label: 'Baños',          value: entry.bathrooms },
    { label: 'Estacionam.',    value: entry.parking },
    { label: 'Amenidades',     value: entry.amenities },
  ].filter(d => d.value);

  if (detailDefs.length) {
    const dc = document.createElement('div');
    dc.className = 'card';
    const dg = document.createElement('div');
    dg.className = 'listing-grid';
    detailDefs.forEach(({ label, value }) => {
      const item = document.createElement('div');
      item.className = 'listing-item';
      item.innerHTML = `<div class="listing-item-label">${escHtml(label)}</div>`
        + `<div class="listing-item-value">${escHtml(String(value))}</div>`;
      dg.appendChild(item);
    });
    dc.appendChild(dg);
    galleryView.appendChild(dc);
  }

  // Notes
  if (entry.notes) {
    const nc = document.createElement('div');
    nc.className = 'card';
    nc.innerHTML = `<div class="card-label">Notas</div>`
      + `<div style="font-size:0.9rem;line-height:1.6;white-space:pre-wrap;">${escHtml(entry.notes)}</div>`;
    galleryView.appendChild(nc);
  }

  // Timestamp
  const dateDiv = document.createElement('div');
  dateDiv.className = 'gallery-date';
  dateDiv.textContent = `Guardado ${new Date(entry.date).toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })}`;
  galleryView.appendChild(dateDiv);
}

// ── htmlToText (used by both analyzeUrl and buildArchiveCard runExtract) ───
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,footer,header,aside,iframe').forEach(el => el.remove());
  return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 15000);
}
