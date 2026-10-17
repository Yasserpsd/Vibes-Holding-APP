import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { authApi } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { GlassCard } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Choice = 'entrepreneur' | 'investor';

/**
 * M74 (owner): the neutral's gentle standing card — «هل حددت وجهتك؟». One tap switches his category
 * to رائد أعمال or مستثمر from inside the app; the hub stores it and the whole app reshapes itself.
 */
export function PersonaSwitchCard() {
  const { me, setMe } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!me || me.persona !== 'neutral') return null;

  const choose = (persona: Choice) => {
    const label = persona === 'entrepreneur' ? t('home.destination.entrepreneur') : t('home.destination.investor');
    Alert.alert(t('home.destination.confirmTitle'), t('home.destination.confirmText', { label }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('home.destination.confirm'),
        onPress: () => {
          setBusy(true);
          authApi
            .updateMe({ persona })
            .then(({ me: updated }) => {
              setMe(updated);
              Alert.alert(t('home.destination.doneTitle'), t('home.destination.doneText'));
            })
            .catch((error: unknown) => {
              Alert.alert(t('home.destination.errorTitle'), errorMessage(error));
            })
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <GlassCard golden radius={radii.xl} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconRing}>
          <Ionicons name="compass-outline" size={22} color={colors.gold} />
        </View>
        <Text style={styles.title}>{t('home.destination.title')}</Text>
      </View>
      <Text style={styles.text}>{t('home.destination.text')}</Text>
      <View style={styles.choices}>
        <ChoiceChip icon="rocket-outline" label={t('home.destination.entrepreneur')} disabled={busy} onPress={() => choose('entrepreneur')} />
        <ChoiceChip icon="trending-up-outline" label={t('home.destination.investor')} disabled={busy} onPress={() => choose('investor')} />
      </View>
      <Text style={styles.hint}>{t('home.destination.hint')}</Text>
    </GlassCard>
  );
}

function ChoiceChip({ icon, label, disabled, onPress }: { icon: 'rocket-outline' | 'trending-up-outline'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <PressScale onPress={disabled ? undefined : onPress} glow glowRadius={radii.lg} wrapStyle={styles.choiceWrap} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.choice, disabled && styles.choiceDisabled]}>
        <Ionicons name={icon} size={20} color={colors.gold} />
        <Text style={styles.choiceLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconRing: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
  },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 28, color: colors.gold, textAlign: textStart, flex: 1 },
  text: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  choices: { flexDirection: 'row', gap: spacing.sm },
  choiceWrap: { flex: 1 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surface,
  },
  choiceDisabled: { opacity: 0.5 },
  choiceLabel: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.textPrimary },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
});
