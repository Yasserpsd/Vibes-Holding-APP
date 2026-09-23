import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useGuide, type GuideStep } from '@/api/guide';
import { AppButton } from '@/components/AppButton';
import { entranceDelay, FadeInView } from '@/components/motion';
import { Screen } from '@/components/Screen';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M10 «دليل المحايد» (owner: «المحايد عندي رقم 1»): the neutral's road inside the club —
 * steps with in-app calls to action, the neutral's benefits, and the workshops door.
 * Every word comes from the server block `content:guide` (dashboard-editable).
 */
export default function GuideScreen() {
  const router = useRouter();
  const guide = useGuide();
  const data = guide.data;

  const open = (step: GuideStep, nonce: string) => {
    switch (step.target) {
      case 'workshops':
        router.push('/workshops' as Href);
        return;
      case 'projects':
        router.push('/projects');
        return;
      case 'membership':
        router.push('/membership');
        return;
      default:
        router.push({ pathname: '/advisor', params: { ctxType: 'portal', ctxId: 'neutral', ctxTitle: step.title, ctxNonce: nonce } });
    }
  };

  return (
    <Screen title={data?.title} subtitle={data?.intro}>
      <Stack.Screen options={{ title: t('nav.guide') }} />
      {!data ? (
        <StateView loading={guide.isLoading} error={guide.error} onRetry={() => void guide.refetch()} />
      ) : (
        <>
          {data.steps.map((step, index) => (
            <FadeInView key={step.key} delay={entranceDelay(index, 90)} style={styles.step}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNumber}>{index + 1}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepText}>{step.text}</Text>
                <AppButton label={step.cta} variant={index === 0 ? 'primary' : 'outline'} onPress={() => open(step, String(Date.now()))} />
              </View>
            </FadeInView>
          ))}

          <FadeInView delay={420} style={styles.benefits}>
            <Text style={styles.benefitsTitle}>{data.benefitsTitle}</Text>
            {data.benefits.map((benefit) => (
              <View key={benefit} style={styles.benefitRow}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.gold} />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </FadeInView>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNumber: { color: colors.gold, fontFamily: fonts.bold, fontSize: 16 },
  stepBody: { flex: 1, gap: spacing.sm },
  stepTitle: { ...typography.subtitle, color: colors.textPrimary, textAlign: textStart },
  stepText: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  benefits: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  benefitsTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  benefitText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: textStart },
});
