// src/db.js — Supabase data layer (future replacement for Gist sync)
import { getSupabaseClient } from './supabase.js';

export async function loadEntries() {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(normalizeEntry);
  } catch {
    return [];
  }
}

export function normalizeEntry(row) {
  // Sidecar: fields without dedicated columns are round-tripped via raw_extraction JSON.
  const sidecar = (row.raw_extraction && typeof row.raw_extraction === 'object' && !Array.isArray(row.raw_extraction))
    ? row.raw_extraction
    : {};
  return {
    id: row.id,
    date: row.created_at,
    url: row.url || null,
    address: row.address || null,
    neighborhood: row.neighborhood || null,
    priceMxn: row.price_mxn || null,
    sizeSqm: row.size_m2 || null,
    bedrooms: row.bedrooms || null,
    bathrooms: row.bathrooms || null,
    contactedNumber: row.contact_phone || null,
    contactedDisplay: row.contact_phone || null,
    notes: row.notes || null,
    status: row.status || 'spotted',
    starred: row.starred || false,
    headline: row.headline || null,
    score: row.score || null,
    scoreBreakdown: row.score_breakdown || null,
    amenities: row.amenities || null,
    extraPhotos: row.photos || [],
    thumbnail: row.photos?.[0] || null,
    allPhones:       sidecar.allPhones       ?? (row.contact_phone ? [row.contact_phone] : []),
    whatsappMessage: sidecar.whatsappMessage ?? '',
    type:            sidecar.type            ?? null,
    extras:          sidecar.extras          ?? null,
    parking:         sidecar.parking         ?? null,
    streetAddress:   sidecar.streetAddress   ?? null,
    sourceUrl:       sidecar.sourceUrl       ?? null,
    price:           sidecar.price           ?? null,
  };
}

export async function saveEntry(entry) {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const row = {
      id:              (() => { const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id?.toString()); return isUuid ? entry.id : crypto.randomUUID(); })(),
      user_id:         user.id,
      url:             entry.url             || null,
      neighborhood:    entry.neighborhood    || null,
      address:         entry.address         || null,
      price_mxn:       parseFloat((entry.priceMxn || entry.price || '').toString().replace(/,/g, '')) || null,
      size_m2:         parseFloat((entry.sizeSqm || '').toString().replace(/,/g, '')) || null,
      bedrooms:        parseInt((entry.bedrooms || '').toString()) || null,
      bathrooms:       parseInt((entry.bathrooms || '').toString()) || null,
      contact_phone:   entry.contactedNumber || (entry.allPhones?.[0]) || null,
      notes:           entry.notes           || null,
      status:          entry.status          || 'spotted',
      starred:         entry.starred         || false,
      headline:        entry.headline        || null,
      score:           entry.score           || null,
      score_breakdown: entry.scoreBreakdown  || null,
      amenities:       entry.amenities       || null,
      photos:          entry.extraPhotos     || null,
      // Sidecar: fields without dedicated columns are JSON-packed here so they round-trip.
      raw_extraction: {
        parking:         entry.parking         ?? null,
        streetAddress:   entry.streetAddress   ?? null,
        sourceUrl:       entry.sourceUrl       ?? null,
        whatsappMessage: entry.whatsappMessage ?? '',
        type:            entry.type            ?? null,
        extras:          entry.extras          ?? null,
        allPhones:       entry.allPhones       ?? null,
        price:           entry.price           ?? null,
      },
    };
    const { data, error } = await supabase
      .from('entries')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

export async function deleteEntry(id) {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('entries')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch {
    // silent
  }
}
