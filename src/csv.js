// src/csv.js — CSV export
import { loadArchive, parsePriceMxn, STATUSES, mxnToUsdRate } from './archive.js';
import { showToast } from './ui.js';

export function exportCSV() {
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
