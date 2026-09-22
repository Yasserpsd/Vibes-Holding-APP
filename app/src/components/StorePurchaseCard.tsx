import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { membershipApi, useStoreConfig } from '@/api/membership';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { openLink } from '@/lib/openLink';
import {
  fetchManagementUrl,
  fetchMembershipOffer,
  hasStorePurchases,
  identifyPurchases,
  purchaseMembership,
  restoreMembership,
  storeKeyFor,
  storeName,
  type StoreOffer,
} from '@/lib/purchases';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Phase = 'loading' | 'ready' | 'unavailable' | 'busy' | 'activating' | 'done' | 'pending';

const SETTLE_ATTEMPTS = 8;
const SETTLE_DELAY_MS = 3000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Annual membership purchase through the store (CLAUDE.md rule 3). The price comes from the store,
 * the activation from the server: the store's own result never activates anything here.
 */
export function StorePurchaseCard({ title }: { title: string }) {
  const { me, setMe } = useAuth();
  const { data: config, isLoading } = useStoreConfig(Boolean(me));
  const [phase, setPhase] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  const [offer, setOffer] = useState<StoreOffer | null>(null);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contactId = me?.id ?? null;
  const active = me?.membership.status === 'active';
  const supported = hasStorePurchases();
  const apiKey = config ? storeKeyFor(config) : null;

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    if (!config || contactId === null || !apiKey || !supported) return;
    if (phaseRef.current === 'activating' || phaseRef.current === 'done' || phaseRef.current === 'pending') return;
    let cancelled = false;
    go('loading');
    (async () => {
      const identified = await identifyPurchases(config, contactId);
      if (cancelled) return;
      if (!identified) {
        go('unavailable');
        return;
      }
      if (active) {
        const url = await fetchManagementUrl();
        if (!cancelled) {
          setManageUrl(url);
          go('ready');
        }
        return;
      }
      try {
        const found = await fetchMembershipOffer(config);
        if (cancelled) return;
        setOffer(found);
        go(found ? 'ready' : 'unavailable');
      } catch {
        if (!cancelled) go('unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, contactId, apiKey, supported, active, go]);

  // The store said yes; only the server's answer counts (webhook, or its REST check in /api/membership/sync).
  const settle = useCallback(async () => {
    go('activating');
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
      try {
        const result = await membershipApi.sync();
        setMe(result.me);
        if (result.me.membership.status === 'active') {
          go('done');
          return;
        }
      } catch {
        // Server busy or offline: try again below.
      }
      await wait(SETTLE_DELAY_MS);
    }
    go('pending');
  }, [go, setMe]);

  const buy = async () => {
    if (!config || !offer) return;
    setError(null);
    go('busy');
    const result = await purchaseMembership(config, offer);
    if (result.status === 'cancelled') return go('ready');
    if (result.status === 'failed') {
      setError(result.message);
      return go('ready');
    }
    await settle();
  };

  const restore = async () => {
    if (!config) return;
    setError(null);
    go('busy');
    const result = await restoreMembership(config);
    if ('error' in result) {
      setError(result.error);
      return go('ready');
    }
    if (!result.entitled) {
      setError(t('store.noPrevious', { store: storeName() }));
      return go('ready');
    }
    await settle();
  };

  if (!me || isLoading) return null;
  if (phase === 'done') return <Notice tone="success" text={t('store.done')} />;
  if (phase === 'pending') return <Notice tone="warning" text={t('store.pending')} />;
  if (!config || !apiKey) return active ? null : <Notice text={t('store.comingSoon', { store: storeName() })} />;
  if (!supported) return active ? null : <Notice tone="warning" text={t('store.unsupported')} />;
  if (active) {
    return manageUrl ? <AppButton label={t('store.manage', { store: storeName() })} variant="outline" icon="settings-outline" onPress={() => void openLink(manageUrl)} /> : null;
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="storefront-outline" size={22} color={colors.gold} />
        <Text style={styles.title}>{title}</Text>
      </View>
      {phase === 'loading' ? <Progress text={t('store.loadingPrice')} /> : null}
      {phase === 'busy' ? <Progress text={t('store.opening', { store: storeName() })} /> : null}
      {phase === 'activating' ? <Progress text={t('store.activating')} /> : null}
      {phase === 'unavailable' ? <Text style={styles.muted}>{t('store.unavailable')}</Text> : null}
      {phase === 'ready' && offer ? (
        <>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{offer.product.priceString}</Text>
            <Text style={styles.period}>{t('store.period', { store: storeName() })}</Text>
          </View>
          <AppButton label={t('store.subscribe')} icon="card-outline" onPress={() => void buy()} />
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {phase === 'ready' || phase === 'unavailable' ? (
        <Pressable onPress={() => void restore()} accessibilityRole="button" style={styles.restore}>
          <Ionicons name="refresh-outline" size={16} color={colors.goldLight} />
          <Text style={styles.restoreText}>{t('store.restore')}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.legal}>
        {t('store.legal', { store: storeName() })}
      </Text>
      {config.environment === 'test' ? <Text style={styles.legal}>{t('store.testEnv')}</Text> : null}
      {config.termsUrl || config.privacyUrl ? (
        <View style={styles.links}>
          {config.termsUrl ? <LinkText label={t('store.terms')} url={config.termsUrl} /> : null}
          {config.privacyUrl ? <LinkText label={t('store.privacy')} url={config.privacyUrl} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Progress({ text }: { text: string }) {
  return (
    <View style={styles.progress}>
      <ActivityIndicator color={colors.gold} />
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

function LinkText({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => void openLink(url)} accessibilityRole="link">
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.textPrimary, flex: 1, textAlign: textStart },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, justifyContent: 'flex-start' },
  price: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 32, color: colors.gold },
  period: { ...typography.caption, color: colors.textSecondary },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muted: { ...typography.body, color: colors.textSecondary, textAlign: textStart, flex: 1 },
  error: { ...typography.caption, color: colors.danger, textAlign: textStart },
  restore: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  restoreText: { ...typography.caption, color: colors.goldLight },
  legal: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
  links: { flexDirection: 'row', gap: spacing.md },
  link: { ...typography.caption, color: colors.goldLight, textDecorationLine: 'underline' },
});
