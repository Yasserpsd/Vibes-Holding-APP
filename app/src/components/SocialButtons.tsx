import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { authApi, useAuthConfig } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { availableSocialProvider, socialSignIn } from '@/auth/social';
import { AppButton } from '@/components/AppButton';
import { t } from '@/i18n';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * M46: the one-tap sign-in block — Google on Android, Apple on iOS. Rendered only when this
 * binary has the native module AND the server announces the provider (auth config `social`),
 * so OTA updates on older binaries and unconfigured servers both simply hide it.
 */
export function SocialButtons({ onError }: { onError: (message: string) => void }) {
  const router = useRouter();
  const { signIn } = useAuth();
  const { data: config } = useAuthConfig();
  const [busy, setBusy] = useState(false);
  const provider = availableSocialProvider(config?.social);
  if (!provider) return null;

  const press = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await socialSignIn(provider);
      if (!result.ok) {
        if (!result.cancelled) onError(t('auth.social.failed'));
        return;
      }
      const signedIn = await authApi.social(result.provider, result.token, result.name || undefined);
      await signIn(signedIn.token, signedIn.me);
      if (router.canDismiss()) router.dismissAll();
      else router.replace('/account');
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <AppButton
        label={busy ? t('auth.login.busy') : t(provider === 'google' ? 'auth.social.google' : 'auth.social.apple')}
        icon={provider === 'google' ? 'logo-google' : 'logo-apple'}
        variant="outline"
        onPress={() => void press()}
      />
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>{t('auth.social.or')}</Text>
        <View style={styles.line} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  or: { ...typography.caption, color: colors.textMuted },
});
