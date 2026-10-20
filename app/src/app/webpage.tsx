import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { openLink } from '@/lib/openLink';
import { loadWebView } from '@/lib/player';
import { colors } from '@/theme/tokens';

/**
 * M116d (owner: «مش عايز ابدا يظهر سيرفر railway»): club pages (terms, privacy…) render inside
 * this native screen — a WebView under our own header, NO address bar, so the hosting domain
 * never shows. Binaries without the WebView module fall back to the in-app browser once.
 */
export default function WebPageScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const webview = useMemo(() => loadWebView(), []);

  if (!url) return null;
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
        source={{ uri: url }}
        style={styles.web}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.gold} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  web: { flex: 1, backgroundColor: colors.black },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black },
});
