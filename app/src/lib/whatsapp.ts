import { Linking } from 'react-native';

import { t } from '@/i18n';

/** Hands a request over to WhatsApp: the wa.me link opens the app when installed, the web client otherwise. */
export async function openWhatsApp(phone: string, text: string): Promise<boolean> {
  const digits = phone.replace(/\D+/g, '');
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Builds the message: the service line, then one line per answered field, then who is asking. */
export function composeRequest(message: string, lines: { label: string; value: string }[], sender: { name: string; phone: string } | null): string {
  const parts = [message];
  for (const line of lines) {
    if (line.value.trim()) parts.push(`${line.label}: ${line.value.trim()}`);
  }
  if (sender) parts.push(`${t('request.senderName', { name: sender.name })}${sender.phone ? ` · ${t('request.senderPhone', { phone: sender.phone })}` : ''}`);
  parts.push(t('request.fromApp'));
  return parts.join('\n');
}
