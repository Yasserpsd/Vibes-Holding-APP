import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { amountLabel, useMyPayments, type Payment, type PaymentStatus } from '@/api/payments';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { LockedNotice } from '@/components/LockedNotice';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatArabicDateTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATUS_COLOR: Record<PaymentStatus, string> = { created: colors.warning, paid: colors.success, failed: colors.danger };

/** The member's in-app payments (real-world services), newest first. */
export default function PaymentsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const { data, isLoading, error, refetch } = useMyPayments(status === 'signedIn');

  if (status !== 'signedIn') {
    return (
      <Screen title={t('payments.title')}>
        <LockedNotice text={t('payments.signIn')} guest />
        <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  return (
    <Screen title={t('payments.title')} subtitle={t('payments.subtitle')}>
      {data ? (
        data.payments.length ? (
          data.payments.map((payment, index) => (
            <FadeInView key={payment.id} delay={entranceDelay(index)}>
              <PaymentRow payment={payment} onPress={() => router.push({ pathname: '/payment/[id]', params: { id: payment.id } })} />
            </FadeInView>
          ))
        ) : (
          <FadeInView>
            <Text style={styles.empty}>{t('payments.empty')}</Text>
          </FadeInView>
        )
      ) : (
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      )}
      <FadeInView delay={entranceDelay(2)}>
        <AppButton label={t('nav.services')} variant="outline" icon="grid-outline" onPress={() => router.push('/services')} />
      </FadeInView>
    </Screen>
  );
}

/** Icons pass: operations, how many went through, and the paid total in SAR. */
function PaymentRow({ payment, onPress }: { payment: Payment; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} accessibilityRole="button">
      <GlassCard style={styles.row}>
        <View pointerEvents="none" style={[styles.accent, { backgroundColor: STATUS_COLOR[payment.status] }]} />
        <View style={styles.rowHeader}>
          <Text style={styles.title}>{payment.serviceTitle}</Text>
          <View style={[styles.badge, { borderColor: STATUS_COLOR[payment.status] }]}>
            <Text style={[styles.badgeText, { color: STATUS_COLOR[payment.status] }]} numberOfLines={1}>
              {t(`payments.status.${payment.status}`)}
            </Text>
          </View>
        </View>
        <Text style={styles.amount}>{`${amountLabel(payment)}${payment.memberPrice ? ` · ${t('payments.memberPrice')}` : ''}`}</Text>
        <View style={styles.footer}>
          <Text style={styles.meta}>{formatArabicDateTime(payment.createdAt)}</Text>
          <Ionicons name={chevronForward()} size={16} color={colors.goldLight} />
        </View>
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, padding: spacing.md },
  // The start-side filament tells the status before the badge is read.
  accent: { position: 'absolute', start: 0, top: 0, bottom: 0, width: 3 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart, flex: 1 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, backgroundColor: colors.surfaceElevated },
  badgeText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  amount: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22, color: colors.gold, textAlign: textStart },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
});
