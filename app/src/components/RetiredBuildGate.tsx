import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { env } from '@/config/env';
import { t } from '@/i18n';
import { colors, fonts, spacing } from '@/theme/tokens';

/** M133b: the smart download link — iPhone → App Store, Android → Google Play, anything else → a page with both. */
const STORE_LINK = 'https://api.vibesholdingsa.com/app';

/**
 * M137 (owner, 2026-10-28: «مش عايز تجريبي، عايز أجبر كله ينزل الرسمي فقط»): the preview build is retired.
 * Every TEST binary (the `.preview` app id, channel `preview`) shows this cover and nothing else: one button
 * to the store app. Production binaries and local dev runs never see it.
 */
export function RetiredBuildGate() {
  if (env.isProduction || __DEV__) return null;
  return (
    <View style={styles.cover}>
      <Image source={require('../../assets/images/club-emblem.png')} style={styles.emblem} resizeMode="contain" />
      <View style={styles.row}>
        <Ionicons name="cloud-download-outline" size={20} color={colors.gold} />
        <Text style={styles.title}>{t('retired.title')}</Text>
      </View>
      <Text style={styles.body}>{t('retired.body')}</Text>
      <AppButton label={t('retired.button')} icon="open-outline" onPress={() => void Linking.openURL(STORE_LINK).catch(() => undefined)} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  emblem: { width: 110, height: 110, opacity: 0.9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28, color: colors.textPrimary, textAlign: 'center' },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 26, color: colors.textSecondary, textAlign: 'center' },
});
