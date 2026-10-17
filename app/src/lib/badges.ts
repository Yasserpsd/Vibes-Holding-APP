import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/api/client';
import { useLatestPosts } from '@/api/posts';
import { useProjectsList } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
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
 * M75: the tabs' «+N» numbers — unread admin messages for «الإشعارات», fresh bank projects for
 * «بنك المشاريع» (from queries the app fetches anyway), and the server's /api/badges signal for
 * الرئيسية and حسابي. Honest counts only: a section with no reliable signal shows nothing.
 */
export function useTabBadges(): { inbox: number; projects: number; home: number; account: number } {
  const { status } = useAuth();
  const seen = useSeenMarks();
  const posts = useLatestPosts(10);
  const projects = useProjectsList({ q: '', sort: 'latest' });
  const signal = useBadgeSignal(status === 'signedIn');
  return {
    inbox: countNew((posts.data?.posts ?? []).map((post) => post.publishedAt), seen.inbox),
    projects: countNew((projects.data?.pages[0]?.items ?? []).map((project) => project.modifiedAt), seen.projects),
    home: countNew(signal.data?.home ?? [], seen.home),
    account: countNew(signal.data?.account ?? [], seen.account),
  };
}
