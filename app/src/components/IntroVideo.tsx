import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Modal, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { playVideo } from '@/lib/player';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

/** M84 (owner): the one-time «تعرف علينا أكتر» popup — this exact film, first open only. */
const INTRO_URL = 'https://www.youtube.com/watch?v=8MuTvxvtnXY';
const INTRO_THUMB = 'https://img.youtube.com/vi/8MuTvxvtnXY/hqdefault.jpg';
const SEEN_KEY = 'investorsclub.introSeen';

export function IntroVideoPopup() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadSetting(SEEN_KEY).then((seen) => {
      if (alive && !seen) setVisible(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Seen is recorded on ANY way out, so the popup never returns (a replay lives in «تعرف علينا»).
  const dismiss = () => {
    setVisible(false);
    void saveSetting(SEEN_KEY, '1');
  };

  const play = () => {
    dismiss();
    playVideo(router, { url: INTRO_URL, title: t('home.intro.title') });
  };

  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <PressScale onPress={play} accessibilityRole="button" accessibilityLabel={t('home.intro.play')}>
              <View style={styles.thumbBox}>
                <Image source={{ uri: INTRO_THUMB }} style={styles.thumb} resizeMode="cover" accessibilityLabel={t('home.intro.title')} />
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch' },
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
});
