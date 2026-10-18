import { useHomeContent, type PortalKey } from '@/api/content';
import { useAuth } from '@/auth/AuthProvider';

/**
 * M99: the tab routes the current persona never sees (server-driven, e.g. the Projects Bank leaves the
 * entrepreneur's bar). Empty while the home content loads, so the bar never flashes a wrong layout.
 */
export function useHiddenTabs(): Set<string> {
  const { status, me } = useAuth();
  const home = useHomeContent();
  const personaKey: PortalKey | 'guest' = status === 'signedIn' ? (me?.persona || 'neutral') : 'guest';
  return new Set(home.data?.personas?.[personaKey]?.hideTabs ?? []);
}
