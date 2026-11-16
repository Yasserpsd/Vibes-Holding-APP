import type { KV } from '../store.js';

/**
 * M243 (owner, 2026-11-16: «اعرف مين فتح المقال ومين شاف واعرف الأسماء»): who opened each management message.
 * One record per member per message, written when a signed-in member opens the message screen
 * (GET /api/posts/:id). Guests have no identity and are not recorded. The read mark the app shows lives on
 * the phone (app/src/lib/readPosts.ts); this is the dashboard's view only.
 */
export type PostOpen = { contactId: number; name: string; persona: string; first: string; last: string; count: number };
type OpensDoc = { opens: Record<string, PostOpen> };

export const postOpensKey = (postId: string) => `posts:opens:${postId}`;

/** A second open inside this window refreshes nothing: a member scrolling back into the message is one visit. */
const REVISIT_MS = 5 * 60_000;

export class PostOpens {
  private chain: Promise<unknown> = Promise.resolve();

  /** `postIds` lists every stored message, so a deleted account can be removed from all of them. */
  constructor(
    private readonly kv: KV,
    private readonly postIds: () => Promise<string[]> = async () => [],
  ) {}

  private async doc(postId: string): Promise<OpensDoc> {
    return (await this.kv.get<OpensDoc>(postOpensKey(postId))) ?? { opens: {} };
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Never throws: a failed record must not cost the member his message. */
  record(postId: string, member: { contactId: number; name: string; persona: string }, now = new Date()): Promise<void> {
    return this.serial(async () => {
      const doc = await this.doc(postId);
      const key = String(member.contactId);
      const at = now.toISOString();
      const before = doc.opens[key];
      if (before && now.getTime() - Date.parse(before.last) < REVISIT_MS) return;
      doc.opens[key] = before
        ? { ...before, name: member.name || before.name, persona: member.persona || before.persona, last: at, count: before.count + 1 }
        : { contactId: member.contactId, name: member.name, persona: member.persona, first: at, last: at, count: 1 };
      await this.kv.set(postOpensKey(postId), doc);
    }).catch(() => undefined);
  }

  /** Every member who opened the message, the latest open first. */
  async list(postId: string): Promise<PostOpen[]> {
    return Object.values((await this.doc(postId)).opens).sort((a, b) => b.last.localeCompare(a.last));
  }

  /** How many members opened each message (0 when nobody did). */
  async counts(postIds: string[]): Promise<Record<string, number>> {
    const entries = await Promise.all(postIds.map(async (id) => [id, Object.keys((await this.doc(id)).opens).length] as const));
    return Object.fromEntries(entries);
  }

  /** M216 rule: a deleted account leaves no name behind — its opens leave every message. */
  forgetContact(contactId: number): Promise<void> {
    return this.serial(async () => {
      for (const id of await this.postIds()) {
        const doc = await this.doc(id);
        if (!doc.opens[String(contactId)]) continue;
        delete doc.opens[String(contactId)];
        await this.kv.set(postOpensKey(id), doc);
      }
    });
  }

  /** The message left the dashboard: its opens go with it. */
  forget(postId: string): Promise<void> {
    return this.serial(() => this.kv.delete(postOpensKey(postId)));
  }
}
