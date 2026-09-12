import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { amountLabel, useMyPayments, type Payment, type PaymentStatus } from '@/api/payments';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { LockedNotice } from '@/components/LockedNotice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { formatArabicDateTime } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATUS: Record<PaymentStatus, { label: string; color: string }> = {
  created: { label: 'بانتظار الدفع', color: colors.warning },
  paid: { label: 'مدفوعة', color: colors.success },
  failed: { label: 'غير مكتملة', color: colors.danger },
};

/** The member's in-app payments (real-world services), newest first. */
export default function PaymentsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const { data, isLoading, error, refetch } = useMyPayments(status === 'signedIn');

  if (status !== 'signedIn') {
    return (
      <Screen title="مدفوعاتي">
        <LockedNotice text="سجّل الدخول بحسابك لعرض مدفوعاتك." guest />
        <AppButton label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  return (
    <Screen title="مدفوعاتي" subtitle="خدمات النادي المدفوعة من داخل التطبيق">
      {data ? (
        data.payments.length ? (
          data.payments.map((payment) => <PaymentRow key={payment.id} payment={payment} onPress={() => router.push({ pathname: '/payment/[id]', params: { id: payment.id } })} />)
        ) : (
          <Text style={styles.empty}>لا توجد مدفوعات بعد. خدمات مثل تصميم Pitch Deck و«اصنع ملتقاك» تُدفع من صفحة الخدمة.</Text>
        )
      ) : (
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      )}
      <AppButton label="خدمات النادي" variant="outline" icon="grid-outline" onPress={() => router.push('/services')} />
    </Screen>
  );
}

function PaymentRow({ payment, onPress }: { payment: Payment; onPress: () => void }) {
  const badge = STATUS[payment.status];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowHeader}>
        <Text style={styles.title}>{payment.serviceTitle}</Text>
        <View style={[styles.badge, { backgroundColor: badge.color }]}>
          <Text style={styles.badgeText}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.amount}>{`${amountLabel(payment)}${payment.memberPrice ? ' · سعر الأعضاء' : ''}`}</Text>
      <View style={styles.footer}>
        <Text style={styles.meta}>{formatArabicDateTime(payment.createdAt)}</Text>
        <Ionicons name="chevron-back" size={16} color={colors.goldLight} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pressed: { opacity: 0.7 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: 'right', flex: 1 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  badgeText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.black },
  amount: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 22, color: colors.gold, textAlign: 'right' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'right' },
});
