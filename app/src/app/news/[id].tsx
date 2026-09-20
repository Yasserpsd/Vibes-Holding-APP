import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useNewsItem } from '@/api/news';
import { useAdvisorScreen, useAskAdvisor, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { StateView } from '@/components/StateView';
import { formatRelativeTime } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

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
  const latin = item?.lang === 'en';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: item?.decision ? 'قرار' : 'الخبر' }} />
      {!item ? (
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
          {item.image ?<Image source={{ uri: item.image }} style={styles.image} resizeMode="cover" /> : null}
          <View style={styles.meta}>
            <Text style={styles.source}>{item.source.name}</Text>
            <View style={styles.tierPill}>
              <Text style={styles.tier} numberOfLines={1}>
                {item.source.tierLabel}
              </Text>
            </View>
            <Text style={styles.time}>{formatRelativeTime(item.publishedAt)}</Text>
          </View>
          {item.decision ? (
            <View style={styles.badge}>
              <Ionicons name="ribbon-outline" size={14} color={colors.black} />
              <Text style={styles.badgeText}>قرارات وأنظمة المملكة</Text>
            </View>
          ) : null}
          <Text style={[styles.title, latin && styles.latin]}>{item.title}</Text>
          {item.snippet ? <Text style={[styles.body, latin && styles.latin]}>{item.snippet}</Text> : null}
          {item.topics.length > 0 ? (
            <View style={styles.tags}>
              {item.topics.map((topic) => (
                <Text key={topic.key} style={styles.tag}>
                  {topic.label}
                </Text>
              ))}
            </View>
          ) : null}
          <AppButton label="اقرأ من المصدر" icon="open-outline" onPress={() => void openLink(item.url)} />
          <AppButton label="ناقش الخبر مع المستشار" icon="sparkles-outline" variant="outline" onPress={() => (advisorContext ? askAdvisor(advisorContext) : undefined)} />
          <View style={styles.noteCard}>
            <Ionicons name="information-circle-outline" size={20} color={colors.goldLight} />
            <Text style={styles.noteText}>العنوان والمقتطف كما نشرهما المصدر. التطبيق لا يكتب الأخبار ولا يعيد صياغتها؛ النص الكامل على صفحة المصدر.</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md },
  image: { width: '100%', height: 200, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  source: { ...typography.body, color: colors.goldLight },
  // Padding sits on a View: Android measures a padded Text too narrow and truncates it.
  tierPill: { paddingHorizontal: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated },
  tier: { ...typography.caption, color: colors.textSecondary },
  time: { ...typography.caption, color: colors.textMuted },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.black },
  title: { ...typography.title, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary },
  latin: { textAlign: 'left', writingDirection: 'ltr' },
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
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  noteText: { ...typography.caption, flex: 1, color: colors.textSecondary },
});
