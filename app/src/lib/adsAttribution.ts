import { requireOptionalNativeModule } from 'expo';
import { InteractionManager, NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { env } from '@/config/env';
import { loadSetting, saveSetting } from '@/lib/deviceStore';

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
 * M174 launch guard. iOS 1.3.0 (5) died inside the native SDK half a second into every launch, so the
 * native start is marked «pending» right before it runs and «ok» once the app has survived it. A
 * launch that finds «pending» knows the previous one crashed in the SDK and keeps it off for this
 * app version: one crash at most per device, never a locked-out member. The marker is per version so
 * a fixed binary gets a fresh try.
 */
const GUARD_KEY = 'adsAttribution.launchGuard';

function guardValue(state: 'pending' | 'ok' | 'off'): string {
  return `${env.appVersion}:${state}`;
}

async function launchGuardAllows(): Promise<boolean> {
  let marker: string | null = null;
  try {
    marker = await loadSetting(GUARD_KEY);
  } catch {
    marker = null;
  }
  if (marker === guardValue('off')) return false;
  if (marker === guardValue('pending')) {
    await saveSetting(GUARD_KEY, guardValue('off')).catch(() => undefined);
    return false;
  }
  if (marker !== guardValue('ok')) await saveSetting(GUARD_KEY, guardValue('pending')).catch(() => undefined);
  return true;
}

function markLaunchOk(): void {
  void saveSetting(GUARD_KEY, guardValue('ok')).catch(() => undefined);
}

/**
 * Starts the SDK once per launch in the order the SDK 7 migration guide prescribes: the tracking
 * prompt BEFORE init (the guide retired timeToWaitForATTUserAuthorization in favour of that), then
 * init, then the session-ready listener registered right after init — not before it, not inside
 * init().then() — and start() only from that callback (isSessionReady() covers a native side that was
 * ready already). M174: the previous order (listener before init) is the one native difference between
 * 1.2.0 and the 1.3.0 (5) launch crash; the SDK also only wakes up once the first screen has settled.
 */
export function startAdsAttribution(): Promise<void> {
  if (starting) return starting;
  const current = loadSdk();
  if (!current) return Promise.resolve();
  starting = (async () => {
    if (!(await launchGuardAllows())) return;
    await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => setTimeout(resolve, 1500)));
    // The app is still alive 15 s after the native calls = no launch crash, whatever the session did.
    const survived = setTimeout(markLaunchOk, 15000);
    const begin = async () => {
      if (started) return;
      started = true;
      await current.start();
      clearTimeout(survived);
      markLaunchOk();
    };
    try {
      if (!env.isProduction) await current.enableDebug({ enabled: true }).catch(() => undefined);
      await askTrackingPermission();
      const initialized = current.init({ devKey: env.appsflyerDevKey, appId: Platform.OS === 'ios' ? IOS_APP_ID : null });
      const listening = current.registerSessionReadyListener(() => void begin().catch(warn)).catch(warn);
      await initialized;
      await listening;
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

/** M217: the store's purchase sheet is about to open (intent signal for the ad networks, no member data). */
export function trackMembershipCheckout(product: { identifier: string; price: number; currencyCode: string }): void {
  logEvent('af_initiated_checkout', {
    af_price: product.price,
    af_currency: product.currencyCode,
    af_content_id: product.identifier,
    af_content_type: 'membership',
  });
}

const checkedOut = new Set<string>();

/** M217: a real-world service checkout opened. Once per payment per launch. */
export function trackServiceCheckout(payment: { id: string; serviceKey: string; amount: number; currency: string }): void {
  if (checkedOut.has(payment.id)) return;
  checkedOut.add(payment.id);
  logEvent('af_initiated_checkout', {
    af_price: payment.amount,
    af_currency: payment.currency,
    af_content_id: payment.serviceKey,
    af_content_type: 'service',
  });
}

const viewedProjects = new Set<string>();

/** M217: a Projects Bank opportunity was opened (once per project per launch; the id only, no founder data). */
export function trackProjectView(projectId: string): void {
  if (!projectId || viewedProjects.has(projectId)) return;
  viewedProjects.add(projectId);
  logEvent('af_content_view', { af_content_id: projectId, af_content_type: 'project' });
}

/** M217: the member unlocked a project's founder contact (the club's core action). */
export function trackProjectUnlock(projectId: string): void {
  logEvent('project_unlock', { af_content_id: projectId, af_content_type: 'project' });
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
