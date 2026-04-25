// src/supabase.js — Supabase client initialisation and credential helpers
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { store } from './archive.js';

export const SUPABASE_URL = 'https://qhfoftkcyfnyahclkxis.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_d62Ed34i4oQjlsfmhZQ7Kg_ecXR4wuM';

export function getSupabaseUrl() { return store.get('apt_hunter_supabase_url') || ''; }
export function getSupabaseKey() { return store.get('apt_hunter_supabase_key') || ''; }

let _client = null;

export function getSupabaseClient() {
  if (_client) return _client;
  const url = getSupabaseUrl() || SUPABASE_URL;
  const key = getSupabaseKey() || SUPABASE_KEY;
  _client = createClient(url, key);
  return _client;
}
