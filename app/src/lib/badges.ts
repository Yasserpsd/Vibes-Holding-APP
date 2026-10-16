import { useLatestPosts } from '@/api/posts';
import { useProjectsList } from '@/api/queries';
import { countNew, useSeenMarks } from '@/lib/seen';

/**
 * M75: the tabs' «+N» numbers, computed from queries the app fetches anyway — unread admin
 * messages for «الإشعارات», fresh bank projects for «بنك المشاريع». Honest counts only: a
 * section with no reliable newness signal shows nothing rather than a guess.
 */
export function useTabBadges(): { inbox: number; projects: number } {
  const seen = useSeenMarks();
  const posts = useLatestPosts(10);
  const projects = useProjectsList({ q: '', sort: 'latest' });
  return {
    inbox: countNew((posts.data?.posts ?? []).map((post) => post.publishedAt), seen.inbox),
    projects: countNew((projects.data?.pages[0]?.items ?? []).map((project) => project.modifiedAt), seen.projects),
  };
}
