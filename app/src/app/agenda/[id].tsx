import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAgendaEvent, useRegisterAgenda, type AgendaAttendance, type AgendaEvent } from '@/api/agenda';
import { useMonthlyDeal } from '@/api/payments';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { GlassCard } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { dealAmount, MonthlyDealBadge } from '@/components/MonthlyDeal';
import { FadeInView, PopIn } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { isProfileGate, ProfileGateNotice } from '@/components/ProfileGate';
import { SarText } from '@/components/SarText';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { StructuredText } from '@/components/StructuredText';
import { WorkshopRecordings } from '@/components/WorkshopRecordings';
import { EventDateBadge } from './index';
import { t, type StringKey } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatEventDays, formatNumber } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

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
  const [gated, setGated] = useState(false);
  // M172 (owner): ONE button. A «both» event asks how he attends with two pills above it (in person first).
  const [chosen, setChosen] = useState<AgendaAttendance>('hq');
  // M176 (owner): the month's code rides along on its own; a top button jumps straight to booking.
  const deal = useMonthlyDeal();
  const scrollRef = useRef<ScrollView>(null);
  const [bookingY, setBookingY] = useState(0);
  const event = query.data?.event;
  const myFee = event ? (event.myFeeSar ?? event.feeSar) : 0;
  // M182e (owner: «بعد الخصم بالفعل 290 ليه مكتوب 261»): a supported price (originalFeeSar struck above it)
  // is final — the month's automatic code never rides along or shows on it.
  const supportedPrice = (event?.originalFeeSar ?? 0) > 0;
  const attendance: AgendaAttendance = event?.mode === 'online' ? 'online' : event?.mode === 'hq' ? 'hq' : chosen;

  const tap = (attendance: AgendaAttendance) => {
    if (!event || register.isPending) return;
    setError(null);
    setGated(false);
    register.mutate(
      { eventId: event.id, attendance, discountCode: !supportedPrice && deal?.code ? deal.code : undefined },
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

  // The one button: «تأكيد الحضور» for a member (or a no-fee event), the same words with the fee for everyone else.
  const dealOn = Boolean(event?.mustPay && myFee > 0 && deal && !supportedPrice);
  const payFee = dealOn && deal ? dealAmount(myFee, deal.percent) : myFee;
  const confirmLabel = event && event.mustPay && myFee > 0 ? t('agenda.withFee', { label: t('agenda.confirmAttendance'), fee: String(payFee) }) : t('agenda.confirmAttendance');
  const canBook = Boolean(event && signedIn && event.open && !event.mine?.paid);
  // The top button books at once; a «both» event first needs his in-person/online choice, so it scrolls there.
  const topCta = () => {
    if (!event) return;
    if (!signedIn) router.push('/auth/login');
    else if (event.mode === 'both') scrollRef.current?.scrollTo({ y: Math.max(0, bookingY - 16), animated: true });
    else tap(attendance);
  };

  return (
    <Screen scrollRef={scrollRef}>
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

          {/* M176 (owner): the first CTA sits right under the title — book on the spot, no scrolling. */}
          {canBook || (!signedIn && event.open) ? (
            <FadeInView delay={60}>
              <AppButton label={signedIn ? t('deal.ctaBook') : t('agenda.signIn')} icon={signedIn ? 'flash-outline' : 'log-in-outline'} loading={register.isPending} onPress={topCta} />
            </FadeInView>
          ) : null}

          {/* M173 (owner): the owner's prose as tidy blocks — fact rows, bullets, golden figures — never one grey wall. */}
          {event.blurb ? (
            <FadeInView delay={100}>
              <StructuredText text={event.blurb} />
            </FadeInView>
          ) : null}

          {/* M191: the full recordings — playable for annual members, locked with the membership door for everyone else. */}
          {event.recordings?.length ? (
            <FadeInView delay={130}>
              <WorkshopRecordings eventId={event.id} titles={event.recordings} />
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
              {/* M107: both prices side by side, with the membership saving for a non-member viewer.
                  M172 (owner: «لو أنا عضو… بس كده مش أكتر»): a member whose seat is included sees ONE line, no prices. */}
              <View style={styles.infoRow}>
                <Ionicons name="pricetag-outline" size={18} color={colors.gold} />
                {signedIn && !event.mustPay && event.feeSar > 0 ? (
                  <Text style={styles.infoText}>{t('agenda.memberIncluded')}</Text>
                ) : (
                  <View style={styles.prices}>
                    <View style={styles.feePill}>
                      <SarText style={styles.feeText} numberOfLines={1}>
                        {event.feeSar > 0 ? t('agenda.nonMemberPrice', { fee: String(event.feeSar) }) : t('agenda.free')}
                      </SarText>
                    </View>
                    <View style={[styles.feePill, styles.memberPill]}>
                      <SarText style={styles.feeText} numberOfLines={1}>
                        {(event.memberFeeSar ?? 0) > 0 ? t('agenda.memberPrice', { fee: String(event.memberFeeSar) }) : t('agenda.included')}
                      </SarText>
                    </View>
                  </View>
                )}
              </View>
              {/* M182e (owner: «السعر الاصلي 990 مشطوب … دعم من النادي»): the list price struck, the support pill carries the computed discount. */}
              {(event.originalFeeSar ?? 0) > 0 && event.feeSar > 0 && !(signedIn && !event.mustPay) ? (
                <View style={styles.supportRow}>
                  <SarText style={styles.wasPrice} numberOfLines={1}>{t('agenda.wasPrice', { fee: formatNumber(event.originalFeeSar ?? 0) })}</SarText>
                  <View style={styles.supportPill}>
                    <Text style={styles.supportText} numberOfLines={1}>
                      {t('agenda.clubSupport', { percent: String(Math.round((1 - event.feeSar / (event.originalFeeSar ?? event.feeSar)) * 100)) })}
                    </Text>
                  </View>
                </View>
              ) : null}
              {(event.savingsSar ?? 0) > 0 ? (
                <SarText style={styles.savings}>{t('agenda.save', { amount: String(event.savingsSar) })}</SarText>
              ) : null}
            </GlassCard>
          </FadeInView>

          {/* M173 (owner: «لازم يكون في CTA مباشر يعرفني إن لو دفعت العضوية دلوقتي الحضور بدون أي رسوم»): a signed-in
              non-member who would pay sees the membership door right under the prices — one tap opens the store popup. */}
          {signedIn && event.mustPay && (event.savingsSar ?? 0) > 0 && !event.mine?.paid ? (
            <FadeInView delay={200}>
              <GlassCard golden style={styles.memberCta}>
                <View style={styles.memberCtaHead}>
                  <Ionicons name="ribbon-outline" size={22} color={colors.goldLight} />
                  <SarText style={styles.memberCtaTitle}>
                    {(event.memberFeeSar ?? 0) > 0
                      ? t('agenda.memberCtaTitleFee', { fee: String(event.memberFeeSar), full: String(event.feeSar) })
                      : t('agenda.memberCtaTitle')}
                  </SarText>
                </View>
                <SarText style={styles.memberCtaText}>{t('agenda.memberCtaText', { amount: String(event.savingsSar) })}</SarText>
                <AppButton label={t('agenda.memberCtaButton')} icon="sparkles-outline" onPress={showMembershipGate} />
              </GlassCard>
            </FadeInView>
          ) : null}

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
            <View style={styles.booking} onLayout={(layout) => setBookingY(layout.nativeEvent.layout.y)}>
              {event.mine && !event.mine.paid ? <Notice tone="warning" text={t('agenda.pendingPay')} /> : null}
              {event.mustPay ? <Notice tone="info" text={t('agenda.payNote')} /> : null}
              {/* M176/M177 (owner): the month's code already applied — no field for another code. */}
              {dealOn ? <MonthlyDealBadge amount={myFee} /> : null}
              {error ? (
                <FadeInView offset={8}>
                  {/* M109i: the complete-profile refusal comes with its own door to the editor. */}
                  {gated ? <ProfileGateNotice text={error} /> : <Notice tone="warning" text={error} support />}
                </FadeInView>
              ) : null}
              {/* M172 (owner): one «تأكيد الحضور» button; a «both» event asks how he attends with two pills. */}
              {event.mode === 'both' ? (
                <View style={styles.attendanceRow}>
                  <Text style={styles.attendanceLabel}>{t('agenda.chooseAttendance')}</Text>
                  <View style={styles.attendanceChips}>
                    <Chip label={t('agenda.attHq')} selected={chosen === 'hq'} dimmed={chosen !== 'hq'} onPress={() => setChosen('hq')} />
                    <Chip label={t('agenda.attOnline')} selected={chosen === 'online'} dimmed={chosen !== 'online'} onPress={() => setChosen('online')} />
                  </View>
                </View>
              ) : null}
              <AppButton
                label={confirmLabel}
                icon={attendance === 'online' ? 'videocam-outline' : 'checkmark-circle-outline'}
                loading={register.isPending}
                onPress={() => tap(attendance)}
              />
            </View>
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
  // M173: the membership door under the prices — golden, one sentence, one button.
  memberCta: { gap: spacing.sm, padding: spacing.md, boxShadow: shadows.glowGoldFaint },
  memberCtaHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memberCtaTitle: { ...typography.subtitle, fontSize: 17, lineHeight: 26, color: colors.goldLight, flex: 1, textAlign: textStart },
  memberCtaText: { ...typography.body, fontSize: 15, lineHeight: 24, color: colors.textSecondary, textAlign: textStart },
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
  // M182e: the struck list price beside the club-support discount pill.
  supportRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  wasPrice: { ...typography.caption, fontSize: 14, color: colors.textMuted, textDecorationLine: 'line-through' },
  supportPill: {
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  supportText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 18, color: colors.goldInk },
  booking: { gap: spacing.md },
  // M172: how he attends — two pills above the one button.
  attendanceRow: { gap: spacing.xs },
  attendanceLabel: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  attendanceChips: { flexDirection: 'row', gap: spacing.sm },
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
