import { supabase } from './supabase';

export interface AuthUser {
  id: string;
  email: string;
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
  return { id: data.user!.id, email: data.user!.email! };
}

export async function restoreSession(): Promise<AuthUser | null> {
  try {
    const session = await loadSession();
    if (!session) return null;
    const { data, error } = await supabase.auth.setSession(session as any);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email! };
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  try {
    await clearSession();
  } catch {}
}
