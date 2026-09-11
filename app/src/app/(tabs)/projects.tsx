import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProjectFilters, useProjectsList } from '@/api/queries';
import type { ProjectsSort } from '@/api/types';
import { Chip } from '@/components/Chip';
import { ProjectCard } from '@/components/ProjectCard';
import { StateView } from '@/components/StateView';
import { formatNumber } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const DEFAULT_SORTS: { key: ProjectsSort; label: string }[] = [
  { key: 'latest', label: 'الأحدث' },
  { key: 'views', label: 'الأكثر مشاهدة' },
  { key: 'discover', label: 'اكتشف' },
  { key: 'golden', label: 'المشاريع الذهبية' },
];

export default function ProjectsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectsSort>('latest');
  const [sector, setSector] = useState<string | undefined>();
  const [stage, setStage] = useState<string | undefined>();
  const q = useDebounced(search.trim());

  const filters = useProjectFilters();
  const list = useProjectsList({ q, sort, sector, stage });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const sorts = filters.data?.sorts ?? DEFAULT_SORTS;

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>بنك المشاريع</Text>
        <Pressable onPress={() => router.push('/golden')} style={styles.goldenLink} accessibilityRole="link">
          <Ionicons name="star" size={16} color={colors.gold} />
          <Text style={styles.goldenLinkText}>المشاريع الذهبية</Text>
        </Pressable>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="ابحث باسم المشروع أو الشركة"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} accessibilityLabel="مسح البحث" hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {sorts.map((option) => (
          <Chip key={option.key} label={option.label} selected={sort === option.key} onPress={() => setSort(option.key)} />
        ))}
      </ScrollView>

      {filters.data && filters.data.sectors.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="كل القطاعات" selected={!sector} onPress={() => setSector(undefined)} />
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
          <Chip label="كل المراحل" selected={!stage} onPress={() => setStage(undefined)} />
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

      {typeof total === 'number' ? <Text style={styles.count}>{`${formatNumber(total)} مشروع`}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            onPress={() => router.push({ pathname: '/project/[id]', params: { id: String(item.id) } })}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <StateView
            loading={list.isPending}
            error={list.error}
            onRetry={() => list.refetch()}
            empty={!list.isPending && !list.error}
            emptyText="لا توجد مشاريع مطابقة"
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
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
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
