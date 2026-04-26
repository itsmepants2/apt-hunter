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
  try {
    const { data } = await Promise.race([
      supabase.auth.getSession(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('getSession timeout')), 3000)
      ),
    ]);
    return data?.session || null;
  } catch (err) {
    console.warn('[auth] getSession failed or timed out, treating as no session:', err.message);
    return null;
  }
}

export function onAuthStateChange(callback) {
  const supabase = getSupabaseClient();
  return supabase.auth.onAuthStateChange(callback);
}
