import { Image, StyleSheet, Text, View } from 'react-native';

import type { GoldenCompany } from '@/api/types';
import { AppButton } from '@/components/AppButton';
import { t } from '@/i18n';
import { formatMillionsSar } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  company: GoldenCompany;
};

export function GoldenCompanyCard({ company }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.logoBox}>
          <Image source={{ uri: company.logoUrl }} style={styles.logo} resizeMode="contain" accessibilityLabel={company.name} />
        </View>
        <View style={styles.titles}>
          <Text style={styles.code}>{company.code}</Text>
          <Text style={styles.name}>{company.name}</Text>
          {company.tagline ? <Text style={styles.tagline}>{company.tagline}</Text> : null}
        </View>
      </View>
      {company.valuationSarMillions !== null ? (
        <View style={styles.valuationRow}>
          <Text style={styles.valuationLabel}>{t('golden.valuation')}</Text>
          <Text style={styles.valuationValue}>{formatMillionsSar(company.valuationSarMillions)}</Text>
        </View>
      ) : null}
      <AppButton label={t('golden.offerPage')} variant="outline" icon="open-outline" onPress={() => openLink(company.offerUrl)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logoBox: {
    width: 72,
    height: 72,
    padding: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.white,
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  code: {
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.gold,
  },
  name: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  tagline: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  valuationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  valuationLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  valuationValue: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.goldLight,
  },
});
