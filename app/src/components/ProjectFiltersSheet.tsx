import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { FilterOption } from '@/api/types';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { GoldHairline } from '@/components/lux';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  open: boolean;
  onClose: () => void;
  sectors: FilterOption[];
  stages: FilterOption[];
  sector: string | undefined;
  stage: string | undefined;
  onSector: (slug: string | undefined) => void;
  onStage: (slug: string | undefined) => void;
  /** Live count of the current selection (the list query answers while the sheet is open). */
  total: number | undefined;
};

/**
 * The sector/stage filters in one bottom sheet (they used to be two chip rows crowding the header).
 * Choices apply immediately — the count on the button follows the live query.
 */
export function ProjectFiltersSheet({ open, onClose, sectors, stages, sector, stage, onSector, onStage, total }: Props) {
  const active = Boolean(sector || stage);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.grabber} />
          <View style={styles.titleRow}>
            <Ionicons name="options-outline" size={18} color={colors.gold} />
            <Text style={styles.title}>{t('projects.filterTitle')}</Text>
            {active ? (
              <Pressable onPress={() => (onSector(undefined), onStage(undefined))} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.clear}>{t('projects.filterClear')}</Text>
              </Pressable>
            ) : null}
          </View>
          <GoldHairline />
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.sectionTitle}>{t('projects.filterSector')}</Text>
            <View style={styles.chips}>
              <Chip label={t('projects.allSectors')} selected={!sector} onPress={() => onSector(undefined)} />
              {sectors.map((option) => (
                <Chip
                  key={option.slug}
                  label={`${option.name} (${formatNumber(option.count)})`}
                  selected={sector === option.slug}
                  onPress={() => onSector(sector === option.slug ? undefined : option.slug)}
                />
              ))}
            </View>
            {stages.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{t('projects.filterStage')}</Text>
                <View style={styles.chips}>
                  <Chip label={t('projects.allStages')} selected={!stage} onPress={() => onStage(undefined)} />
                  {stages.map((option) => (
                    <Chip
                      key={option.slug}
                      label={`${option.name} (${formatNumber(option.count)})`}
                      selected={stage === option.slug}
                      onPress={() => onStage(stage === option.slug ? undefined : option.slug)}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
          <AppButton
            label={typeof total === 'number' ? `${t('projects.filterDone')} — ${t('projects.count', { count: formatNumber(total) })}` : t('projects.filterDone')}
            icon="checkmark-outline"
            onPress={onClose}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '80%',
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.lg,
    borderTopStartRadius: radii.xl,
    borderTopEndRadius: radii.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
  },
  grabber: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.gold, flex: 1, textAlign: textStart },
  clear: { ...typography.caption, color: colors.textMuted, textDecorationLine: 'underline' },
  body: { flexGrow: 0 },
  bodyContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  sectionTitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart, marginTop: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
