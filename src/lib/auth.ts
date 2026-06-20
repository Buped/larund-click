import { supabase } from './supabase';
import { getAdminState, clearAdminCache } from './admin';

export interface AuthUser {
  id: string;
  email: string;
  /** True when the user holds the 'admin' role in Supabase (public.user_roles). */
  isAdmin: boolean;
}

/** Resolve admin status from Supabase. Best-effort: defaults to non-admin. */
async function resolveAdmin(id: string, email: string): Promise<boolean> {
  try {
    const state = await getAdminState(id, email);
    return state.isAdmin;
  } catch {
    return false;
  }
}

async function getStore() {
  try {
    const { Store } = await import('@tauri-apps/plugin-store');
    return await Store.load('auth.dat');
  } catch {
    return null;
  }
}

async function persistSession(session: unknown) {
  const store = await getStore();
  if (store) {
    try {
      await store.set('session', session);
      await store.save();
      return;
    } catch {
      // IPC call failed — fall through to sessionStorage
    }
  }
  sessionStorage.setItem('session', JSON.stringify(session));
}

async function loadSession(): Promise<unknown | null> {
  const store = await getStore();
  if (store) {
    try {
      const val = await store.get('session');
      if (val !== null && val !== undefined) return val;
    } catch {
      // fall through to sessionStorage
    }
  }
  const raw = sessionStorage.getItem('session');
  return raw ? JSON.parse(raw) : null;
}

async function clearSession() {
  const store = await getStore();
  if (store) {
    try {
      await store.delete('session');
      await store.save();
      return;
    } catch {
      // fall through
    }
  }
  sessionStorage.removeItem('session');
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  await persistSession(data.session);
  const id = data.user!.id;
  const userEmail = data.user!.email!;
  return { id, email: userEmail, isAdmin: await resolveAdmin(id, userEmail) };
}

export async function restoreSession(): Promise<AuthUser | null> {
  try {
    const session = await loadSession();
    if (!session) return null;
    const { data, error } = await supabase.auth.setSession(session as any);
    if (error || !data.user) return null;
    const id = data.user.id;
    const email = data.user.email!;
    return { id, email, isAdmin: await resolveAdmin(id, email) };
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  clearAdminCache();
  try {
    await clearSession();
  } catch {}
}
