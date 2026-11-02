import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/components/lux';
import { FadeInView, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openContactWhatsApp, openSupportWhatsApp, SUPPORT_WHATSAPP } from '@/lib/support';
import { colors, radii, spacing, typography } from '@/theme/tokens';

// The left-to-right mark keeps «+966» at the start of the number inside Arabic text.
const NUMBER = `‎${SUPPORT_WHATSAPP}`;

/**
 * Owner (2026-11-03, «عميل من الصين مكنش عارف يوصلنا»): the management's only official WhatsApp line.
 * `problem` → the compact line right under an error (the chat opens with that problem); no `problem`
 * → the full card of حسابي, shown to everyone, signed in or not.
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
    <PressScale onPress={() => void openContactWhatsApp()} accessibilityRole="link" accessibilityLabel={`${t('support.link')} ${SUPPORT_WHATSAPP}`}>
      <GlassCard radius={radii.lg} style={styles.card}>
        <View style={styles.logo}>
          <Ionicons name="logo-whatsapp" size={30} color={colors.white} />
        </View>
        <View style={styles.texts}>
          <Text style={styles.title}>{t('support.link')}</Text>
          <Text style={styles.sub}>{t('support.official')}</Text>
          <Text style={styles.number}>{NUMBER}</Text>
        </View>
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.xs, paddingVertical: spacing.xs },
  lineText: { ...typography.caption, color: colors.textSecondary },
  lineNumber: { ...typography.caption, color: colors.whatsapp },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderColor: colors.whatsapp },
  logo: { width: 52, height: 52, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.whatsapp },
  texts: { flex: 1, gap: 2 },
  title: { ...typography.subtitle, fontSize: 16, color: colors.textPrimary, textAlign: textStart },
  sub: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  number: { ...typography.body, fontSize: 17, color: colors.whatsapp, textAlign: textStart },
});
