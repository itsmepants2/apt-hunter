// src/analyze.js — scan flow, URL extract flow, bulk upload helpers
import {
  callAnthropicMessages,
  extractListingFromText,
  fetchUrlViaWorker,
} from './services.js';

import {
  setLoading,
  showError,
  hideError,
  generateThumbnail,
  htmlToText,
} from './ui.js';

import { saveToArchiveDirect, readFileAsDataUrl } from './archive.js';
import { openPreview, updatePreview, getCurrentRequestId } from './preview.js';

// ── Scan state ────────────────────────────────────────────────────────────
export let imageBase64 = null;
export let imageMime = 'image/jpeg';
export let currentResult = null;
export let currentThumbnail = null;

// ── Bulk upload state ─────────────────────────────────────────────────────
export let bulkFiles = [];

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
export async function analyzeImage(base64, mime) {
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

// Map raw scan-result keys onto the takeover's editable-field keys.
// Mappings settled in step 2B: rooms→bedrooms, address→neighborhood,
// extras→amenities. Other fields stay empty for the user to fill in.
function scanResultToFields(r) {
  return {
    bedrooms:     r.rooms   != null && r.rooms   !== 'null' ? String(r.rooms)   : '',
    neighborhood: r.address != null && r.address !== 'null' ? String(r.address) : '',
    amenities:    r.extras  != null && r.extras  !== 'null' ? String(r.extras)  : '',
  };
}

export async function analyze() {
  if (!imageBase64) return showError('Primero sube o toma una foto.');

  setLoading(true);
  hideError();

  const dataUrl = `data:${imageMime};base64,${imageBase64}`;
  const reqId = openPreview('scan', { status: 'extracting', photos: [dataUrl] });

  try {
    const result = await analyzeImage(imageBase64, imageMime);
    if (reqId !== getCurrentRequestId()) return; // user discarded
    currentResult = result;
    updatePreview(reqId, {
      status: 'ready',
      extracted: { ...result, ...scanResultToFields(result) },
    });
  } catch (err) {
    if (reqId !== getCurrentRequestId()) return; // user discarded
    const msg = err instanceof SyntaxError
      ? 'No se pudo parsear la respuesta de la API. Intenta de nuevo.'
      : err.message;
    updatePreview(reqId, { status: 'error', error: msg });
  } finally {
    setLoading(false);
  }
}

// ── URL import ─────────────────────────────────────────────────────────────

// Extract candidate property photo URLs from raw HTML.
export function extractPhotosFromHtml(html, baseUrl) {
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

export async function analyzeUrl() {
  const urlImportInput  = document.getElementById('urlImportInput');
  const btnAnalyzeUrl   = document.getElementById('btnAnalyzeUrl');
  const url = urlImportInput.value.trim();
  if (!url) return;
  try { new URL(url); } catch {
    // Briefly flash the input as invalid (no separate status element anymore)
    urlImportInput.setCustomValidity('URL no válida');
    urlImportInput.reportValidity();
    setTimeout(() => urlImportInput.setCustomValidity(''), 2000);
    return;
  }

  btnAnalyzeUrl.disabled = true;
  btnAnalyzeUrl.textContent = '…';

  const reqId = openPreview('url', { status: 'extracting', sourceUrl: url });

  try {
    const html = await fetchUrlViaWorker(url);
    const [extracted, photos] = await Promise.all([
      extractListingFromText(htmlToText(html)),
      Promise.resolve(extractPhotosFromHtml(html, url)),
    ]);
    updatePreview(reqId, { status: 'ready', extracted, photos });
  } catch (e) {
    updatePreview(reqId, { status: 'error', error: e.message });
  } finally {
    btnAnalyzeUrl.disabled = false;
    btnAnalyzeUrl.textContent = 'Analizar';
  }
}

// ── File handling ──────────────────────────────────────────────────────────
export function handleFile(file) {
  const captureZone = document.getElementById('captureZone');
  const btnClear    = document.getElementById('btnClear');
  const btnAnalyze  = document.getElementById('btnAnalyze');
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
  };
  reader.readAsDataURL(file);
  // Reset file inputs so same file can be reselected
  fileCamera.value = '';
  fileUpload.value = '';
}

export function clearImage() {
  const captureZone = document.getElementById('captureZone');
  const btnClear    = document.getElementById('btnClear');
  const btnAnalyze  = document.getElementById('btnAnalyze');

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
  hideError();
}

// ── Bulk upload helpers ─────────────────────────────────────────────────────
export const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif|tiff?)$/i;

export function isLikelyImage(f) {
  const t = (f.type || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  if (!t) return IMAGE_EXTS.test(f.name || '');
  return false;
}

export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function updateBulkSelection(files) {
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
