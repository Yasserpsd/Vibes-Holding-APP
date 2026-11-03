import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAgendaRecordings } from '@/api/agenda';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { playVideo } from '@/lib/player';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M191 (owner: «يتفرج علي الورشة لانه مقدرش يحضر … خاصة بالأعضاء فقط»): the workshop's full
 * recordings. An ACTIVE annual member gets one row per day that opens the in-app player; everyone
 * else sees the same titles locked, with the membership door — a paid workshop ticket never unlocks them.
 */
export function WorkshopRecordings({ eventId, titles }: { eventId: string; titles: { title: string }[] }) {
  const router = useRouter();
  const { status, me } = useAuth();
  const signedIn = status === 'signedIn';
  const member = signedIn && me?.membership.status === 'active';
  const links = useAgendaRecordings(eventId, member);
  if (titles.length === 0) return null;

  const playable = member ? (links.data?.recordings ?? null) : null;
  const rows = playable ?? titles.map((entry) => ({ title: entry.title, url: '', poster: '' }));

  return (
    <GlassCard golden style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="play-circle" size={26} color={colors.goldLight} />
        <Text style={styles.title}>{t('agenda.recordingsTitle')}</Text>
      </View>
      <View style={styles.badge}>
        <Ionicons name="ribbon-outline" size={14} color={colors.goldLight} />
        <Text style={styles.badgeText} numberOfLines={1}>
          {t('agenda.recordingsBadge')}
        </Text>
      </View>

      {rows.map((recording, index) => {
        const ready = Boolean(recording.url);
        return (
          <PressScale
            key={`${index}-${recording.title}`}
            disabled={!ready}
            onPress={() => playVideo(router, { url: recording.url, title: recording.title, poster: recording.poster })}
            accessibilityLabel={recording.title}
          >
            <View style={[styles.row, !ready && styles.rowLocked]}>
              <Ionicons name={member ? 'play' : 'lock-closed'} size={18} color={member ? colors.gold : colors.textMuted} />
              <Text style={[styles.rowText, !ready && styles.rowTextLocked]} numberOfLines={2}>
                {recording.title}
              </Text>
            </View>
          </PressScale>
        );
      })}

      {member && links.isError ? <Text style={styles.note}>{t('agenda.recordingsError')}</Text> : null}
      {!member ? (
        <>
          <Text style={styles.note}>{t('agenda.recordingsLocked')}</Text>
          {signedIn ? (
            <AppButton label={t('agenda.memberCtaButton')} icon="sparkles-outline" onPress={showMembershipGate} />
          ) : (
            <AppButton label={t('agenda.recordingsSignIn')} icon="log-in-outline" onPress={() => router.push('/auth/login')} />
          )}
        </>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, boxShadow: shadows.glowGoldFaint },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.subtitle, fontSize: 18, lineHeight: 28, color: colors.goldLight, flex: 1, textAlign: textStart },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
  badgeText: { ...typography.caption, color: colors.goldLight },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
  },
  rowLocked: { opacity: 0.75 },
  rowText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: textStart },
  rowTextLocked: { color: colors.textSecondary },
  note: { ...typography.body, fontSize: 15, lineHeight: 24, color: colors.textSecondary, textAlign: textStart },
});
