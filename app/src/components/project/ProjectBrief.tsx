import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useProjectBrief } from '@/api/queries';
import type { ProjectBrief as Brief } from '@/api/types';
import type { IoniconName } from '@/lib/icons';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * «ملخص المستشار» on a project page: the summary, an elegant facts table, where the project stands, strengths and
 * risks, and competing projects from the bank. A skeleton while the server builds it (the first call can be
 * slow); when it is unavailable the section stays out of the way and the page works as before.
 */
export function ProjectBrief({ projectId }: { projectId: string }) {
  const query = useProjectBrief(projectId);
  if (query.isPending) return <BriefSkeleton />;
  if (!query.data) {
    return (
      <View style={styles.fallback}>
        <Ionicons name="sparkles-outline" size={16} color={colors.textMuted} />
        <Text style={styles.fallbackText}>ملخص المستشار غير متاح الآن. يمكنك سؤاله عن المشروع مباشرة.</Text>
      </View>
    );
  }
  return <BriefBody brief={query.data} />;
}

function BriefBody({ brief }: { brief: Brief }) {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.mark}>
            <Ionicons name="sparkles" size={16} color={colors.black} />
          </View>
          <Text style={styles.headerTitle}>ملخص المستشار</Text>
        </View>
        {brief.summary ? <Text style={styles.summary}>{brief.summary}</Text> : null}

        {brief.table.length ? (
          <View style={styles.table}>
            {brief.table.map((row, index) => (
              <View key={`${row.label}:${index}`} style={[styles.tableRow, index > 0 && styles.tableRowBorder, index % 2 === 1 && styles.tableRowAlt]}>
                <View style={styles.labelCell}>
                  <Text style={styles.labelText}>{row.label}</Text>
                </View>
                <View style={styles.valueCell}>
                  <Text style={styles.valueText}>{row.value}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <StageStepper stage={brief.stage} />

        <Points title="نقاط القوة" icon="trending-up-outline" tone={colors.success} items={brief.strengths} />
        <Points title="مخاطر تستحق الانتباه" icon="alert-circle-outline" tone={colors.warning} items={brief.risks} />
      </View>

      {brief.competitors.length ? (
        <View style={styles.competitors}>
          <Text style={styles.sectionTitle}>مشاريع منافسة من بنك المشاريع</Text>
          {brief.competitors.map((competitor) => (
            <Pressable
              key={competitor.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/project/[id]', params: { id: String(competitor.id) } })}
              style={({ pressed }) => [styles.competitor, pressed && styles.pressed]}
            >
              <View style={styles.competitorTexts}>
                <Text style={styles.competitorTitle} numberOfLines={2}>
                  {competitor.title}
                </Text>
                {competitor.sector || competitor.stage ? (
                  <View style={styles.tags}>
                    {competitor.sector ? <Tag label={competitor.sector} /> : null}
                    {competitor.stage ? <Tag label={competitor.stage} /> : null}
                  </View>
                ) : null}
                {competitor.why ? <Text style={styles.competitorWhy}>{competitor.why}</Text> : null}
              </View>
              <Ionicons name="chevron-back" size={18} color={colors.goldDark} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.disclaimer}>{brief.disclaimer}</Text>
    </View>
  );
}

/** Where the project stands on the five steps; the feed's own wording sits beside the title. */
function StageStepper({ stage }: { stage: Brief['stage'] }) {
  const known = stage.index >= 0 && stage.index < stage.steps.length;
  return (
    <View style={styles.stage}>
      <View style={styles.stageHeader}>
        <Text style={styles.blockTitle}>مرحلة المشروع</Text>
        <View style={styles.stagePill}>
          <Text style={styles.stagePillText} numberOfLines={1}>
            {stage.label}
          </Text>
        </View>
      </View>
      <View style={styles.steps}>
        {stage.steps.map((label, index) => {
          const done = known && index < stage.index;
          const current = known && index === stage.index;
          return (
            <View key={label} style={styles.step}>
              <View style={styles.track}>
                {/* The line towards the previous step; in the RTL row that is the right half. */}
                <View style={[styles.line, index === 0 && styles.lineHidden, (done || current) && styles.lineDone]} />
                <View style={[styles.node, done && styles.nodeDone, current && styles.nodeCurrent]}>
                  {done ? <Ionicons name="checkmark" size={12} color={colors.black} /> : null}
                  {current ? <View style={styles.nodeDot} /> : null}
                </View>
                <View style={[styles.line, index === stage.steps.length - 1 && styles.lineHidden, done && styles.lineDone]} />
              </View>
              <Text style={[styles.stepLabel, done && styles.stepLabelDone, current && styles.stepLabelCurrent]} numberOfLines={3}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>
      {known ? null : <Text style={styles.stageNote}>لم نتمكن من تحديد موقع المشروع على المراحل من بياناته المنشورة.</Text>}
    </View>
  );
}

function Points({ title, icon, tone, items }: { title: string; icon: IoniconName; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.points}>
      <View style={styles.pointsHeader}>
        <Ionicons name={icon} size={18} color={tone} />
        <Text style={styles.blockTitle}>{title}</Text>
      </View>
      {items.map((item) => (
        <View key={item} style={styles.point}>
          <View style={[styles.bullet, { backgroundColor: tone }]} />
          <Text style={styles.pointText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

// Padding sits on a View: Android measures a padded Text too narrow and truncates it.
function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function BriefSkeleton() {
  const [pulse] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={styles.card} accessibilityLabel="المستشار يجهّز ملخص المشروع">
      <View style={styles.header}>
        <View style={styles.mark}>
          <Ionicons name="sparkles" size={16} color={colors.black} />
        </View>
        <Text style={styles.headerTitle}>ملخص المستشار</Text>
      </View>
      <Text style={styles.skeletonNote}>المستشار يقرأ بيانات المشروع ويجهّز الملخص…</Text>
      <Animated.View style={[styles.skeletonBlock, { opacity: pulse }]}>
        <View style={[styles.bar, styles.barFull]} />
        <View style={[styles.bar, styles.barFull]} />
        <View style={[styles.bar, styles.barShort]} />
        <View style={styles.barTable} />
        <View style={[styles.bar, styles.barMedium]} />
      </Animated.View>
    </View>
  );
}

const NODE = 22;

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.goldDark, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 30, height: 30, borderRadius: radii.pill, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.subtitle, color: colors.gold, flex: 1, textAlign: 'right' },
  summary: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },

  table: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  // In the forced RTL layout the row starts on the right: the label column is the right one.
  tableRow: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surfaceElevated },
  tableRowAlt: { backgroundColor: colors.surface },
  tableRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  labelCell: { width: '36%', paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm, borderEndWidth: StyleSheet.hairlineWidth, borderEndColor: colors.border, backgroundColor: 'rgba(201, 162, 39, 0.08)' },
  valueCell: { flex: 1, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm },
  labelText: { ...typography.caption, fontFamily: fonts.medium, color: colors.goldLight, textAlign: 'right' },
  valueText: { ...typography.caption, fontSize: 14, lineHeight: 22, color: colors.textPrimary, textAlign: 'right' },

  blockTitle: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 24, color: colors.textPrimary, textAlign: 'right' },
  stage: { gap: spacing.sm },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  stagePill: { paddingHorizontal: spacing.sm + 2, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.goldDark, maxWidth: '70%' },
  stagePillText: { ...typography.caption, color: colors.goldLight },
  steps: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { flex: 1, alignItems: 'center', gap: spacing.xs },
  track: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  line: { flex: 1, height: 2, backgroundColor: colors.border },
  lineDone: { backgroundColor: colors.gold },
  lineHidden: { backgroundColor: 'transparent' },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  nodeDone: { borderColor: colors.gold, backgroundColor: colors.gold },
  nodeCurrent: { borderColor: colors.gold, backgroundColor: colors.black },
  nodeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  stepLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 2 },
  stepLabelDone: { color: colors.textSecondary },
  stepLabelCurrent: { fontFamily: fonts.semiBold, color: colors.goldLight },
  stageNote: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },

  points: { gap: spacing.xs + 2 },
  pointsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  pointText: { ...typography.caption, fontSize: 14, lineHeight: 22, flex: 1, color: colors.textSecondary, textAlign: 'right' },

  competitors: { gap: spacing.sm },
  sectionTitle: { ...typography.subtitle, color: colors.gold, textAlign: 'right' },
  competitor: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pressed: { opacity: 0.8 },
  competitorTexts: { flex: 1, gap: spacing.xs },
  competitorTitle: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: 'right' },
  competitorWhy: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated },
  tagText: { ...typography.caption, color: colors.textSecondary },
  disclaimer: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },

  fallback: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  fallbackText: { ...typography.caption, flex: 1, color: colors.textMuted, textAlign: 'right' },

  skeletonNote: { ...typography.caption, color: colors.textSecondary, textAlign: 'right' },
  skeletonBlock: { gap: spacing.sm },
  bar: { height: 12, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  barFull: { alignSelf: 'stretch' },
  barMedium: { width: '70%' },
  barShort: { width: '45%' },
  barTable: { height: 96, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
});
