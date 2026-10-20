import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import type { PublicProject } from '@/api/types';
import { GlassCard } from '@/components/lux';
import { PressScale, Sheen } from '@/components/motion';
import { StarsRow } from '@/components/Stars';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = {
  project: PublicProject;
  onPress: () => void;
  /** M35: «تواصل مع المؤسس» straight from the list; the page then walks the unlock (rule 4 intact). */
  onContact?: () => void;
};

/** Fixed image strip height; the sheen only needs the measured width. */
const IMAGE_HEIGHT = 168;

export function ProjectCard({ project, onPress, onContact }: Props) {
  // The cover fades in once it arrives instead of popping over the dark surface.
  const [imageOpacity] = useState(() => new Animated.Value(0));
  const [imageWidth, setImageWidth] = useState(0);
  // M107b: a cover that errors out hands the box to the fallback instead of staying a dark hole.
  const [imageBroken, setImageBroken] = useState(false);
  // M109h: a recycled card keeps its state — a NEW cover url gets a fresh try instead of the
  // previous project's latched failure (reset during render, the React way for derived state).
  const [brokenFor, setBrokenFor] = useState(project.image);
  if (brokenFor !== project.image) {
    setBrokenFor(project.image);
    setImageBroken(false);
    imageOpacity.setValue(0);
  }
  const golden = project.isGolden;
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl}>
      <GlassCard golden={golden} radius={radii.xl} style={golden ? styles.cardGolden : null}>
        <View style={styles.imageBox} onLayout={(event) => setImageWidth(event.nativeEvent.layout.width)}>
          {project.image && !imageBroken ? (
            <Animated.Image
              source={{ uri: project.image }}
              style={[styles.image, { opacity: imageOpacity }]}
              resizeMode="cover"
              // Android decodes at the card's size instead of the photo's (perf, owner 2026-10-20).
              resizeMethod="resize"
              onLoad={() => Animated.timing(imageOpacity, { toValue: 1, duration: 320, useNativeDriver: true }).start()}
              onError={() => setImageBroken(true)}
            />
          ) : (
            <View style={[styles.image, styles.imageFallback]}>
              <Ionicons name="briefcase-outline" size={40} color={colors.goldDark} />
            </View>
          )}
          {/* A soft scrim keeps the pills readable over any image. */}
          <View style={styles.scrim} />
          {/* V2: golden projects catch the light — a slow metal sheen across the cover. */}
          {golden && imageWidth > 0 ? <Sheen width={imageWidth} height={IMAGE_HEIGHT} /> : null}
          {golden ? (
            <View style={styles.goldenBadge}>
              <Ionicons name="star" size={12} color={colors.goldInk} />
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
          {/* M116: the stars the owner asked for on every project. */}
          {project.rating && project.rating.stars !== null ? <StarsRow value={project.rating.stars} count={project.rating.count} /> : null}
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
          {!golden && onContact ? (
            <PressScale
              onPress={onContact}
              glow
              glowRadius={radii.md}
              wrapStyle={styles.contactWrap}
              style={styles.contactCta}
              accessibilityLabel={t('project.contactCta')}
            >
              <Ionicons name="chatbubbles-outline" size={16} color={colors.goldInk} />
              <Text style={styles.contactCtaText}>{t('project.contactCta')}</Text>
            </PressScale>
          ) : null}
        </View>
      </GlassCard>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  // The golden projects wear the brand: a faint gold wash under the gold hairline.
  cardGolden: {
    backgroundColor: colors.goldFaint,
    experimental_backgroundImage: gradients.goldWash,
  },
  imageBox: {
    height: IMAGE_HEIGHT,
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
    backgroundColor: colors.overlay,
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
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  goldenText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    lineHeight: 16,
    color: colors.goldInk,
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
  contactWrap: {
    marginTop: spacing.sm,
  },
  contactCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
  },
  contactCtaText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    lineHeight: 20,
    color: colors.goldInk,
  },
});
