import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { hqApi, useHq, useMyVisits, type Visit, type VisitStatus } from '@/api/hq';
import { useAuth } from '@/auth/AuthProvider';
import { useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { LockedNotice } from '@/components/LockedNotice';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatArabicDate, weekdayName, weekdayOf } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATUS_COLOR: Record<VisitStatus, string> = { pending: colors.warning, confirmed: colors.success, rejected: colors.danger, cancelled: colors.textMuted };

/** HQ page: address, tour, rules, and (for paid members) booking plus the member's visits. */
export default function HqScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useHq();
  const visits = useMyVisits(status === 'signedIn');
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useAdvisorScreen({ type: 'screen', id: 'hq', title: data?.content.title ?? t('nav.hq') });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), visits.refetch()]);
    setRefreshing(false);
  };

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  const { content } = data;
  const days = content.hours.days.map(weekdayName).filter(Boolean).join(t('common.listSeparator'));
  const cancel = async (visit: Visit) => {
    setActionError(null);
    try {
      await hqApi.cancel(visit.id);
      await queryClient.invalidateQueries({ queryKey: ['hq'] });
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  };

  const photos = data.photos ?? [];

  return (
    <Screen title={content.title} subtitle={content.intro} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}>
      {/* M81: the owner's real HQ photos, employed where they belong — the first photo leads wide. */}
      {photos.length ? (
        <FadeInView delay={entranceDelay(0)}>
          <Image source={{ uri: photos[0] }} style={styles.heroPhoto} resizeMode="cover" accessibilityLabel={content.title} />
          {photos.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
              {photos.slice(1).map((photo) => (
                <Image key={photo} source={{ uri: photo }} style={styles.photo} resizeMode="cover" accessibilityLabel={content.title} />
              ))}
            </ScrollView>
          ) : null}
        </FadeInView>
      ) : null}
      <FadeInView delay={entranceDelay(1)}>
        <GlassCard golden style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="location-outline" size={22} color={colors.gold} />
            <Text style={styles.rowText}>{content.address}</Text>
          </View>
          <View style={styles.row}>
            <Ionicons name="time-outline" size={22} color={colors.gold} />
            <Text style={styles.rowText}>{t('hq.hours', { days, open: content.hours.open, close: content.hours.close })}</Text>
          </View>
          <View style={styles.actions}>
            <AppButton label={t('hq.openMap')} variant="outline" icon="map-outline" onPress={() => void openLink(content.mapUrl)} style={styles.action} />
            <AppButton label={t('hq.tour')} variant="outline" icon="play-circle-outline" onPress={() => void openLink(`https://www.youtube.com/watch?v=${content.tourVideoId}`)} style={styles.action} />
          </View>
          {/* M76 (owner): right after the map — a DIRECT booking CTA, the first actionable thing. */}
          {data.access === 'member' ? <AppButton label={t('hq.bookNow')} icon="calendar-outline" onPress={() => router.push('/hq/book')} /> : null}
        </GlassCard>
      </FadeInView>

      {content.facilities.length ? (
        <FadeInView delay={entranceDelay(2)} style={styles.chips}>
          {content.facilities.map((facility) => (
            <View key={facility} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {facility}
              </Text>
            </View>
          ))}
        </FadeInView>
      ) : null}

      <FadeInView delay={entranceDelay(3)}>
        <SectionHeader title={t('hq.bookingTitle')} />
      </FadeInView>
      {data.access === 'member' ? (
        <FadeInView delay={entranceDelay(4)}>
          <AppButton label={t('hq.book')} icon="calendar-outline" onPress={() => router.push('/hq/book')} />
        </FadeInView>
      ) : (
        <LockedNotice text={data.lockedText ?? content.memberOnlyText} guest={data.access === 'guest'} />
      )}
      {content.rules.map((rule, index) => (
        <FadeInView key={rule} delay={entranceDelay(5 + index)} style={styles.bullet}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.gold} />
          <Text style={styles.bulletText}>{rule}</Text>
        </FadeInView>
      ))}

      {status === 'signedIn' ? (
        <>
          <SectionHeader title={t('hq.myVisits')} />
          {actionError ? <Notice tone="warning" text={actionError} /> : null}
          {visits.data ? (
            visits.data.visits.length ? (
              visits.data.visits.map((visit, index) => (
                <FadeInView key={visit.id} delay={entranceDelay(index)}>
                  <VisitRow visit={visit} onPass={() => router.push({ pathname: '/hq/pass/[id]', params: { id: visit.id } })} onCancel={() => void cancel(visit)} />
                </FadeInView>
              ))
            ) : (
              <Text style={styles.empty}>{t('hq.noVisits')}</Text>
            )
          ) : (
            <StateView loading={visits.isLoading} error={visits.error} onRetry={() => void visits.refetch()} />
          )}
        </>
      ) : null}

      {me?.isAdmin ? <AppButton label={t('hq.adminRequests')} variant="outline" icon="shield-checkmark-outline" onPress={() => router.push('/hq/admin')} /> : null}
    </Screen>
  );
}

function VisitRow({ visit, onPass, onCancel }: { visit: Visit; onPass: () => void; onCancel: () => void }) {
  const weekday = weekdayOf(visit.date);
  return (
    <GlassCard golden={visit.status === 'confirmed'} style={styles.visit}>
      <View style={styles.visitHeader}>
        <Text style={styles.visitDate}>{`${weekday} ${formatArabicDate(visit.date)}`}</Text>
        <View style={[styles.badge, { borderColor: STATUS_COLOR[visit.status] }]}>
          <Text style={[styles.badgeText, { color: STATUS_COLOR[visit.status] }]} numberOfLines={1}>
            {t(`hq.status.${visit.status}`)}
          </Text>
        </View>
      </View>
      <Text style={styles.visitMeta}>{t('hq.visitMeta', { from: visit.time, to: visit.endTime, purpose: visit.purpose })}</Text>
      {visit.note ? <Text style={styles.visitNote}>{visit.note}</Text> : null}
      {visit.adminNote ? <Text style={styles.visitNote}>{t('hq.adminNote', { note: visit.adminNote })}</Text> : null}
      <View style={styles.actions}>
        {visit.hasPass ? <AppButton label={t('hq.pass')} icon="qr-code-outline" onPress={onPass} style={styles.action} /> : null}
        {visit.cancellable ? (
          <PressScale onPress={onCancel} accessibilityRole="button" wrapStyle={styles.cancelWrap} style={styles.cancel}>
            <Text style={styles.cancelText}>{t('hq.cancelBooking')}</Text>
          </PressScale>
        ) : null}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  // M81: the HQ gallery.
  heroPhoto: { width: '100%', height: 180, borderRadius: radii.xl, backgroundColor: colors.surfaceElevated },
  photoStrip: { gap: spacing.sm, paddingTop: spacing.sm },
  photo: { width: 132, height: 88, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated },
  card: {
    gap: spacing.md,
    padding: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowText: { ...typography.body, color: colors.textPrimary, textAlign: textStart, flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  action: { flexGrow: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderGoldSoft, backgroundColor: colors.goldFaint },
  chipText: { ...typography.caption, color: colors.goldLight },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bulletText: { ...typography.caption, color: colors.textSecondary, textAlign: textStart, flex: 1 },
  empty: { ...typography.body, color: colors.textMuted, textAlign: textStart },
  visit: { gap: spacing.xs, padding: spacing.md },
  visitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  visitDate: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart, flex: 1 },
  visitMeta: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  visitNote: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  // Tinted pill: the status colour frames and inks the word instead of flooding it.
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, backgroundColor: colors.surfaceElevated },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 },
  cancelWrap: { flexShrink: 0 },
  cancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  cancelText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 22, color: colors.danger },
});
