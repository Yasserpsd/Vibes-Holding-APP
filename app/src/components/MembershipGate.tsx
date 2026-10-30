import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { membershipApi, useStoreConfig } from '@/api/membership';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldGradient } from '@/components/lux';
import { Floating, PopIn, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { loadSetting } from '@/lib/deviceStore';
import { claimWeeklyMembershipPrompt } from '@/lib/popupGate';
import {
  fetchMembershipOffer,
  hasStorePurchases,
  identifyPurchases,
  purchaseMembership,
  storeKeyFor,
  storeName,
  type StoreOffer,
} from '@/lib/purchases';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M120 (owner's TestFlight feedback, 2026-10-23): the subscribe path. One popup, opened the moment
 * a non-member taps anything members-only — short title, one line, the store price and a direct
 * subscribe button (CLAUDE.md rule 3: the store sheet, activation only from the server).
 * M122b (owner, same week: «عايز pop up تظهر فورًا… ولما أروح أفعّل العضوية أتحول على الدفع مباشر»):
 * it now opens by itself for every signed-in non-member — a few seconds after the
 * home settles (and after the intro video when that shows) — and the subscribe button goes straight
 * to the store's payment sheet, fetching the offer on the spot when it is not cached yet.
 * M164 (owner, 2026-10-30, member complaints): the self-opening is ONCE A WEEK per device, shared
 * with every other automatic membership pitch (popupGate.claimWeeklyMembershipPrompt). Every other
 * appearance is the member's own tap on something members-only.
 */

let openGate: (() => void) | null = null;

/** Opens the members-only popup from anywhere (locked tiles, lock notices, gates). */
export function showMembershipGate(): void {
  openGate?.();
}

// The one-time nudge waits for the intro-video popup to leave (IntroVideoPopup reports it here).
let introClosedNow = false;
let introWaiter: (() => void) | null = null;
export function noteIntroClosed(): void {
  introClosedNow = true;
  introWaiter?.();
  introWaiter = null;
}

const INTRO_SEEN_KEY = 'investorsclub.introSeen.v2'; // IntroVideoPopup's own key, read-only here.
const NUDGE_DELAY_MS = 5000;

const SETTLE_ATTEMPTS = 8;
const SETTLE_DELAY_MS = 3000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One store-offer fetch per launch, shared by the popup and the home card.
let cachedOffer: StoreOffer | null = null;

type Phase = 'idle' | 'busy' | 'activating' | 'done' | 'pending';

/** The members-only popup + the one-time post-registration nudge. Rendered once in the root layout. */
export function MembershipGateHost() {
  const router = useRouter();
  const segments = useSegments();
  const { status, me, setMe } = useAuth();
  const [visible, setVisible] = useState(false);
  const { data: config } = useStoreConfig(Boolean(me) && visible);
  const [offer, setOffer] = useState<StoreOffer | null>(cachedOffer);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const nudged = useRef(false);

  const signedIn = status === 'signedIn' && me !== null;
  const member = me?.membership.status === 'active';
  const first = segments[0];
  const atGate = first === 'welcome' || first === 'auth';

  useEffect(() => {
    openGate = () => {
      setPhase('idle');
      setError(null);
      setVisible(true);
    };
    return () => {
      openGate = null;
    };
  }, []);

  // The store price, fetched once the popup is open (and kept for the whole launch).
  useEffect(() => {
    if (!visible || !signedIn || !config || cachedOffer || !hasStorePurchases() || !storeKeyFor(config)) return;
    let alive = true;
    void (async () => {
      const found = await loadOffer(config, me.id);
      if (alive && found) setOffer(found);
    })();
    return () => {
      alive = false;
    };
  }, [visible, signedIn, config, me]);

  // M122b: ONCE PER LAUNCH, by itself — a few seconds after the intro video (or right after the
  // home settles when the intro is already seen), for every signed-in non-member.
  useEffect(() => {
    if (!signedIn || member || atGate || nudged.current) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      timer = setTimeout(() => {
        if (!alive || nudged.current) return;
        nudged.current = true;
        void claimWeeklyMembershipPrompt().then((allowed) => {
          if (allowed && alive) openGate?.();
        });
      }, NUDGE_DELAY_MS);
    };
    void (async () => {
      if (!alive) return;
      if (introClosedNow || (await loadSetting(INTRO_SEEN_KEY))) fire();
      else introWaiter = fire;
    })();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (introWaiter) introWaiter = null;
    };
  }, [signedIn, member, atGate]);

  const dismiss = () => {
    if (phase === 'busy' || phase === 'activating') return;
    setVisible(false);
  };
  const go = (path: '/membership' | '/auth/login') => {
    setVisible(false);
    router.push(path);
  };

  // The store said yes; only the server's answer activates (same contract as StorePurchaseCard).
  const settle = useCallback(async () => {
    setPhase('activating');
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      try {
        const result = await membershipApi.sync();
        setMe(result.me);
        if (result.me.membership.status === 'active') {
          setPhase('done');
          return;
        }
      } catch {
        // Server busy or offline: try again below.
      }
      await wait(SETTLE_DELAY_MS);
    }
    setPhase('pending');
  }, [setMe]);

  // M122b (owner): the button goes STRAIGHT to the store's payment sheet. An offer not cached yet
  // is fetched on the spot; only a store this device truly cannot reach falls back to /membership.
  const buy = async () => {
    if (!config || !me || !hasStorePurchases() || !storeKeyFor(config)) {
      go('/membership');
      return;
    }
    setError(null);
    setPhase('busy');
    let current = offer;
    if (!current) {
      current = await loadOffer(config, me.id);
      if (current) setOffer(current);
    }
    if (!current) {
      setPhase('idle');
      go('/membership');
      return;
    }
    const result = await purchaseMembership(config, current);
    if (result.status === 'cancelled') return setPhase('idle');
    if (result.status === 'failed') {
      setError(result.message);
      return setPhase('idle');
    }
    await settle();
  };

  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <View style={styles.lockRing}>
              <Ionicons name="lock-closed" size={24} color={colors.goldInk} />
            </View>
            <Text style={styles.title}>{t('gate.popupTitle')}</Text>
            <Text style={styles.text}>{signedIn ? t('gate.popupText') : t('gate.popupGuest')}</Text>
            {phase === 'done' ? (
              <>
                <Notice tone="success" text={t('store.done')} />
                <AppButton label={t('common.close')} icon="checkmark-outline" onPress={() => setVisible(false)} />
              </>
            ) : phase === 'pending' ? (
              <>
                <Notice tone="warning" text={t('store.pending')} />
                <AppButton label={t('common.close')} variant="outline" onPress={() => setVisible(false)} />
              </>
            ) : (
              <>
                {signedIn && offer ? (
                  <View style={styles.priceRow}>
                    <Text style={styles.price}>{offer.product.priceString}</Text>
                    <Text style={styles.period}>{t('store.period', { store: storeName() })}</Text>
                  </View>
                ) : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {signedIn ? (
                  <AppButton
                    label={phase === 'activating' ? t('store.activating') : t('gate.activateNow')}
                    icon="card-outline"
                    loading={phase === 'busy' || phase === 'activating'}
                    onPress={() => void buy()}
                  />
                ) : (
                  <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => go('/auth/login')} />
                )}
                <AppButton label={t('gate.benefits')} variant="outline" icon="ribbon-outline" onPress={() => go('/membership')} />
                <PressScale onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('gate.later')}>
                  <Text style={styles.later}>{t('gate.later')}</Text>
                </PressScale>
              </>
            )}
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

async function loadOffer(config: NonNullable<ReturnType<typeof useStoreConfig>['data']>, contactId: number): Promise<StoreOffer | null> {
  try {
    if (!(await identifyPurchases(config, contactId))) return null;
    cachedOffer = await fetchMembershipOffer(config);
    return cachedOffer;
  } catch {
    return null;
  }
}

/**
 * The home card for a signed-in non-member — the owner's line, the store price when the store
 * answers, and one golden door into the popup.
 */
export function MembershipHomeCard() {
  const { status, me } = useAuth();
  const signedIn = status === 'signedIn' && me !== null;
  const nonMember = signedIn && me.membership.status !== 'active';
  const { data: config } = useStoreConfig(nonMember);
  const [offer, setOffer] = useState<StoreOffer | null>(cachedOffer);

  useEffect(() => {
    if (!nonMember || !config || cachedOffer || !hasStorePurchases() || !storeKeyFor(config)) return;
    let alive = true;
    void (async () => {
      const found = await loadOffer(config, me.id);
      if (alive && found) setOffer(found);
    })();
    return () => {
      alive = false;
    };
  }, [nonMember, config, me]);

  if (!nonMember) return null;
  return (
    <PressScale onPress={showMembershipGate} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={t('gate.activateNow')}>
      <GlassCard golden radius={radii.xl} style={styles.homeCard}>
        <Floating amplitude={2} duration={2600}>
          <GoldGradient style={styles.homeIcon}>
            <Ionicons name="ribbon" size={24} color={colors.goldInk} />
          </GoldGradient>
        </Floating>
        <View style={styles.homeTexts}>
          <Text style={styles.homeTitle}>{t('gate.homeTitle')}</Text>
          <Text style={styles.homeSubtitle}>{t('gate.homeText')}</Text>
          {offer ? (
            <Text style={styles.homePrice}>
              {offer.product.priceString} <Text style={styles.homePeriod}>{t('store.period', { store: storeName() })}</Text>
            </Text>
          ) : null}
        </View>
        <GoldGradient style={styles.homeCta}>
          <Text style={styles.homeCtaText} numberOfLines={1}>
            {t('store.subscribe')}
          </Text>
        </GoldGradient>
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch' },
  card: { gap: spacing.sm, padding: spacing.md, alignItems: 'stretch' },
  lockRing: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    boxShadow: shadows.glowGold,
  },
  title: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  text: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: spacing.sm },
  price: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 36, color: colors.gold },
  period: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.danger, textAlign: 'center' },
  later: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xs },
  // The home card.
  homeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginTop: spacing.sm },
  homeIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGold,
  },
  homeTexts: { flex: 1, gap: 2 },
  homeTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 23, color: colors.textPrimary, textAlign: textStart },
  homeSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  homePrice: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 21, color: colors.gold, textAlign: textStart, marginTop: 2 },
  homePeriod: { ...typography.caption, fontFamily: fonts.regular, color: colors.textSecondary },
  homeCta: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    boxShadow: shadows.glowGoldFaint,
    maxWidth: 110,
  },
  homeCtaText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 20, color: colors.goldInk },
});
