import { NativeModules, Platform } from 'react-native';

import type { StoreConfig } from '@/api/membership';
import { t } from '@/i18n';

type PurchasesModule = typeof import('react-native-purchases');
type PurchasesPackage = import('react-native-purchases').PurchasesPackage;
type PurchasesStoreProduct = import('react-native-purchases').PurchasesStoreProduct;

export type StoreOffer = { kind: 'package'; pkg: PurchasesPackage; product: PurchasesStoreProduct } | { kind: 'product'; product: PurchasesStoreProduct };
export type PurchaseResult = { status: 'purchased'; entitled: boolean } | { status: 'cancelled' } | { status: 'failed'; message: string };

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
  const purchases = loadPurchases();
  if (!purchases || !configuredUser) return;
  configuredUser = null;
  try {
    await purchases.default.logOut();
  } catch {
    // Already anonymous: nothing to forget.
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
    const result = offer.kind === 'package' ? await purchases.default.purchasePackage(offer.pkg) : await purchases.default.purchaseStoreProduct(offer.product);
    return { status: 'purchased', entitled: Boolean(result.customerInfo.entitlements.active[config.entitlement]) };
  } catch (error) {
    const failure = (error ?? {}) as StoreFailure;
    if (failure.userCancelled || failure.code === purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return { status: 'cancelled' };
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
