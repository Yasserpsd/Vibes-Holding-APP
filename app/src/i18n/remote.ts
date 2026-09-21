import { apiGet } from '@/api/client';

import { applyOverrides, getLang, stringsVersion } from './index';

type StringsAnswer = { lang: string; version: string; strings: Record<string, string> };

/**
 * The owner's wording edits (dashboard, «نصوص التطبيق»): fetched once after the first screen is up.
 * A failure changes nothing: the app keeps the overrides saved at an earlier start, or its bundled text.
 */
export async function syncStrings(): Promise<void> {
  try {
    const answer = await apiGet<StringsAnswer>('/api/strings', { lang: getLang() });
    if (answer.lang !== getLang() || answer.version === stringsVersion()) return;
    await applyOverrides(answer.version, answer.strings);
  } catch {
    // Offline or an older server: nothing to apply.
  }
}
