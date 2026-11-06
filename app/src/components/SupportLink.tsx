import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from 'react-native';

import { FadeInView, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { openContactWhatsApp, openSupportWhatsApp, SUPPORT_WHATSAPP } from '@/lib/support';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

// The left-to-right mark keeps «+966» at the start of the number inside Arabic text.
const NUMBER = `‎${SUPPORT_WHATSAPP}`;

/**
 * Owner (2026-11-03, «عميل من الصين مكنش عارف يوصلنا»): the management's only official WhatsApp line.
 * `problem` → the compact line right under an error (the chat opens with that problem); no `problem`
 * → the same small line at the very end of حسابي, for everyone, signed in or not.
 * M204 (owner, 2026-11-06: «يكلم الإدارة شكلها كبير جدا حاليا وفوق خالص»): the big card on top is gone.
 */
export function SupportLink({ problem }: { problem?: string | null }) {
  if (problem !== undefined) {
    return (
      <FadeInView offset={6}>
        <PressScale onPress={() => void openSupportWhatsApp(problem)} style={styles.line} accessibilityRole="link" accessibilityLabel={`${t('support.link')} ${SUPPORT_WHATSAPP}`}>
          <Ionicons name="logo-whatsapp" size={18} color={colors.whatsapp} />
          <Text style={styles.lineText}>{t('support.link')}</Text>
          <Text style={styles.lineNumber}>{NUMBER}</Text>
        </PressScale>
      </FadeInView>
    );
  }
  return (
    <PressScale onPress={() => void openContactWhatsApp()} style={styles.line} accessibilityRole="link" accessibilityLabel={`${t('support.link')} ${SUPPORT_WHATSAPP}`}>
      <Ionicons name="logo-whatsapp" size={16} color={colors.whatsapp} />
      <Text style={styles.lineText}>{t('support.link')}</Text>
      <Text style={styles.lineNumber}>{NUMBER}</Text>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.xs, paddingVertical: spacing.xs },
  lineText: { ...typography.caption, color: colors.textSecondary },
  lineNumber: { ...typography.caption, color: colors.whatsapp },
}));
