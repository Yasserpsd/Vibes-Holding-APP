import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { amountLabel, usePayment } from '@/api/payments';
import { AppButton } from '@/components/AppButton';
import { SarText } from '@/components/SarText';
import { StateView } from '@/components/StateView';
import { env } from '@/config/env';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { trackServiceCheckout, trackServicePurchase } from '@/lib/adsAttribution';
import { appScheme, openCheckout, paymentReturnUrl } from '@/lib/checkout';
import { loadWebView } from '@/lib/player';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, spacing, typography } from '@/theme/tokens';

const hostOf = (address: string): string | null => {
  const match = /^https?:\/\/([^/?#]+)/i.exec(address);
  return match ? (match[1] ?? '').replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase() : null;
};
const API_HOST = hostOf(env.apiBaseUrl);

/**
 * The server's own return page and nothing else: the path must end with /pay/return AND the host must be ours
 * (the app's API host, a club domain or the hosting domain). A bank or gateway address that merely carries
 * the words in its query is an ordinary navigation.
 */
function isReturnPage(address: string): boolean {
  const host = hostOf(address);
  if (!host) return false;
  const path = /^https?:\/\/[^/?#]+([^?#]*)/i.exec(address)?.[1] ?? '';
  if (!path.endsWith('/pay/return')) return false;
  return host === API_HOST || host.endsWith('.vibesholdingsa.com') || host.endsWith('.up.railway.app');
}

/**
 * M111 (owner, 2026-10-20: «أهم شرط إن الدفع يتم داخل التطبيق جوا نفس الصفحة»): the gateway
 * checkout renders EMBEDDED in this screen — no browser sheet, nothing leaves the app. The return
 * redirect flips straight to the native status screen, and the status itself always comes from the
 * server (rule 5): while the member pays, the payment is re-read every few seconds, so the screen
 * also flips by itself the moment the server callback settles it.
 */
export default function CheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = usePayment(id);
  const webview = useMemo(() => loadWebView(), []);
  const done = useRef(false);
  const ownCancel = useRef(false);
  const insets = useSafeAreaInsets();
  // The gateway page failed to load (offline, DNS): a retry mounts the WebView again at the checkout URL.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const payment = data?.payment ?? null;
  const status = payment?.status ?? null;

  // `leaving`: the app itself is moving on to the status screen. It is a state so the leave question below is
  // already switched off when the navigation runs (the effect fires after the render that drops the guard).
  const [leaving, setLeaving] = useState(false);
  const navigation = useNavigation();

  const finish = () => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
  };

  useEffect(() => {
    if (leaving) router.replace({ pathname: '/payment/[id]', params: { id: id ?? '' } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  // Leaving while the payment is still open — Android back, the header's back button, the gesture — asks once.
  // Nothing is asked once the server has settled the payment (paid / failed) or when the app itself navigates.
  usePreventRemove(status === 'created' && !leaving, ({ data }) => {
    if (done.current) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert(t('checkout.leaveTitle'), t('checkout.leaveText'), [
      { text: t('checkout.stay'), style: 'cancel' },
      {
        text: t('checkout.leave'),
        style: 'destructive',
        // The server may have settled the payment while the question was up: the app has then moved on by itself.
        onPress: () => (done.current ? undefined : navigation.dispatch(data.action)),
      },
    ]);
  });

  useEffect(() => {
    if (status !== 'created') return;
    const timer = setInterval(() => void refetch(), 5000);
    return () => clearInterval(timer);
  }, [status, refetch]);

  useEffect(() => {
    // M217: the checkout opened for a real, unpaid payment — the intent signal.
    if (status === 'created' && payment) trackServiceCheckout(payment);
  }, [status, payment]);

  useEffect(() => {
    // M157: the server flipped this payment to paid while the checkout was open — one conversion.
    if (status === 'paid' && payment) trackServicePurchase(payment);
    if (status && status !== 'created') finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (!payment) {
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title: t('checkout.title') }} />
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  const WebView = webview?.WebView;
  return (
    // The page runs to the screen's bottom edge: keep the gateway's pay button clear of the home indicator / gesture bar.
    <View style={[styles.page, { paddingBottom: insets.bottom }]}>
      {/* No edge swipe out of the card form (iOS); the header's back button still leaves, after the question above. */}
      <Stack.Screen options={{ title: t('checkout.title'), gestureEnabled: false }} />
      {/* M128 (owner: «الخدمة غير واضحة»): the order — service, amount, the secure-payment line — reads
          as one clean receipt header above the gateway. */}
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text style={styles.service} numberOfLines={2}>
            {payment.serviceTitle}
          </Text>
          <SarText style={styles.amount}>{amountLabel(payment)}</SarText>
        </View>
        <View style={styles.secureRow}>
          {/* The payment sheet is white in both themes, so the lock wears the gold that reads on paper. */}
          <Ionicons name="lock-closed" size={13} color={colors.paperGold} />
          <Text style={styles.secureText}>{t('checkout.secure')}</Text>
        </View>
      </View>
      {WebView && status === 'created' ? (
        <View style={styles.webBox}>
          <WebView
            key={reloadKey}
            source={{ uri: payment.checkoutUrl }}
            style={styles.web}
            containerStyle={styles.webContainer}
            // A navigation WE cancelled (the return page, a wallet deep link) is not a failed page load.
            onLoadStart={() => {
              ownCancel.current = false;
            }}
            onError={() => {
              if (!ownCancel.current && !done.current) setLoadFailed(true);
            }}
            onLoad={() => setLoadFailed(false)}
            // Owner (2026-10-20, the black 3-D Secure page): payment pages stay WHITE, always — the
            // bank's verification page has no background of its own and Android force-dark inverted it.
            forceDarkOn={false}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.gold} size="large" />
              </View>
            )}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(request) => {
              const url = request.url;
              // The way back: the server return page (it also confirms the payment server-side —
              // calling it keeps that confirm) or the app scheme. Either way the native screen takes over.
              if (url.startsWith(`${appScheme()}://`)) {
                ownCancel.current = true;
                void refetch();
                finish();
                return false;
              }
              if (isReturnPage(url)) {
                ownCancel.current = true;
                void fetch(url).catch(() => undefined);
                setTimeout(() => void refetch(), 800);
                finish();
                return false;
              }
              if (/^(https?:|about:blank)/.test(url)) return true;
              // Wallet deep links (Samsung Pay…) open their native side and the member comes back here.
              ownCancel.current = true;
              Linking.openURL(url).catch(() => undefined);
              return false;
            }}
          />
          {loadFailed ? (
            <View style={styles.loadError}>
              <Ionicons name="cloud-offline-outline" size={36} color={colors.gold} />
              <Text style={styles.fallbackText}>{t('errors.network')}</Text>
              <AppButton
                label={t('common.retry')}
                icon="refresh"
                onPress={() => {
                  setLoadFailed(false);
                  setReloadKey((key) => key + 1);
                }}
              />
            </View>
          ) : null}
        </View>
      ) : status === 'created' ? (
        // A binary without the WebView native side: the old in-app browser sheet still works.
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>{t('checkout.fallback')}</Text>
          <AppButton
            label={t('payment.openCheckout')}
            icon="card-outline"
            onPress={() => void openCheckout(payment.checkoutUrl, paymentReturnUrl(payment.id)).then(() => refetch())}
          />
        </View>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      )}
    </View>
  );
}

// The whole checkout lives on WHITE (owner: «لما الموضوع يكون في دفع الخلفية بيضاء تمامًا») —
// the gateway and bank pages assume a light background, and gold on white stays the brand accent.
const PAPER = '#FFFFFF';
const INK = '#1C1C1C';
const styles = themedStyles(() => ({
  page: { flex: 1, backgroundColor: PAPER },
  summary: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E2D2',
    backgroundColor: PAPER,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  service: { ...typography.body, fontFamily: fonts.semiBold, color: INK, flex: 1, textAlign: textStart },
  // goldDark, not gold: the gold reads at about 2:1 on this always-white page in the dark theme.
  amount: { ...typography.subtitle, color: colors.goldDark },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  secureText: { ...typography.caption, color: '#6E6754', textAlign: textStart },
  webBox: { flex: 1 },
  loadError: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: PAPER },
  web: { flex: 1, backgroundColor: PAPER },
  webContainer: { flex: 1, backgroundColor: PAPER },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: PAPER },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: PAPER },
  fallbackText: { ...typography.body, color: INK, textAlign: 'center' },
}));
