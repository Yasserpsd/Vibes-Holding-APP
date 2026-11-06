import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * M204 (owner, 2026-11-06: «يكون عارفه ان وصلك علي واتس اب المسجل في الحساب»): one small line telling the member
 * where the club's message about this goes. Shown only to an account that has a number; the invoice line also
 * names the e-mail, the owner's one exception to «WhatsApp only».
 */
export function WhatsappNote({ kind }: { kind: 'confirm' | 'updates' | 'invoice' }) {
  const { status, me } = useAuth();
  if (status !== 'signedIn' || !me?.phone?.trim()) return null;
  return (
    <View style={styles.row}>
      <Ionicons name="logo-whatsapp" size={15} color={colors.whatsapp} />
      <Text style={styles.text}>{t(`waNote.${kind}`)}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  text: { ...typography.caption, color: colors.textMuted, flexShrink: 1, textAlign: 'center' },
}));
