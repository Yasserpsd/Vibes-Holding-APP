import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HomePortal } from '@/api/content';
import { GlassCard, GoldGradient } from '@/components/lux';
import { PressScale, Sheen } from '@/components/motion';
import { chevronForward, textStart } from '@/i18n/direction';
import { iconFor } from '@/lib/icons';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = { portal: HomePortal; onPress: () => void };

/** One of the three home portals: a golden glass card with a gradient icon medallion and a sheen. */
export function PortalCard({ portal, onPress }: Props) {
  // The card measures itself so the light band sweeps its full width.
  const [size, setSize] = useState({ width: 0, height: 0 });
  return (
    <View onLayout={(event) => setSize(event.nativeEvent.layout)}>
      <PressScale onPress={onPress} glow glowRadius={radii.lg}>
        <GlassCard golden style={styles.card}>
          {size.width > 0 ? <Sheen width={size.width} height={size.height} /> : null}
          <View style={styles.accent} />
          <GoldGradient style={styles.iconBox}>
            <Ionicons name={iconFor(portal.icon, 'grid-outline')} size={28} color={colors.goldInk} />
          </GoldGradient>
          <View style={styles.texts}>
            <Text style={styles.title}>{portal.title}</Text>
            <Text style={styles.subtitle}>{portal.subtitle}</Text>
          </View>
          <Ionicons name={chevronForward()} size={22} color={colors.gold} />
        </GlassCard>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.md,
    paddingStart: spacing.md + 6,
  },
  // The lit filament on the start edge: part of the portal identity since V1, now glowing.
  accent: { position: 'absolute', start: 0, top: 0, bottom: 0, width: 5, backgroundColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGoldFaint,
  },
  texts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 28, color: colors.textPrimary, textAlign: textStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
});
