import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { authApi } from '@/api/auth';
import { AppButton } from '@/components/AppButton';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M117: the 30-day deletion countdown (owner: «يوصله عداد مدته 30 يوم») — a warning band at the
 * top of حسابي for the whole grace window, with the «تراجع عن الحذف» door right inside it.
 */
export function DeletionBanner({ account }: { account: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['delete-state', account],
    queryFn: () => authApi.deleteState(),
    staleTime: 60_000,
    retry: false,
  });
  const scheduled = query.data?.scheduled ?? null;
  if (!scheduled) return null;

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await authApi.deleteCancel();
      await queryClient.invalidateQueries({ queryKey: ['delete-state'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.band}>
      <View style={styles.row}>
        <Ionicons name="hourglass-outline" size={20} color={colors.warning} />
        <Text style={styles.text}>{t('deleteAccount.countdown', { days: String(scheduled.daysLeft) })}</Text>
      </View>
      <AppButton label={t('deleteAccount.cancel')} variant="outline" icon="arrow-undo-outline" loading={busy} onPress={() => void cancel()} />
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: 'rgba(214, 158, 46, 0.08)',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  text: { ...typography.caption, fontSize: 14, lineHeight: 22, fontFamily: fonts.semiBold, color: colors.warning, flex: 1, textAlign: textStart },
});
