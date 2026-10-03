import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { GoldenCompany } from '@/api/types';
import { AppButton } from '@/components/AppButton';
import { t } from '@/i18n';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  company: GoldenCompany;
};

export function GoldenCompanyCard({ company }: Props) {
  const router = useRouter();
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
      {/* §5.1: the offer opens as a native page in the app, never in the browser. */}
      <AppButton label={t('golden.offerPage')} variant="outline" icon="reader-outline" onPress={() => router.push(`/golden/${company.code}`)} />
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
});
