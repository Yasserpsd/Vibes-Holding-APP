import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PublicProject } from '@/api/types';
import { formatNumber } from '@/lib/format';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  project: PublicProject;
  onPress: () => void;
};

export function ProjectCard({ project, onPress }: Props) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {project.image ? (
        <Image source={{ uri: project.image }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imageFallback]}>
          <Ionicons name="briefcase-outline" size={28} color={colors.goldDark} />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {project.title}
          </Text>
          {project.isGolden ? (
            <View style={styles.goldenBadge}>
              <Ionicons name="star" size={12} color={colors.black} />
              <Text style={styles.goldenText}>ذهبي</Text>
            </View>
          ) : null}
        </View>
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
          {project.stage ? <Text style={styles.tag}>{project.stage.name}</Text> : null}
          <View style={styles.views}>
            <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
            <Text style={styles.viewsText}>{formatNumber(project.viewsCount)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.8,
  },
  image: {
    width: 84,
    height: 84,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    ...typography.subtitle,
    flex: 1,
    color: colors.textPrimary,
  },
  goldenBadge: {
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
});
