import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Animated, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { goldenCodeForUrl, useGolden, useProject } from '@/api/queries';
import { useAdvisorScreen, useAskAdvisor, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { FadeInView, PopIn, PressScale } from '@/components/motion';
import { ProjectBrief } from '@/components/project/ProjectBrief';
import { ProjectUnlock } from '@/components/project/ProjectUnlock';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { isRTL } from '@/i18n/direction';
import { formatNumber } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

export default function ProjectScreen() {
  const { id, contact } = useLocalSearchParams<{ id: string; contact?: string }>();
  const router = useRouter();
  const askAdvisor = useAskAdvisor();
  const { width } = useWindowDimensions();
  const query = useProject(id);
  const golden = useGolden();
  const project = query.data?.project;
  // §5.1: a partner page that belongs to a golden company opens as the native offer page.
  const partnerCode = goldenCodeForUrl(golden.data, project?.goldenPartnerUrl ?? null);
  const advisorContext = project ? ({ type: 'project', id: project.id, title: project.title } as const) : null;
  // The floating «اسأل المستشار» button opens the advisor with this project as the context.
  useAdvisorScreen(advisorContext);
  // Keeps the last card (the unlock button) clear of that floating button.
  const clearance = useAskAdvisorClearance();
  const imageWidth = width - spacing.md * 2;
  // V2: the gallery's page indicator follows the swipes.
  const [page, setPage] = useState(0);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: project?.title ?? t('nav.project') }} />
      {!project ? (
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
          {project.gallery.length > 0 ? (
            <FadeInView>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={styles.gallery}
                onMomentumScrollEnd={({ nativeEvent }) => {
                  // Android reports raw left-origin scrollX even under RTL (snap targeting is the
                  // only RTL-converted part), so the logical page counts from the far end there.
                  const maxOffset = nativeEvent.contentSize.width - nativeEvent.layoutMeasurement.width;
                  const logicalX =
                    Platform.OS === 'android' && isRTL()
                      ? maxOffset - nativeEvent.contentOffset.x
                      : Math.abs(nativeEvent.contentOffset.x);
                  const index = Math.round(logicalX / imageWidth);
                  setPage(Math.min(project.gallery.length - 1, Math.max(0, index)));
                }}
              >
                {project.gallery.map((uri) => (
                  <GalleryImage key={uri} uri={uri} width={imageWidth} />
                ))}
              </ScrollView>
              {project.gallery.length > 1 ? (
                <View style={styles.dots}>
                  {project.gallery.map((uri, index) => (
                    <View key={uri} style={[styles.dot, index === page && styles.dotActive]} />
                  ))}
                </View>
              ) : null}
            </FadeInView>
          ) : null}

          {project.isGolden ? (
            <PopIn delay={60} style={styles.goldenWrap}>
              <View style={styles.goldenBadge}>
                <Ionicons name="star" size={14} color={colors.goldInk} />
                <Text style={styles.goldenText}>{t('project.golden')}</Text>
              </View>
            </PopIn>
          ) : null}

          <FadeInView delay={30}>
            <Text style={styles.title}>{project.title}</Text>
          </FadeInView>
          {project.titleEn ? (
            <FadeInView delay={50}>
              <Text style={styles.titleEn}>{project.titleEn}</Text>
            </FadeInView>
          ) : null}

          <FadeInView delay={70}>
            <View style={styles.tags}>
              {project.sector ? <Text style={styles.tag}>{project.sector.name}</Text> : null}
              {project.stage ? <Text style={styles.tag}>{project.stage.name}</Text> : null}
              {project.number ? <Text style={styles.tag}>{t('project.number', { number: project.number })}</Text> : null}
            </View>
          </FadeInView>

          {/* Founder and views in one quiet line — they used to occupy a whole card further down. */}
          {project.founderName || project.viewsCount ? (
            <FadeInView delay={90}>
              <View style={styles.metaRow}>
                {project.founderName ? (
                  <View style={styles.metaItem}>
                    <Ionicons name="person-circle-outline" size={16} color={colors.goldDark} />
                    <Text style={styles.metaText} numberOfLines={1}>
                      {project.founderName}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.metaItem}>
                  <Ionicons name="eye-outline" size={15} color={colors.goldDark} />
                  <Text style={styles.metaText}>{formatNumber(project.viewsCount)}</Text>
                </View>
              </View>
            </FadeInView>
          ) : null}

          {/* M35: contact with the founder sits at the top — a golden project offers its partner page instead. */}
          {project.isGolden && project.goldenPartnerUrl ? (
            <FadeInView delay={60}>
              <AppButton
                label={t('project.partnerPage')}
                icon={partnerCode ? 'reader-outline' : 'open-outline'}
                onPress={() => (partnerCode ? router.push(`/golden/${partnerCode}`) : openLink(project.goldenPartnerUrl ?? ''))}
              />
            </FadeInView>
          ) : null}

          <FadeInView delay={80}>
            <ProjectUnlock projectId={String(project.id)} projectTitle={project.title} hasPitchDeck={project.hasPitchDeck} autoStart={contact === '1'} />
          </FadeInView>

          {/* M35: the adviser's table before everything else about the project. */}
          <FadeInView delay={140}>
            <ProjectBrief projectId={String(project.id)} />
          </FadeInView>

          {/* M80 (owner): the original text hides behind «اقرأ المزيد», collapsed by default. */}
          {project.details ?? project.detailsEn ? (
            <FadeInView delay={240}>
              <ReadMore text={project.details ?? project.detailsEn ?? ''} />
            </FadeInView>
          ) : null}

          <FadeInView delay={280}>
            <AppButton label={t('project.discuss')} icon="sparkles-outline" variant="outline" onPress={() => (advisorContext ? askAdvisor(advisorContext) : undefined)} />
          </FadeInView>
        </ScrollView>
      )}
    </View>
  );
}

/** M80: the project's raw description behind an «اقرأ المزيد» expander — a tap reveals the original wording. */
function ReadMore({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.section}>
      <PressScale onPress={() => setOpen((current) => !current)} accessibilityRole="button" accessibilityLabel={t('project.about')} style={styles.readMoreHeader}>
        <Ionicons name="document-text-outline" size={18} color={colors.gold} />
        <Text style={styles.sectionTitle}>{t('project.about')}</Text>
        <View style={styles.readMorePill}>
          <Text style={styles.readMorePillText}>{open ? t('project.readLess') : t('project.readMore')}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.goldLight} />
        </View>
      </PressScale>
      {open ? (
        <FadeInView offset={8}>
          <Text style={styles.body}>{text}</Text>
        </FadeInView>
      ) : null}
    </View>
  );
}

/** A gallery page that fades in once its image arrives, instead of popping over the placeholder. */
function GalleryImage({ uri, width }: { uri: string; width: number }) {
  const [reveal] = useState(() => new Animated.Value(0));
  return (
    <View style={[styles.galleryImage, { width }]}>
      <Animated.Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, { opacity: reveal }]}
        resizeMode="cover"
        onLoad={() => Animated.timing(reveal, { toValue: 1, duration: 320, useNativeDriver: true }).start()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md },
  gallery: { borderRadius: radii.lg, overflow: 'hidden' },
  galleryImage: { height: 220, backgroundColor: colors.surfaceElevated },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { width: 16, backgroundColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  goldenWrap: { alignSelf: 'flex-start' },
  goldenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  goldenText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.goldInk },
  title: { ...typography.title, color: colors.textPrimary },
  titleEn: { ...typography.body, color: colors.textSecondary },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    ...typography.caption,
    color: colors.goldLight,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '70%' },
  metaText: { ...typography.caption, color: colors.textSecondary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.subtitle, color: colors.gold },
  body: { ...typography.body, color: colors.textSecondary },
  readMoreHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  readMorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldSoft,
    marginStart: 'auto',
  },
  readMorePillText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.goldLight },
});
