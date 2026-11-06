import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Modal, Text, View } from 'react-native';

import { useHq } from '@/api/hq';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn, PressScale } from '@/components/motion';
import { getLang, t } from '@/i18n';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { clearIntroDue, INTRO_DEVICE_SEEN_KEY, introAccountSeenKey, introIsDue } from '@/lib/introGate';
import { playVideo } from '@/lib/player';
import { autoPopupsBlocked, markAutoPopupUsed, usePopupHold } from '@/lib/popupGate';
import { themedStyles } from '@/theme/styles';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M84 (owner): the one-time «تعرف علينا أكتر» popup.
 * M102: each language gets its own film, and the poster is the club HQ photo (owner: the
 * YouTube auto-thumbnail showed the podcast studio), falling back to the film's thumbnail.
 * M209 (owner, 2026-11-06: a member registered and nothing played): the «seen» flag was one per DEVICE and the popup was
 * mounted on the home screen (a visitor's first open spent it). It is now a root-level host that is owed per ACCOUNT:
 * a new registration plays it at once (lib/introGate), an account that has not seen it on this phone sees it once, and
 * the same film is a playable card in «عنّا» for anyone, any time.
 */
const INTRO = {
  ar: { url: 'https://www.youtube.com/watch?v=8MuTvxvtnXY', thumb: 'https://img.youtube.com/vi/8MuTvxvtnXY/hqdefault.jpg' },
  en: { url: 'https://www.youtube.com/watch?v=QJpUWGz47q0', thumb: 'https://img.youtube.com/vi/QJpUWGz47q0/hqdefault.jpg' },
} as const;

/** The film of the app's language and its poster (the HQ photo when the server has one). */
export function useIntroFilm(): { url: string; poster: string } {
  const intro = INTRO[getLang()];
  const hqPhoto = useHq().data?.photos?.[0] ?? null;
  return { url: intro.url, poster: hqPhoto ?? intro.thumb };
}

/** The film as a card: poster with a play button, opening the in-app player. Used by «عنّا». */
export function IntroFilmCard() {
  const router = useRouter();
  const film = useIntroFilm();
  const play = () => playVideo(router, { url: film.url, title: t('home.intro.title') });
  return (
    <GlassCard golden radius={radii.xxl} style={styles.card}>
      <PressScale onPress={play} accessibilityRole="button" accessibilityLabel={t('home.intro.play')}>
        <View style={styles.thumbBox}>
          <Image source={{ uri: film.poster }} style={styles.thumb} resizeMode="cover" accessibilityLabel={t('home.intro.title')} />
          <View style={styles.playRing}>
            <Ionicons name="play" size={26} color={colors.goldInk} />
          </View>
        </View>
      </PressScale>
      <Text style={styles.title}>{t('home.intro.title')}</Text>
      <Text style={styles.subtitle}>{t('home.intro.subtitle')}</Text>
      <AppButton label={t('home.intro.play')} icon="play" onPress={play} />
    </GlassCard>
  );
}

/** Mounted once in the root layout. */
export function IntroVideoPopup() {
  const router = useRouter();
  const { status, me, confirmed } = useAuth();
  const film = useIntroFilm();
  const [phase, setPhase] = useState<'idle' | 'open'>('idle');
  const [decided, setDecided] = useState<string | null>(null);
  const account = status === 'signedIn' && confirmed && me ? String(me.id) : null;

  // Held while the saved flags are read (a few milliseconds) and while the film popup is up, so no other popup jumps in first.
  usePopupHold(phase === 'open' || (account !== null && decided !== account));

  useEffect(() => {
    if (!account || decided === account) return;
    let alive = true;
    void Promise.all([introIsDue(), loadSetting(introAccountSeenKey(account)), loadSetting(INTRO_DEVICE_SEEN_KEY)]).then(([due, seenByAccount, seenOnDevice]) => {
      if (!alive) return;
      setDecided(account);
      // Never above the forced-update cover; a new registration always plays it, anyone else only if this phone never did.
      const show = !seenByAccount && !autoPopupsBlocked() && (due || !seenOnDevice);
      if (show) markAutoPopupUsed();
      setPhase(show ? 'open' : 'idle');
    });
    return () => {
      alive = false;
    };
  }, [account, decided]);

  // Seen is recorded on ANY way out, so the popup never returns (a replay lives in «عنّا»).
  const dismiss = () => {
    setPhase('idle');
    clearIntroDue();
    if (account) void saveSetting(introAccountSeenKey(account), '1');
    void saveSetting(INTRO_DEVICE_SEEN_KEY, '1');
  };

  const play = () => {
    dismiss();
    playVideo(router, { url: film.url, title: t('home.intro.title') });
  };

  if (phase !== 'open') return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.popCard}>
            <PressScale onPress={play} accessibilityRole="button" accessibilityLabel={t('home.intro.play')}>
              <View style={styles.thumbBox}>
                <Image source={{ uri: film.poster }} style={styles.thumb} resizeMode="cover" accessibilityLabel={t('home.intro.title')} />
                <View style={styles.playRing}>
                  <Ionicons name="play" size={26} color={colors.goldInk} />
                </View>
              </View>
            </PressScale>
            <Text style={styles.title}>{t('home.intro.title')}</Text>
            <Text style={styles.subtitle}>{t('home.intro.subtitle')}</Text>
            <AppButton label={t('home.intro.play')} icon="play" onPress={play} />
            <AppButton label={t('home.intro.later')} variant="outline" onPress={dismiss} />
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch' },
  popCard: { gap: spacing.sm, padding: spacing.md },
  card: { gap: spacing.sm, padding: spacing.md },
  thumbBox: { borderRadius: radii.lg, overflow: 'hidden' },
  thumb: { width: '100%', height: 180, backgroundColor: colors.surfaceElevated },
  playRing: {
    position: 'absolute',
    top: '50%',
    alignSelf: 'center',
    marginTop: -27,
    width: 54,
    height: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGoldStrong,
  },
  title: { ...typography.subtitle, color: colors.gold, textAlign: 'center', marginTop: spacing.xs },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
}));
