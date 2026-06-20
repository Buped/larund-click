// Project collaboration client: thin wrappers over the Supabase RPCs and
// row reads defined in 20260620090000_larund_project_collaboration.sql.
// All authorization is enforced server-side (SECURITY DEFINER + RLS); these
// helpers only translate shapes and surface friendly error messages.

import { supabase } from '../supabase';
import type { ProjectInvitation, ProjectMember, ProjectOwnershipTransfer } from './types';

/** Maps a raw Postgres RPC error code (we raise bare codes) to a UI message. */
const ERROR_MESSAGES: Record<string, string> = {
  no_user_for_email: 'No Larund user found with this email yet.',
  already_member: 'That user is already a member of this project.',
  already_invited: 'That user already has a pending invitation.',
  cannot_invite_self: 'You cannot invite yourself.',
  cannot_transfer_to_self: 'You cannot transfer ownership to yourself.',
  not_owner: 'Only the project owner can do that.',
  not_recipient: 'This request is not addressed to you.',
  not_sender: 'Only the sender can cancel this request.',
  cannot_remove_owner: 'The owner cannot be removed.',
  owner_cannot_leave: 'The owner cannot leave. Transfer ownership or archive the project instead.',
  invitation_not_pending: 'This invitation is no longer pending.',
  invitation_expired: 'This invitation has expired.',
  transfer_not_pending: 'This transfer request is no longer pending.',
  transfer_expired: 'This transfer request has expired.',
  from_no_longer_owner: 'The sender is no longer the owner of this project.',
  not_authenticated: 'You must be signed in.',
};

function friendly(error: { message: string }): Error {
  // Supabase wraps RPC raises; the bare code is usually in the message body.
  const raw = error.message || '';
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (raw.includes(code)) return new Error(ERROR_MESSAGES[code]);
  }
  return new Error(raw || 'Something went wrong.');
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw friendly(error);
  return data as T;
}

// ── Members ────────────────────────────────────────────────────────────────

type MemberRow = { user_id: string; role: 'owner' | 'member'; email: string | null; joined_at: string; invited_by_user_id: string | null };

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const rows = await rpc<MemberRow[]>('list_project_members', { p_project_id: projectId });
  return (rows ?? []).map((r) => ({
    userId: r.user_id,
    role: r.role,
    email: r.email,
    joinedAt: r.joined_at,
    invitedByUserId: r.invited_by_user_id,
  }));
}

export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  await rpc('remove_project_member', { p_project_id: projectId, p_user_id: userId });
}

export async function leaveProject(projectId: string): Promise<void> {
  await rpc('leave_project', { p_project_id: projectId });
}

// ── Invitations ──────────────────────────────────────────────────────────────

type InvitationRow = {
  id: string; project_id: string; invited_by_user_id: string; invited_user_id: string | null;
  invited_email: string; role: 'member'; status: ProjectInvitation['status']; message: string;
  expires_at: string; created_at: string; responded_at: string | null;
};

function toInvitation(r: InvitationRow): ProjectInvitation {
  return {
    id: r.id,
    projectId: r.project_id,
    invitedByUserId: r.invited_by_user_id,
    invitedUserId: r.invited_user_id,
    invitedEmail: r.invited_email,
    role: r.role,
    status: r.status,
    message: r.message,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
  };
}

export async function inviteProjectMember(projectId: string, email: string, message = ''): Promise<ProjectInvitation> {
  const row = await rpc<InvitationRow>('invite_project_member', { p_project_id: projectId, p_email: email, p_message: message });
  return toInvitation(row);
}

export async function acceptProjectInvitation(invitationId: string): Promise<ProjectInvitation> {
  return toInvitation(await rpc<InvitationRow>('accept_project_invitation', { p_invitation_id: invitationId }));
}

export async function declineProjectInvitation(invitationId: string): Promise<ProjectInvitation> {
  return toInvitation(await rpc<InvitationRow>('decline_project_invitation', { p_invitation_id: invitationId }));
}

export async function cancelProjectInvitation(invitationId: string): Promise<ProjectInvitation> {
  return toInvitation(await rpc<InvitationRow>('cancel_project_invitation', { p_invitation_id: invitationId }));
}

/** Pending invitations the owner has sent for a project (read via RLS). */
export async function listProjectInvitations(projectId: string): Promise<ProjectInvitation[]> {
  const { data, error } = await supabase
    .from('larund_project_invitations')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw friendly(error);
  return ((data ?? []) as InvitationRow[]).map(toInvitation);
}

// ── Ownership transfers ──────────────────────────────────────────────────────

type TransferRow = {
  id: string; project_id: string; from_user_id: string; to_user_id: string | null; to_email: string;
  status: ProjectOwnershipTransfer['status']; message: string; expires_at: string; created_at: string; responded_at: string | null;
};

function toTransfer(r: TransferRow): ProjectOwnershipTransfer {
  return {
    id: r.id,
    projectId: r.project_id,
    fromUserId: r.from_user_id,
    toUserId: r.to_user_id,
    toEmail: r.to_email,
    status: r.status,
    message: r.message,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
  };
}

export async function requestProjectOwnershipTransfer(projectId: string, email: string, message = ''): Promise<ProjectOwnershipTransfer> {
  return toTransfer(await rpc<TransferRow>('request_project_ownership_transfer', { p_project_id: projectId, p_email: email, p_message: message }));
}

export async function acceptProjectOwnershipTransfer(requestId: string): Promise<void> {
  await rpc('accept_project_ownership_transfer', { p_request_id: requestId });
}

export async function declineProjectOwnershipTransfer(requestId: string): Promise<ProjectOwnershipTransfer> {
  return toTransfer(await rpc<TransferRow>('decline_project_ownership_transfer', { p_request_id: requestId }));
}

export async function cancelProjectOwnershipTransfer(requestId: string): Promise<ProjectOwnershipTransfer> {
  return toTransfer(await rpc<TransferRow>('cancel_project_ownership_transfer', { p_request_id: requestId }));
}

/** Pending outgoing ownership transfers for a project (read via RLS). */
export async function listProjectOwnershipTransfers(projectId: string): Promise<ProjectOwnershipTransfer[]> {
  const { data, error } = await supabase
    .from('larund_project_ownership_transfers')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw friendly(error);
  return ((data ?? []) as TransferRow[]).map(toTransfer);
}
