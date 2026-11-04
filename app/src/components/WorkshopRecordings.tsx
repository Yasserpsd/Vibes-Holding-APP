import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useAgendaRecordings } from '@/api/agenda';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { sized } from '@/lib/imageUrl';
import { openLink } from '@/lib/openLink';
import { textStart } from '@/i18n/direction';
import { playVideo } from '@/lib/player';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M191 (owner: «يتفرج علي الورشة لانه مقدرش يحضر … خاصة بالأعضاء فقط»): the workshop's full
 * recordings. An ACTIVE annual member gets one row per day that opens the in-app player; everyone
 * else sees the same titles locked, with the membership door — a paid workshop ticket never unlocks them.
 */
export function WorkshopRecordings({ eventId, titles, files, past = false }: { eventId: string; titles: { title: string; image?: string }[]; files: { title: string }[]; past?: boolean }) {
  const router = useRouter();
  const { status, me } = useAuth();
  const signedIn = status === 'signedIn';
  const member = signedIn && me?.membership.status === 'active';
  const links = useAgendaRecordings(eventId, member);
  const { width } = useWindowDimensions();
  // Big enough to read the day across the room — about two thirds of the screen, the next day peeking in.
  const bannerWidth = Math.round(Math.min(width * 0.66, 340));
  if (titles.length === 0 && files.length === 0) return null;

  const missed = past && titles.length > 0;
  const playable = member ? (links.data?.recordings ?? null) : null;
  const rows = playable ?? titles.map((entry) => ({ title: entry.title, url: '', poster: '' }));
  // M192: the slides shown at the workshop, opened in the in-app browser.
  const documents = (member ? links.data?.files : null) ?? files.map((entry) => ({ title: entry.title, url: '' }));

  return (
    <GlassCard golden style={styles.card}>
      {/* M192 (owner: «فاتتك الورشة ما تشيل هم»): a finished workshop opens with the reassurance. */}
      {missed ? (
        <View style={styles.missed}>
          <Text style={styles.missedTitle}>{t('agenda.missedTitle')}</Text>
          <Text style={styles.missedBody}>{t('agenda.missedBody')}</Text>
        </View>
      ) : null}
      <View style={styles.head}>
        <Ionicons name="play-circle" size={26} color={colors.goldLight} />
        <Text style={styles.title}>{t(titles.length > 0 ? 'agenda.recordingsTitle' : 'agenda.filesTitle')}</Text>
      </View>
      <View style={styles.badge}>
        <Ionicons name="ribbon-outline" size={14} color={colors.goldLight} />
        <Text style={styles.badgeText} numberOfLines={1}>
          {t('agenda.recordingsBadge')}
        </Text>
      </View>

      {/* M192 (owner: «البانر يكون كبير كبير … جنب بعض»): one big banner per day, swiped side by side. */}
      {rows.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={bannerWidth + spacing.sm} decelerationRate="fast" contentContainerStyle={styles.banners}>
          {rows.map((recording, index) => {
            const ready = Boolean(recording.url);
            // A dashboard banner already carries the day's name in big letters; a video frame gets the title over a shade.
            const custom = titles[index]?.image;
            const banner = custom ?? (recording.poster || undefined);
            return (
              <PressScale
                key={`${index}-${recording.title}`}
                wrapStyle={{ width: bannerWidth }}
                disabled={!ready}
                glow={ready}
                onPress={() => playVideo(router, { url: recording.url, title: recording.title, poster: recording.poster })}
                accessibilityLabel={recording.title}
              >
                <View style={styles.banner}>
                  {banner ? (
                    <Image source={{ uri: sized(banner, bannerWidth) }} style={[StyleSheet.absoluteFill, !member && styles.bannerLocked]} resizeMode="cover" accessibilityLabel={recording.title} />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, styles.bannerFallback]} />
                  )}
                  {custom ? null : <View style={styles.bannerScrim} pointerEvents="none" />}
                  <View style={[styles.bannerIcon, !member && styles.bannerIconLocked]}>
                    <Ionicons name={member ? 'play' : 'lock-closed'} size={22} color={member ? colors.black : colors.goldLight} />
                  </View>
                  {custom ? null : (
                    <Text style={styles.bannerTitle} numberOfLines={2}>
                      {recording.title}
                    </Text>
                  )}
                </View>
              </PressScale>
            );
          })}
        </ScrollView>
      ) : null}

      {/* M192 (owner: «الملفات … جنب بعض 3 ملفات … بطريقة شيك»): the slides as small cards in rows of three. */}
      {documents.length > 0 ? (
        <View style={styles.files}>
          {documents.map((file, index) => {
            const ready = Boolean(file.url);
            const [lead, day] = file.title.includes(' — ') ? file.title.split(' — ', 2) : ['', file.title];
            return (
              <PressScale key={`file-${index}-${file.title}`} wrapStyle={styles.fileWrap} disabled={!ready} onPress={() => void openLink(file.url)} accessibilityLabel={file.title}>
                <View style={[styles.file, !ready && styles.fileLocked]}>
                  <View style={styles.fileIcon}>
                    <Ionicons name={member ? 'document-text' : 'lock-closed'} size={22} color={member ? colors.gold : colors.textMuted} />
                  </View>
                  {lead ? (
                    <Text style={styles.fileLead} numberOfLines={1}>
                      {lead}
                    </Text>
                  ) : null}
                  <Text style={styles.fileDay} numberOfLines={2}>
                    {day}
                  </Text>
                  <Text style={styles.fileTag}>PDF</Text>
                </View>
              </PressScale>
            );
          })}
        </View>
      ) : null}

      {member && links.isError ? <Text style={styles.note}>{t('agenda.recordingsError')}</Text> : null}
      {!member ? (
        <>
          <Text style={styles.note}>{t(missed ? 'agenda.recordingsLockedShort' : 'agenda.recordingsLocked')}</Text>
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

const styles = themedStyles(() => ({
  card: { gap: spacing.sm, padding: spacing.md, boxShadow: shadows.glowGoldFaint },
  missed: { gap: 2, paddingBottom: spacing.xs },
  missedTitle: { ...typography.subtitle, fontSize: 19, lineHeight: 30, color: colors.textPrimary, textAlign: textStart },
  missedBody: { ...typography.body, fontSize: 15, lineHeight: 24, color: colors.textSecondary, textAlign: textStart },
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
  banners: { gap: spacing.sm, paddingVertical: spacing.xs },
  banner: { aspectRatio: 3 / 4, borderRadius: radii.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderGold, backgroundColor: colors.surfaceElevated, justifyContent: 'flex-end', padding: spacing.md, boxShadow: shadows.glowGoldFaint },
  bannerLocked: { opacity: 0.6 },
  bannerFallback: { backgroundColor: colors.surfaceElevated, experimental_backgroundImage: gradients.goldWash },
  bannerScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: gradients.scrim },
  bannerIcon: {
    position: 'absolute',
    top: spacing.md,
    start: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  bannerIconLocked: { backgroundColor: colors.overlay, borderWidth: 1, borderColor: colors.borderGold },
  bannerTitle: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.onPhotoGold, textAlign: 'center' },
  files: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  fileWrap: { width: '31.5%' },
  file: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
    experimental_backgroundImage: gradients.goldWash,
  },
  fileLocked: { opacity: 0.75 },
  fileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderGold, marginBottom: spacing.xs },
  fileLead: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  fileDay: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 21, color: colors.textPrimary, textAlign: 'center' },
  fileTag: { fontFamily: fonts.semiBold, fontSize: 10, lineHeight: 14, color: colors.gold, letterSpacing: 1 },
  note: { ...typography.body, fontSize: 15, lineHeight: 24, color: colors.textSecondary, textAlign: textStart },
}));
