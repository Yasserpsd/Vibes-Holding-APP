import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';

import { amountLabel, usePayment, type PaymentStatus } from '@/api/payments';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { WhatsappNote } from '@/components/WhatsappNote';
import { entranceDelay, FadeInView, PopIn, Sheen, usePulse } from '@/components/motion';
import { SarText } from '@/components/SarText';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { SupportLink } from '@/components/SupportLink';
import { env } from '@/config/env';
import { getLang, t, type StringKey } from '@/i18n';
import { trackServicePurchase } from '@/lib/adsAttribution';
import { textStart } from '@/i18n/direction';
import { formatArabicDateTime } from '@/lib/format';
import { lazyTokens, themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

const STATE: Record<PaymentStatus, { title: StringKey; text: StringKey; color: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle' }> = lazyTokens(() => ({
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
}));

// How long a payment may stay «created» before the waiting text gains the support line.
const LATE_AFTER_MS = 2 * 60_000;
// The Arabic block U+0600 to U+06FF, built from its code points (plain ASCII in this file).
const ARABIC_LETTERS = new RegExp(`[${String.fromCharCode(0x0600)}-${String.fromCharCode(0x06ff)}]`);

/** One payment: the status as the server knows it (from the gateway callback), the details, and the way back. */
export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = usePayment(id);
  // V2: a pending payment breathes; a paid one gets the gold sheen (needs the hero's measured size).
  const pulse = usePulse();
  const [heroSize, setHeroSize] = useState<{ width: number; height: number } | null>(null);
  // M157: a payment watched here from «created» to «paid» (the refresh button) counts as a conversion;
  // reopening an old receipt does not.
  const watched = data?.payment;
  const sawCreated = useRef(false);
  useEffect(() => {
    if (!watched) return;
    if (watched.status === 'created') sawCreated.current = true;
    else if (watched.status === 'paid' && sawCreated.current) trackServicePurchase(watched);
  }, [watched]);
  // The «مدفوعاتي» list under this screen must not keep showing «بانتظار الدفع» once the server has settled the payment.
  const queryClient = useQueryClient();
  const settledStatus = watched && watched.status !== 'created' ? watched.status : null;
  useEffect(() => {
    if (settledStatus) void queryClient.invalidateQueries({ queryKey: ['payments', 'mine'] });
  }, [settledStatus, queryClient]);
  // A payment still «created» two minutes after it was made: the confirmation is late, so the support line joins
  // the waiting text. The timer only marks WHICH payment turned late; the status itself stays the server's.
  const waitingSince = watched?.status === 'created' ? watched.createdAt : null;
  const [lateSince, setLateSince] = useState<string | null>(null);
  useEffect(() => {
    if (!waitingSince) return;
    const age = Date.now() - Date.parse(waitingSince);
    const left = Number.isNaN(age) ? LATE_AFTER_MS : LATE_AFTER_MS - age;
    const timer = setTimeout(() => setLateSince(waitingSince), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [waitingSince]);
  const late = waitingSince !== null && lateSince === waitingSince;

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const { payment } = data;
  const state = STATE[payment.status];
  // M111: the checkout renders embedded inside the app («الدفع جوا نفس الصفحة», owner). `replace`, not `push`:
  // the checkout ends by replacing itself with this screen, so a push left two copies of it in the stack.
  const reopen = () => router.replace({ pathname: '/checkout/[id]', params: { id: payment.id } });
  // The gateway's own words are shown only when they are in the app's language (Arabic letters in Arabic, none
  // in English); a raw technical line in the other language is dropped and the general sentence stands alone.
  const reason =
    payment.status === 'failed' && payment.failureReason && ARABIC_LETTERS.test(payment.failureReason) === (getLang() === 'ar') ? payment.failureReason : null;
  // M110: the server's printable invoice page (paid payments only), opened inside the app.
  const invoiceUrl = payment.status === 'paid' && payment.invoiceNo && env.apiBaseUrl ? `${env.apiBaseUrl}/pay/invoice/${encodeURIComponent(payment.id)}` : null;

  return (
    <Screen>
      <FadeInView delay={entranceDelay(0)}>
        <View
          style={[styles.state, { borderColor: state.color }, payment.status === 'paid' && styles.statePaid]}
          onLayout={(event) => setHeroSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        >
          <PopIn>
            {payment.status === 'created' ? (
              <Animated.View style={{ opacity: pulse }}>
                <Ionicons name={state.icon} size={44} color={state.color} />
              </Animated.View>
            ) : (
              <Ionicons name={state.icon} size={44} color={state.color} />
            )}
          </PopIn>
          <Text style={[styles.stateTitle, { color: state.color }]}>{t(state.title)}</Text>
          <Text style={styles.stateText}>{t(state.text)}</Text>
          {payment.status === 'created' && late ? (
            <>
              <Text style={styles.stateText}>{t('payment.createdLate')}</Text>
              <SupportLink problem={`${t('payment.created.title')} — ${payment.serviceTitle} — ${t('payment.id')}: ${payment.id}`} />
            </>
          ) : null}
          {payment.status === 'paid' ? <WhatsappNote kind="invoice" /> : null}
          {reason ? <Text style={styles.reason}>{t('payment.gatewayReason', { reason })}</Text> : null}
          {payment.status === 'paid' && heroSize ? <Sheen width={heroSize.width} height={heroSize.height} /> : null}
        </View>
      </FadeInView>

      <FadeInView delay={entranceDelay(1)}>
        <GlassCard style={styles.card}>
          <Row label={t('payment.service')} value={payment.serviceTitle} />
          <Row label={t('payment.amount')} value={`${amountLabel(payment)}${payment.memberPrice ? ` (${t('payments.memberPrice')})` : ''}`} gold />
          {payment.answers
            .filter((answer) => answer.value)
            .map((answer) => (
              <Row key={answer.label} label={answer.label} value={answer.value} />
            ))}
          <Row label={t('payment.createdAt')} value={formatArabicDateTime(payment.createdAt)} />
          {payment.paidAt ? <Row label={t('payment.paidAt')} value={formatArabicDateTime(payment.paidAt)} /> : null}
          {payment.status === 'paid' && payment.invoiceNo ? <Row label={t('payment.invoiceNo')} value={String(payment.invoiceNo)} latin /> : null}
          {payment.transactionId ? <Row label={t('payment.gatewayId')} value={payment.transactionId} latin /> : null}
          <Row label={t('payment.id')} value={payment.id} latin />
        </GlassCard>
      </FadeInView>

      <FadeInView delay={entranceDelay(2)} style={styles.actions}>
        {invoiceUrl ? (
          <AppButton
            label={t('payment.viewInvoice')}
            icon="document-text-outline"
            onPress={() => router.push({ pathname: '/webpage', params: { url: invoiceUrl, title: t('payment.viewInvoice') } } as Href)}
          />
        ) : null}
        {payment.status === 'created' ? <AppButton label={t('payment.openCheckout')} icon="card-outline" onPress={() => void reopen()} /> : null}
        {payment.status === 'created' ? <AppButton label={t('payment.refreshStatus')} variant="outline" icon="refresh-outline" onPress={() => void refetch()} /> : null}
        {payment.status === 'failed' ? (
          <AppButton label={t('payment.retry')} icon="refresh-outline" onPress={() => router.navigate({ pathname: '/service/[key]', params: { key: payment.serviceKey, answers: JSON.stringify(Object.fromEntries(payment.answers.map((answer) => [answer.key, answer.original ?? answer.value]))) } })} />
        ) : null}
        <AppButton label={t('payment.all')} variant="outline" icon="receipt-outline" onPress={() => router.navigate('/payments')} />
      </FadeInView>
    </Screen>
  );
}

function Row({ label, value, latin = false, gold = false }: { label: string; value: string; latin?: boolean; gold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <SarText style={[styles.rowValue, latin && styles.latin, gold && styles.rowGold]} selectable>
        {value}
      </SarText>
    </View>
  );
}

const styles = themedStyles(() => ({
  state: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, backgroundColor: colors.surface },
  statePaid: { boxShadow: shadows.glowGold, overflow: 'hidden' },
  stateTitle: { ...typography.subtitle, textAlign: 'center' },
  stateText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  reason: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  card: { gap: spacing.sm, padding: spacing.md },
  actions: { gap: spacing.md },
  row: { gap: 2 },
  rowLabel: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  rowValue: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  rowGold: { ...typography.title, color: colors.gold },
  latin: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 20, color: colors.textSecondary, writingDirection: 'ltr', textAlign: textStart },
}));
