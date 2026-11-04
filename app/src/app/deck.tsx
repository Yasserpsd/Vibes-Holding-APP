import { useQuery } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Linking, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { t } from '@/i18n';
import { openLink } from '@/lib/openLink';
import { loadWebView } from '@/lib/player';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * M193 (owner, 2026-11-03, a client tapped the pitch deck and nothing showed): the deck opens AT ONCE inside
 * the app. The phone downloads the file to its cache; iOS's WebView draws a PDF natively, Android's cannot, so
 * there pdf.js draws every page on a canvas. «تحميل على الجوال» hands the same link to the system browser,
 * which saves it to the phone. Anything that is not a PDF (a slides page, a drive link) opens in the browser.
 */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

const VIEWER = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<style>html,body{margin:0;background:#0b0b0d}canvas{display:block;width:100%;margin:0 0 8px;background:#fff}</style>
<script src="${PDFJS}/pdf.min.js"></script></head><body><div id="pages"></div><script>
pdfjsLib.GlobalWorkerOptions.workerSrc='${PDFJS}/pdf.worker.min.js';
window.showPdf=async function(b64){try{
var raw=atob(b64),bytes=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
var pdf=await pdfjsLib.getDocument({data:bytes}).promise,box=document.getElementById('pages'),ratio=Math.min(window.devicePixelRatio||1,2);
for(var n=1;n<=pdf.numPages;n++){var page=await pdf.getPage(n),base=page.getViewport({scale:1}),scale=(window.innerWidth/base.width)*ratio,view=page.getViewport({scale:scale});
var canvas=document.createElement('canvas');canvas.width=view.width;canvas.height=view.height;box.appendChild(canvas);
await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
if(n===1)window.ReactNativeWebView.postMessage('shown');}
}catch(e){window.ReactNativeWebView.postMessage('failed');}};
window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;

/** The cache file of one link: same link, same file (opening it again is instant). */
function cacheFileOf(url: string): string {
  let hash = 0;
  for (let index = 0; index < url.length; index += 1) hash = (hash * 31 + url.charCodeAt(index)) | 0;
  return `${FileSystem.cacheDirectory ?? ''}deck-${(hash >>> 0).toString(36)}.pdf`;
}

async function downloadDeck(url: string): Promise<{ uri: string; pdf: boolean }> {
  const target = cacheFileOf(url);
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists && (existing.size ?? 0) > 0) return { uri: target, pdf: true };
  const result = await FileSystem.downloadAsync(url, target);
  if (result.status < 200 || result.status >= 300) throw new Error(`deck ${result.status}`);
  const type = Object.entries(result.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
  // The first bytes decide when the server labels the file vaguely (octet-stream).
  const head = await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 4 }).catch(() => '');
  const pdf = /pdf/i.test(type) || head.startsWith('JVBERi'); // «%PDF» in base64
  if (!pdf) await FileSystem.deleteAsync(target, { idempotent: true });
  return { uri: target, pdf };
}

export default function DeckScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const webview = useMemo(() => loadWebView(), []);
  const ref = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
  const deck = useQuery({
    queryKey: ['deck', url],
    queryFn: () => downloadDeck(url ?? ''),
    enabled: Boolean(url && webview),
    staleTime: Infinity,
    retry: 1,
  });

  const outside = Boolean(url) && (!webview || (deck.data !== undefined && !deck.data.pdf));
  useEffect(() => {
    // Not a PDF, or a binary without the WebView: the browser is the right place for it.
    if (outside && url) void openLink(url).then(() => router.back());
  }, [outside, url, router]);

  if (!url) return null;
  const download = () => void Linking.openURL(url).catch(() => openLink(url));

  if (outside || !webview) return <View style={styles.screen} />;

  const WebView = webview.WebView;
  const sendPdf = async () => {
    if (!deck.data) return;
    try {
      const base64 = await FileSystem.readAsStringAsync(deck.data.uri, { encoding: FileSystem.EncodingType.Base64 });
      ref.current?.injectJavaScript(`window.showPdf(${JSON.stringify(base64)});true;`);
    } catch {
      void openLink(url);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: title || t('deck.title') }} />
      {deck.error ? (
        <View style={styles.center}>
          <Notice tone="warning" text={t('deck.failed')} />
          <AppButton label={t('deck.openOutside')} icon="open-outline" onPress={() => void openLink(url)} />
        </View>
      ) : !deck.data ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} />
          <Text style={styles.loadingText}>{t('deck.loading')}</Text>
        </View>
      ) : Platform.OS === 'ios' ? (
        <WebView source={{ uri: deck.data.uri }} originWhitelist={['*']} allowingReadAccessToURL={FileSystem.cacheDirectory ?? undefined} allowFileAccess style={styles.web} />
      ) : (
        <WebView
          ref={ref as never}
          source={{ html: VIEWER, baseUrl: 'https://cdnjs.cloudflare.com/' }}
          originWhitelist={['*']}
          style={styles.web}
          onMessage={(event: { nativeEvent: { data: string } }) => {
            if (event.nativeEvent.data === 'ready') void sendPdf();
            if (event.nativeEvent.data === 'failed') void openLink(url);
          }}
        />
      )}
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <AppButton label={t('deck.download')} icon="download-outline" onPress={download} />
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.black },
  web: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  bar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.black, borderTopWidth: 1, borderTopColor: colors.border },
}));
