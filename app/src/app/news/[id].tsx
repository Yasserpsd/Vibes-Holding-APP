import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image, ScrollView, Text, View } from 'react-native';

import { useNewsItem } from '@/api/news';
import { useAdvisorScreen, useAskAdvisor, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PopIn } from '@/components/motion';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { textDir } from '@/i18n/direction';
import { formatRelativeTime } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

/** The item as the source published it, with the link to the original page and the advisor shortcut. */
export default function NewsItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const askAdvisor = useAskAdvisor();
  const query = useNewsItem(id);
  const item = query.data?.item;
  // The discussion happens in the advisor's chat; the item on this page stays as its source published it.
  const advisorContext = item ? ({ type: 'news', id: item.id, title: item.title } as const) : null;
  useAdvisorScreen(advisorContext);
  // Keeps the note at the end clear of the floating «اسأل المستشار» button.
  const clearance = useAskAdvisorClearance();

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: item?.decision ? t('nav.newsDecision') : t('nav.newsItem') }} />
      {!item ? (
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
          {item.image ? (
            <FadeInView delay={entranceDelay(0)}>
              <Image source={{ uri: item.image }} style={styles.image} resizeMode="cover" />
            </FadeInView>
          ) : null}
          <FadeInView delay={entranceDelay(1)}>
            <View style={styles.meta}>
              <Text style={styles.source}>{item.source.name}</Text>
              <View style={styles.tierPill}>
                <Text style={styles.tier} numberOfLines={1}>
                  {item.source.tierLabel}
                </Text>
              </View>
              <Text style={styles.time}>{formatRelativeTime(item.publishedAt)}</Text>
            </View>
          </FadeInView>
          {item.decision ? (
            <PopIn delay={entranceDelay(2)} style={styles.badgeWrap}>
              <View style={styles.badge}>
                <Ionicons name="ribbon-outline" size={14} color={colors.goldInk} />
                <Text style={styles.badgeText}>{t('news.decisionsTitle')}</Text>
              </View>
            </PopIn>
          ) : null}
          <FadeInView delay={entranceDelay(3)}>
            {/* M177 (owner): the headline on its own golden panel, the source's words on a second one — each in its own direction. */}
            <View style={styles.titlePanel}>
              <Text style={[styles.title, textDir(item.title)]}>{item.title}</Text>
            </View>
          </FadeInView>
          {item.snippet ? (
            <FadeInView delay={entranceDelay(4)}>
              <View style={styles.bodyPanel}>
                <View style={styles.bodyRail} />
                <Text style={[styles.body, textDir(item.snippet)]}>{item.snippet}</Text>
              </View>
            </FadeInView>
          ) : null}
          {item.topics.length > 0 ? (
            <FadeInView delay={entranceDelay(5)}>
              <View style={styles.tags}>
                {item.topics.map((topic) => (
                  <Text key={topic.key} style={styles.tag}>
                    {topic.label}
                  </Text>
                ))}
              </View>
            </FadeInView>
          ) : null}
          <FadeInView delay={entranceDelay(6)}>
            <AppButton label={t('news.readSource')} icon="open-outline" onPress={() => void openLink(item.url)} />
          </FadeInView>
          <FadeInView delay={entranceDelay(7)}>
            <AppButton label={t('news.discuss')} icon="sparkles-outline" variant="outline" onPress={() => (advisorContext ? askAdvisor(advisorContext) : undefined)} />
          </FadeInView>
          <FadeInView delay={entranceDelay(8)}>
            <GlassCard style={styles.noteCard}>
              <Ionicons name="information-circle-outline" size={20} color={colors.goldLight} />
              <Text style={styles.noteText}>{t('news.sourceNote')}</Text>
            </GlassCard>
          </FadeInView>
        </ScrollView>
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md },
  image: { width: '100%', height: 200, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, boxShadow: shadows.lift },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  source: { ...typography.body, color: colors.goldLight },
  // Padding sits on a View: Android measures a padded Text too narrow and truncates it.
  tierPill: { paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated },
  tier: { ...typography.caption, color: colors.textSecondary },
  time: { ...typography.caption, color: colors.textMuted },
  // The pop wrapper hugs the badge so the spring scales it around its own center.
  badgeWrap: { alignSelf: 'flex-start' },
  badge: {
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
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.goldInk },
  titlePanel: { padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderGold, backgroundColor: colors.goldSoft, boxShadow: shadows.glowGoldFaint },
  title: { ...typography.title, color: colors.textPrimary },
  bodyPanel: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderGoldSoft, backgroundColor: colors.surfaceElevated },
  bodyRail: { width: 3, borderRadius: 2, backgroundColor: colors.gold },
  body: { ...typography.body, lineHeight: 28, color: colors.textPrimary, flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    ...typography.caption,
    color: colors.goldLight,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  // The card chrome (border, machined surface, lift) comes from the GlassCard.
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noteText: { ...typography.caption, flex: 1, color: colors.textSecondary },
}));
