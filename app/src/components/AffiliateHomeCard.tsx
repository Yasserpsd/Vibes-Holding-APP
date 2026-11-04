import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAffiliate } from '@/api/affiliate';
import { useAuth } from '@/auth/AuthProvider';
import { GlassCard, GoldGradient } from '@/components/lux';
import { FadeInView, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M194 (owner, 2026-11-04): «أرباحي» — the very first card on an APPROVED affiliate's home. Balance,
 * paying / non-paying referrals, and a nudge while nobody paid yet; it opens the affiliate panel.
 * Everyone else (no application, pending, rejected, guest) sees nothing.
 */
export function AffiliateHomeCard() {
  const router = useRouter();
  const { status } = useAuth();
  const affiliate = useAffiliate(status === 'signedIn');
  const data = affiliate.data;
  const balance = data?.status === 'approved' ? data.balance : undefined;
  if (!balance) return null;
  const subtitle = balance.paid === 0 ? t('affiliate.homeNudge') : t('affiliate.homeEarned', { amount: formatNumber(balance.earned) });

  return (
    <FadeInView delay={120}>
      <PressScale onPress={() => router.push('/affiliate' as Href)} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={t('affiliate.homeTitle')}>
        <GlassCard golden radius={radii.xl} style={styles.card}>
          <GoldGradient style={styles.icon}>
            <Ionicons name="cash" size={24} color={colors.goldInk} />
          </GoldGradient>
          <View style={styles.texts}>
            <Text style={styles.title}>{t('affiliate.homeTitle')}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            <View style={styles.statsRow}>
              <Stat value={formatNumber(balance.available)} label={t('affiliate.homeAvailable')} />
              <Stat value={formatNumber(balance.paid)} label={t('affiliate.paidCount')} />
              <Stat value={formatNumber(balance.unpaid)} label={t('affiliate.unpaidCount')} />
            </View>
            <View style={styles.ctaRow}>
              <Text style={styles.cta}>{t('affiliate.homeOpen')}</Text>
              <Ionicons name={chevronForward()} size={14} color={colors.gold} />
            </View>
          </View>
        </GlassCard>
      </PressScale>
    </FadeInView>
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
