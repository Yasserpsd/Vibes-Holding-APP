import { useQuery } from '@tanstack/react-query';

import { apiGet } from './client';

// Mirrors server/src/invites/routes.ts (M32): the member's invite code and his nominees.
export type InviteeState = 'registered' | 'verified' | 'member';

export type Invitee = { name: string; at: string; state: InviteeState };

export type MyInvites = {
  /** The member's own membership number — the invite code he shares. */
  code: string;
  /** Sharing needs an active annual membership. */
  eligible: boolean;
  giftText: string;
  shareText: string;
  invited: Invitee[];
};

export function useMyInvites(enabled: boolean) {
  return useQuery({
    queryKey: ['invites', 'mine'],
    queryFn: () => apiGet<MyInvites>('/api/invites'),
    enabled,
    staleTime: 60_000,
  });
}
