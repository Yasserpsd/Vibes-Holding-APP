import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  text: string;
  /** Guests get a sign-in button; signed-in accounts go to the membership screen. */
  guest: boolean;
};

/** Explains that a screen or service needs an active annual membership. */
export function LockedNotice({ text, guest }: Props) {
  const router = useRouter();
  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Ionicons name="lock-closed-outline" size={22} color={colors.goldLight} />
        <Text style={styles.text}>{text}</Text>
      </View>
      <View style={styles.actions}>
        {guest ? <AppButton label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.push('/auth/login')} /> : null}
        <AppButton label="مزايا العضوية" variant={guest ? 'outline' : 'primary'} icon="ribbon-outline" onPress={() => router.push('/membership')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  text: { ...typography.body, color: colors.textPrimary, textAlign: 'right', flex: 1 },
  actions: { gap: spacing.sm },
});
