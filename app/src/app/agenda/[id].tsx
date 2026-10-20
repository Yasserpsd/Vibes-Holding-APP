import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAgendaDiscount, useAgendaEvent, useRegisterAgenda, type AgendaAttendance, type AgendaDiscount, type AgendaEvent } from '@/api/agenda';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { GlassCard } from '@/components/lux';
import { FadeInView, PopIn } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { isProfileGate, ProfileGateNotice } from '@/components/ProfileGate';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { EventDateBadge } from './index';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
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
  const checkDiscount = useAgendaDiscount();
  const [error, setError] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  // M107: the discount code the member typed, and what the server said it is worth here.
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<AgendaDiscount | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const event = query.data?.event;
  const myFee = event ? (event.myFeeSar ?? event.feeSar) : 0;
  const dueNow = applied ? applied.amountAfter : myFee;

  const tryCode = () => {
    if (!event || !code.trim() || checkDiscount.isPending) return;
    setCodeError(null);
    checkDiscount.mutate(
      { eventId: event.id, code: code.trim() },
      {
        onSuccess: (answer) => setApplied(answer),
        onError: (cause) => {
          setApplied(null);
          setCodeError(errorMessage(cause));
        },
      },
    );
  };

  const tap = (attendance: AgendaAttendance) => {
    if (!event || register.isPending) return;
    setError(null);
    setGated(false);
    register.mutate(
      { eventId: event.id, attendance, discountCode: applied ? applied.code : code.trim() || undefined },
      {
        onSuccess: async (answer) => {
          // M111: the checkout renders embedded inside the app. A 100% code settles on the spot.
          if (answer.payment && answer.payment.status === 'created' && answer.payment.checkoutUrl) {
            router.navigate({ pathname: '/checkout/[id]', params: { id: answer.payment.id } });
            return;
          }
          void query.refetch();
        },
        onError: (cause) => {
          setError(cause.message);
          setGated(isProfileGate(cause));
        },
      },
    );
  };

  const timeLine = (item: AgendaEvent): string => {
    if (item.time && item.endTime) return t('agenda.timeRange', { from: `${LRM}${item.time}`, to: `${LRM}${item.endTime}` });
    return item.time ? `${LRM}${item.time}` : '';
  };

  const registerLabel = (base: string): string => (event && event.mustPay && dueNow > 0 ? t('agenda.withFee', { label: base, fee: String(dueNow) }) : base);

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
              {/* M107: both prices side by side, with the membership saving for a non-member viewer. */}
              <View style={styles.infoRow}>
                <Ionicons name="pricetag-outline" size={18} color={colors.gold} />
                <View style={styles.prices}>
                  <View style={styles.feePill}>
                    <Text style={styles.feeText} numberOfLines={1}>
                      {event.feeSar > 0 ? t('agenda.nonMemberPrice', { fee: String(event.feeSar) }) : t('agenda.free')}
                    </Text>
                  </View>
                  <View style={[styles.feePill, styles.memberPill]}>
                    <Text style={styles.feeText} numberOfLines={1}>
                      {(event.memberFeeSar ?? 0) > 0 ? t('agenda.memberPrice', { fee: String(event.memberFeeSar) }) : t('agenda.included')}
                    </Text>
                  </View>
                </View>
              </View>
              {(event.savingsSar ?? 0) > 0 ? (
                <Text style={styles.savings}>{t('agenda.save', { amount: String(event.savingsSar) })}</Text>
              ) : null}
            </GlassCard>
          </FadeInView>

          {event.mine?.paid ? (
            <>
              <PopIn style={styles.confirmGlow}>
                <Notice tone="success" text={`${t('agenda.confirmed')} — ${event.mine.attendance === 'hq' ? t('agenda.attHq') : t('agenda.attOnline')}`} />
              </PopIn>
              {/* M107: the confirmed attendee's QR ticket. */}
              <AppButton label={t('agenda.ticket')} icon="qr-code-outline" onPress={() => router.push(`/agenda/ticket/${event.id}` as Href)} />
              {event.onlineUrl ? <AppButton label={t('agenda.onlineLink')} icon="videocam-outline" variant="outline" onPress={() => void openLink(event.onlineUrl as string)} /> : null}
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
              {/* M107: the discount-code box — a 100% code confirms the attendance with no checkout. */}
              {event.mustPay ? (
                <View style={styles.codeBox}>
                  <View style={styles.codeRow}>
                    <View style={styles.codeField}>
                      <FormField
                        label={t('agenda.discountLabel')}
                        latin
                        autoCapitalize="characters"
                        autoCorrect={false}
                        value={code}
                        onChangeText={(value) => {
                          setCode(value.toUpperCase());
                          setApplied(null);
                          setCodeError(null);
                        }}
                        placeholder="CODE"
                      />
                    </View>
                    <AppButton label={t('agenda.discountCheck')} variant="outline" icon="checkmark-outline" loading={checkDiscount.isPending} onPress={tryCode} />
                  </View>
                  {applied ? (
                    <Notice
                      tone="success"
                      text={applied.amountAfter === 0 ? t('agenda.discountFree') : t('agenda.discountApplied', { percent: String(applied.percent), amount: String(applied.amountAfter) })}
                    />
                  ) : null}
                  {codeError ? <Notice tone="warning" text={codeError} /> : null}
                </View>
              ) : null}
              {error ? (
                <FadeInView offset={8}>
                  {/* M109i: the complete-profile refusal comes with its own door to the editor. */}
                  {gated ? <ProfileGateNotice text={error} /> : <Notice tone="warning" text={error} />}
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
  // M107: both prices side by side, then the saving line under them.
  prices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, flex: 1 },
  memberPill: { backgroundColor: colors.surfaceElevated },
  savings: { ...typography.caption, color: colors.goldLight, textAlign: textStart },
  codeBox: { gap: spacing.sm },
  codeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  codeField: { flex: 1 },
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
