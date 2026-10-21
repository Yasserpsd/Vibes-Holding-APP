import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M118d (owner: «نخفيها جوا خالص»): the extra security settings — account deletion and problem
 * reports live HERE, two levels under حسابي, never a stray tap away out in the open.
 */
export default function SecurityExtraScreen() {
  const router = useRouter();
  const { me } = useAuth();

  if (!me) {
    return (
      <Screen title={t('security.extraTitle')}>
        <Notice tone="warning" text={t('profile.signInFirst')} />
      </Screen>
    );
  }

  return (
    <Screen title={t('security.extraTitle')} subtitle={t('security.extraHint')}>
      <FadeInView delay={entranceDelay(0)}>
        <GlassCard radius={radii.lg} style={styles.card}>
          <Row icon="megaphone-outline" label={t('security.reportProblem')} onPress={() => router.push('/contact' as Href)} />
          <Row icon="trash-outline" label={t('account.menu.delete')} danger onPress={() => router.push('/delete-account' as Href)} />
        </GlassCard>
      </FadeInView>
    </Screen>
  );
}

function Row({ icon, label, danger, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.gold} />
      <Text style={[styles.rowLabel, danger && styles.rowDanger]}>{label}</Text>
      <Ionicons name={chevronForward()} size={18} color={colors.textMuted} />
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.sm, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm },
  rowLabel: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  rowDanger: { color: colors.danger },
});
