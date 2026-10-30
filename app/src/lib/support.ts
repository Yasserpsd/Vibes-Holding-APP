import { t } from '@/i18n';
import { openWhatsApp } from '@/lib/whatsapp';

/**
 * M161 (owner, 2026-10-30): a direct WhatsApp support line, shown the moment a member runs into any problem.
 * The number is public contact data (not a secret); the owner hands out changes in chat.
 */
export const SUPPORT_WHATSAPP = '+966 55 162 3111';

type Listener = (problem: string) => void;
const listeners = new Set<Listener>();

/** Called by the API client on every failed request; the SupportBanner listens. */
export function reportProblem(problem: string): void {
  for (const listener of listeners) listener(problem);
}

export function onProblem(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Opens the support chat with a short Arabic/English opener and, when known, the problem the member just saw. */
export function openSupportWhatsApp(problem?: string | null): Promise<boolean> {
  const detail = problem?.trim() ? `\n${t('support.problemLine', { problem: problem.trim() })}` : '';
  return openWhatsApp(SUPPORT_WHATSAPP, `${t('support.whatsappOpener')}${detail}`);
}
