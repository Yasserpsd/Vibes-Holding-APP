import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useProject } from '@/api/queries';
import { useAdvisorScreen, useAskAdvisor, useAskAdvisorClearance } from '@/components/advisor/AskAdvisor';
import { AppButton } from '@/components/AppButton';
import { FadeInView } from '@/components/motion';
import { ProjectBrief } from '@/components/project/ProjectBrief';
import { ProjectUnlock } from '@/components/project/ProjectUnlock';
import { StateView } from '@/components/StateView';
import { t } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { openLink } from '@/lib/openLink';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

export default function ProjectScreen() {
  const { id, contact } = useLocalSearchParams<{ id: string; contact?: string }>();
  const askAdvisor = useAskAdvisor();
  const { width } = useWindowDimensions();
  const query = useProject(id);
  const project = query.data?.project;
  const advisorContext = project ? ({ type: 'project', id: project.id, title: project.title } as const) : null;
  // The floating «اسأل المستشار» button opens the advisor with this project as the context.
  useAdvisorScreen(advisorContext);
  // Keeps the last card (the unlock button) clear of that floating button.
  const clearance = useAskAdvisorClearance();
  const imageWidth = width - spacing.md * 2;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: project?.title ?? t('nav.project') }} />
      {!project ? (
        <StateView loading={query.isPending} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
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
              <Text style={styles.goldenText}>{t('project.golden')}</Text>
            </View>
          ) : null}

          <Text style={styles.title}>{project.title}</Text>
          {project.titleEn ? <Text style={styles.titleEn}>{project.titleEn}</Text> : null}

          <View style={styles.tags}>
            {project.sector ? <Text style={styles.tag}>{project.sector.name}</Text> : null}
            {project.stage ? <Text style={styles.tag}>{project.stage.name}</Text> : null}
            {project.number ? <Text style={styles.tag}>{t('project.number', { number: project.number })}</Text> : null}
          </View>

          {/* M35: contact with the founder sits at the top — a golden project offers its partner page instead. */}
          {project.isGolden && project.goldenPartnerUrl ? (
            <AppButton label={t('project.partnerPage')} icon="open-outline" onPress={() => openLink(project.goldenPartnerUrl ?? '')} />
          ) : null}

          <FadeInView delay={80}>
            <ProjectUnlock projectId={String(project.id)} projectTitle={project.title} hasPitchDeck={project.hasPitchDeck} autoStart={contact === '1'} />
          </FadeInView>

          {/* M35: the adviser's table before everything else about the project. */}
          <FadeInView delay={140}>
            <ProjectBrief projectId={String(project.id)} />
          </FadeInView>

          <FadeInView delay={200}>
            <View style={styles.infoCard}>
              {project.companyName ? <InfoRow icon="business-outline" label={t('project.company')} value={project.companyName} /> : null}
              {project.founderName ? <InfoRow icon="person-outline" label={t('project.founder')} value={project.founderName} /> : null}
              <InfoRow icon="eye-outline" label={t('project.views')} value={formatNumber(project.viewsCount)} />
            </View>
          </FadeInView>

          {project.details ?? project.detailsEn ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('project.about')}</Text>
              <Text style={styles.body}>{project.details ?? project.detailsEn}</Text>
            </View>
          ) : null}

          <AppButton label={t('project.discuss')} icon="sparkles-outline" variant="outline" onPress={() => (advisorContext ? askAdvisor(advisorContext) : undefined)} />
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
  content: { padding: spacing.md, gap: spacing.md },
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
});
