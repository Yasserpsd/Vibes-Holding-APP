import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProjectFilters, useProjectsList } from '@/api/queries';
import type { ProjectsSort } from '@/api/types';
import { ASK_ADVISOR_CLEARANCE, useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { Chip } from '@/components/Chip';
import { entranceDelay, FadeInView } from '@/components/motion';
import { ProjectCard } from '@/components/ProjectCard';
import { StateView } from '@/components/StateView';
import { t, tOptional } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { colors, radii, spacing, typography } from '@/theme/tokens';

// The labels come from the app's strings (projects.sort.*); a server label serves a sort the app does not know yet.
const DEFAULT_SORTS: { key: ProjectsSort; label: string }[] = [
  { key: 'latest', label: '' },
  { key: 'views', label: '' },
  { key: 'discover', label: '' },
  { key: 'golden', label: '' },
];

export default function ProjectsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectsSort>('latest');
  const [sector, setSector] = useState<string | undefined>();
  const [stage, setStage] = useState<string | undefined>();
  const q = useDebounced(search.trim());
  // Tab screens keep the floating «اسأل المستشار» button above the tab bar.
  useAdvisorScreen({ type: 'screen', id: 'projects', title: t('tabs.projects') }, true);

  const filters = useProjectFilters();
  const list = useProjectsList({ q, sort, sector, stage });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const sorts = filters.data?.sorts ?? DEFAULT_SORTS;

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('tabs.projects')}</Text>
        <Pressable onPress={() => router.push('/golden')} style={styles.goldenLink} accessibilityRole="link">
          <Ionicons name="star" size={16} color={colors.gold} />
          <Text style={styles.goldenLinkText}>{t('nav.golden')}</Text>
        </Pressable>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('projects.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} accessibilityLabel={t('projects.clearSearch')} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {sorts.map((option) => (
          <Chip key={option.key} label={tOptional(`projects.sort.${option.key}`) ?? option.label} selected={sort === option.key} onPress={() => setSort(option.key)} />
        ))}
      </ScrollView>

      {filters.data && filters.data.sectors.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('projects.allSectors')} selected={!sector} onPress={() => setSector(undefined)} />
          {filters.data.sectors.map((option) => (
            <Chip
              key={option.slug}
              label={`${option.name} (${formatNumber(option.count)})`}
              selected={sector === option.slug}
              onPress={() => setSector(sector === option.slug ? undefined : option.slug)}
            />
          ))}
        </ScrollView>
      ) : null}

      {filters.data && filters.data.stages.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label={t('projects.allStages')} selected={!stage} onPress={() => setStage(undefined)} />
          {filters.data.stages.map((option) => (
            <Chip
              key={option.slug}
              label={`${option.name} (${formatNumber(option.count)})`}
              selected={stage === option.slug}
              onPress={() => setStage(stage === option.slug ? undefined : option.slug)}
            />
          ))}
        </ScrollView>
      ) : null}

      {typeof total === 'number' ? <Text style={styles.count}>{t('projects.count', { count: formatNumber(total) })}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => (
          <FadeInView delay={entranceDelay(index)}>
            <ProjectCard
              project={item}
              onPress={() => router.push({ pathname: '/project/[id]', params: { id: String(item.id) } })}
              onContact={() => router.push({ pathname: '/project/[id]', params: { id: String(item.id), contact: '1' } })}
            />
          </FadeInView>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <StateView
            loading={list.isPending}
            error={list.error}
            onRetry={() => list.refetch()}
            empty={!list.isPending && !list.error}
            emptyText={t('projects.empty')}
          />
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={colors.gold} style={styles.footer} /> : null}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => list.refetch()}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.black },
  // The bottom padding keeps the last card clear of the floating «اسأل المستشار» button.
  listContent: { paddingHorizontal: spacing.md, paddingBottom: ASK_ADVISOR_CLEARANCE },
  header: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.title, color: colors.gold },
  goldenLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  goldenLinkText: { ...typography.caption, color: colors.goldLight },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { ...typography.body, flex: 1, color: colors.textPrimary, paddingVertical: spacing.sm + 2 },
  chips: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  count: { ...typography.caption, color: colors.textMuted },
  separator: { height: spacing.sm },
  footer: { paddingVertical: spacing.md },
});
