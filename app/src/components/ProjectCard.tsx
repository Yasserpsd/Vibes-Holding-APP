import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Animated, Text, View } from 'react-native';

import type { PublicProject } from '@/api/types';
import { GlassCard } from '@/components/lux';
import { PressScale, Sheen } from '@/components/motion';
import { StarsRow } from '@/components/Stars';
import { t } from '@/i18n';
import { ownDirection, rangeDashes } from '@/components/Highlight';
import { formatNumber } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

type Props = {
  project: PublicProject;
  onPress: () => void;
  /** M35: «تواصل مع المؤسس» straight from the list; the page then walks the unlock (rule 4 intact). */
  onContact?: () => void;
  /** M201: «اسأل المستشار» on the card; the server builds what the advisor knows from the project's id. */
  onAskAdvisor?: () => void;
};

/** Fixed image strip height; the sheen only needs the measured width. */
const IMAGE_HEIGHT = 168;

/** The same name once spacing and letter case are set aside. */
function sameName(a: string, b: string): boolean {
  const plain = (value: string) => value.trim().replace(/\s+/gu, ' ').toLowerCase();
  return plain(a) === plain(b);
}

export function ProjectCard({ project, onPress, onContact, onAskAdvisor }: Props) {
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
  const showContact = !golden && Boolean(onContact);
  const hasPhoto = Boolean(project.image) && !imageBroken;
  // A company named exactly like the project says nothing new under the title.
  const company = project.companyName && sameName(project.companyName, project.title) ? null : project.companyName;
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl}>
      <GlassCard golden={golden} radius={radii.xl} style={golden ? styles.cardGolden : null}>
        <View style={styles.imageBox} onLayout={(event) => setImageWidth(event.nativeEvent.layout.width)}>
          {hasPhoto && project.image ? (
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
          {/* The photo's bottom-up scrim (the same in both themes) arrives with the photo; the pills carry their
              own dark backing, so they read on any picture and on the placeholder alike. */}
          {hasPhoto ? <Animated.View style={[styles.scrim, { opacity: imageOpacity }]} pointerEvents="none" /> : null}
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
            <Ionicons name="eye-outline" size={13} color={colors.onPhotoGold} />
            <Text style={styles.viewsText}>{formatNumber(project.viewsCount)}</Text>
          </View>
        </View>
        <View style={styles.body}>
          {/* Every line starts at the card's start edge and reads in the order of its own letters (a Latin
              brand on an Arabic card sits on the right, written left to right). */}
          <Text style={[styles.title, ownDirection(project.title)]} numberOfLines={2}>
            {project.title}
          </Text>
          {/* The stars show once the project has a rating; a row of five empty stars said nothing. */}
          {project.rating && project.rating.stars !== null ? <StarsRow value={project.rating.stars} count={project.rating.count} /> : null}
          {company ? (
            <Text style={[styles.company, ownDirection(company)]} numberOfLines={1}>
              {company}
            </Text>
          ) : null}
          {project.excerpt ? (
            <Text style={[styles.excerpt, ownDirection(project.excerpt)]} numberOfLines={2}>
              {rangeDashes(project.excerpt)}
            </Text>
          ) : null}
          {project.sector ? (
            <View style={styles.metaRow}>
              {/* The padding sits on a View: Android measures a padded Text too narrow and clips the last letter. */}
              <View style={styles.tag}>
                <Text style={styles.tagText} numberOfLines={1}>
                  {project.sector.name}
                </Text>
              </View>
            </View>
          ) : null}
          {showContact || onAskAdvisor ? (
            <View style={styles.actions}>
              {showContact ? (
                <PressScale
                  onPress={onContact}
                  glow
                  glowRadius={radii.md}
                  wrapStyle={styles.actionGrow}
                  style={styles.contactCta}
                  accessibilityLabel={t('project.contactCta')}
                >
                  <Ionicons name="chatbubbles-outline" size={16} color={colors.goldInk} />
                  <Text style={styles.contactCtaText} numberOfLines={1}>
                    {t('project.contactCta')}
                  </Text>
                </PressScale>
              ) : null}
              {/* M201 (owner): the advisor on EVERY project — it opens the chat already on this project.
                  Beside the contact button it keeps its own width; alone (golden projects) it fills the row. */}
              {onAskAdvisor ? (
                <PressScale
                  onPress={onAskAdvisor}
                  wrapStyle={showContact ? null : styles.actionGrow}
                  style={styles.advisorCta}
                  accessibilityLabel={t('advisor.askAbout', { title: project.title })}
                >
                  <Ionicons name="sparkles" size={15} color={colors.goldText} />
                  <Text style={styles.advisorCtaText} numberOfLines={1}>
                    {t('advisor.ask')}
                  </Text>
                </PressScale>
              ) : null}
            </View>
          ) : null}
        </View>
      </GlassCard>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
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
    height: 96,
    experimental_backgroundImage: gradients.scrim,
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
    // Over a photo: the same dark backing and on-photo gold in both themes (the light theme's navy overlay
    // with dark-gold text was barely readable).
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
  stagePillText: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 16,
    color: colors.onPhotoGold,
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
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
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
    color: colors.goldLightText,
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
    paddingVertical: 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.goldSoft,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  tagText: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 18,
    color: colors.goldLightText,
  },
  viewsText: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 16,
    color: colors.onPhotoGold,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionGrow: {
    flex: 1,
  },
  advisorCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingVertical: spacing.sm - 1,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
  },
  advisorCtaText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    lineHeight: 20,
    color: colors.goldLightText,
  },
  contactCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
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
    flexShrink: 1,
  },
}));
