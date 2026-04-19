// src/auth.js — Google OAuth via Supabase
import { getSupabaseClient } from './supabase.js';

export async function signInWithGoogle() {
  const supabase = getSupabaseClient();
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://itsmepants2.github.io/apt-hunter' },
  });
}

export async function signOut() {
  const supabase = getSupabaseClient();
  return supabase.auth.signOut();
}

export async function getSession() {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export function onAuthStateChange(callback) {
  const supabase = getSupabaseClient();
  return supabase.auth.onAuthStateChange(callback);
}
