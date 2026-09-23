import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';
import { ABOUT_CONTENT_KEY, ABOUT_SEED } from './about.js';
import { CONTENT_BLOCK_KEYS, contentProblem, readEdits, writeEdits, type ContentBlockKey, type ContentEdit } from './edits.js';
import { ABOUT_EN } from './en/about.js';
import { GOLDEN_EN } from './en/golden.js';
import { HOME_EN } from './en/home.js';
import { HQ_EN } from './en/hq.js';
import { MEMBERSHIP_EN } from './en/membership.js';
import { SERVICES_EN } from './en/services.js';
import { VIDEOS_EN } from './en/videos.js';
import { GOLDEN_CONTENT_KEY, GOLDEN_SEED } from './golden.js';
import { GUIDE_EN } from './en/guide.js';
import { GUIDE_CONTENT_KEY, GUIDE_SEED } from './guide.js';
import { HOME_CONTENT_KEY, HOME_SEED } from './home.js';
import { HQ_CONTENT_KEY, HQ_SEED } from './hq.js';
import { at, wordingOf } from './i18n.js';
import { MEMBERSHIP_CONTENT_KEY, MEMBERSHIP_SEED } from './membership.js';
import { SERVICES_CONTENT_KEY, SERVICES_SEED } from './services.js';
import { VIDEOS_CONTENT_KEY, VIDEOS_SEED } from './videos.js';

/**
 * «محتوى التطبيق» for the dashboard: every text of the seven content blocks in both languages, and the owner's edit
 * of any of them. The list is built from the stored Arabic block (its texts are the paths), the English seed gives
 * the English default, and the edits sit on top (see edits.ts).
 */
export type ContentBlock = { key: ContentBlockKey; label: string; storeKey: string; seed: unknown; translation: unknown };

export const CONTENT_BLOCKS: readonly ContentBlock[] = [
  { key: 'home', label: 'الرئيسية', storeKey: HOME_CONTENT_KEY, seed: HOME_SEED, translation: HOME_EN },
  { key: 'membership', label: 'العضوية', storeKey: MEMBERSHIP_CONTENT_KEY, seed: MEMBERSHIP_SEED, translation: MEMBERSHIP_EN },
  { key: 'services', label: 'الخدمات', storeKey: SERVICES_CONTENT_KEY, seed: SERVICES_SEED, translation: SERVICES_EN },
  { key: 'golden', label: 'المشاريع الذهبية', storeKey: GOLDEN_CONTENT_KEY, seed: GOLDEN_SEED, translation: GOLDEN_EN },
  { key: 'hq', label: 'مقر النادي', storeKey: HQ_CONTENT_KEY, seed: HQ_SEED, translation: HQ_EN },
  { key: 'about', label: 'عن النادي', storeKey: ABOUT_CONTENT_KEY, seed: ABOUT_SEED, translation: ABOUT_EN },
  { key: 'videos', label: 'مكتبة الفيديو', storeKey: VIDEOS_CONTENT_KEY, seed: VIDEOS_SEED, translation: VIDEOS_EN },
  { key: 'guide', label: 'دليل المحايد والورش', storeKey: GUIDE_CONTENT_KEY, seed: GUIDE_SEED, translation: GUIDE_EN },
];

export type AdminContentItem = { block: ContentBlockKey; path: string; ar: string; en: string; arEdit: ContentEdit | null; enEdit: ContentEdit | null };
export type AdminContent = { blocks: { key: ContentBlockKey; label: string; count: number }[]; items: AdminContentItem[]; edited: Record<AppLang, number> };

const baseOf = async (kv: KV, block: ContentBlock): Promise<unknown> => (await kv.get<unknown>(block.storeKey)) ?? block.seed;
const englishOf = (block: ContentBlock, path: string): string => {
  const value = at(block.translation, path);
  return typeof value === 'string' ? value : '';
};

export async function adminContent(kv: KV): Promise<AdminContent> {
  const blocks: AdminContent['blocks'] = [];
  const items: AdminContentItem[] = [];
  const edited: Record<AppLang, number> = { ar: 0, en: 0 };
  for (const block of CONTENT_BLOCKS) {
    const [base, ar, en] = await Promise.all([baseOf(kv, block), readEdits(kv, block.key, 'ar'), readEdits(kv, block.key, 'en')]);
    const wording = wordingOf(base);
    for (const entry of wording) {
      const arEdit = ar.edits[entry.path] ?? null;
      const enEdit = en.edits[entry.path] ?? null;
      if (arEdit) edited.ar += 1;
      if (enEdit) edited.en += 1;
      items.push({ block: block.key, path: entry.path, ar: entry.value, en: englishOf(block, entry.path), arEdit, enEdit });
    }
    blocks.push({ key: block.key, label: block.label, count: wording.length });
  }
  return { blocks, items, edited };
}

export class ContentError extends Error {}

export type ContentEditInput = { block: ContentBlockKey; path: string; lang: AppLang; value: string | null; by: string };

// One save at a time: each one rewrites the block's list for that language (single-instance server).
let chain: Promise<unknown> = Promise.resolve();

/** Saves one text; `value: null` goes back to the block's own text. Answers the edit as stored, or `null`. */
export function saveContentEdit(kv: KV, input: ContentEditInput): Promise<{ edit: ContentEdit | null }> {
  const run = chain.then(() => save(kv, input));
  chain = run.catch(() => undefined);
  return run;
}

async function save(kv: KV, input: ContentEditInput): Promise<{ edit: ContentEdit | null }> {
  const block = CONTENT_BLOCKS.find((entry) => entry.key === input.block);
  if (!block || !CONTENT_BLOCK_KEYS.includes(input.block)) throw new ContentError('هذا القسم غير موجود');
  const entry = wordingOf(await baseOf(kv, block)).find((item) => item.path === input.path);
  if (!entry) throw new ContentError('هذا النص غير موجود في المحتوى');
  const stored = await readEdits(kv, block.key, input.lang);
  let edit: ContentEdit | null = null;
  if (input.value === null) {
    delete stored.edits[input.path];
  } else {
    const problem = contentProblem(input.lang, input.value);
    if (problem) throw new ContentError(problem);
    const value = input.value.trim();
    // The same text as the block's own is not an edit.
    const own = input.lang === 'ar' ? entry.value : englishOf(block, input.path) || entry.value;
    if (value === own) delete stored.edits[input.path];
    else {
      edit = { value, by: input.by, at: new Date().toISOString() };
      stored.edits[input.path] = edit;
    }
  }
  await writeEdits(kv, block.key, input.lang, stored.edits);
  return { edit };
}
