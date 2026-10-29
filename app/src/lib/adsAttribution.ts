import { requireOptionalNativeModule } from 'expo';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { env } from '@/config/env';

/**
 * M157: ads attribution through AppsFlyer, the one measurement partner every network the owner buys
 * ads on accepts (TikTok, Meta, X, LinkedIn, Google Ads). The SDK is native, so binaries built before
 * 1.3.0 do not contain it: the native registry is checked before the package is required (the same
 * pattern as lib/purchases.ts and auth/social.ts) and every function here is a no-op there, which
 * keeps OTA updates safe. Only the member's numeric id and the event names leave the device — never
 * a name, phone or e-mail. The dev key is a public app key (EXPO_PUBLIC_APPSFLYER_DEV_KEY).
 */

/** The App Store id of «Investors Club» (public; AppsFlyer needs it on iOS only). */
const IOS_APP_ID = '6825963092';

/** The slice of @appsflyer-sdk/js-core-plugin this app uses (typed here so tsc never checks the SDK's own TS sources). */
type AppsFlyerSdk = {
  init(params: { devKey: string; appId?: string | null }): Promise<void>;
  registerSessionReadyListener(onReady: () => void): Promise<void>;
  isSessionReady(): Promise<boolean>;
  start(): Promise<void>;
  enableDebug(params: { enabled: boolean }): Promise<void>;
  logEvent(params: { eventName: string; eventValues?: Record<string, unknown> | null }): Promise<void>;
  setCustomerUserId(params: { customerId: string }): Promise<void>;
};

type TrackingModule = Pick<typeof import('expo-tracking-transparency'), 'requestTrackingPermissionsAsync'>;

let sdk: AppsFlyerSdk | null | undefined;
let starting: Promise<void> | null = null;
let started = false;

function loadSdk(): AppsFlyerSdk | null {
  if (sdk !== undefined) return sdk;
  sdk = null;
  if (!env.appsflyerDevKey) return null;
  try {
    const native = TurboModuleRegistry.get('RNAppsFlyer') ?? (NativeModules as Record<string, unknown>).RNAppsFlyer;
    if (!native) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-appsflyer') as { AppsFlyer?: AppsFlyerSdk; default?: AppsFlyerSdk };
    sdk = loaded.AppsFlyer ?? loaded.default ?? null;
  } catch {
    sdk = null;
  }
  return sdk;
}

/** True when this binary carries the attribution SDK and a dev key (false on 1.2.0 and older). */
export function hasAdsAttribution(): boolean {
  return loadSdk() !== null;
}

/** iOS: the App Tracking Transparency prompt (Arabic + English text in app.config.ts). Android resolves at once. */
async function askTrackingPermission(): Promise<void> {
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoTrackingTransparency')) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require('expo-tracking-transparency') as TrackingModule;
    await tracking.requestTrackingPermissionsAsync();
  } catch {
    // Denied or unavailable: AppsFlyer still measures without the advertising id.
  }
}

/**
 * Starts the SDK once per launch: init, then the ATT prompt (so the advertising id is settled), then
 * start(). SDK 7's manual start model fires a session-ready event; the listener is registered BEFORE
 * init so the event is never missed, and isSessionReady() covers a native side that was ready already.
 */
export function startAdsAttribution(): Promise<void> {
  if (starting) return starting;
  const current = loadSdk();
  if (!current) return Promise.resolve();
  starting = (async () => {
    const begin = async () => {
      if (started) return;
      started = true;
      await askTrackingPermission();
      await current.start();
    };
    try {
      if (!env.isProduction) await current.enableDebug({ enabled: true }).catch(() => undefined);
      await current.registerSessionReadyListener(() => void begin().catch(warn));
      await current.init({ devKey: env.appsflyerDevKey, appId: Platform.OS === 'ios' ? IOS_APP_ID : null });
      if (await current.isSessionReady().catch(() => false)) await begin();
    } catch (error) {
      warn(error);
    }
  })();
  return starting;
}

/** Ties this device's events to the member (numeric id only) so the dashboard dedupes across devices. */
export function identifyAdsUser(contactId: number): void {
  const current = loadSdk();
  if (!current) return;
  void current.setCustomerUserId({ customerId: String(contactId) }).catch(warn);
}

function logEvent(eventName: string, eventValues: Record<string, unknown>): void {
  const current = loadSdk();
  if (!current) return;
  void current.logEvent({ eventName, eventValues }).catch(warn);
}

/** A new account finished its e-mail code (the server created the member). */
export function trackRegistration(method: 'email' | 'google' | 'apple'): void {
  logEvent('af_complete_registration', { af_registration_method: method });
}

/** The store's purchase sheet closed with a bought annual membership (the server activates it later). */
export function trackMembershipPurchase(product: { identifier: string; price: number; currencyCode: string }): void {
  logEvent('af_subscribe', {
    af_revenue: product.price,
    af_currency: product.currencyCode,
    af_content_id: product.identifier,
    af_content_type: 'membership',
  });
}

const trackedPayments = new Set<string>();

/** A real-world service was paid (Moyasar callback confirmed on the server). Once per payment per launch. */
export function trackServicePurchase(payment: { id: string; serviceKey: string; amount: number; currency: string }): void {
  if (payment.amount <= 0 || trackedPayments.has(payment.id)) return;
  trackedPayments.add(payment.id);
  logEvent('af_purchase', {
    af_revenue: payment.amount,
    af_currency: payment.currency,
    af_content_id: payment.serviceKey,
    af_content_type: 'service',
    af_order_id: payment.id,
  });
}

function warn(error: unknown): void {
  console.warn('ads attribution', error instanceof Error ? error.message : String(error));
}
