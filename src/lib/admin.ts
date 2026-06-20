// Admin role detection. The AUTHORITATIVE source is Supabase: the `is_admin`
// RPC and `current_user_roles`, both backed by public.user_roles. No user can
// make themselves admin from the client: role writes are blocked by RLS and only
// the service role / admin RPCs can change roles.
//
// A small cache of the verified result may be written for non-authoritative UI
// hints, but admin-only gates must use AuthUser.isAdmin from login/restore.
// Tampering with localStorage must not reveal admin UI or grant privileges.

import { supabase } from './supabase';

export interface AdminState {
  isAdmin: boolean;
  roles: string[];
}

const ADMIN_CACHE_KEY = 'larund_admin';

// Dev-only shortcut. NEVER authoritative in production — only honored when the
// Vite build is in dev mode (import.meta.env.DEV). Configure via VITE_ADMIN_EMAILS
// (comma-separated) to test admin UI without seeding the DB.
const DEV_ADMIN_EMAILS: string[] = ((import.meta.env.VITE_ADMIN_EMAILS as string | undefined) ?? '')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

function devShortcutAdmin(email?: string | null): boolean {
  return Boolean(import.meta.env.DEV && email && DEV_ADMIN_EMAILS.includes(email.toLowerCase()));
}

/** All roles the signed-in user holds (e.g. ['admin']). [] when none / on error. */
export async function getCurrentUserRoles(): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('current_user_roles');
    if (error || !Array.isArray(data)) return [];
    return (data as unknown[]).map(String);
  } catch {
    return [];
  }
}

/** The user's primary role for display: 'admin' if they hold it, else 'user'. */
export async function getCurrentUserRole(): Promise<string> {
  const roles = await getCurrentUserRoles();
  return roles.includes('admin') ? 'admin' : 'user';
}

/** Authoritative admin check via the Supabase is_admin RPC (uses auth.uid()). */
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_admin');
    if (!error && typeof data === 'boolean') return data;
  } catch { /* fall through */ }
  return false;
}

/**
 * Resolve the full admin state for the signed-in user from Supabase, write the
 * verified value to the cache, and return it. `email` enables the dev-only
 * VITE_ADMIN_EMAILS shortcut. Never throws.
 */
export async function getAdminState(_userId?: string, email?: string | null): Promise<AdminState> {
  let roles: string[] = [];
  let isAdmin = false;
  try {
    isAdmin = await isCurrentUserAdmin();
    roles = await getCurrentUserRoles();
    if (roles.includes('admin')) isAdmin = true;
  } catch { /* defaults below */ }

  if (!isAdmin && devShortcutAdmin(email)) {
    isAdmin = true;
    if (!roles.includes('admin')) roles = [...roles, 'admin'];
  }

  cacheAdminState(isAdmin);
  return { isAdmin, roles };
}

/** Persist the verified admin flag for cheap UI hints. UI-only; not a source of truth. */
export function cacheAdminState(isAdmin: boolean): void {
  try {
    if (isAdmin) localStorage.setItem(ADMIN_CACHE_KEY, 'true');
    else localStorage.removeItem(ADMIN_CACHE_KEY);
  } catch { /* ignore */ }
}

export function clearAdminCache(): void {
  try { localStorage.removeItem(ADMIN_CACHE_KEY); } catch { /* ignore */ }
}

/** Cached admin hint for components that can't easily receive the prop. */
export function isAdminCached(): boolean {
  try { return localStorage.getItem(ADMIN_CACHE_KEY) === 'true'; } catch { return false; }
}

/** Developer/admin UI surfaces require BOTH verified admin state from AuthUser
 *  and the developer-mode opt-in toggle. Non-admins never see these surfaces. */
export function isDeveloperUiEnabled(verifiedIsAdmin: boolean): boolean {
  try {
    return verifiedIsAdmin && localStorage.getItem('developer_mode') === 'true';
  } catch {
    return false;
  }
}
