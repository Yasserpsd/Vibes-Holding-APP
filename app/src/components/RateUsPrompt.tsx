import Ionicons from '@expo/vector-icons/Ionicons';
import { useSegments } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldHairline } from '@/components/lux';
import { FadeInView, PressScale } from '@/components/motion';
import { env } from '@/config/env';
import { t } from '@/i18n';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { claimAutoPopup } from '@/lib/popupGate';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * M141 (owner, 2026-10-28: «يظهر مرة واحدة كل أسبوع مرة واحدة فقط، برسالة شيك يدوس يروح يعملنا تقييم في
 * المتجر اللي فاتح منه»): a small bottom sheet that invites a signed-in member to rate the app in the
 * store this install came from. At most once every 7 days, never on the first launch, only over the
 * tabs (never over sign-in, checkout, payment or a form), a few seconds after the app settles, and
 * never again once the member taps «قيّمت بالفعل». Production binaries only (`__DEV__` for testing).
 */

const KEY = 'investorsclub.rateUs';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** The prompt waits for the home screen to settle before rising. */
const SETTLE_MS = 6_000;

const IOS_APP_ID = '6825963092';
const ANDROID_APP_ID = 'com.vcmem.investorsclub';

const emblem = require('../../assets/images/club-emblem.png');

type RateState = {
  /** First launch with this feature on the device: the prompt never shows that day. */
  firstLaunchAt?: number;
  lastShownAt?: number;
  /** «قيّمت بالفعل» — the prompt is retired on this device for good. */
  rated?: boolean;
};

async function readState(): Promise<RateState> {
  try {
    const raw = await loadSetting(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as RateState) : {};
  } catch {
    return {};
  }
}

function writeState(state: RateState): Promise<void> {
  return saveSetting(KEY, JSON.stringify(state));
}

/** The write-review page of THIS install's store, with the https page as the fallback. */
async function openStoreReview(): Promise<void> {
  const ios = Platform.OS === 'ios';
  const deepLink = ios
    ? `itms-apps://apps.apple.com/app/id${IOS_APP_ID}?action=write-review`
    : `market://details?id=${ANDROID_APP_ID}`;
  const webLink = ios
    ? `https://apps.apple.com/sa/app/investors-club/id${IOS_APP_ID}?action=write-review`
    : `https://play.google.com/store/apps/details?id=${ANDROID_APP_ID}`;
  try {
    if (await Linking.canOpenURL(deepLink)) {
      await Linking.openURL(deepLink);
      return;
    }
  } catch {
    // The store app is not reachable through its scheme: fall through to the web page.
  }
  try {
    await Linking.openURL(webLink);
  } catch {
    // Nothing else to try.
  }
}

export function RateUsPrompt() {
  const segments = useSegments();
  const { me } = useAuth();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  // One attempt per JS launch: a member who taps «لاحقًا» is not asked again until the next week.
  const attempted = useRef(false);

  const onTabs = segments[0] === '(tabs)';
  const eligible = (env.isProduction || __DEV__) && me !== null && onTabs;

  useEffect(() => {
    if (!eligible || attempted.current) return;
    let cancelled = false;
    const run = async () => {
      const state = await readState();
      if (cancelled) return;
      attempted.current = true;
      const now = Date.now();
      if (!state.firstLaunchAt) {
        // The first launch (a fresh install, or the first launch after this update) only stamps the clock.
        await writeState({ ...state, firstLaunchAt: now });
        return;
      }
      if (state.rated) return;
      if (now - state.firstLaunchAt < DAY_MS) return;
      if (state.lastShownAt && now - state.lastShownAt < WEEK_MS) return;
      // M128: never a second automatic popup in the same session.
      if (!claimAutoPopup()) return;
      await writeState({ ...state, lastShownAt: now });
      if (!cancelled) setVisible(true);
    };
    const timer = setTimeout(() => void run(), SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [eligible]);

  const later = () => setVisible(false);
  const rateNow = () => {
    setVisible(false);
    void openStoreReview();
  };
  const alreadyRated = () => {
    setVisible(false);
    void readState().then((state) => writeState({ ...state, rated: true }));
  };

  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={later}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={later} accessibilityLabel={t('rateUs.later')} />
        <FadeInView offset={32} style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <View style={styles.grip} />
            <Image source={emblem} style={styles.emblem} resizeMode="contain" />
            <View style={styles.stars} accessible accessibilityLabel={t('rateUs.title')}>
              {[0, 1, 2, 3, 4].map((index) => (
                <Ionicons key={index} name="star" size={18} color={colors.gold} />
              ))}
            </View>
            <Text style={styles.title}>{t('rateUs.title')}</Text>
            <Text style={styles.text}>{t('rateUs.text')}</Text>
            <GoldHairline style={styles.hairline} />
            <AppButton label={t('rateUs.now')} icon="star-outline" onPress={rateNow} />
            <AppButton label={t('rateUs.later')} variant="ghost" onPress={later} />
            <PressScale onPress={alreadyRated} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('rateUs.done')}>
              <Text style={styles.done}>{t('rateUs.done')}</Text>
            </PressScale>
          </GlassCard>
        </FadeInView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheetWrap: { paddingHorizontal: spacing.md },
  card: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderGold, marginBottom: spacing.xs },
  emblem: { width: 64, height: 64 },
  stars: { flexDirection: 'row', gap: 4 },
  title: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  text: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  hairline: { alignSelf: 'stretch', marginVertical: spacing.xs },
  done: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xs },
});
