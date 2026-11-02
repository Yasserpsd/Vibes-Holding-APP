import { t } from '@/i18n';
import { openWhatsApp } from '@/lib/whatsapp';

/**
 * M161 (owner, 2026-10-30): a direct WhatsApp support line. The number is public contact data (not a secret); the owner hands out changes in chat.
 * 2026-11-03 (owner): the ONLY official number to reach the management — shown in حسابي for everyone and right under every error
 * (components/SupportLink.tsx). This replaces the 2026-10-31 «registration failure only» rule.
 */
export const SUPPORT_WHATSAPP = '+966 55 162 3111';

/** Opens the support chat with a short Arabic/English opener and, when known, the problem the member just saw. */
export function openSupportWhatsApp(problem?: string | null): Promise<boolean> {
  const detail = problem?.trim() ? `\n${t('support.problemLine', { problem: problem.trim() })}` : '';
  return openWhatsApp(SUPPORT_WHATSAPP, `${t('support.whatsappOpener')}${detail}`);
}

/** حسابي's card: a plain hello to the management, no problem assumed. */
export function openContactWhatsApp(): Promise<boolean> {
  return openWhatsApp(SUPPORT_WHATSAPP, t('support.contactOpener'));
}
