import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ScrollView, Text, View } from 'react-native';

import type { FilterOption } from '@/api/types';
import { FadeInView, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Keyword → icon, matched on the sector's name in either language (the site may add sectors;
// an unknown one gets the generic tag). Order matters: the more specific words come first.
const SECTOR_ICONS: { words: string[]; icon: IconName }[] = [
  { words: ['السيبراني', 'cyber'], icon: 'shield-checkmark-outline' },
  { words: ['الإلكترونية', 'e-commerce'], icon: 'cart-outline' },
  { words: ['المالية', 'fintech', 'financ'], icon: 'card-outline' },
  { words: ['البرمجيات', 'التكنولوجيا والبرمجيات', 'software'], icon: 'code-slash-outline' },
  { words: ['تقنية المعلومات', 'information'], icon: 'hardware-chip-outline' },
  { words: ['التجزئة', 'retail', 'trade'], icon: 'storefront-outline' },
  { words: ['اللوجستية', 'النقل', 'logistic'], icon: 'cube-outline' },
  { words: ['الصحة', 'health'], icon: 'medkit-outline' },
  { words: ['الصناعة', 'التصنيع', 'industr', 'manufactur'], icon: 'construct-outline' },
  { words: ['الغذاء', 'المشروبات', 'food'], icon: 'restaurant-outline' },
  { words: ['التعليم', 'التدريب', 'educat'], icon: 'school-outline' },
  { words: ['السياحة', 'الضيافة', 'touris'], icon: 'airplane-outline' },
  { words: ['الاستشارات', 'consult'], icon: 'briefcase-outline' },
  { words: ['الترفيه', 'الإعلام', 'entertain', 'media'], icon: 'film-outline' },
  { words: ['العقار', 'العمراني', 'real estate'], icon: 'business-outline' },
  { words: ['الطاقة', 'الاستدامة', 'energy'], icon: 'flash-outline' },
  { words: ['الزراعة', 'agricult'], icon: 'leaf-outline' },
  { words: ['أخرى', 'اخرى', 'other'], icon: 'ellipsis-horizontal-circle-outline' },
];

export function sectorIcon(name: string): IconName {
  const lower = name.toLowerCase();
  return SECTOR_ICONS.find((entry) => entry.words.some((word) => lower.includes(word)))?.icon ?? 'pricetag-outline';
}

type Props = {
  sectors: FilterOption[];
  sector: string | undefined;
  onSector: (slug: string | undefined) => void;
  /** All projects in the bank (the «كل القطاعات» tile's count). */
  total: number | undefined;
};

/**
 * Owner, 2026-11-10 («الفلترة تكون واضحة جدا … عيان بيان»): the sectors sit on the screen itself as a
 * titled row of icon tiles with their counts, instead of hiding inside the «فلترة» sheet.
 * The chosen tile turns shiny gold and its siblings fade, like the M102 pills.
 */
export function SectorStrip({ sectors, sector, onSector, total }: Props) {
  if (sectors.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Ionicons name="grid-outline" size={16} color={colors.gold} />
        <Text style={styles.title}>{t('projects.sectorsTitle')}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Tile icon="apps-outline" name={t('projects.allSectors')} count={total} selected={!sector} dimmed={false} onPress={() => onSector(undefined)} />
        {sectors.map((option) => (
          <Tile
            key={option.slug}
            icon={sectorIcon(option.name)}
            name={option.name}
            count={option.count}
            selected={sector === option.slug}
            dimmed={Boolean(sector) && sector !== option.slug}
            onPress={() => onSector(sector === option.slug ? undefined : option.slug)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** The banner under the strip while a sector is chosen: what is shown, how many, and the way back. */
export function ActiveSectorBanner({ option, total, onClear }: { option: FilterOption; total: number | undefined; onClear: () => void }) {
  return (
    <FadeInView offset={6}>
      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <Ionicons name={sectorIcon(option.name)} size={18} color={colors.goldInk} />
        </View>
        <View style={styles.bannerText}>
          <Text style={styles.bannerTitle} numberOfLines={2}>
            {t('projects.showingSector', { name: option.name })}
          </Text>
          {typeof total === 'number' ? <Text style={styles.bannerCount}>{t('projects.count', { count: formatNumber(total) })}</Text> : null}
        </View>
        <PressScale onPress={onClear} accessibilityRole="button" accessibilityLabel={t('projects.clearSector')} hitSlop={8} style={styles.bannerClear}>
          <Ionicons name="close" size={14} color={colors.goldLight} />
          <Text style={styles.bannerClearText}>{t('projects.clearSector')}</Text>
        </PressScale>
      </View>
    </FadeInView>
  );
}

type TileProps = { icon: IconName; name: string; count: number | undefined; selected: boolean; dimmed: boolean; onPress: () => void };

function Tile({ icon, name, count, selected, dimmed, onPress }: TileProps) {
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      style={[styles.tile, selected && styles.tileSelected, dimmed && styles.tileDimmed]}
    >
      <View style={[styles.iconCircle, selected && styles.iconCircleSelected]}>
        <Ionicons name={icon} size={20} color={selected ? colors.goldInk : colors.gold} />
      </View>
      <Text style={[styles.name, selected && styles.nameSelected]} numberOfLines={2}>
        {name}
      </Text>
      {typeof count === 'number' ? <Text style={[styles.count, selected && styles.countSelected]}>{formatNumber(count)}</Text> : null}
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  wrap: { gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.gold, textAlign: textStart },
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  tile: {
    width: 96,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surface,
  },
  tileSelected: {
    borderColor: colors.goldLight,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGold,
  },
  tileDimmed: { opacity: 0.5 },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldFaint,
  },
  iconCircleSelected: { backgroundColor: 'rgba(20,16,5,0.14)' },
  name: { ...typography.caption, fontSize: 12, lineHeight: 17, minHeight: 34, color: colors.textPrimary, textAlign: 'center' },
  nameSelected: { fontFamily: fonts.bold, color: colors.goldInk },
  count: { ...typography.caption, fontSize: 12, lineHeight: 16, fontFamily: fonts.medium, color: colors.goldLight },
  countSelected: { color: colors.goldInk },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.goldFaint,
  },
  bannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  bannerCount: { ...typography.caption, fontSize: 12, color: colors.goldLight, textAlign: textStart },
  bannerClear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
  bannerClearText: { ...typography.caption, fontSize: 12, color: colors.goldLight },
}));
