import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import type { HomeContent } from '@/api/content';
import { useProjectsWallet } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
import { GlassCard, GoldGradient } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M99c: the investor's wallet — the server writes the words, the PB bridge supplies the live numbers
 * (what is left of his balance and how many projects he opened). A non-member reads the promise and
 * the card walks him to the membership.
 */
export function WalletCard({ block }: { block: NonNullable<HomeContent['wallet']> }) {
  const router = useRouter();
  const { me } = useAuth();
  const wallet = useProjectsWallet(me ? String(me.id) : null);
  const balance = wallet.data?.balance ?? null;
  const total = balance ? balance.credits + balance.granted : 0;
  const member = wallet.data?.isMember === true;
  const onPress = () => router.push((member ? '/projects' : '/membership') as Href);

  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={block.title}>
      <GlassCard golden radius={radii.xl} style={styles.card}>
        <GoldGradient style={styles.icon}>
          <Ionicons name="wallet" size={24} color={colors.goldInk} />
        </GoldGradient>
        <View style={styles.texts}>
          <Text style={styles.title}>{block.title}</Text>
          <Text style={styles.subtitle}>{block.subtitle}</Text>
          {balance ? (
            <View style={styles.statsRow}>
              <Stat value={formatNumber(balance.left)} label={t('wallet.left')} />
              <Stat value={t('wallet.ofTotal', { used: formatNumber(wallet.data?.unlockedCount ?? balance.used), total: formatNumber(total) })} label={t('wallet.opened')} />
            </View>
          ) : null}
          <View style={styles.ctaRow}>
            <Text style={styles.cta}>{member ? block.cta : t('wallet.activate')}</Text>
            <Ionicons name={chevronForward()} size={14} color={colors.gold} />
          </View>
        </View>
      </GlassCard>
    </PressScale>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, marginTop: spacing.sm },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadows.glowGoldFaint,
  },
  texts: { flex: 1, gap: spacing.xs },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
  },
  statValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.goldLight },
  statLabel: { ...typography.caption, fontSize: 11, lineHeight: 16, color: colors.textSecondary },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cta: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.gold },
});
