import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useGolden } from '@/api/queries';
import { useAdvisorScreen, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GoldenCompanyCard } from '@/components/GoldenCompanyCard';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, Sheen, useCountUp } from '@/components/motion';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { formatMillionsSar } from '@/lib/format';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

export default function GoldenScreen() {
  const router = useRouter();
  const query = useGolden();
  const content = query.data;
  useAdvisorScreen({ type: 'screen', id: 'golden', title: content?.title ?? t('nav.golden') });
  // Keeps the disclaimer at the end clear of the floating «اسأل المستشار» button.
  const clearance = useAskAdvisorClearance();
  // V2: the portfolio number counts up to its value — measured, not pasted.
  const portfolioShown = useCountUp(content?.portfolioValueSarMillions ?? 0);
  // The hero's metal sheen sweeps the card's rendered size.
  const [heroSize, setHeroSize] = useState({ width: 0, height: 0 });

  if (!content) {
    return (
      <View style={styles.screen}>
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      </View>
    );
  }

  const companies = [...content.companies].sort((a, b) => a.order - b.order);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
      <FadeInView offset={12}>
        <GlassCard golden radius={radii.xl} style={styles.heroCard}>
          <View
            style={styles.hero}
            onLayout={({ nativeEvent: { layout } }) => {
              const width = Math.round(layout.width);
              const height = Math.round(layout.height);
              setHeroSize((size) => (size.width === width && size.height === height ? size : { width, height }));
            }}
          >
            <View style={styles.logoBox}>
              <Image
                source={{ uri: content.umbrella.logoUrl }}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel={content.umbrella.name}
              />
            </View>
            <Text style={styles.heroTitle}>{content.umbrella.name}</Text>
            <Text style={styles.intro}>{content.intro}</Text>
            <View style={styles.valueBadge}>
              <Text style={styles.valueLabel}>{t('golden.portfolioValue')}</Text>
              <Text style={styles.valueText}>{formatMillionsSar(portfolioShown)}</Text>
            </View>
            {/* §5.1: the umbrella's offer opens as a native page in the app, never in the browser. */}
            <AppButton label={t('golden.vibesPage')} icon="reader-outline" onPress={() => router.push(`/golden/${content.umbrella.code}`)} />
          </View>
          {heroSize.width > 0 ? <Sheen width={heroSize.width} height={heroSize.height} /> : null}
        </GlassCard>
      </FadeInView>

      {companies.map((company, index) => (
        <FadeInView key={company.code} delay={140 + entranceDelay(index, 70)}>
          <GoldenCompanyCard company={company} />
        </FadeInView>
      ))}

      <Text style={styles.disclaimer}>{content.disclaimer}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md },
  // The portfolio hero earns the full golden halo; the company cards below keep the faint one.
  heroCard: { boxShadow: shadows.glowGold },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  logoBox: {
    width: 120,
    height: 120,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.white,
  },
  logo: { width: '100%', height: '100%' },
  heroTitle: { ...typography.title, color: colors.gold, textAlign: 'center' },
  intro: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  valueBadge: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldSoft,
  },
  valueLabel: { ...typography.caption, color: colors.textMuted },
  valueText: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 28, color: colors.goldLight },
  disclaimer: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.md },
});
