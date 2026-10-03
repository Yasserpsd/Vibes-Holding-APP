import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { PublicProject } from '@/api/types';
import { PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  project: PublicProject;
  onPress: () => void;
  /** M35: «تواصل مع المؤسس» straight from the list; the page then walks the unlock (rule 4 intact). */
  onContact?: () => void;
};

export function ProjectCard({ project, onPress, onContact }: Props) {
  return (
    <PressScale onPress={onPress} style={[styles.card, project.isGolden && styles.cardGolden]}>
      <View style={styles.imageBox}>
        {project.image ? (
          <Image source={{ uri: project.image }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imageFallback]}>
            <Ionicons name="briefcase-outline" size={40} color={colors.goldDark} />
          </View>
        )}
        {/* A soft scrim keeps the pills readable over any image. */}
        <View style={styles.scrim} />
        {project.isGolden ? (
          <View style={styles.goldenBadge}>
            <Ionicons name="star" size={12} color={colors.black} />
            <Text style={styles.goldenText}>{t('project.goldenBadge')}</Text>
          </View>
        ) : null}
        {project.stage ? (
          <View style={styles.stagePill}>
            <Text style={styles.stagePillText} numberOfLines={1}>
              {project.stage.name}
            </Text>
          </View>
        ) : null}
        <View style={styles.viewsPill}>
          <Ionicons name="eye-outline" size={13} color={colors.goldLight} />
          <Text style={styles.viewsText}>{formatNumber(project.viewsCount)}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {project.title}
        </Text>
        {project.companyName ? (
          <Text style={styles.company} numberOfLines={1}>
            {project.companyName}
          </Text>
        ) : null}
        {project.excerpt ? (
          <Text style={styles.excerpt} numberOfLines={2}>
            {project.excerpt}
          </Text>
        ) : null}
        {project.sector ? (
          <View style={styles.metaRow}>
            <Text style={styles.tag} numberOfLines={1}>
              {project.sector.name}
            </Text>
          </View>
        ) : null}
        {!project.isGolden && onContact ? (
          <PressScale onPress={onContact} style={styles.contactCta} accessibilityLabel={t('project.contactCta')}>
            <Ionicons name="chatbubbles-outline" size={16} color={colors.black} />
            <Text style={styles.contactCtaText}>{t('project.contactCta')}</Text>
          </PressScale>
        ) : null}
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  // The golden projects wear the brand: a gold hairline over a faint gold wash.
  cardGolden: {
    borderColor: colors.goldDark,
    backgroundColor: '#1A160D',
  },
  imageBox: {
    height: 168,
    backgroundColor: colors.surfaceElevated,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 56,
    backgroundColor: 'rgba(8, 8, 8, 0.35)',
  },
  goldenBadge: {
    position: 'absolute',
    top: spacing.sm,
    start: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
  goldenText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    lineHeight: 16,
    color: colors.black,
  },
  stagePill: {
    position: 'absolute',
    bottom: spacing.sm,
    start: spacing.sm,
    maxWidth: '60%',
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  stagePillText: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 16,
    color: colors.goldLight,
  },
  viewsPill: {
    position: 'absolute',
    bottom: spacing.sm,
    end: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.overlay,
  },
  body: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  title: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  company: {
    ...typography.caption,
    fontFamily: fonts.medium,
    color: colors.goldLight,
  },
  excerpt: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  tag: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 18,
    color: colors.goldLight,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.goldSoft,
    alignSelf: 'flex-start',
  },
  viewsText: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 16,
    color: colors.goldLight,
  },
  contactCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.gold,
  },
  contactCtaText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    lineHeight: 20,
    color: colors.black,
  },
});
