import Ionicons from '@expo/vector-icons/Ionicons';
import { requireOptionalNativeModule } from 'expo';
import { useEffect, useState } from 'react';
import { AppState, Image, Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appApi, type AppStatus } from '@/api/app';
import { setUpdateRequiredHandler } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { FormCard } from '@/components/form/FormTheme';
import { t } from '@/i18n';
import { blockAutoPopups } from '@/lib/popupGate';
import { brand, fonts, formPalettes, spacing, typography } from '@/theme/tokens';

/**
 * M195 (owner, 2026-11-04): two messages nobody can miss.
 * 1. «يرجى تحديث التطبيق» — a full-screen cover when the server says this binary is below the floor
 *    (GET /api/app/status at launch and on every return to the foreground, or any 426 answer). Nothing
 *    behind it is usable; the button opens the store.
 * 2. «يرجى إعادة تشغيل التطبيق» — a banner when an OTA update was downloaded but is not running yet
 *    (expo-updates `isUpdatePending`); the button reloads the app. The automatic reload in _layout.tsx
 *    runs first; this covers the cases where it did not take.
 */
export function UpdateGate() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [forced, setForced] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () =>
      appApi
        .status()
        .then((answer) => {
          if (!alive) return;
          setStatus(answer);
          setForced(answer.updateRequired ? answer.message : null);
        })
        .catch(() => undefined);
    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    setUpdateRequiredHandler((message) => setForced(message));
    return () => {
      alive = false;
      sub.remove();
      setUpdateRequiredHandler(null);
    };
  }, []);

  // The cover is a Modal, so it sits above the app's own sheets; the automatic popups stay shut meanwhile.
  useEffect(() => {
    blockAutoPopups(Boolean(forced));
  }, [forced]);

  const hasUpdates = Boolean(requireOptionalNativeModule('ExpoUpdates'));

  if (forced) return <ForcedUpdate message={forced} storeUrls={status?.storeUrls} />;
  return hasUpdates ? <PendingOta /> : null;
}

function ForcedUpdate({ message, storeUrls }: { message: string; storeUrls?: AppStatus['storeUrls'] }) {
  const insets = useSafeAreaInsets();
  // M239: a 426 can raise the cover before the status has answered — the button is there all the same.
  const url = Platform.OS === 'ios' ? (storeUrls?.ios ?? 'https://apps.apple.com/app/id6825963092') : (storeUrls?.android ?? 'https://play.google.com/store/apps/details?id=com.vcmem.investorsclub');
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
    <View style={[styles.cover, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} accessibilityViewIsModal>
      <Image source={require('../../assets/images/club-logo.png')} style={styles.emblem} resizeMode="contain" />
      <FormCard tone="light">
        <View style={styles.row}>
          <Ionicons name="cloud-download-outline" size={26} color={brand.gold} />
          <Text style={styles.title}>{t('update.required.title')}</Text>
        </View>
        <Text style={styles.body}>{message || t('update.required.body')}</Text>
        {url ? <AppButton label={t('update.required.button')} icon="open-outline" onPress={() => void Linking.openURL(url)} /> : null}
      </FormCard>
    </View>
    </Modal>
  );
}

/** Mounted only when the native updates module exists: the hook needs it. */
function PendingOta() {
  const insets = useSafeAreaInsets();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const updates = require('expo-updates') as typeof import('expo-updates');
  const { isUpdatePending } = updates.useUpdates();
  const [dismissed, setDismissed] = useState(false);
  if (!isUpdatePending || dismissed) return null;
  return (
    <View style={[styles.banner, { top: insets.top + spacing.sm }]} accessibilityLiveRegion="polite">
      <Ionicons name="refresh-circle" size={24} color={brand.gold} />
      <View style={styles.bannerText}>
        <Text style={styles.bannerTitle}>{t('update.restart.title')}</Text>
        <Text style={styles.bannerBody}>{t('update.restart.body')}</Text>
      </View>
      <AppButton
        label={t('update.restart.button')}
        onPress={() => {
          setDismissed(true);
          void updates.reloadAsync().catch(() => setDismissed(false));
        }}
        style={styles.bannerButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    flex: 1,
    backgroundColor: formPalettes.light.bg,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  emblem: { width: 120, height: 120, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, color: brand.navy, textAlign: 'center' },
  body: { ...typography.body, color: formPalettes.light.inkSoft, textAlign: 'center' },
  banner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 950,
    elevation: 950,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: brand.gold,
    backgroundColor: brand.navy,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { ...typography.caption, fontFamily: fonts.bold, fontSize: 14, color: brand.gold, textAlign: 'left' },
  bannerBody: { ...typography.caption, color: '#D5DEEB', textAlign: 'left' },
  bannerButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2 },
});
