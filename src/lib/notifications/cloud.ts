// Supabase-backed notifications (table: public.larund_notifications).
// These are the cross-user, in-app notifications used by the project
// collaboration flow (invitations, ownership transfers, membership changes).
// They are distinct from the local task notifications in ./store.ts, which stay
// machine-local. Rows are INSERTed only by SECURITY DEFINER RPCs server-side;
// the client can read / mark-read / delete its own rows under RLS.

import { supabase } from '../supabase';

export type CloudNotificationType =
  | 'project_invitation_received'
  | 'project_invitation_accepted'
  | 'project_invitation_declined'
  | 'project_ownership_transfer_received'
  | 'project_ownership_transfer_accepted'
  | 'project_ownership_transfer_declined'
  | 'project_member_added'
  | 'project_member_removed';

export interface CloudNotification {
  id: string;
  userId: string;
  type: CloudNotificationType | string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const TABLE = 'larund_notifications';

type Row = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

function toNotification(r: Row): CloudNotification {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    title: r.title,
    body: r.body,
    payload: r.payload ?? {},
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

export async function listCloudNotifications(limit = 50): Promise<CloudNotification[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toNotification);
}

export async function unreadCloudCount(): Promise<number> {
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function markCloudRead(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function markAllCloudRead(): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (error) throw new Error(error.message);
}

export async function deleteCloudNotification(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(error.message);
}
