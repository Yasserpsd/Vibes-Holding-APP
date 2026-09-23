import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAgendaEvent, useRegisterAgenda, type AgendaAttendance, type AgendaEvent } from '@/api/agenda';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FadeInView } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { EventDateBadge } from './index';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openCheckout, paymentReturnUrl } from '@/lib/checkout';
import { formatArabicDate } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const LRM = '‎';
const MODE_KEY: Record<AgendaEvent['mode'], StringKey> = { hq: 'agenda.modeHq', online: 'agenda.modeOnline', both: 'agenda.modeBoth' };

/** M41: one event — the details, and the ONE-tap attendance (pay first only for non-members of a fee event). */
export default function AgendaEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const query = useAgendaEvent(typeof id === 'string' ? id : undefined);
  const register = useRegisterAgenda();
  const [error, setError] = useState<string | null>(null);
  const event = query.data?.event;

  const tap = (attendance: AgendaAttendance) => {
    if (!event || register.isPending) return;
    setError(null);
    register.mutate(
      { eventId: event.id, attendance },
      {
        onSuccess: async (answer) => {
          if (answer.payment) {
            await openCheckout(answer.payment.checkoutUrl, paymentReturnUrl(answer.payment.id));
            router.navigate({ pathname: '/payment/[id]', params: { id: answer.payment.id } });
            return;
          }
          void query.refetch();
        },
        onError: (cause) => setError(cause.message),
      },
    );
  };

  const timeLine = (item: AgendaEvent): string => {
    if (item.time && item.endTime) return t('agenda.timeRange', { from: `${LRM}${item.time}`, to: `${LRM}${item.endTime}` });
    return item.time ? `${LRM}${item.time}` : '';
  };

  const registerLabel = (base: string): string => (event && event.mustPay ? t('agenda.withFee', { label: base, fee: String(event.feeSar) }) : base);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('nav.agendaEvent') }} />
      {!event ? (
        <StateView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <FadeInView style={styles.head} offset={10}>
            <EventDateBadge date={event.date} />
            <View style={styles.headText}>
              <Text style={styles.title}>{event.title}</Text>
              <Text style={styles.meta}>{`${formatArabicDate(event.date)}${timeLine(event) ? ` · ${timeLine(event)}` : ''}`}</Text>
              <Text style={styles.meta}>{t(MODE_KEY[event.mode])}</Text>
            </View>
          </FadeInView>

          {event.blurb ? (
            <FadeInView delay={100}>
              <Text style={styles.blurb}>{event.blurb}</Text>
            </FadeInView>
          ) : null}

          <FadeInView delay={160} style={styles.infoCard}>
            {event.place && event.mode !== 'online' ? (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={18} color={colors.gold} />
                <Text style={styles.infoText}>{`${t('agenda.place')}: ${event.place}`}</Text>
              </View>
            ) : null}
            <View style={styles.infoRow}>
              <Ionicons name="pricetag-outline" size={18} color={colors.gold} />
              <Text style={styles.infoText}>{event.feeSar > 0 ? t('agenda.fee', { fee: String(event.feeSar) }) : t('agenda.free')}</Text>
            </View>
          </FadeInView>

          {event.mine?.paid ? (
            <>
              <Notice tone="success" text={`${t('agenda.confirmed')} — ${event.mine.attendance === 'hq' ? t('agenda.attHq') : t('agenda.attOnline')}`} />
              {event.onlineUrl ? <AppButton label={t('agenda.onlineLink')} icon="videocam-outline" onPress={() => void openLink(event.onlineUrl as string)} /> : null}
            </>
          ) : !signedIn ? (
            <>
              <Notice tone="warning" text={t('agenda.guest')} />
              <AppButton label={t('agenda.signIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
            </>
          ) : !event.open ? (
            <Notice tone="info" text={t('agenda.closed')} />
          ) : (
            <>
              {event.mine && !event.mine.paid ? <Notice tone="warning" text={t('agenda.pendingPay')} /> : null}
              {event.mustPay ? <Notice tone="info" text={t('agenda.payNote')} /> : null}
              {error ? <Notice tone="warning" text={error} /> : null}
              {event.mode !== 'online' ? (
                <AppButton label={register.isPending ? '…' : registerLabel(t('agenda.registerHq'))} icon="business-outline" onPress={() => tap('hq')} />
              ) : null}
              {event.mode !== 'hq' ? (
                <AppButton
                  label={register.isPending ? '…' : registerLabel(t('agenda.registerOnline'))}
                  icon="videocam-outline"
                  variant={event.mode === 'online' ? 'primary' : 'outline'}
                  onPress={() => tap('online')}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 4 },
  title: { ...typography.title, color: colors.textPrimary, textAlign: textStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  blurb: { ...typography.body, color: colors.textSecondary, textAlign: textStart, lineHeight: 26 },
  infoCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
});
