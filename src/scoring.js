// src/scoring.js — pure scoring engine, no DOM/localStorage/imports

const AMENIDAD_KEYWORDS = {
  elevador:    ['elevador'],
  terraza:     ['terraza', 'balcón', 'balcon'],
  seguridad24h:['seguridad 24', 'seguridad24'],
  gimnasio:    ['gimnasio'],
  alberca:     ['alberca'],
  mascotas:    ['mascota', 'pets', 'pet-friendly'],
  amueblado:   ['amueblado', 'amoblado', 'furnished'],
};

function parseNum(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

function amenidadPresent(amenidades, keywords) {
  const haystack = (amenidades ?? '').toLowerCase();
  return keywords.some(kw => haystack.includes(kw.toLowerCase()));
}

export function scoreEntry(entry, profile) {
  if (!profile) return { total: null, breakdown: {} };

  let earned = 0;
  let maxPossible = 0;
  const breakdown = {};

  // ── Numeric: recamaras (min, 2 pts) ───────────────────────────────────────
  const profRec = parseNum(profile.recamaras);
  if (profRec > 0) {
    const entRec = parseNum(entry.recamaras);
    const ok = entRec >= profRec;
    breakdown.recamaras = { score: ok ? 2 : 0, max: 2, label: ok ? `${entRec} rec. ✓` : `${entRec} rec. ✗` };
    earned += breakdown.recamaras.score;
    maxPossible += 2;
  } else {
    breakdown.recamaras = { score: 0, max: 0, label: '' };
  }

  // ── Numeric: banos (min, 1 pt) ────────────────────────────────────────────
  const profBan = parseNum(profile.banos);
  if (profBan > 0) {
    const entBan = parseNum(entry.banos);
    const ok = entBan >= profBan;
    breakdown.banos = { score: ok ? 1 : 0, max: 1, label: ok ? `${entBan} baños ✓` : `${entBan} baños ✗` };
    earned += breakdown.banos.score;
    maxPossible += 1;
  } else {
    breakdown.banos = { score: 0, max: 0, label: '' };
  }

  // ── Numeric: estacionamiento (min, 1 pt) ──────────────────────────────────
  const profEst = parseNum(profile.estacionamiento);
  if (profEst > 0) {
    const entEst = parseNum(entry.estacionamiento);
    const ok = entEst >= profEst;
    breakdown.estacionamiento = { score: ok ? 1 : 0, max: 1, label: ok ? `${entEst} est. ✓` : `${entEst} est. ✗` };
    earned += breakdown.estacionamiento.score;
    maxPossible += 1;
  } else {
    breakdown.estacionamiento = { score: 0, max: 0, label: '' };
  }

  // ── Numeric: precio (max, 2 pts) ──────────────────────────────────────────
  const profPrecio = parseNum(profile.precio);
  if (profPrecio > 0) {
    const entPrecio = parseNum(entry.precio);
    const ok = entPrecio > 0 && entPrecio <= profPrecio;
    breakdown.precio = { score: ok ? 2 : 0, max: 2, label: ok ? `$${entPrecio.toLocaleString()} ✓` : `$${entPrecio.toLocaleString()} ✗` };
    earned += breakdown.precio.score;
    maxPossible += 2;
  } else {
    breakdown.precio = { score: 0, max: 0, label: '' };
  }

  // ── Numeric: tamano (min, 1 pt) ───────────────────────────────────────────
  const profTam = parseNum(profile.tamano);
  if (profTam > 0) {
    const entTam = parseNum(entry.tamano);
    const ok = entTam >= profTam;
    breakdown.tamano = { score: ok ? 1 : 0, max: 1, label: ok ? `${entTam} m² ✓` : `${entTam} m² ✗` };
    earned += breakdown.tamano.score;
    maxPossible += 1;
  } else {
    breakdown.tamano = { score: 0, max: 0, label: '' };
  }

  // ── Colonias (2 pts) ──────────────────────────────────────────────────────
  const prefColonias = (profile.coloniasPreferidas ?? [])
    .map(c => c.trim().toLowerCase())
    .filter(Boolean);
  if (prefColonias.length > 0) {
    const entColonia = (entry.colonia ?? '').trim().toLowerCase();
    const ok = prefColonias.includes(entColonia);
    breakdown.colonias = { score: ok ? 2 : 0, max: 2, label: ok ? `${entry.colonia} ✓` : `${entry.colonia ?? '—'} ✗` };
    earned += breakdown.colonias.score;
    maxPossible += 2;
  } else {
    breakdown.colonias = { score: 0, max: 0, label: '' };
  }

  // ── Amenidades ────────────────────────────────────────────────────────────
  const amenidadesStr = entry.amenidades ?? '';

  for (const [key, keywords] of Object.entries(AMENIDAD_KEYWORDS)) {
    const importance = profile[key] ?? null; // 'want' | 'must' | null
    if (!importance) {
      breakdown[key] = { score: 0, max: 0, label: '' };
      continue;
    }

    const present = amenidadPresent(amenidadesStr, keywords);
    const displayKey = key.charAt(0).toUpperCase() + key.slice(1);

    if (importance === 'want') {
      if (present) {
        breakdown[key] = { score: 1, max: 1, label: `${displayKey} ✓` };
        earned += 1;
        maxPossible += 1;
      } else {
        breakdown[key] = { score: 0, max: 1, label: `Sin ${displayKey.toLowerCase()} ✗` };
        maxPossible += 1;
      }
    } else if (importance === 'must') {
      if (present) {
        breakdown[key] = { score: 3, max: 3, label: `${displayKey} ✓` };
        earned += 3;
        maxPossible += 3;
      } else {
        breakdown[key] = { score: -8, max: 3, label: `Sin ${displayKey.toLowerCase()} ✗` };
        earned -= 8;
        maxPossible += 3;
      }
    }
  }

  // ── Total ─────────────────────────────────────────────────────────────────
  if (maxPossible === 0) return { total: null, breakdown: {} };

  const total = Math.max(0, Math.round((earned / maxPossible) * 100));
  return { total, breakdown };
}
