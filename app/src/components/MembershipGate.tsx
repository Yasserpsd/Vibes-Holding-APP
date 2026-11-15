import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';

import { useStoreConfig } from '@/api/membership';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldGradient } from '@/components/lux';
import { Floating, PopIn, PressScale } from '@/components/motion';
import { Notice } from '@/components/Notice';
import { SarText } from '@/components/SarText';
import { StoreLegalLinks, storePriceLabel, syncMembershipOnce } from '@/components/StorePurchaseCard';
import { SupportLink } from '@/components/SupportLink';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import {
  fetchMembershipOffer,
  hasStorePurchases,
  identifyPurchases,
  purchaseMembership,
  restoreMembership,
  storeKeyFor,
  storeName,
  type StoreOffer,
} from '@/lib/purchases';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M120 (owner's TestFlight feedback, 2026-10-23): the subscribe path. One popup, opened the moment
 * a non-member taps anything members-only — short title, one line, the store price and a direct
 * subscribe button (CLAUDE.md rule 3: the store sheet, activation only from the server).
 * M122b (owner, same week: «ولما أروح أفعّل العضوية أتحول على الدفع مباشر»): the subscribe button
 * goes straight to the store's payment sheet, fetching the offer on the spot when it is not cached yet.
 * M170 (owner, 2026-10-31, final word after the M122b launch nudge and the M164 weekly slot: «مش عايزها
 * تظهر خالص إلا لو العضو ضغط على خدمة مقفولة»): the popup NEVER opens by itself — no launch nudge,
 * no weekly timer. Every appearance is the member's own tap on something members-only.
 */

let openGate: (() => void) | null = null;

/** Opens the members-only popup from anywhere (locked tiles, lock notices, gates). */
export function showMembershipGate(): void {
  openGate?.();
}

const SETTLE_ATTEMPTS = 8;
const SETTLE_DELAY_MS = 3000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// One store-offer fetch per launch, shared by the popup and the home card.
let cachedOffer: StoreOffer | null = null;

// `storePending`: the store itself is still processing the payment (Android pending purchase) — a calm wait,
// not a failure; `restoring` is the «استعادة المشتريات» button of that state at work.
type Phase = 'idle' | 'busy' | 'activating' | 'done' | 'pending' | 'storePending' | 'restoring';

/** The members-only popup + the one-time post-registration nudge. Rendered once in the root layout. */
export function MembershipGateHost() {
  const router = useRouter();
  const { status, me, setMe } = useAuth();
  const [visible, setVisible] = useState(false);
  const { data: config } = useStoreConfig(Boolean(me) && visible);
  const [offer, setOffer] = useState<StoreOffer | null>(cachedOffer);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const signedIn = status === 'signedIn' && me !== null;

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

  const dismiss = () => {
    if (phase === 'busy' || phase === 'activating' || phase === 'restoring') return;
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
      const started = Date.now();
      // null = server busy, offline or no answer within the cap: try again below.
      const result = await syncMembershipOnce();
      if (result) {
        setMe(result.me);
        if (result.me.membership.status === 'active') {
          setPhase('done');
          return;
        }
      }
      // An attempt that already took its time is not followed by another pause.
      if (Date.now() - started < SETTLE_DELAY_MS) await wait(SETTLE_DELAY_MS);
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
    // The store is still processing the payment: a calm wait — no error, and no second Subscribe while it shows.
    if (result.status === 'pending') return setPhase('storePending');
    if (result.status === 'failed') {
      setError(result.message);
      return setPhase('idle');
    }
    await settle();
  };

  // «استعادة المشتريات» stays within reach while the store's pending notice shows.
  const restore = async () => {
    if (!config || phase !== 'storePending') return;
    setError(null);
    setPhase('restoring');
    const result = await restoreMembership(config);
    if ('error' in result) {
      setError(result.error);
      return setPhase('storePending');
    }
    if (!result.entitled) {
      setError(t('store.noPrevious', { store: storeName() }));
      return setPhase('storePending');
    }
    await settle();
  };

  if (!visible) return null;
  return (
    <Modal transparent statusBarTranslucent animationType="fade" visible={visible} onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            {/* On a short screen the popup scrolls inside itself instead of running off the edges. */}
            <ScrollView contentContainerStyle={styles.cardBody} bounces={false} showsVerticalScrollIndicator={false}>
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
            ) : phase === 'storePending' || phase === 'restoring' ? (
              <>
                <Notice text={t('store.pending')} />
                {error ? (<><Text style={styles.error}>{error}</Text><SupportLink problem={error} /></>) : null}
                <AppButton label={t('store.restore')} variant="outline" icon="refresh-outline" loading={phase === 'restoring'} onPress={() => void restore()} />
                <AppButton label={t('common.close')} variant="ghost" onPress={dismiss} />
              </>
            ) : (
              <>
                {signedIn && offer ? (
                  <View style={styles.priceRow}>
                    <SarText style={styles.price}>{storePriceLabel(offer.product.priceString)}</SarText>
                    <Text style={styles.period}>{t('store.period', { store: storeName() })}</Text>
                  </View>
                ) : null}
                {/* The renewal terms and the Terms / Privacy links sit beside the button that opens the store sheet. */}
                {signedIn ? (
                  <>
                    <Text style={styles.legal}>{t('store.legal', { store: storeName() })}</Text>
                    {config ? <StoreLegalLinks config={config} onOpen={() => setVisible(false)} centered /> : null}
                  </>
                ) : null}
                {error ? (<><Text style={styles.error}>{error}</Text><SupportLink problem={error} /></>) : null}
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
            </ScrollView>
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
              <SarText style={styles.homePrice}>{storePriceLabel(offer.product.priceString)}</SarText>
              <Text style={styles.homePeriod}>{` ${t('store.period', { store: storeName() })}`}</Text>
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

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch', maxHeight: '100%' },
  card: { flexShrink: 1 },
  cardBody: { gap: spacing.sm, padding: spacing.md, alignItems: 'stretch' },
  legal: { ...typography.caption, fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: 'center' },
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
}));
