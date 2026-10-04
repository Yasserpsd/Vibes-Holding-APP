import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { FadeInView, PopIn } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  text: string;
  /** Guests get a sign-in button; signed-in accounts go to the membership screen. */
  guest: boolean;
};

/** Explains that a screen or service needs an active annual membership — the velvet-rope moment. */
export function LockedNotice({ text, guest }: Props) {
  const router = useRouter();
  return (
    <FadeInView offset={14}>
      <GlassCard golden radius={radii.lg} style={styles.box}>
        <View style={styles.row}>
          <PopIn delay={160}>
            <View style={styles.lockChip}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.goldLight} />
            </View>
          </PopIn>
          <Text style={styles.text}>{text}</Text>
        </View>
        <View style={styles.actions}>
          {guest ? <AppButton label={t('auth.login.title')} icon="log-in-outline" onPress={() => router.push('/auth/login')} /> : null}
          <AppButton label={t('account.benefits')} variant={guest ? 'outline' : 'primary'} icon="ribbon-outline" onPress={() => router.push('/membership')} />
        </View>
      </GlassCard>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: spacing.md,
    padding: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  lockChip: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
  },
  text: { ...typography.body, color: colors.textPrimary, textAlign: textStart, flex: 1 },
  actions: { gap: spacing.sm },
});
