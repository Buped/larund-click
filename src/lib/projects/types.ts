export type ProjectKind = 'personal' | 'company' | 'client' | 'project' | 'custom';
export type ProjectStatus = 'active' | 'archived';

/** Collaboration role of the current user within a project. */
export type ProjectRole = 'owner' | 'member';

export interface Project {
  id: string;
  ownerUserId: string;
  createdByUserId?: string | null;
  name: string;
  description: string;
  kind: ProjectKind;
  status: ProjectStatus;
  color?: string | null;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  lastOpenedAt?: string | null;
  /** The viewing user's role in this project. Attached by listProjects/resolveActiveProject. */
  role?: ProjectRole;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  kind?: ProjectKind;
  color?: string | null;
  icon?: string | null;
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  kind?: ProjectKind;
  color?: string | null;
  icon?: string | null;
  status?: ProjectStatus;
}

export interface ProjectMember {
  userId: string;
  role: ProjectRole;
  email: string | null;
  joinedAt: string;
  invitedByUserId?: string | null;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface ProjectInvitation {
  id: string;
  projectId: string;
  invitedByUserId: string;
  invitedUserId?: string | null;
  invitedEmail: string;
  role: 'member';
  status: InvitationStatus;
  message: string;
  expiresAt: string;
  createdAt: string;
  respondedAt?: string | null;
}

export interface ProjectOwnershipTransfer {
  id: string;
  projectId: string;
  fromUserId: string;
  toUserId?: string | null;
  toEmail: string;
  status: InvitationStatus;
  message: string;
  expiresAt: string;
  createdAt: string;
  respondedAt?: string | null;
}
