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
 * M161: slides in under the status bar the moment any request fails (the API client reports it), with one tap
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
        <PressScale style={styles.body} onPress={() => void openSupportWhatsApp(problem)} accessibilityLabel={t('support.banner')}>
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

/** A quiet one-line link to the same support chat, for screens where a member may be stuck (sign-in, the code, the profile). */
export function SupportLink({ problem }: { problem?: string | null }) {
  return (
    <PressScale onPress={() => void openSupportWhatsApp(problem)} accessibilityRole="link" accessibilityLabel={t('support.link')}>
      <View style={styles.linkRow}>
        <Ionicons name="logo-whatsapp" size={16} color={colors.success} />
        <Text style={styles.link}>{t('support.link')}</Text>
        <Text style={styles.linkNumber}>{`‎${SUPPORT_WHATSAPP}`}</Text>
      </View>
    </PressScale>
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
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  texts: { flex: 1, gap: 2 },
  title: { ...typography.caption, color: colors.textPrimary, fontFamily: fonts.semiBold, textAlign: textStart },
  number: { ...typography.caption, color: colors.success, textAlign: textStart },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  link: { ...typography.caption, color: colors.goldLight, textAlign: textStart },
  linkNumber: { ...typography.caption, color: colors.textMuted },
});
