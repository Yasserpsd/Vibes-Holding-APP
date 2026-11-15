import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useMyRequests, type MemberRequest, type RequestKind, type RequestStatus } from '@/api/requests';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { LockedNotice } from '@/components/LockedNotice';
import { WhatsappNote } from '@/components/WhatsappNote';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SarText } from '@/components/SarText';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { getLang, t, tOptional } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatArabicDateTime, formatSar } from '@/lib/format';
import { lazyTokens, themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const STATUS_COLOR: Record<RequestStatus, string> = lazyTokens(() => ({
  pending: colors.warning,
  in_progress: colors.gold,
  done: colors.success,
  rejected: colors.danger,
  cancelled: colors.textMuted,
}));

const KIND_ICON: Record<RequestKind, keyof typeof Ionicons.glyphMap> = {
  card: 'card-outline',
  hq: 'business-outline',
  service: 'grid-outline',
  workshop: 'school-outline',
  form: 'document-text-outline',
  golden: 'star-outline',
  agenda: 'calendar-outline',
  persona: 'compass-outline',
  profile: 'sparkles-outline',
  deletion: 'trash-outline',
  payment: 'receipt-outline',
};

/** M138 «متابعة طلباتي»: every operation the member started, newest first, with its status and details. */
export default function RequestsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const { data, isLoading, error, refetch } = useMyRequests(status === 'signedIn');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  // The account is still being restored: no sign-in prompt flashes at a member who is signed in.
  if (status === 'loading') {
    return (
      <Screen title={t('requests.title')}>
        <StateView loading />
      </Screen>
    );
  }

  if (status !== 'signedIn') {
    return (
      <Screen title={t('requests.title')}>
        <LockedNotice text={t('requests.signIn')} guest />
        <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('requests.title')}
      subtitle={t('requests.subtitle')}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.gold} colors={[colors.gold]} progressBackgroundColor={colors.surfaceElevated} />}
    >
      {data?.requests.length ? <WhatsappNote kind="updates" /> : null}
      {data ? (
        data.requests.length ? (
          data.requests.map((request, index) => (
            <FadeInView key={`${request.kind}-${request.id}`} delay={entranceDelay(Math.min(index, 8))}>
              <RequestRow request={request} onOpen={request.screen ? () => router.push(request.screen as Href) : null} />
            </FadeInView>
          ))
        ) : (
          <FadeInView>
            <Text style={styles.empty}>{t('requests.empty')}</Text>
          </FadeInView>
        )
      ) : (
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      )}
    </Screen>
  );
}

function RequestRow({ request, onOpen }: { request: MemberRequest; onOpen: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const en = getLang() === 'en';
  // A status or kind the app does not know yet (a newer server) keeps a neutral colour, icon and its own words.
  const color = STATUS_COLOR[request.status] ?? colors.textMuted;
  const title = (en ? request.titleEn : '') || request.title;
  const kindLabel = tOptional(`requests.kind.${request.kind}`) ?? t('requests.kind.service');
  const statusLabel = tOptional(`requests.status.${request.status}`) ?? '';
  const amount = request.noFee ? t('requests.noFee') : request.amountSar !== null ? `${formatSar(request.amountSar)} ${t('requests.sar')}` : null;
  return (
    <GlassCard style={styles.row}>
      <View pointerEvents="none" style={[styles.accent, { backgroundColor: color }]} />
      <Pressable onPress={() => setOpen((value) => !value)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={styles.header}>
          <Ionicons name={KIND_ICON[request.kind] ?? 'document-text-outline'} size={18} color={colors.goldLightText} />
          <Text style={styles.kind} numberOfLines={1}>
            {kindLabel}
          </Text>
          {statusLabel ? (
            <View style={[styles.badge, { borderColor: color }]}>
              <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
                {statusLabel}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.title}>{title}</Text>
        {amount ? <SarText style={styles.amount}>{amount}</SarText> : null}
        <View style={styles.footer}>
          <Text style={styles.meta}>{`${t('requests.number', { number: request.number })} · ${formatArabicDateTime(request.createdAt)}`}</Text>
          <Ionicons name={open ? 'chevron-up-outline' : 'chevron-down-outline'} size={16} color={colors.goldLightText} />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.details}>
          {request.rows.map((row, index) => (
            <View key={`${row.label}-${index}`} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{en ? row.labelEn : row.label}</Text>
              <Text style={styles.detailValue}>{row.value}</Text>
            </View>
          ))}
          {request.updatedAt ? (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('requests.updatedAt')}</Text>
              <Text style={styles.detailValue}>{formatArabicDateTime(request.updatedAt)}</Text>
            </View>
          ) : null}
          {request.note ? (
            <View style={styles.note}>
              <Text style={styles.noteLabel}>{t('requests.note')}</Text>
              <Text style={styles.noteText}>{request.note}</Text>
            </View>
          ) : null}
          {onOpen ? (
            <PressScale onPress={onOpen} accessibilityRole="button">
              <View style={styles.openLink}>
                <Text style={styles.openText}>{t('requests.open')}</Text>
                <Ionicons name={chevronForward()} size={16} color={colors.goldText} />
              </View>
            </PressScale>
          ) : null}
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = themedStyles(() => ({
  row: { gap: spacing.xs, padding: spacing.md },
  accent: { position: 'absolute', start: 0, top: 0, bottom: 0, width: 3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kind: { ...typography.caption, color: colors.goldLightText, flex: 1, textAlign: textStart },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, backgroundColor: colors.surfaceElevated },
  badgeText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart, marginTop: spacing.xs },
  amount: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.goldText, textAlign: textStart },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  meta: { ...typography.caption, color: colors.textMuted, textAlign: textStart, flex: 1 },
  details: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: spacing.xs },
  detailRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  detailLabel: { ...typography.caption, color: colors.textMuted, textAlign: textStart, width: 110 },
  detailValue: { ...typography.body, color: colors.textPrimary, textAlign: textStart, flex: 1 },
  note: { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, padding: spacing.sm, gap: 2 },
  noteLabel: { ...typography.caption, color: colors.goldLightText, textAlign: textStart },
  noteText: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  openLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.xs, minHeight: 44 },
  openText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: colors.goldText },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
}));
