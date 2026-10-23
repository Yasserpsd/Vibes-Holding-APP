import type { FastifyBaseLogger } from 'fastify';

import type { KV } from '../store.js';
import type { Translator } from '../translate.js';
import { CONTENT_BLOCKS, saveContentEdit } from './admin.js';
import { readEdits, type ContentBlockKey } from './edits.js';
import { at, isArabic, wordingOf } from './i18n.js';

/**
 * M122 (owner: «حط اداة فحص تفحص اي حاجه مكتوبة عربي في نسخة انجليزي وتترجمها فورا»): the English
 * sweep. It walks every content block the way the ENGLISH app reads it and finds two kinds of holes:
 * an English value that still contains Arabic (a dashboard-grown text the English seed never knew),
 * and an Arabic edit of the owner's whose English never followed. Each hole is translated once by AI
 * and stored as an English edit signed `AI_BY` — the owner's own English edits (any other signature)
 * are never overwritten, and a failed translation simply waits for the next pass.
 *
 * It runs shortly after boot, then on a slow interval, and `kick()` schedules a quick pass moments
 * after every Arabic edit the dashboard saves — so the owner posts Arabic and English follows alone.
 */
export type SweepOutcome = { checked: number; translated: number; failed: number };

const FIRST_RUN_MS = 15_000;
const KICK_DELAY_MS = 5_000;
const INTERVAL_MINUTES = 360;
const BATCH = 40;

/** The signature of AI-written English edits: what the sweep wrote, the sweep may rewrite. */
export const AI_BY = 'ترجمة تلقائية (AI)';

type Deps = { kv: KV; translator: Translator; log: FastifyBaseLogger; bump?: () => Promise<void> };

type Target = { block: ContentBlockKey; path: string; arabic: string };

export class EnglishSweep {
  private timer: NodeJS.Timeout | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private running = false;
  private last: (SweepOutcome & { at: string }) | null = null;

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.deps.translator.mode === 'off') return;
    const schedule = (ms: number) => {
      this.timer = setTimeout(() => {
        void this.run().finally(() => schedule(INTERVAL_MINUTES * 60_000));
      }, ms);
      this.timer.unref();
    };
    schedule(FIRST_RUN_MS);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.timer = null;
    this.kickTimer = null;
  }

  /** An Arabic edit was just saved: run again in a few seconds (several saves share one pass). */
  kick(): void {
    if (this.deps.translator.mode === 'off') return;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => void this.run(), KICK_DELAY_MS);
    this.kickTimer.unref();
  }

  status(): { mode: Translator['mode']; last: (SweepOutcome & { at: string }) | null } {
    return { mode: this.deps.translator.mode, last: this.last };
  }

  async run(): Promise<SweepOutcome> {
    const outcome: SweepOutcome = { checked: 0, translated: 0, failed: 0 };
    if (this.running || this.deps.translator.mode === 'off') return outcome;
    this.running = true;
    try {
      const targets: Target[] = [];
      for (const block of CONTENT_BLOCKS) {
        const base = (await this.deps.kv.get<unknown>(block.storeKey)) ?? block.seed;
        const [arStored, enStored] = await Promise.all([readEdits(this.deps.kv, block.key, 'ar'), readEdits(this.deps.kv, block.key, 'en')]);
        const arEdits = arStored.edits;
        for (const entry of wordingOf(base)) {
          outcome.checked += 1;
          const arEdit = arEdits[entry.path];
          const arabicNow = arEdit?.value ?? entry.value;
          const enEdit = enStored.edits[entry.path];
          const seed = at(block.translation, entry.path);
          const englishNow = enEdit?.value ?? (typeof seed === 'string' ? seed : '');
          const hole = !englishNow || isArabic(englishNow);
          const stale = arEdit && (!enEdit || (enEdit.by === AI_BY && enEdit.at < arEdit.at));
          const mine = !enEdit || enEdit.by === AI_BY;
          if ((hole && mine) || stale) targets.push({ block: block.key, path: entry.path, arabic: arabicNow });
        }
      }
      for (let start = 0; start < targets.length && start < 400; start += BATCH) {
        const batch = targets.slice(start, start + BATCH);
        const out = await this.deps.translator.translate(batch.map((target) => target.arabic));
        if (!out) {
          outcome.failed += batch.length;
          continue;
        }
        for (const [index, target] of batch.entries()) {
          const english = (out[index] ?? '').trim();
          if (!english || isArabic(english)) {
            outcome.failed += 1;
            continue;
          }
          try {
            await saveContentEdit(this.deps.kv, { block: target.block, path: target.path, lang: 'en', value: english, by: AI_BY });
            outcome.translated += 1;
          } catch {
            outcome.failed += 1;
          }
        }
      }
      if (outcome.translated || outcome.failed) this.deps.log.info(outcome, 'english sweep');
      // Open apps hear the new English through /api/sync and read the blocks again.
      if (outcome.translated) await this.deps.bump?.().catch(() => undefined);
      this.last = { ...outcome, at: new Date().toISOString() };
      return outcome;
    } finally {
      this.running = false;
    }
  }
}
