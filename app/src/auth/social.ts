import { requireOptionalNativeModule } from 'expo';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { env } from '@/config/env';

/**
 * M46: sign-in with Google (Android) / Apple (iOS) in seconds. Both are native modules, so binaries
 * built before M46 do not contain them: the native registry is checked before any require, exactly
 * like lib/notifications.ts — an OTA update on an old binary simply hides the buttons.
 */
export type SocialProvider = 'google' | 'apple';

export type SocialSignInResult =
  | { ok: true; provider: SocialProvider; token: string; name: string }
  | { ok: false; cancelled: boolean };

type AppleModule = typeof import('expo-apple-authentication');
type GoogleModule = typeof import('@react-native-google-signin/google-signin');

function loadApple(): AppleModule | null {
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoAppleAuthentication')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-apple-authentication') as AppleModule;
  } catch {
    return null;
  }
}

function loadGoogle(): GoogleModule | null {
  if (Platform.OS !== 'android' || !env.googleWebClientId) return null;
  try {
    const native = TurboModuleRegistry.get('RNGoogleSignin') ?? (NativeModules as Record<string, unknown>).RNGoogleSignin;
    if (!native) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin') as GoogleModule;
  } catch {
    return null;
  }
}

/** Which social button this binary + platform + server config can actually show. */
export function availableSocialProvider(serverSocial: { google: boolean; apple: boolean } | undefined): SocialProvider | null {
  if (!serverSocial) return null;
  if (serverSocial.google && loadGoogle()) return 'google';
  if (serverSocial.apple && loadApple()) return 'apple';
  return null;
}

let googleConfigured = false;

async function signInWithGoogle(): Promise<SocialSignInResult> {
  const google = loadGoogle();
  if (!google) return { ok: false, cancelled: false };
  const { GoogleSignin, statusCodes } = google;
  try {
    if (!googleConfigured) {
      GoogleSignin.configure({ webClientId: env.googleWebClientId });
      googleConfigured = true;
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = (await GoogleSignin.signIn()) as unknown as {
      type?: string;
      data?: { idToken?: string | null; user?: { name?: string | null } } | null;
      idToken?: string | null;
      user?: { name?: string | null };
    };
    if (response?.type === 'cancelled') return { ok: false, cancelled: true };
    const data = response?.data ?? response;
    const token = data?.idToken ?? null;
    if (!token) return { ok: false, cancelled: false };
    return { ok: true, provider: 'google', token, name: data?.user?.name?.trim() ?? '' };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) return { ok: false, cancelled: true };
    return { ok: false, cancelled: false };
  }
}

async function signInWithApple(): Promise<SocialSignInResult> {
  const apple = loadApple();
  if (!apple) return { ok: false, cancelled: false };
  try {
    if (!(await apple.isAvailableAsync())) return { ok: false, cancelled: false };
    const credential = await apple.signInAsync({
      requestedScopes: [apple.AppleAuthenticationScope.FULL_NAME, apple.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) return { ok: false, cancelled: false };
    // Apple sends the name ONCE, on the first authorization only; the server keeps it from then on.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ').trim();
    return { ok: true, provider: 'apple', token: credential.identityToken, name };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'ERR_REQUEST_CANCELED') return { ok: false, cancelled: true };
    return { ok: false, cancelled: false };
  }
}

/** Runs the native sheet of the given provider and returns the ID token for the server. */
export async function socialSignIn(provider: SocialProvider): Promise<SocialSignInResult> {
  return provider === 'google' ? signInWithGoogle() : signInWithApple();
}
