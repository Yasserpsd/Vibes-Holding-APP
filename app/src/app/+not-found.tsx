import { Stack, useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmblemWatermark, GoldHairline } from '@/components/lux';
import { FadeInView } from '@/components/motion';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { colors, spacing, typography } from '@/theme/tokens';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: t('notFound.title') }} />
      <View style={styles.container}>
        <EmblemWatermark />
        <FadeInView style={styles.body}>
          <Text style={styles.title}>{t('notFound.message')}</Text>
          <GoldHairline style={styles.hairline} />
          {/* Same destination as the old bare link — Link's default is a navigate. */}
          <AppButton label={t('notFound.home')} icon="home-outline" onPress={() => router.navigate('/')} />
        </FadeInView>
      </View>
    </>
  );
}

const styles = themedStyles(() => ({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.black,
  },
  body: {
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    ...typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  hairline: {
    width: 72,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
}));
