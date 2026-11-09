import { riyadhDay } from '../riyadh.js';
import type { KV } from '../store.js';

/**
 * M219 (owner, 2026-11-09: «الأخبار اللي يوصل بيها نوتفكيشن تكون 2 فقط في اليوم — أحيانًا بيوصل فوق 8»):
 * ONE budget for every automatic news push. Before it, three senders each kept their own cap (editions 2,
 * decisions 3, breaking 2 or whatever the dashboard card said) and the totals simply added up. Every news
 * wave now takes a slot here first; with no slot left the wave is not sent, whoever asks.
 */
export const NEWS_PUSH_CAP_KEY = 'push:news:cap';
export const NEWS_PUSH_DAILY_CAP = 2;

type CapState = { day: string; sent: number };

export class NewsPushCap {
  /** Takes and refunds run one at a time: two senders in the same minute never both read «one slot left». */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly kv: KV,
    private readonly max = NEWS_PUSH_DAILY_CAP,
  ) {}

  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async state(day: string): Promise<CapState> {
    const saved = await this.kv.get<CapState>(NEWS_PUSH_CAP_KEY);
    return saved?.day === day ? saved : { day, sent: 0 };
  }

  /** Reserves one of today's slots (Riyadh day) BEFORE the send; false when the day is full. */
  take(now = Date.now()): Promise<boolean> {
    return this.run(async () => {
      const state = await this.state(riyadhDay(now));
      if (state.sent >= this.max) return false;
      await this.kv.set(NEWS_PUSH_CAP_KEY, { day: state.day, sent: state.sent + 1 } satisfies CapState);
      return true;
    });
  }

  /** A day with no record yet (the deploy day, a wiped key): start from what already went out, never from zero. */
  seed(alreadySent: number, now = Date.now()): Promise<void> {
    return this.run(async () => {
      const day = riyadhDay(now);
      const saved = await this.kv.get<CapState>(NEWS_PUSH_CAP_KEY);
      if (saved?.day !== day) await this.kv.set(NEWS_PUSH_CAP_KEY, { day, sent: Math.min(this.max, Math.max(0, alreadySent)) } satisfies CapState);
    });
  }

  /** Gives the slot back when the wave reached nobody. */
  refund(now = Date.now()): Promise<void> {
    return this.run(async () => {
      const state = await this.state(riyadhDay(now));
      if (state.sent > 0) await this.kv.set(NEWS_PUSH_CAP_KEY, { day: state.day, sent: state.sent - 1 } satisfies CapState);
    });
  }

  async sentToday(now = Date.now()): Promise<number> {
    return (await this.state(riyadhDay(now))).sent;
  }
}
