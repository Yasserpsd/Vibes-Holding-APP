import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { AppButton } from '@/components/AppButton';
import { Notice } from '@/components/Notice';
import { t } from '@/i18n';
import { spacing } from '@/theme/tokens';

/** M109i: true when the server refused a booking/registration until the profile is complete. */
export function isProfileGate(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'profile_incomplete';
}

/** The refusal, said nicely, with the «كمّل بياناتك» door straight into the profile editor. */
export function ProfileGateNotice({ text }: { text: string }) {
  const router = useRouter();
  return (
    <View style={styles.box}>
      <Notice tone="warning" text={text} />
      <AppButton label={t('profileGate.cta')} icon="create-outline" onPress={() => router.push('/profile-edit')} />
    </View>
  );
}

const styles = StyleSheet.create({ box: { gap: spacing.sm } });
