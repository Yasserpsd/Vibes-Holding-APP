import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProjectFilters, useProjectsList } from '@/api/queries';
import type { ProjectsSort } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ASK_ADVISOR_CLEARANCE, useAdvisorScreen } from '@/components/advisor/AskAdvisor';
import { Chip } from '@/components/Chip';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectFiltersSheet } from '@/components/ProjectFiltersSheet';
import { StateView } from '@/components/StateView';
import { t, tOptional } from '@/i18n';
import { markSeen } from '@/lib/seen';
import { formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

// The labels come from the app's strings (projects.sort.*); a server label serves a sort the app does not know yet.
const DEFAULT_SORTS: { key: ProjectsSort; label: string }[] = [
  { key: 'latest', label: '' },
  { key: 'views', label: '' },
  { key: 'discover', label: '' },
  { key: 'golden', label: '' },
];

export default function ProjectsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [sort, setSort] = useState<ProjectsSort>('latest');
  const [sector, setSector] = useState<string | undefined>();
  const [stage, setStage] = useState<string | undefined>();
  // M107 «حسب اهتماماتي»: keeps only the projects matching my saved interests.
  const [mine, setMine] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = useDebounced(search.trim());
  // Tab screens keep the floating «اسأل المستشار» button above the tab bar.
  useAdvisorScreen({ type: 'screen', id: 'projects', title: t('tabs.projects') }, true);
  // M75: opening the bank clears its +N badge.
  useFocusEffect(
    useCallback(() => {
      markSeen('projects');
    }, []),
  );

  const filters = useProjectFilters();
  const list = useProjectsList({ q, sort, sector, stage, mine: mine ? '1' : undefined });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const sorts = filters.data?.sorts ?? DEFAULT_SORTS;

  const header = (
    <View style={styles.header}>
      <FadeInView delay={entranceDelay(0)}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('tabs.projects')}</Text>
          <PressScale onPress={() => router.push('/golden')} style={styles.goldenLink} accessibilityRole="link">
            <Ionicons name="star" size={16} color={colors.gold} />
            <Text style={styles.goldenLinkText}>{t('nav.golden')}</Text>
          </PressScale>
        </View>
      </FadeInView>

      <FadeInView delay={entranceDelay(1)}>
        <View style={[styles.searchBox, searchFocused && styles.searchBoxFocused]}>
          <Ionicons name="search-outline" size={20} color={searchFocused ? colors.gold : colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t('projects.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.gold}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
          />
          {search ? (
            <PressScale onPress={() => setSearch('')} accessibilityLabel={t('projects.clearSearch')} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </PressScale>
          ) : null}
        </View>
      </FadeInView>

      <FadeInView delay={entranceDelay(2)}>
        {/* One row: the sorts, then «فلترة» opening the sheet (the sector/stage chip rows used to crowd the header). */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {signedIn ? <Chip label={t('projects.mine')} selected={mine} onPress={() => setMine((value) => !value)} /> : null}
          {sorts.map((option) => (
            <Chip key={option.key} label={tOptional(`projects.sort.${option.key}`) ?? option.label} selected={sort === option.key} onPress={() => setSort(option.key)} />
          ))}
          {filters.data && (filters.data.sectors.length > 0 || filters.data.stages.length > 0) ? (
            <PressScale
              onPress={() => setFiltersOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('projects.filterTitle')}
              style={[styles.filterButton, (sector || stage) && styles.filterButtonActive]}
            >
              <Ionicons name="options-outline" size={15} color={sector || stage ? colors.goldInk : colors.goldLight} />
              <Text style={[styles.filterButtonText, (sector || stage) && styles.filterButtonTextActive]}>{t('projects.filter')}</Text>
            </PressScale>
          ) : null}
        </ScrollView>
      </FadeInView>

      {sector || stage ? (
        // The chosen filters stay visible as removable chips.
        <FadeInView offset={6}>
          <View style={styles.activeFilters}>
            {sector ? (
              <Chip label={`${filters.data?.sectors.find((option) => option.slug === sector)?.name ?? sector} ✕`} selected onPress={() => setSector(undefined)} />
            ) : null}
            {stage ? (
              <Chip label={`${filters.data?.stages.find((option) => option.slug === stage)?.name ?? stage} ✕`} selected onPress={() => setStage(undefined)} />
            ) : null}
          </View>
        </FadeInView>
      ) : null}

      {typeof total === 'number' ? (
        // Keyed by the total: a new filter result fades its count in instead of snapping.
        <FadeInView key={total} offset={6} duration={320}>
          <Text style={styles.count}>{t('projects.count', { count: formatNumber(total) })}</Text>
        </FadeInView>
      ) : null}
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
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => list.refetch()}
            tintColor={colors.gold}
            colors={[colors.gold]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardShouldPersistTaps="handled"
      />
      <ProjectFiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        sectors={filters.data?.sectors ?? []}
        stages={filters.data?.stages ?? []}
        sector={sector}
        stage={stage}
        onSector={setSector}
        onStage={setStage}
        total={total}
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
  // Focus lights the box: golden border with a faint neon halo.
  searchBoxFocused: {
    borderColor: colors.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  searchInput: { ...typography.body, flex: 1, color: colors.textPrimary, paddingVertical: spacing.sm + 2 },
  chips: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  // «فلترة» rides the sorts row; it lights up gold while a filter is on.
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.goldFaint,
  },
  filterButtonActive: { backgroundColor: colors.gold, borderColor: colors.gold, boxShadow: shadows.glowGoldFaint },
  filterButtonText: { ...typography.caption, color: colors.goldLight },
  filterButtonTextActive: { color: colors.goldInk, fontFamily: fonts.semiBold },
  activeFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  count: { ...typography.caption, color: colors.textMuted },
  separator: { height: spacing.sm },
  footer: { paddingVertical: spacing.md },
});
