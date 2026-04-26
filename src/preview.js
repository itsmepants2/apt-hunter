// src/preview.js — full-viewport takeover for the extract → edit → save flow.
// Step 2A handles mode === 'url' only; the API is shaped so 'scan' can join in 2B
// without changing signatures.

const FIELD_DEFS = [
  { key: 'priceMxn',     label: 'Precio (MXN)', type: 'text',   placeholder: '15,000/mes' },
  { key: 'sizeSqm',      label: 'Tamaño (m²)',  type: 'number', placeholder: '—' },
  { key: 'neighborhood', label: 'Colonia',       type: 'text',   placeholder: 'Col. Roma…' },
  { key: 'bedrooms',     label: '# Recámaras',  type: 'number', placeholder: '—' },
  { key: 'bathrooms',    label: '# Baños',      type: 'number', placeholder: '—' },
  { key: 'parking',      label: '# Estacion.',  type: 'number', placeholder: '—' },
  { key: 'amenities',    label: 'Amenidades',    type: 'text',   placeholder: 'Gym, alberca…', wide: true },
  { key: 'notes',        label: 'Notas',         type: 'text',   placeholder: '', wide: true },
];

let currentRequestId = 0;
let state = null;            // { mode, status, sourceUrl, extracted, photos, error, inputRefs }
let savedBodyOverflow = '';

export function isPreviewOpen() {
  return state !== null;
}

export function getCurrentRequestId() {
  return currentRequestId;
}

// Read live values from the DOM inputs and currently-visible photos.
// Returns null when the takeover isn't open or extraction hasn't finished.
export function getPreviewData() {
  if (!state || state.status !== 'ready') return null;
  const inputs = state.inputRefs || {};
  const fields = {};
  Object.keys(inputs).forEach(k => { fields[k] = inputs[k].value; });
  const photosEl = document.getElementById('previewPhotos');
  const visiblePhotos = (state.photos || []).filter(src => {
    const el = photosEl.querySelector(`img[data-src="${CSS.escape(src)}"]`);
    return !el || el.style.display !== 'none';
  });
  return { mode: state.mode, sourceUrl: state.sourceUrl || null, fields, visiblePhotos };
}

export function openPreview(mode, initialData = {}) {
  currentRequestId += 1;
  const reqId = currentRequestId;
  state = {
    mode,
    status: initialData.status || 'extracting',
    sourceUrl: initialData.sourceUrl || null,
    extracted: initialData.extracted || null,
    photos: initialData.photos || [],
    error: initialData.error || null,
    inputRefs: {},
  };
  showView();
  render();
  return reqId;
}

export function updatePreview(reqId, patch) {
  if (reqId !== currentRequestId || !state) return;
  Object.assign(state, patch);
  render();
}

export function closePreview() {
  // Bump requestId so any in-flight extraction's update is dropped.
  currentRequestId += 1;
  state = null;
  hideView();
}

function showView() {
  const view = document.getElementById('previewView');
  view.style.display = 'flex';
  savedBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  // Reset scroll inside the takeover
  view.scrollTop = 0;
}

function hideView() {
  const view = document.getElementById('previewView');
  view.style.display = 'none';
  document.body.style.overflow = savedBodyOverflow;
  savedBodyOverflow = '';
  // Clear DOM so a re-open starts clean
  document.getElementById('previewStatus').innerHTML = '';
  document.getElementById('previewPhotos').innerHTML = '';
  document.getElementById('previewSource').innerHTML = '';
  document.getElementById('previewFields').innerHTML = '';
}

function render() {
  if (!state) return;

  const statusEl  = document.getElementById('previewStatus');
  const photosEl  = document.getElementById('previewPhotos');
  const sourceEl  = document.getElementById('previewSource');
  const fieldsEl  = document.getElementById('previewFields');
  const saveBtn   = document.getElementById('previewSave');

  statusEl.innerHTML = '';
  photosEl.innerHTML = '';
  sourceEl.innerHTML = '';
  fieldsEl.innerHTML = '';
  state.inputRefs = {};

  if (state.status === 'extracting') {
    statusEl.className = 'preview-status preview-status--loading';
    statusEl.innerHTML = '<span class="spinner"></span>Extrayendo datos…';
    saveBtn.disabled = true;
    return;
  }

  if (state.status === 'error') {
    statusEl.className = 'preview-status preview-status--error';
    statusEl.textContent = `Error: ${state.error || 'Falló la extracción.'}`;
    saveBtn.disabled = true;
    return;
  }

  // status === 'ready'
  statusEl.className = 'preview-status';
  saveBtn.disabled = false;

  // Photo strip
  const photos = state.photos || [];
  if (photos.length) {
    photos.forEach(src => {
      const img = document.createElement('img');
      img.className = 'preview-photo';
      img.src = src;
      img.dataset.src = src;
      img.alt = '';
      img.onerror = () => { img.style.display = 'none'; };
      photosEl.appendChild(img);
    });
  } else {
    const noPhotos = document.createElement('div');
    noPhotos.className = 'preview-no-photos';
    noPhotos.textContent = 'No se encontraron fotos — puedes añadirlas más tarde';
    photosEl.appendChild(noPhotos);
  }

  // Source row (only when we have one)
  if (state.sourceUrl) {
    const label = document.createElement('span');
    label.className = 'preview-source-label';
    label.textContent = 'Fuente';
    const link = document.createElement('a');
    link.className = 'preview-source-link';
    link.href = state.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = state.sourceUrl;
    sourceEl.appendChild(label);
    sourceEl.appendChild(link);
  }

  // Editable fields
  const extracted = state.extracted || {};
  FIELD_DEFS.forEach(({ key, label, type, placeholder, wide }) => {
    const wrap = document.createElement('div');
    wrap.className = 'archive-field' + (wide ? ' wide' : '');

    const lbl = document.createElement('div');
    lbl.className = 'archive-field-label';
    lbl.textContent = label;

    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'archive-field-input';
    inp.placeholder = placeholder;
    const val = extracted[key];
    inp.value = (val != null && val !== 'null') ? String(val) : '';
    if (type === 'number') inp.min = '0';

    state.inputRefs[key] = inp;
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    fieldsEl.appendChild(wrap);
  });
}
