import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';

import { amountLabel, usePayment } from '@/api/payments';
import { AppButton } from '@/components/AppButton';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { appScheme, openCheckout, paymentReturnUrl } from '@/lib/checkout';
import { loadWebView } from '@/lib/player';
import { colors, spacing, typography } from '@/theme/tokens';

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

  const payment = data?.payment ?? null;
  const status = payment?.status ?? null;

  const finish = () => {
    if (done.current) return;
    done.current = true;
    router.replace({ pathname: '/payment/[id]', params: { id: id ?? '' } });
  };

  useEffect(() => {
    if (status !== 'created') return;
    const timer = setInterval(() => void refetch(), 5000);
    return () => clearInterval(timer);
  }, [status, refetch]);

  useEffect(() => {
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
    <View style={styles.page}>
      <Stack.Screen options={{ title: t('checkout.title') }} />
      <View style={styles.summary}>
        <Text style={styles.service} numberOfLines={1}>
          {payment.serviceTitle}
        </Text>
        <Text style={styles.amount}>{amountLabel(payment)}</Text>
      </View>
      {WebView && status === 'created' ? (
        <WebView
          source={{ uri: payment.checkoutUrl }}
          style={styles.web}
          containerStyle={styles.webContainer}
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
              void refetch();
              finish();
              return false;
            }
            if (url.includes('/pay/return')) {
              void fetch(url).catch(() => undefined);
              setTimeout(() => void refetch(), 800);
              finish();
              return false;
            }
            if (/^(https?:|about:blank)/.test(url)) return true;
            // Wallet deep links (Samsung Pay…) open their native side and the member comes back here.
            Linking.openURL(url).catch(() => undefined);
            return false;
          }}
        />
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

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.black },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  service: { ...typography.body, color: colors.textSecondary, flex: 1 },
  amount: { ...typography.subtitle, color: colors.gold },
  web: { flex: 1, backgroundColor: colors.black },
  webContainer: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  fallbackText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
