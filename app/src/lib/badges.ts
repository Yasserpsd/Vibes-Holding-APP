import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { apiGet } from '@/api/client';
import { useLatestPosts } from '@/api/posts';
import { useProjectsList } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
import { setAppBadge } from '@/lib/notifications';
import { UNREAD_FEED_LIMIT, useReadPosts, useUnreadPosts } from '@/lib/readPosts';
import { countNew, useSeenMarks } from '@/lib/seen';

/** M75: the server's honest newness signal for الرئيسية (new events, new profiles) and حسابي (my settled payments). */
function useBadgeSignal(signedIn: boolean) {
  return useQuery({
    // The account list is the viewer's own: a sign-in/out swaps the cache entry.
    queryKey: ['badges', signedIn],
    queryFn: () => apiGet<{ home: string[]; account: string[] }>('/api/badges'),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/**
 * M75: the tabs' «+N» numbers — fresh bank projects for «بنك المشاريع» (from a query the app fetches
 * anyway) and the server's /api/badges signal for الرئيسية and حسابي. Honest counts only: a section
 * with no reliable signal shows nothing.
 * M242: «بريد وارد» counts the management messages the member has NOT OPENED (lib/readPosts), so the
 * number stays until each message is read — entering the tab no longer clears it.
 */
export function useTabBadges(): { inbox: number; projects: number; home: number; account: number } {
  const { status } = useAuth();
  const seen = useSeenMarks();
  const unread = useUnreadPosts();
  const projects = useProjectsList({ q: '', sort: 'latest' });
  const signal = useBadgeSignal(status === 'signedIn');
  return {
    inbox: unread.length,
    projects: countNew((projects.data?.pages[0]?.items ?? []).map((project) => project.modifiedAt), seen.projects),
    home: countNew(signal.data?.home ?? [], seen.home),
    account: countNew(signal.data?.account ?? [], seen.account),
  };
}

/**
 * M242: keeps the number on the app icon equal to the unread management messages — written whenever the count
 * changes and again when the app returns to the foreground. Signed out = 0. While the account, the stored read
 * state or the feed is still loading nothing is written, so a launch never wipes a right number with a wrong 0.
 * Mount it once, in a component that lives for the whole launch (GlobalTabBar).
 */
export function useAppIconBadge(): void {
  const { status } = useAuth();
  const read = useReadPosts();
  const feedLoaded = useLatestPosts(UNREAD_FEED_LIMIT).data !== undefined;
  const unread = useUnreadPosts().length;
  const count = status === 'guest' ? 0 : status === 'signedIn' && read.loaded && feedLoaded ? unread : null;
  useEffect(() => {
    if (count === null) return;
    setAppBadge(count);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setAppBadge(count);
    });
    return () => subscription.remove();
  }, [count]);
}
