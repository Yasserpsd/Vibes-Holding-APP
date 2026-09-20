import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useGolden } from '@/api/queries';
import { useAdvisorScreen, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GoldenCompanyCard } from '@/components/GoldenCompanyCard';
import { StateView } from '@/components/StateView';
import { formatMillionsSar } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

export default function GoldenScreen() {
  const query = useGolden();
  const content = query.data;
  useAdvisorScreen({ type: 'screen', id: 'golden', title: content?.title ?? 'المشاريع الذهبية' });
  // Keeps the disclaimer at the end clear of the floating «اسأل المستشار» button.
  const clearance = useAskAdvisorClearance();

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
      <View style={styles.hero}>
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
          <Text style={styles.valueLabel}>قيمة المحفظة</Text>
          <Text style={styles.valueText}>{formatMillionsSar(content.portfolioValueSarMillions)}</Text>
        </View>
        <AppButton label="صفحة عرض فايبز القابضة" icon="open-outline" onPress={() => openLink(content.umbrella.offerUrl)} />
      </View>

      {companies.map((company) => (
        <GoldenCompanyCard key={company.code} company={company} />
      ))}

      <Text style={styles.disclaimer}>{content.disclaimer}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md },
  hero: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surfaceElevated,
  },
  valueLabel: { ...typography.caption, color: colors.textMuted },
  valueText: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 28, color: colors.goldLight },
  disclaimer: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.md },
});
