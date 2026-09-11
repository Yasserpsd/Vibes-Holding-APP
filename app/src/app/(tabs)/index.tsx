import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export default function HomeScreen() {
  const router = useRouter();
  return (
    <PlaceholderScreen title="الرئيسية" description="واجهة النادي: العروض، فرص الشراكة، وخدمات الأعضاء.">
      <View style={styles.links}>
        <HomeLink icon="star" label="المشاريع الذهبية" hint="الشركات التي تحمل علامة V" onPress={() => router.push('/golden')} />
        <HomeLink icon="briefcase" label="بنك المشاريع" hint="تصفّح فرص الشراكة" onPress={() => router.push('/projects')} />
      </View>
    </PlaceholderScreen>
  );
}

type HomeLinkProps = { icon: 'star' | 'briefcase'; label: string; hint: string; onPress: () => void };

function HomeLink({ icon, label, hint, onPress }: HomeLinkProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <Ionicons name={icon} size={24} color={colors.gold} />
      <View style={styles.cardText}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={styles.cardHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  links: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.8 },
  cardText: { flex: 1, gap: 2 },
  cardLabel: { ...typography.subtitle, color: colors.textPrimary },
  cardHint: { ...typography.caption, color: colors.textSecondary },
});
