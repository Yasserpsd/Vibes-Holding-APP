import { t } from '@/i18n';
import { openWhatsApp } from '@/lib/whatsapp';

/**
 * M161 (owner, 2026-10-30): a direct WhatsApp support line. The number is public contact data (not a secret); the owner hands out changes in chat.
 * 2026-10-31 (owner): it appears in ONE place only — under the registration screen when creating the account fails. No banner, nothing elsewhere.
 */
export const SUPPORT_WHATSAPP = '+966 55 162 3111';

/** Opens the support chat with a short Arabic/English opener and, when known, the problem the member just saw. */
export function openSupportWhatsApp(problem?: string | null): Promise<boolean> {
  const detail = problem?.trim() ? `\n${t('support.problemLine', { problem: problem.trim() })}` : '';
  return openWhatsApp(SUPPORT_WHATSAPP, `${t('support.whatsappOpener')}${detail}`);
}
