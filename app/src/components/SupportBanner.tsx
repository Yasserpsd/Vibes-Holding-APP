import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { onProblem, openSupportWhatsApp, SUPPORT_WHATSAPP } from '@/lib/support';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const SHOW_MS = 12_000;

/**
 * M161: slides in under the status bar only for a real breakdown (offline, timed out, server failure, unexpected error —
 * see errorMessage in api/client.ts); hidden otherwise, with one tap
 * to the owner's direct WhatsApp support line. Mounted once in the root layout, above every screen.
 */
export function SupportBanner() {
  const insets = useSafeAreaInsets();
  const [problem, setProblem] = useState<string | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => onProblem((text) => setProblem(text || t('support.unknownProblem'))), []);

  useEffect(() => {
    if (problem === null) return;
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => setProblem(null));
    }, SHOW_MS);
    return () => clearTimeout(timer);
  }, [problem, opacity]);

  if (problem === null) return null;
  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + spacing.sm, opacity }]}>
      <View style={styles.card}>
        <PressScale wrapStyle={styles.grow} style={styles.body} onPress={() => void openSupportWhatsApp(problem)} accessibilityLabel={t('support.banner')}>
          <Ionicons name="logo-whatsapp" size={22} color={colors.success} />
          <View style={styles.texts}>
            <Text style={styles.title}>{t('support.banner')}</Text>
            <Text style={styles.number}>{`‎${SUPPORT_WHATSAPP}`}</Text>
          </View>
        </PressScale>
        <Pressable onPress={() => setProblem(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('support.dismiss')}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}


const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.md, right: spacing.md, zIndex: 50, elevation: 50 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  grow: { flex: 1 },
  body: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  texts: { flex: 1, gap: 2 },
  title: { ...typography.caption, color: colors.textPrimary, fontFamily: fonts.semiBold, textAlign: textStart },
  number: { ...typography.caption, color: colors.success, textAlign: textStart },
});
