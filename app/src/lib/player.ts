import { requireOptionalNativeModule } from 'expo';
import type { useRouter } from 'expo-router';
import { NativeModules, TurboModuleRegistry } from 'react-native';

import { openLink } from '@/lib/openLink';

/**
 * M19 («أي فيديو يتم فتحه داخل التطبيق»): YouTube plays in YouTube's own embedded player inside a
 * WebView (its terms), uploaded files play in expo-video. Both are native modules, so binaries built
 * before M19 do not contain them: the native registry is checked before any require — exactly like
 * auth/social.ts — and an OTA update on an old binary simply keeps the in-app browser behaviour.
 */

type WebViewModule = typeof import('react-native-webview');
type VideoModule = typeof import('expo-video');
type Router = ReturnType<typeof useRouter>;

/** The YouTube embedded player needs react-native-webview's native side. */
export function loadWebView(): WebViewModule | null {
  try {
    const native = TurboModuleRegistry.get('RNCWebViewModule') ?? (NativeModules as Record<string, unknown>).RNCWebViewModule;
    if (!native) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-webview') as WebViewModule;
  } catch {
    return null;
  }
}

/** Uploaded files play in expo-video's native player. */
export function loadVideo(): VideoModule | null {
  if (!requireOptionalNativeModule('ExpoVideo')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-video') as VideoModule;
  } catch {
    return null;
  }
}

/** The video id of any YouTube URL form (watch, youtu.be, shorts, live, embed); null for anything else. */
export function youtubeIdOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    const clean = (value: string | null | undefined): string | null => {
      const id = (value ?? '').trim();
      return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
    };
    if (host === 'youtu.be') return clean(parsed.pathname.split('/')[1]);
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const [, first, second] = parsed.pathname.split('/');
      if (first === 'watch') return clean(parsed.searchParams.get('v'));
      if (first === 'shorts' || first === 'live' || first === 'embed' || first === 'v') return clean(second);
    }
    return null;
  } catch {
    return null;
  }
}

export type PlayRequest = {
  /** The page or file to open when in-app playback is not possible (and the analytics name of the video). */
  url: string;
  title?: string | null;
  poster?: string | null;
};

/**
 * Opens the video inside the app (the «مشاهدة» screen) whenever this binary can play it;
 * an old binary falls back to the in-app browser, exactly as before M19.
 */
export function playVideo(router: Router, request: PlayRequest): void {
  const youtubeId = youtubeIdOf(request.url);
  const canPlay = youtubeId ? loadWebView() !== null : loadVideo() !== null;
  if (!canPlay) {
    void openLink(request.url);
    return;
  }
  router.push({
    pathname: '/watch',
    params: {
      url: request.url,
      ...(youtubeId ? { yt: youtubeId } : {}),
      ...(request.title ? { title: request.title } : {}),
      ...(request.poster ? { poster: request.poster } : {}),
    },
  });
}
