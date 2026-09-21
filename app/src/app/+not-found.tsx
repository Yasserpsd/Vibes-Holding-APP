import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { colors, spacing, typography } from '@/theme/tokens';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: t('notFound.title') }} />
      <View style={styles.container}>
        <Text style={styles.title}>{t('notFound.message')}</Text>
        <Link href="/" style={styles.link}>
          {t('notFound.home')}
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.black,
    gap: spacing.md,
  },
  title: {
    ...typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  link: {
    ...typography.body,
    color: colors.gold,
  },
});
