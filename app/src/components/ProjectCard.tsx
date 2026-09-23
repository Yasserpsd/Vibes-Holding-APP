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
    <PressScale onPress={onPress} style={styles.card}>
      <View style={styles.imageBox}>
        {project.image ? (
          <Image source={{ uri: project.image }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imageFallback]}>
            <Ionicons name="briefcase-outline" size={40} color={colors.goldDark} />
          </View>
        )}
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
        <View style={styles.metaRow}>
          {project.sector ? <Text style={styles.tag}>{project.sector.name}</Text> : null}
          <View style={styles.views}>
            <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
            <Text style={styles.viewsText}>{formatNumber(project.viewsCount)}</Text>
          </View>
        </View>
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
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  imageBox: {
    height: 150,
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
  goldenBadge: {
    position: 'absolute',
    top: spacing.sm,
    start: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
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
    maxWidth: '70%',
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(10, 10, 10, 0.78)',
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  stagePillText: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 16,
    color: colors.goldLight,
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
    color: colors.textSecondary,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  views: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginStart: 'auto',
  },
  viewsText: {
    ...typography.caption,
    color: colors.textMuted,
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
