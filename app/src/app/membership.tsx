import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useMembershipContent, type MembershipBenefit } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { MembershipStatusCard } from '@/components/MembershipStatusCard';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// Server content names an icon family; unknown names fall back to a check mark.
const ICONS: Record<string, IoniconName> = {
  megaphone: 'megaphone-outline',
  briefcase: 'briefcase-outline',
  sparkles: 'sparkles-outline',
  people: 'people-outline',
  business: 'business-outline',
  pricetag: 'pricetag-outline',
  cart: 'cart-outline',
};

export default function MembershipScreen() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data, isLoading, error, refetch } = useMembershipContent();

  if (!data) {
    return (
      <Screen>
        <StateView loading={isLoading} error={error} onRetry={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen title={data.title} subtitle={data.intro}>
      <MembershipStatusCard
        membership={status === 'signedIn' ? (me?.membership ?? null) : null}
        texts={data.statusTexts}
        activationNote={data.activationNote}
      />
      {status === 'guest' ? <AppButton label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.push('/auth/login')} /> : null}

      <Text style={styles.section}>مزايا العضوية</Text>
      <View style={styles.list}>
        {data.benefits.map((benefit) => (
          <BenefitRow key={benefit.title} benefit={benefit} />
        ))}
      </View>

      {data.comingSoon.length > 0 ? (
        <>
          <Text style={styles.section}>قريبًا</Text>
          <View style={styles.chips}>
            {data.comingSoon.map((item) => (
              <View key={item} style={styles.chip}>
                <Text style={styles.chipText}>{item}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function BenefitRow({ benefit }: { benefit: MembershipBenefit }) {
  return (
    <View style={styles.benefit}>
      <View style={styles.iconBox}>
        <Ionicons name={ICONS[benefit.icon] ?? 'checkmark-circle-outline'} size={22} color={colors.gold} />
      </View>
      <View style={styles.benefitText}>
        <Text style={styles.benefitTitle}>{benefit.title}</Text>
        {benefit.detail ? <Text style={styles.benefitDetail}>{benefit.detail}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { ...typography.subtitle, color: colors.gold, textAlign: 'right', marginTop: spacing.sm },
  list: { gap: spacing.sm },
  benefit: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  benefitText: { flex: 1, gap: 2 },
  benefitTitle: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
  benefitDetail: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
  },
  chipText: { ...typography.caption, color: colors.goldLight },
});
