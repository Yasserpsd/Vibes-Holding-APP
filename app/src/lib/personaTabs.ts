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
  const hidden = new Set(home.data?.personas?.[personaKey]?.hideTabs ?? []);
  // The home tab is `index` in the (tabs) navigator and `home` in the twin bar (GlobalTabBar): one name hides both.
  if (hidden.has('home')) hidden.add('index');
  if (hidden.has('index')) hidden.add('home');
  return hidden;
}
