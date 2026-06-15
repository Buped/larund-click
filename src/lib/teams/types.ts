export interface Team {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
}
