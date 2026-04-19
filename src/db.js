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
    return data ?? [];
  } catch {
    return [];
  }
}

export async function saveEntry(entry) {
  console.log('[db] saveEntry called', entry?.id);
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    const row = {
      id:              (() => { const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id?.toString()); return isUuid ? entry.id : crypto.randomUUID(); })(),
      user_id:         user?.id,
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
      raw_extraction:  entry.raw             || null,
    };
    const { data, error } = await supabase
      .from('entries')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[db] saveEntry failed', err?.message, err?.details, err);
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
  } catch (err) {
    console.error('[db] deleteEntry failed', err);
  }
}
