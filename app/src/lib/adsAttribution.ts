import { requireOptionalNativeModule } from 'expo';
import { Alert, AppState, InteractionManager, NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { env } from '@/config/env';
import { createCustomerIdGate } from '@/lib/adsCustomerIdGate';
import { piiFromMe, type AdsUserPii } from '@/lib/adsUserPii';
import { t } from '@/i18n';
import { loadSetting, saveSetting } from '@/lib/deviceStore';

/**
 * M157: ads attribution through AppsFlyer, the one measurement partner every network the owner buys
 * ads on accepts (TikTok, Meta, X, LinkedIn, Google Ads). The SDK is native, so binaries built before
 * 1.3.0 do not contain it: the native registry is checked before the package is required (the same
 * pattern as lib/purchases.ts and auth/social.ts) and every function here is a no-op there, which
 * keeps OTA updates safe. Event names leave the device; the member's numeric id, and since 2026-11-10
 * (owner) the e-mail and mobile HASHED by the SDK (lib/adsUserPii.ts), only after the iOS tracking
 * permission is granted (Android has no such prompt). Never a name. The dev key is a public app key
 * (EXPO_PUBLIC_APPSFLYER_DEV_KEY).
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
  /** SDK 7: hashed-PII setters (the SDK hashes on the device before sending). */
  setUserEmail?(params: { email: string }): Promise<void>;
  setUserPhone?(params: { countryCode: string; phoneNumber: string }): Promise<void>;
  clearUserPii?(): Promise<void>;
};

type TrackingModule = Pick<typeof import('expo-tracking-transparency'), 'requestTrackingPermissionsAsync' | 'getTrackingPermissionsAsync'>;

let sdk: AppsFlyerSdk | null | undefined;
let starting: Promise<void> | null = null;
let started = false;

const customerIdGate = createCustomerIdGate((customerId) => {
  void loadSdk()?.setCustomerUserId({ customerId }).catch(warn);
});

// The hashed e-mail/phone ride the same consent rule as the member id (the gate dedupes by the JSON key).
const piiGate = createCustomerIdGate((json) => {
  const current = loadSdk();
  if (!current) return;
  const pii = JSON.parse(json) as AdsUserPii;
  if (pii.email && current.setUserEmail) void current.setUserEmail({ email: pii.email }).catch(warn);
  if (pii.phone && current.setUserPhone) void current.setUserPhone(pii.phone).catch(warn);
});

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

/**
 * iOS: the App Tracking Transparency prompt (Arabic + English text in app.config.ts), true only when
 * granted. Android has no such prompt and resolves true at once.
 */
async function askTrackingPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return true;
  if (!requireOptionalNativeModule('ExpoTrackingTransparency')) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require('expo-tracking-transparency') as TrackingModule;
    const current = await tracking.getTrackingPermissionsAsync();
    if (current.status !== 'undetermined' || !current.canAskAgain) return current.granted;
    // 2026-11-10 audit: a short, honest explanation first (one «متابعة» button, no reward, the system
    // prompt always follows), so fewer members refuse a dialog they do not understand.
    await new Promise<void>((resolve) =>
      Alert.alert(t('ads.attPrimer.title'), t('ads.attPrimer.body'), [{ text: t('ads.attPrimer.continue'), onPress: () => resolve() }], {
        cancelable: false,
      }),
    );
    const permission = await tracking.requestTrackingPermissionsAsync();
    return permission.granted;
  } catch {
    // Unavailable counts as refused: AppsFlyer still measures without the advertising id.
    return false;
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

function guardValue(state: 'pending' | 'retry' | 'ok' | 'off'): string {
  return `${env.appVersion}:${state}`;
}

async function readGuard(): Promise<string | null> {
  try {
    return await loadSetting(GUARD_KEY);
  } catch {
    return null;
  }
}

/**
 * 2026-11-10 audit: the marker used to turn «pending» at the very start, BEFORE the 1.5 s wait and the
 * tracking prompt, so a newcomer who closed the app before answering it (typical for an ad install)
 * was taken for a crash and lost attribution for good on that version. Now the marker is armed only
 * right before the native calls, and two unproven launches in a row are needed to switch the SDK off.
 */
async function armLaunchGuard(): Promise<boolean> {
  const marker = await readGuard();
  if (marker === guardValue('ok')) return true;
  if (marker === guardValue('off')) return false;
  if (marker === guardValue('retry')) {
    await saveSetting(GUARD_KEY, guardValue('off')).catch(() => undefined);
    return false;
  }
  const next = marker === guardValue('pending') ? 'retry' : 'pending';
  await saveSetting(GUARD_KEY, guardValue(next)).catch(() => undefined);
  return true;
}

let launchOk = false;
function markLaunchOk(): void {
  if (launchOk) return;
  launchOk = true;
  void saveSetting(GUARD_KEY, guardValue('ok')).catch(() => undefined);
}

// Events logged before start() (a sign-up in the first minute) wait here instead of reaching a cold SDK.
const queued: { eventName: string; eventValues: Record<string, unknown> }[] = [];

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
    if ((await readGuard()) === guardValue('off')) return;
    await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => setTimeout(resolve, 1500)));
    const begin = async () => {
      if (started) return;
      started = true;
      customerIdGate.markReady();
      piiGate.markReady();
      await current.start();
      clearTimeout(survived);
      markLaunchOk();
      for (const event of queued.splice(0)) void current.logEvent(event).catch(warn);
    };
    let survived: ReturnType<typeof setTimeout> | undefined;
    try {
      const consent = await askTrackingPermission();
      customerIdGate.setConsent(consent);
      piiGate.setConsent(consent);
      // The guard covers the native calls only (the 1.3.0 (5) crash was inside init).
      if (!(await armLaunchGuard())) return;
      // Alive 15 s after the native calls, or sent to the background = no launch crash.
      survived = setTimeout(markLaunchOk, 15000);
      const background = AppState.addEventListener('change', (state) => {
        if (state === 'background') {
          markLaunchOk();
          background.remove();
        }
      });
      if (!env.isProduction) await current.enableDebug({ enabled: true }).catch(() => undefined);
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

/**
 * Ties this device's events to the member (numeric id only) so the dashboard dedupes across devices.
 * The id waits in the gate and is never sent while iOS tracking is refused or undecided.
 */
export function identifyAdsUser(contactId: number, pii?: AdsUserPii): void {
  if (!loadSdk()) return;
  customerIdGate.setCustomerId(String(contactId));
  if (pii && (pii.email || pii.phone)) piiGate.setCustomerId(JSON.stringify(pii));
}

function logEvent(eventName: string, eventValues: Record<string, unknown>): void {
  const current = loadSdk();
  if (!current) return;
  if (!started) {
    if (queued.length < 30) queued.push({ eventName, eventValues });
    return;
  }
  void current.logEvent({ eventName, eventValues }).catch(warn);
}

/** A new account finished its e-mail code (the server created the member). */
export function trackRegistration(
  method: 'email' | 'google' | 'apple',
  me?: { id: number; email?: string; phone?: string; contactEmail?: string },
): void {
  // 2026-11-10 audit: name the member (and the hashed contact) BEFORE the sign-up event, so the event
  // itself carries them; the root component's effect only runs after React commits the new session.
  if (me) identifyAdsUser(me.id, piiFromMe(me));
  logEvent('af_complete_registration', { af_registration_method: method });
}

/** Sign-out or account deletion: the next person on this phone must not inherit this member's match keys. */
export function forgetAdsUser(): void {
  const current = loadSdk();
  if (!current) return;
  customerIdGate.reset();
  piiGate.reset();
  if (started && current.clearUserPii) void current.clearUserPii().catch(warn);
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
