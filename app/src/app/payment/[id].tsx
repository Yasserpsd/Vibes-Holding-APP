import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { amountLabel, usePayment, type PaymentStatus } from '@/api/payments';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openCheckout, paymentReturnUrl } from '@/lib/checkout';
import { formatArabicDateTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATE: Record<PaymentStatus, { title: StringKey; text: StringKey; color: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle' }> = {
  created: {
    title: 'payment.created.title',
    text: 'payment.created.text',
    color: colors.warning,
    icon: 'time-outline',
  },
  paid: {
    title: 'payment.paid.title',
    text: 'payment.paid.text',
    color: colors.success,
    icon: 'checkmark-circle',
  },
  failed: {
    title: 'payment.failed.title',
    text: 'payment.failed.text',
    color: colors.danger,
    icon: 'close-circle',
  },
};

/** One payment: the status as the server knows it (from the gateway callback), the details, and the way back. */
export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = usePayment(id);

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const { payment } = data;
  const state = STATE[payment.status];
  const reopen = async () => {
    await openCheckout(payment.checkoutUrl, paymentReturnUrl(payment.id));
    void refetch();
  };

  return (
    <Screen>
      <View style={[styles.state, { borderColor: state.color }]}>
        <Ionicons name={state.icon} size={44} color={state.color} />
        <Text style={[styles.stateTitle, { color: state.color }]}>{t(state.title)}</Text>
        <Text style={styles.stateText}>{t(state.text)}</Text>
        {payment.status === 'failed' && payment.failureReason ? <Text style={styles.reason}>{t('payment.gatewayReason', { reason: payment.failureReason })}</Text> : null}
      </View>

      <View style={styles.card}>
        <Row label={t('payment.service')} value={payment.serviceTitle} />
        <Row label={t('payment.amount')} value={`${amountLabel(payment)}${payment.memberPrice ? ` (${t('payments.memberPrice')})` : ''}`} />
        {payment.answers
          .filter((answer) => answer.value)
          .map((answer) => (
            <Row key={answer.label} label={answer.label} value={answer.value} />
          ))}
        <Row label={t('payment.createdAt')} value={formatArabicDateTime(payment.createdAt)} />
        {payment.paidAt ? <Row label={t('payment.paidAt')} value={formatArabicDateTime(payment.paidAt)} /> : null}
        {payment.transactionId ? <Row label={t('payment.gatewayId')} value={payment.transactionId} latin /> : null}
        <Row label={t('payment.id')} value={payment.id} latin />
      </View>

      {payment.status === 'created' ? <AppButton label={t('payment.openCheckout')} icon="card-outline" onPress={() => void reopen()} /> : null}
      {payment.status === 'created' ? <AppButton label={t('payment.refreshStatus')} variant="outline" icon="refresh-outline" onPress={() => void refetch()} /> : null}
      {payment.status === 'failed' ? (
        <AppButton label={t('payment.retry')} icon="refresh-outline" onPress={() => router.navigate({ pathname: '/service/[key]', params: { key: payment.serviceKey, answers: JSON.stringify(Object.fromEntries(payment.answers.map((answer) => [answer.key, answer.value]))) } })} />
      ) : null}
      <AppButton label={t('payment.all')} variant="outline" icon="receipt-outline" onPress={() => router.navigate('/payments')} />
    </Screen>
  );
}

function Row({ label, value, latin = false }: { label: string; value: string; latin?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, latin && styles.latin]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, backgroundColor: colors.surface },
  stateTitle: { ...typography.subtitle, textAlign: 'center' },
  stateText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  reason: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  row: { gap: 2 },
  rowLabel: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  rowValue: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  latin: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.textSecondary, writingDirection: 'ltr', textAlign: textStart },
});
