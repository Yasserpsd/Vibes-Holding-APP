import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAgendaEvent, useRegisterAgenda, type AgendaAttendance, type AgendaEvent } from '@/api/agenda';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { FadeInView, PopIn } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { EventDateBadge } from './index';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openCheckout, paymentReturnUrl } from '@/lib/checkout';
import { formatEventDays } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

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
          {/* M77 (owner): the BIG image leads the page — all details below it. */}
          {event.imageUrl ? (
            <FadeInView offset={8}>
              <Image source={{ uri: event.imageUrl }} style={styles.heroImage} resizeMode="cover" accessibilityLabel={event.title} />
            </FadeInView>
          ) : null}
          <FadeInView style={styles.head} offset={10}>
            <EventDateBadge date={event.date} highlight />
            <View style={styles.headText}>
              <Text style={styles.title}>{event.title}</Text>
              <Text style={styles.meta}>{`${formatEventDays(event.dates, event.date)}${timeLine(event) ? ` · ${timeLine(event)}` : ''}`}</Text>
              <Text style={styles.meta}>{t(MODE_KEY[event.mode])}</Text>
            </View>
          </FadeInView>

          {event.blurb ? (
            <FadeInView delay={100}>
              <Text style={styles.blurb}>{event.blurb}</Text>
            </FadeInView>
          ) : null}

          <FadeInView delay={160}>
            <GlassCard style={styles.infoCard}>
              {event.place && event.mode !== 'online' ? (
                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={18} color={colors.gold} />
                  <Text style={styles.infoText}>{`${t('agenda.place')}: ${event.place}`}</Text>
                </View>
              ) : null}
              <View style={styles.infoRow}>
                <Ionicons name="pricetag-outline" size={18} color={colors.gold} />
                <View style={styles.feePill}>
                  <Text style={styles.feeText} numberOfLines={1}>
                    {event.feeSar > 0 ? t('agenda.fee', { fee: String(event.feeSar) }) : t('agenda.free')}
                  </Text>
                </View>
              </View>
            </GlassCard>
          </FadeInView>

          {event.mine?.paid ? (
            <>
              <PopIn style={styles.confirmGlow}>
                <Notice tone="success" text={`${t('agenda.confirmed')} — ${event.mine.attendance === 'hq' ? t('agenda.attHq') : t('agenda.attOnline')}`} />
              </PopIn>
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
              {error ? (
                <FadeInView offset={8}>
                  <Notice tone="warning" text={error} />
                </FadeInView>
              ) : null}
              {event.mode !== 'online' ? (
                <AppButton label={registerLabel(t('agenda.registerHq'))} icon="business-outline" loading={register.isPending} onPress={() => tap('hq')} />
              ) : null}
              {event.mode !== 'hq' ? (
                <AppButton
                  label={registerLabel(t('agenda.registerOnline'))}
                  icon="videocam-outline"
                  variant={event.mode === 'online' ? 'primary' : 'outline'}
                  loading={register.isPending}
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
  // M77: the owner's event image, big on top of everything.
  heroImage: { width: '100%', height: 200, borderRadius: radii.xl, backgroundColor: colors.surfaceElevated },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 4 },
  title: { ...typography.title, color: colors.textPrimary, textAlign: textStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  blurb: { ...typography.body, color: colors.textSecondary, textAlign: textStart, lineHeight: 26 },
  infoCard: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  // The fee reads as a golden pill, not a plain line.
  feePill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  feeText: { ...typography.caption, color: colors.goldLight, textAlign: textStart },
  // The confirmed moment glows — celebratory, but classy.
  confirmGlow: { borderRadius: radii.md, boxShadow: shadows.glowGold },
});
