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
    const { data, error } = await supabase
      .from('entries')
      .upsert(entry, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[db] saveEntry failed', err);
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
