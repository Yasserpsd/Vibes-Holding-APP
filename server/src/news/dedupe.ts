import { normalizeForSearch } from '../projectsBank/text.js';
import type { NewsItem, SourceTier } from './types.js';

const STOP_WORDS = new Set([
  'في', 'من', 'على', 'الى', 'إلى', 'عن', 'مع', 'ان', 'أن', 'إن', 'بعد', 'قبل', 'خلال', 'بين', 'حتى', 'هذا', 'هذه', 'التي', 'الذي', 'ما', 'لا', 'او', 'أو', 'و', 'يا',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'with', 'at', 'by', 'as', 'is', 'are', 'after', 'before', 'from', 'its', 'it', 'be', 'will',
]);
const PREFIXES = /^(وال|بال|فال|كال|لل|ال|و|ب|ل)/;
/** Two items closer than this in time with similar titles tell the same story. */
export const DUPLICATE_WINDOW_MS = 72 * 3_600_000;
export const DUPLICATE_THRESHOLD = 0.6;

/** Content words of a title, with Arabic prefixes trimmed, for a loose comparison across outlets. */
export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of normalizeForSearch(title).split(' ')) {
    if (!raw || STOP_WORDS.has(raw)) continue;
    const token = raw.length > 3 ? raw.replace(PREFIXES, '') : raw;
    if (token.length > 1) tokens.add(token);
  }
  return tokens;
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function tierRank(tier: SourceTier): number {
  return tier === 'official' ? 3 : tier === 'saudi' ? 2 : 1;
}

/** The better-ranked of two items telling the same story: higher tier, then the earlier one. */
export function preferred(a: NewsItem, b: NewsItem): NewsItem {
  const byTier = tierRank(b.tier) - tierRank(a.tier);
  if (byTier !== 0) return byTier > 0 ? b : a;
  return a.publishedAt <= b.publishedAt ? a : b;
}

/** Finds an existing visible item that tells the same story as `candidate`, if any. */
export function findDuplicate(
  candidate: NewsItem,
  candidateTokens: Set<string>,
  existing: Iterable<{ item: NewsItem; tokens: Set<string> }>,
): NewsItem | null {
  const at = Date.parse(candidate.publishedAt);
  let best: { item: NewsItem; score: number } | null = null;
  for (const { item, tokens } of existing) {
    if (item.id === candidate.id || item.hidden || item.duplicateOf) continue;
    if (Math.abs(Date.parse(item.publishedAt) - at) > DUPLICATE_WINDOW_MS) continue;
    const score = similarity(candidateTokens, tokens);
    if (score >= DUPLICATE_THRESHOLD && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}
