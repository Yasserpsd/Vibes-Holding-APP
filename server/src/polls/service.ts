import { RequestError } from '../auth/guard.js';
import { pollClosed, type Post, type PostPoll } from '../posts/service.js';
import type { KV } from '../store.js';

/**
 * M31: votes of the «استفتاء» posts. The poll itself (question, options, closing moment) lives on
 * its post; this keeps one small document per poll — who chose what — so a member counts once
 * and may change his choice until the poll closes. Counts reach a voter only after he voted
 * (and only when the poll shows its results); the dashboard always sees them.
 */
export const pollVotesKey = (postId: string) => `polls:votes:${postId}`;

type VotesDoc = { votes: Record<string, string> };

/** The poll as one viewer sees it: counts stay null until he may read them. */
export type PollView = {
  options: { id: string; label: string; votes: number | null }[];
  closesAt: string | null;
  closed: boolean;
  resultsVisible: boolean;
  totalVotes: number | null;
  myVote: string | null;
};

export class PollsService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly kv: KV) {}

  private async load(postId: string): Promise<Record<string, string>> {
    return (await this.kv.get<VotesDoc>(pollVotesKey(postId)))?.votes ?? {};
  }

  /** One member, one standing vote; a new choice replaces the old one until the poll closes. */
  async vote(post: Post, contactId: number, optionId: string, now = Date.now()): Promise<void> {
    const poll = post.poll;
    if (post.kind !== 'poll' || !poll) throw new RequestError('not_poll', 'هذا المنشور ليس استفتاء', 400);
    if (pollClosed(poll, now)) throw new RequestError('poll_closed', 'انتهى هذا الاستفتاء ولم يعد التصويت متاحًا', 409);
    if (!poll.options.some((option) => option.id === optionId)) throw new RequestError('bad_option', 'هذا الخيار غير موجود في الاستفتاء', 400);
    const run = this.chain.then(async () => {
      const votes = await this.load(post.id);
      votes[String(contactId)] = optionId;
      await this.kv.set(pollVotesKey(post.id), { votes });
    });
    this.chain = run.catch(() => undefined);
    await run;
  }

  /** Counts per option (removed options' votes count nowhere) and the total of counted voters. */
  async results(postId: string, poll: PostPoll): Promise<{ counts: Record<string, number>; total: number }> {
    const votes = await this.load(postId);
    const counts = Object.fromEntries(poll.options.map((option) => [option.id, 0]));
    let total = 0;
    for (const optionId of Object.values(votes)) {
      if (counts[optionId] !== undefined) {
        counts[optionId] += 1;
        total += 1;
      }
    }
    return { counts, total };
  }

  /**
   * The poll block a response carries. A voter reads the counts after his vote when the poll shows
   * its results, everyone reads them once it closed (still only when it shows them); the dashboard
   * (`admin`) always reads them.
   */
  async view(post: Post, contactId: number | null, admin = false, now = Date.now()): Promise<PollView | null> {
    const poll = post.poll;
    if (post.kind !== 'poll' || !poll) return null;
    const closed = pollClosed(poll, now);
    const myVote = contactId === null ? null : ((await this.load(post.id))[String(contactId)] ?? null);
    const open = admin || (poll.resultsVisible && (myVote !== null || closed));
    const { counts, total } = open ? await this.results(post.id, poll) : { counts: {}, total: 0 };
    return {
      options: poll.options.map((option) => ({ id: option.id, label: option.label, votes: open ? (counts[option.id] ?? 0) : null })),
      closesAt: poll.closesAt,
      closed,
      resultsVisible: poll.resultsVisible,
      totalVotes: open ? total : null,
      myVote,
    };
  }

  /** A deleted poll takes its votes with it. */
  async remove(postId: string): Promise<void> {
    const run = this.chain.then(() => this.kv.delete(pollVotesKey(postId)));
    this.chain = run.catch(() => undefined);
    await run;
  }
}
