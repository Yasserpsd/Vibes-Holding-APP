import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useProject } from '@/api/queries';
import { AppButton } from '@/components/AppButton';
import { StateView } from '@/components/StateView';
import { formatNumber } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const query = useProject(id);
  const project = query.data?.project;
  const imageWidth = width - spacing.md * 2;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: project?.title ?? 'المشروع' }} />
      {!project ? (
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {project.gallery.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.gallery}>
              {project.gallery.map((uri) => (
                <Image key={uri} source={{ uri }} style={[styles.galleryImage, { width: imageWidth }]} resizeMode="cover" />
              ))}
            </ScrollView>
          ) : null}

          {project.isGolden ? (
            <View style={styles.goldenBadge}>
              <Ionicons name="star" size={14} color={colors.black} />
              <Text style={styles.goldenText}>مشروع ذهبي</Text>
            </View>
          ) : null}

          <Text style={styles.title}>{project.title}</Text>
          {project.titleEn ? <Text style={styles.titleEn}>{project.titleEn}</Text> : null}

          <View style={styles.tags}>
            {project.sector ? <Text style={styles.tag}>{project.sector.name}</Text> : null}
            {project.stage ? <Text style={styles.tag}>{project.stage.name}</Text> : null}
            {project.number ? <Text style={styles.tag}>{`رقم ${project.number}`}</Text> : null}
          </View>

          <View style={styles.infoCard}>
            {project.companyName ? <InfoRow icon="business-outline" label="الشركة" value={project.companyName} /> : null}
            {project.founderName ? <InfoRow icon="person-outline" label="المؤسس" value={project.founderName} /> : null}
            <InfoRow icon="eye-outline" label="المشاهدات" value={formatNumber(project.viewsCount)} />
          </View>

          {project.details ?? project.detailsEn ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>عن المشروع</Text>
              <Text style={styles.body}>{project.details ?? project.detailsEn}</Text>
            </View>
          ) : null}

          {project.isGolden && project.goldenPartnerUrl ? (
            <AppButton label="صفحة الشريك الذهبي" icon="open-outline" onPress={() => openLink(project.goldenPartnerUrl ?? '')} />
          ) : null}

          <View style={styles.noteCard}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.goldLight} />
            <Text style={styles.noteText}>
              بيانات التواصل مع المؤسس وملف العرض متاحة لأعضاء النادي بعد فتح المشروع. تسجيل الدخول والعضوية في تحديث قادم.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

type InfoRowProps = { icon: 'business-outline' | 'person-outline' | 'eye-outline'; label: string; value: string };

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={colors.gold} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  gallery: { borderRadius: radii.lg, overflow: 'hidden' },
  galleryImage: { height: 220, backgroundColor: colors.surfaceElevated },
  goldenBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
  goldenText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.black },
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
    borderColor: colors.goldDark,
  },
  infoCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoLabel: { ...typography.caption, color: colors.textMuted, minWidth: 72 },
  infoValue: { ...typography.body, flex: 1, color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.subtitle, color: colors.gold },
  body: { ...typography.body, color: colors.textSecondary },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.goldDark,
    backgroundColor: colors.surface,
  },
  noteText: { ...typography.caption, flex: 1, color: colors.textSecondary },
});
