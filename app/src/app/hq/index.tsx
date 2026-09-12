import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { hqApi, useHq, useMyVisits, type Visit, type VisitStatus } from '@/api/hq';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { LockedNotice } from '@/components/LockedNotice';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StateView } from '@/components/StateView';
import { WEEKDAYS, formatArabicDate } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATUS: Record<VisitStatus, { label: string; color: string }> = {
  pending: { label: 'بانتظار التأكيد', color: colors.warning },
  confirmed: { label: 'مؤكد', color: colors.success },
  rejected: { label: 'مرفوض', color: colors.danger },
  cancelled: { label: 'ملغي', color: colors.textMuted },
};

/** HQ page: address, tour, rules, and (for paid members) booking plus the member's visits. */
export default function HqScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useHq();
  const visits = useMyVisits(status === 'signedIn');
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const days = content.hours.days.map((day) => WEEKDAYS[day]).filter(Boolean).join('، ');
  const cancel = async (visit: Visit) => {
    setActionError(null);
    try {
      await hqApi.cancel(visit.id);
      await queryClient.invalidateQueries({ queryKey: ['hq'] });
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  };

  return (
    <Screen title={content.title} subtitle={content.intro} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} />}>
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="location-outline" size={22} color={colors.gold} />
          <Text style={styles.rowText}>{content.address}</Text>
        </View>
        <View style={styles.row}>
          <Ionicons name="time-outline" size={22} color={colors.gold} />
          <Text style={styles.rowText}>{`${days} · من ${content.hours.open} إلى ${content.hours.close}`}</Text>
        </View>
        <View style={styles.actions}>
          <AppButton label="افتح الخريطة" variant="outline" icon="map-outline" onPress={() => void openLink(content.mapUrl)} style={styles.action} />
          <AppButton label="جولة في المقر" variant="outline" icon="play-circle-outline" onPress={() => void openLink(`https://www.youtube.com/watch?v=${content.tourVideoId}`)} style={styles.action} />
        </View>
      </View>

      {content.facilities.length ? (
        <View style={styles.chips}>
          {content.facilities.map((facility) => (
            <View key={facility} style={styles.chip}>
              <Text style={styles.chipText}>{facility}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <SectionHeader title="حجز الزيارة" />
      {data.access === 'member' ? (
        <AppButton label="احجز موعد زيارتك" icon="calendar-outline" onPress={() => router.push('/hq/book')} />
      ) : (
        <LockedNotice text={data.lockedText ?? content.memberOnlyText} guest={data.access === 'guest'} />
      )}
      {content.rules.map((rule) => (
        <View key={rule} style={styles.bullet}>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.gold} />
          <Text style={styles.bulletText}>{rule}</Text>
        </View>
      ))}

      {status === 'signedIn' ? (
        <>
          <SectionHeader title="زياراتي" />
          {actionError ? <Notice tone="warning" text={actionError} /> : null}
          {visits.data ? (
            visits.data.visits.length ? (
              visits.data.visits.map((visit) => (
                <VisitRow key={visit.id} visit={visit} onPass={() => router.push({ pathname: '/hq/pass/[id]', params: { id: visit.id } })} onCancel={() => void cancel(visit)} />
              ))
            ) : (
              <Text style={styles.empty}>لا توجد زيارات محجوزة بعد.</Text>
            )
          ) : (
            <StateView loading={visits.isLoading} error={visits.error} onRetry={() => void visits.refetch()} />
          )}
        </>
      ) : null}

      {me?.isAdmin ? <AppButton label="طلبات الزيارة (إدارة النادي)" variant="outline" icon="shield-checkmark-outline" onPress={() => router.push('/hq/admin')} /> : null}
    </Screen>
  );
}

function VisitRow({ visit, onPass, onCancel }: { visit: Visit; onPass: () => void; onCancel: () => void }) {
  const badge = STATUS[visit.status];
  const weekday = WEEKDAYS[new Date(`${visit.date}T00:00:00Z`).getUTCDay()] ?? '';
  return (
    <View style={styles.visit}>
      <View style={styles.visitHeader}>
        <Text style={styles.visitDate}>{`${weekday} ${formatArabicDate(visit.date)}`}</Text>
        <View style={[styles.badge, { backgroundColor: badge.color }]}>
          <Text style={styles.badgeText}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.visitMeta}>{`من ${visit.time} إلى ${visit.endTime} · ${visit.purpose}`}</Text>
      {visit.note ? <Text style={styles.visitNote}>{visit.note}</Text> : null}
      {visit.adminNote ? <Text style={styles.visitNote}>{`ملاحظة الإدارة: ${visit.adminNote}`}</Text> : null}
      <View style={styles.actions}>
        {visit.hasPass ? <AppButton label="باركود الدخول" icon="qr-code-outline" onPress={onPass} style={styles.action} /> : null}
        {visit.cancellable ? (
          <Pressable onPress={onCancel} accessibilityRole="button" style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>إلغاء الحجز</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowText: { ...typography.body, color: colors.textPrimary, textAlign: 'right', flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  action: { flexGrow: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.surface },
  chipText: { ...typography.caption, color: colors.goldLight },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bulletText: { ...typography.caption, color: colors.textSecondary, textAlign: 'right', flex: 1 },
  empty: { ...typography.body, color: colors.textMuted, textAlign: 'right' },
  visit: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  visitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  visitDate: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: 'right', flex: 1 },
  visitMeta: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  visitNote: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, color: colors.black },
  cancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, flexShrink: 0 },
  cancelText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 22, color: colors.danger },
  pressed: { opacity: 0.7 },
});
