import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { amountLabel, usePayment, type PaymentStatus } from '@/api/payments';
import { AppButton } from '@/components/AppButton';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { openCheckout, paymentReturnUrl } from '@/lib/checkout';
import { formatArabicDateTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATE: Record<PaymentStatus, { title: string; text: string; color: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle' }> = {
  created: {
    title: 'بانتظار تأكيد الدفع',
    text: 'إذا أكملت الدفع تظهر النتيجة هنا خلال لحظات. إن لم تكمله بعد، افتح صفحة الدفع مرة أخرى.',
    color: colors.warning,
    icon: 'time-outline',
  },
  paid: {
    title: 'تم الدفع بنجاح',
    text: 'وصل طلبك إلى إدارة النادي، وسيتواصل معك الفريق لبدء تنفيذ الخدمة.',
    color: colors.success,
    icon: 'checkmark-circle',
  },
  failed: {
    title: 'لم تكتمل عملية الدفع',
    text: 'لم تقبل بوابة الدفع العملية. يمكنك المحاولة مرة أخرى من صفحة الخدمة.',
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
        <Text style={[styles.stateTitle, { color: state.color }]}>{state.title}</Text>
        <Text style={styles.stateText}>{state.text}</Text>
        {payment.status === 'failed' && payment.failureReason ? <Text style={styles.reason}>{`سبب البوابة: ${payment.failureReason}`}</Text> : null}
      </View>

      <View style={styles.card}>
        <Row label="الخدمة" value={payment.serviceTitle} />
        <Row label="المبلغ" value={`${amountLabel(payment)}${payment.memberPrice ? ' (سعر الأعضاء)' : ''}`} />
        {payment.answers
          .filter((answer) => answer.value)
          .map((answer) => (
            <Row key={answer.label} label={answer.label} value={answer.value} />
          ))}
        <Row label="تاريخ العملية" value={formatArabicDateTime(payment.createdAt)} />
        {payment.paidAt ? <Row label="تاريخ الدفع" value={formatArabicDateTime(payment.paidAt)} /> : null}
        {payment.transactionId ? <Row label="رقم عملية البوابة" value={payment.transactionId} latin /> : null}
        <Row label="رقم العملية" value={payment.id} latin />
      </View>

      {payment.status === 'created' ? <AppButton label="فتح صفحة الدفع" icon="card-outline" onPress={() => void reopen()} /> : null}
      {payment.status === 'created' ? <AppButton label="تحديث الحالة" variant="outline" icon="refresh-outline" onPress={() => void refetch()} /> : null}
      {payment.status === 'failed' ? (
        <AppButton label="المحاولة مرة أخرى" icon="refresh-outline" onPress={() => router.navigate({ pathname: '/service/[key]', params: { key: payment.serviceKey } })} />
      ) : null}
      <AppButton label="كل مدفوعاتي" variant="outline" icon="receipt-outline" onPress={() => router.navigate('/payments')} />
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
  rowLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },
  rowValue: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
  latin: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.textSecondary, writingDirection: 'ltr', textAlign: 'right' },
});
