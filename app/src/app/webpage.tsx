import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, View } from 'react-native';
import type { WebView as WebViewRef } from 'react-native-webview';

import { StateView } from '@/components/StateView';
import { openLink } from '@/lib/openLink';
import { loadWebView } from '@/lib/player';
import { themedStyles } from '@/theme/styles';
import { colors } from '@/theme/tokens';

// Only web pages load here: a route can be reached from a link outside the app, so `javascript:`, `file:` and
// `data:` addresses never become a page under our header.
const WEB_URL = /^https?:\/\//i;

/**
 * M116d (owner: «مش عايز ابدا يظهر سيرفر railway»): club pages (terms, privacy…) render inside
 * this native screen — a WebView under our own header, NO address bar, so the hosting domain
 * never shows. Binaries without the WebView module fall back to the in-app browser once.
 */
export default function WebPageScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const webview = useMemo(() => loadWebView(), []);
  // A failed load (no network, a server error) offers «إعادة المحاولة» by remounting the page.
  const [attempt, setAttempt] = useState(0);
  // Android hardware back: one step back inside the page while it has history, then the screen closes as usual.
  const page = useRef<WebViewRef>(null);
  const pageCanGoBack = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!pageCanGoBack.current || !page.current) return false;
        page.current.goBack();
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  if (!url || !WEB_URL.test(url)) return null;
  if (!webview) {
    // Old binary: the system sheet is the only way — open once and leave the screen quiet.
    void openLink(url);
    return <View style={styles.screen} />;
  }
  const WebView = webview.WebView;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: title || '' }} />
      <WebView
        key={attempt}
        ref={page}
        onNavigationStateChange={(state) => {
          pageCanGoBack.current = state.canGoBack;
        }}
        source={{ uri: url }}
        style={styles.web}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.cover}>
            <ActivityIndicator color={colors.gold} />
          </View>
        )}
        renderError={() => (
          <View style={styles.cover}>
            <StateView
              error={new Error('webpage')}
              onRetry={() => {
                pageCanGoBack.current = false;
                setAttempt((count) => count + 1);
              }}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.black },
  web: { flex: 1, backgroundColor: colors.black },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black },
}));
