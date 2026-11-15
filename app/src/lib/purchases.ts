import { NativeModules, Platform } from 'react-native';

import type { StoreConfig } from '@/api/membership';
import { getLang, t } from '@/i18n';
import { trackMembershipCheckout, trackMembershipPurchase } from '@/lib/adsAttribution';
import { loadSetting, saveSetting } from '@/lib/deviceStore';

type PurchasesModule = typeof import('react-native-purchases');
type PurchasesPackage = import('react-native-purchases').PurchasesPackage;
type PurchasesStoreProduct = import('react-native-purchases').PurchasesStoreProduct;

export type StoreOffer = { kind: 'package'; pkg: PurchasesPackage; product: PurchasesStoreProduct } | { kind: 'product'; product: PurchasesStoreProduct };
// `pending`: the store accepted the order but the payment waits (Ask to Buy, a slow card, a cash method) — not a failure.
export type PurchaseResult = { status: 'purchased'; entitled: boolean } | { status: 'cancelled' } | { status: 'pending' } | { status: 'failed'; message: string };

// react-native-purchases is native. Binaries built before it was added (every preview build up to
// M7 part 2 A) do not contain it: the native module registry is checked before the package is
// required, the same pattern as expo-secure-store in auth/storage.ts.
function loadPurchases(): PurchasesModule | null {
  if (!NativeModules.RNPurchases) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-purchases') as PurchasesModule;
  } catch {
    return null;
  }
}

/** True when this binary can open the store's purchase sheet. */
export function hasStorePurchases(): boolean {
  return loadPurchases() !== null;
}

/** The RevenueCat public key for this platform, or null when the owner has not connected it yet. */
export function storeKeyFor(config: StoreConfig): string | null {
  if (Platform.OS === 'ios') return config.apiKeys.ios;
  if (Platform.OS === 'android') return config.apiKeys.android;
  return null;
}

export function storeName(): string {
  return Platform.OS === 'ios' ? 'App Store' : 'Google Play';
}

/**
 * M182e (owner: «مكتوب SAR برده … والعلامة قبل الرقم مش بعده»): the store formats its price
 * symbol-first («SAR 1,900.00» / «ر.س ١٬٩٠٠»). Riyal prices become «1,900 ريال» — number first,
 * whole .00 dropped — so SarText draws the symbol AFTER the number; other currencies pass through.
 */
export function riyalPrice(priceString: string): string {
  const CURRENCY = /(?:SAR|ر\.س\.?|ريال)/u;
  const AMOUNT = /[0-9٠-٩][0-9٠-٩.,٬٫،\s]*/u;
  // Spaces and the invisible direction marks the stores put around an Arabic price (LRM, RLM, Arabic letter mark).
  const GAP = '[\\s\\u200e\\u200f\\u061c]*';
  const lead = priceString.match(new RegExp(`^${GAP}${CURRENCY.source}${GAP}(${AMOUNT.source})$`, 'u'));
  const trail = priceString.match(new RegExp(`^${GAP}(${AMOUNT.source})${GAP}${CURRENCY.source}${GAP}$`, 'u'));
  const amount = (lead?.[1] ?? trail?.[1])?.trim().replace(/[.,٫][0٠]{2}$/u, '');
  // M239 (owner, 2026-11-14): an English app on an Arabic-language phone must not show Arabic-Indic digits.
  const shown = (text: string) => (getLang() === 'en' ? latinDigits(text) : text);
  return amount ? `${shown(amount)} ريال` : shown(priceString);
}

/** Arabic-Indic / Persian digits and separators folded to Latin. */
function latinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٬،]/g, ',')
    .replace(/٫/g, '.');
}

let configuredKey: string | null = null;
let configuredUser: string | null = null;

/** Configures RevenueCat once for the signed-in member (`vc-<hub id>`, the id the server's webhook expects). */
export async function identifyPurchases(config: StoreConfig, contactId: number): Promise<boolean> {
  const purchases = loadPurchases();
  const apiKey = storeKeyFor(config);
  if (!purchases || !apiKey) return false;
  const appUserID = `${config.appUserIdPrefix}${contactId}`;
  try {
    if (configuredKey !== apiKey) {
      void purchases.default.setLogLevel(purchases.LOG_LEVEL.ERROR);
      purchases.default.configure({ apiKey, appUserID });
      configuredKey = apiKey;
      configuredUser = appUserID;
    } else if (configuredUser !== appUserID) {
      await purchases.default.logIn(appUserID);
      configuredUser = appUserID;
    }
    return true;
  } catch {
    return false;
  }
}

/** Sign-out: the next account on this device must not inherit the store identity. */
export async function resetPurchases(): Promise<void> {
  // The offer fetched for the account that is leaving goes with it (see loadMembershipOffer).
  cachedOffer = null;
  const purchases = loadPurchases();
  if (!purchases || !configuredUser) return;
  configuredUser = null;
  try {
    await purchases.default.logOut();
  } catch {
    // Already anonymous: nothing to forget.
  }
}

// One store-offer fetch per launch and per account, shared by the members-only popup and the home card.
// It is kept under the store identity it was fetched for (`vc-<hub id>`): a sign-out or another account never reads it.
let cachedOffer: { user: string; offer: StoreOffer } | null = null;

/** The offer already fetched for this account in this launch, if any. */
export function cachedMembershipOffer(config: StoreConfig, contactId: number): StoreOffer | null {
  return cachedOffer && cachedOffer.user === `${config.appUserIdPrefix}${contactId}` ? cachedOffer.offer : null;
}

/** Identifies the store account as this member, then fetches the offer (and keeps it for the launch). Null when the store cannot be reached. */
export async function loadMembershipOffer(config: StoreConfig, contactId: number): Promise<StoreOffer | null> {
  try {
    if (!(await identifyPurchases(config, contactId))) return null;
    const offer = await fetchMembershipOffer(config);
    cachedOffer = offer ? { user: `${config.appUserIdPrefix}${contactId}`, offer } : null;
    return offer;
  } catch {
    return null;
  }
}

/**
 * The «a purchase is waiting for the server» flag (review 2026-11-16, «اشتريت العضوية ولازم أقفل التطبيق وأفتحه»).
 * The store said yes (or holds the payment) but the server has not activated yet: the flag survives a restart so
 * the app keeps asking the server (AuthProvider) until it answers «active». It never activates anything by itself.
 * Stored through deviceStore, whose secure-store calls sit behind the optional-module guard (safe on every binary).
 */
export type PurchaseWatch = { contactId: number; at: number };

const WATCH_KEY = 'membership.purchaseWatch';
/** A purchase the server has not confirmed after three days needs the management, not more asking. */
const WATCH_MAX_AGE_MS = 72 * 60 * 60_000;

export async function savePurchaseWatch(contactId: number): Promise<PurchaseWatch> {
  const watch: PurchaseWatch = { contactId, at: Date.now() };
  try {
    await saveSetting(WATCH_KEY, JSON.stringify(watch));
  } catch {
    // This launch still watches; only the «after a restart» part is lost.
  }
  return watch;
}

/** The saved flag when it belongs to this account and is younger than 72 hours; an old or foreign one is removed. */
export async function loadPurchaseWatch(contactId: number): Promise<PurchaseWatch | null> {
  try {
    const raw = await loadSetting(WATCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PurchaseWatch> | null;
    const valid =
      parsed !== null && typeof parsed === 'object' && parsed.contactId === contactId && typeof parsed.at === 'number' && Date.now() - parsed.at < WATCH_MAX_AGE_MS;
    if (valid) return { contactId, at: parsed.at as number };
    await saveSetting(WATCH_KEY, null);
    return null;
  } catch {
    return null;
  }
}

export async function clearPurchaseWatch(): Promise<void> {
  try {
    await saveSetting(WATCH_KEY, null);
  } catch {
    // Nothing to clear, or the store is unavailable: the flag expires by its age.
  }
}

function matchesProduct(identifier: string, productId: string): boolean {
  // Play subscriptions may be reported as `product:basePlan`.
  return identifier === productId || identifier.startsWith(`${productId}:`);
}

/** The annual membership as the store sells it: the current offering's package, else the product itself. */
export async function fetchMembershipOffer(config: StoreConfig): Promise<StoreOffer | null> {
  const purchases = loadPurchases();
  if (!purchases) return null;
  const offerings = await purchases.default.getOfferings();
  const candidates = [offerings.current, ...Object.values(offerings.all)].filter((offering) => offering !== null);
  for (const offering of candidates) {
    const pkg = offering.availablePackages.find((entry) => matchesProduct(entry.product.identifier, config.productId));
    if (pkg) return { kind: 'package', pkg, product: pkg.product };
  }
  const products = await purchases.default.getProducts([config.productId], purchases.PRODUCT_CATEGORY.SUBSCRIPTION);
  const product = products.find((entry) => matchesProduct(entry.identifier, config.productId)) ?? products[0];
  return product ? { kind: 'product', product } : null;
}

function storeErrorMessage(purchases: PurchasesModule, code: unknown): string {
  const codes = purchases.PURCHASES_ERROR_CODE;
  switch (code) {
    case codes.PURCHASE_NOT_ALLOWED_ERROR:
      return t('store.error.notAllowed');
    case codes.PAYMENT_PENDING_ERROR:
      return t('store.error.paymentPending');
    case codes.PRODUCT_ALREADY_PURCHASED_ERROR:
      return t('store.error.alreadyPurchased');
    case codes.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
      return t('store.error.notAvailable');
    case codes.NETWORK_ERROR:
    case codes.OFFLINE_CONNECTION_ERROR:
      return t('store.error.network');
    case codes.STORE_PROBLEM_ERROR:
      return t('store.error.storeProblem');
    default:
      return t('store.error.failed');
  }
}

type StoreFailure = { code?: unknown; userCancelled?: boolean | null };

/** Opens the store's purchase sheet. The server, not this result, activates the membership. */
export async function purchaseMembership(config: StoreConfig, offer: StoreOffer): Promise<PurchaseResult> {
  const purchases = loadPurchases();
  if (!purchases) return { status: 'failed', message: t('store.error.unsupported') };
  try {
    trackMembershipCheckout(offer.product);
    const result = offer.kind === 'package' ? await purchases.default.purchasePackage(offer.pkg) : await purchases.default.purchaseStoreProduct(offer.product);
    // M157: the ad networks learn about the bought membership (price + currency, no member data).
    trackMembershipPurchase(offer.product);
    return { status: 'purchased', entitled: Boolean(result.customerInfo.entitlements.active[config.entitlement]) };
  } catch (error) {
    const failure = (error ?? {}) as StoreFailure;
    if (failure.userCancelled || failure.code === purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return { status: 'cancelled' };
    if (failure.code === purchases.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return { status: 'pending' };
    return { status: 'failed', message: storeErrorMessage(purchases, failure.code) };
  }
}

/** Reads earlier purchases of the store account on this device (new phone, reinstall). */
export async function restoreMembership(config: StoreConfig): Promise<{ entitled: boolean } | { error: string }> {
  const purchases = loadPurchases();
  if (!purchases) return { error: t('store.error.unsupported') };
  try {
    const info = await purchases.default.restorePurchases();
    return { entitled: Boolean(info.entitlements.active[config.entitlement]) };
  } catch (error) {
    return { error: storeErrorMessage(purchases, ((error ?? {}) as StoreFailure).code) };
  }
}

/** The store's own subscription management page for this member, when the store knows one. */
export async function fetchManagementUrl(): Promise<string | null> {
  const purchases = loadPurchases();
  if (!purchases || !configuredUser) return null;
  try {
    return (await purchases.default.getCustomerInfo()).managementURL;
  } catch {
    return null;
  }
}
