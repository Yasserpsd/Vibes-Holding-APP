import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useProjectBrief } from '@/api/queries';
import type { ProjectBrief as Brief } from '@/api/types';
import { Highlight } from '@/components/Highlight';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, GrowBar, PopIn, PressScale, usePulse, Wiggle } from '@/components/motion';
import { t } from '@/i18n';
import { chevronForward, textStart } from '@/i18n/direction';
import { topicIcon, type IoniconName } from '@/lib/icons';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

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
        <Text style={styles.fallbackText}>{t('brief.unavailable')}</Text>
      </View>
    );
  }
  return <BriefBody brief={query.data} />;
}

/** M95 (owner): «مش عايز اي خانات فاضية» — a row whose value is empty or a placeholder never renders.
 *  M116b (owner: «مش عايز اي حاجه unknown نهائي»): the unknowns joined the list, matched by PREFIX,
 *  so «غير مذكور صراحة» and every long-winded cousin fall too. */
export const EMPTY_VALUE =
  /^(?:[-—ـ_.?؟]+|n\/?a|none|null|بدون|(?:unknown|unspecified|not\s+(?:specified|stated|mentioned|available)|غير\s+(?:محدد|محددة|معروف|معروفة|متوفر|متوفرة|مذكور|مذكورة|متاح|متاحة|واضح|واضحة)|لا\s+(?:يوجد|توجد)|لم\s+(?:يُ?حدد|تُ?حدد|يُ?ذكر|تُ?ذكر))(?:\s.*)?)$/iu;

/** M116b (owner: «الكلام ورا بعض يتظبط ويتفنط»): the summary wall becomes tidy sentence lines. */
function summaryLines(summary: string): string[] {
  return summary
    .split(/(?<=[.!؟?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);
}

function BriefBody({ brief }: { brief: Brief }) {
  const router = useRouter();
  const rows = brief.table.filter((row) => {
    const value = row.value.trim();
    return value.length > 0 && !EMPTY_VALUE.test(value);
  });
  return (
    <View style={styles.wrap}>
      <FadeInView delay={entranceDelay(0)}>
        <GlassCard golden radius={radii.lg} style={styles.card}>
          <View style={styles.header}>
            <View style={styles.mark}>
              <Ionicons name="sparkles" size={16} color={colors.black} />
            </View>
            <Text style={styles.headerTitle}>{t('brief.title')}</Text>
          </View>

          {/* M116b (owner): the TABLE leads; no paragraph wall above it. */}
          {rows.length ? (
            <View style={styles.table}>
              {rows.map((row, index) => (
                <View key={`${row.label}:${index}`} style={[styles.tableRow, index > 0 && styles.tableRowBorder, index % 2 === 1 && styles.tableRowAlt]}>
                  <View style={styles.labelCell}>
                    {/* M80: every fact row carries its own signpost icon — M84e: it pops in, row after row. */}
                    <PopIn delay={entranceDelay(index, 50)} style={styles.labelIcon}>
                      <Ionicons name={topicIcon(row.label)} size={14} color={colors.goldDark} />
                    </PopIn>
                    <Text style={styles.labelText}>{row.label}</Text>
                  </View>
                  <View style={styles.valueCell}>
                    {/* M95: the figures light up in gold inside the value. */}
                    <Highlight text={row.value} style={styles.valueText} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* The stage stepper rides right under the facts. */}
          <StageStepper stage={brief.stage} />

          {/* M116b: the summary follows the table as tidy sentence lines, never a text wall. */}
          {brief.summary ? <Points title={t('brief.about')} icon="reader-outline" tone={colors.gold} items={summaryLines(brief.summary)} /> : null}

          <Points title={t('brief.strengths')} icon="trending-up-outline" tone={colors.success} items={brief.strengths} />
          <Points title={t('brief.risks')} icon="alert-circle-outline" tone={colors.warning} items={brief.risks} />
        </GlassCard>
      </FadeInView>

      {brief.competitors.length ? (
        <FadeInView delay={entranceDelay(1)}>
          <View style={styles.competitors}>
            {/* M80 (owner): every big heading carries its icon. */}
            <View style={styles.sectionTitleRow}>
              <PopIn delay={160}>
                <Ionicons name="git-compare-outline" size={18} color={colors.gold} />
              </PopIn>
              <Text style={styles.sectionTitle}>{t('brief.competitors')}</Text>
            </View>
            {brief.competitors.map((competitor) => (
              <PressScale
                key={competitor.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/project/[id]', params: { id: String(competitor.id) } })}
              >
                <GlassCard radius={radii.lg} style={styles.competitor}>
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
                  <Ionicons name={chevronForward()} size={18} color={colors.goldDark} />
                </GlassCard>
              </PressScale>
            ))}
          </View>
        </FadeInView>
      ) : null}

      <FadeInView delay={entranceDelay(2)}>
        <Text style={styles.disclaimer}>{brief.disclaimer}</Text>
      </FadeInView>
    </View>
  );
}

/** Where the project stands on the five steps; the feed's own wording sits beside the title. */
function StageStepper({ stage }: { stage: Brief['stage'] }) {
  const known = stage.index >= 0 && stage.index < stage.steps.length;
  // M98 (owner): an unknown stage shows NOTHING — no flag, no «غير محدد» pill, no stepper.
  if (!known) return null;
  return (
    <View style={styles.stage}>
      <View style={styles.stageHeader}>
        {/* M84e: the stage flag waves once as the card settles. */}
        <Wiggle delay={500}>
          <Ionicons name="flag-outline" size={16} color={colors.gold} />
        </Wiggle>
        <Text style={styles.blockTitle}>{t('brief.stage')}</Text>
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
                <View style={styles.lineSlot}>
                  {index === 0 ? null : done || current ? (
                    <GrowBar percent={100} height={2} color={colors.gold} trackColor={colors.border} delay={entranceDelay(index, 90)} />
                  ) : (
                    <View style={styles.line} />
                  )}
                </View>
                <View style={[styles.node, done && styles.nodeDone, current && styles.nodeCurrent]}>
                  {done ? <Ionicons name="checkmark" size={12} color={colors.black} /> : null}
                  {current ? <View style={styles.nodeDot} /> : null}
                </View>
                <View style={styles.lineSlot}>
                  {index === stage.steps.length - 1 ? null : done ? (
                    <GrowBar percent={100} height={2} color={colors.gold} trackColor={colors.border} delay={entranceDelay(index, 90)} />
                  ) : (
                    <View style={styles.line} />
                  )}
                </View>
              </View>
              <Text style={[styles.stepLabel, done && styles.stepLabelDone, current && styles.stepLabelCurrent]} numberOfLines={3}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>
      {stage.estimated ? <Text style={styles.stageNote}>{t('brief.stageEstimated')}</Text> : null}
    </View>
  );
}

function Points({ title, icon, tone, items }: { title: string; icon: IoniconName; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.points}>
      <View style={styles.pointsHeader}>
        <PopIn delay={160}>
          <Ionicons name={icon} size={18} color={tone} />
        </PopIn>
        <Text style={styles.blockTitle}>{title}</Text>
      </View>
      {items.map((item) => (
        <View key={item} style={styles.point}>
          <View style={[styles.bullet, { backgroundColor: tone }]} />
          {/* M95: figures inside a point take the section's own tone — greens for strengths, amber for risks. */}
          <Highlight text={item} style={styles.pointText} tone={tone} />
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
  const pulse = usePulse(0.45, 1);
  return (
    <View accessibilityLabel={t('brief.preparingLabel')}>
      <GlassCard golden radius={radii.lg} style={styles.card}>
        <View style={styles.header}>
          <View style={styles.mark}>
            <Ionicons name="sparkles" size={16} color={colors.black} />
          </View>
          <Text style={styles.headerTitle}>{t('brief.title')}</Text>
        </View>
        <Text style={styles.skeletonNote}>{t('brief.preparing')}</Text>
        <Animated.View style={[styles.skeletonBlock, { opacity: pulse }]}>
          <View style={[styles.bar, styles.barFull]} />
          <View style={[styles.bar, styles.barFull]} />
          <View style={[styles.bar, styles.barShort]} />
          <View style={styles.barTable} />
          <View style={[styles.bar, styles.barMedium]} />
        </Animated.View>
      </GlassCard>
    </View>
  );
}

const NODE = 22;

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { gap: spacing.md, padding: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: { width: 30, height: 30, borderRadius: radii.pill, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', boxShadow: shadows.glowGoldFaint },
  headerTitle: { ...typography.subtitle, color: colors.gold, flex: 1, textAlign: textStart },
  summary: { ...typography.body, color: colors.textPrimary, textAlign: textStart },

  table: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  // In the forced RTL layout the row starts on the right: the label column is the right one.
  tableRow: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surfaceElevated },
  tableRowAlt: { backgroundColor: colors.surface },
  tableRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  labelCell: { width: '36%', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm, borderEndWidth: StyleSheet.hairlineWidth, borderEndColor: colors.border, backgroundColor: colors.goldFaint },
  labelIcon: { marginTop: 3 },
  valueCell: { flex: 1, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm },
  labelText: { ...typography.caption, fontFamily: fonts.medium, color: colors.goldLight, textAlign: textStart, flex: 1 },
  valueText: { ...typography.caption, fontSize: 14, lineHeight: 22, color: colors.textPrimary, textAlign: textStart },

  blockTitle: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  stage: { gap: spacing.sm },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  stagePill: { paddingHorizontal: spacing.sm + 2, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderGold, backgroundColor: colors.goldFaint, maxWidth: '70%' },
  stagePillText: { ...typography.caption, color: colors.goldLight },
  steps: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { flex: 1, alignItems: 'center', gap: spacing.xs },
  track: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  lineSlot: { flex: 1 },
  line: { height: 2, borderRadius: 1, backgroundColor: colors.border },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  nodeDone: { borderColor: colors.gold, backgroundColor: colors.gold },
  nodeCurrent: { borderColor: colors.gold, backgroundColor: colors.black, boxShadow: shadows.glowGoldFaint },
  nodeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  stepLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 2 },
  stepLabelDone: { color: colors.textSecondary },
  stepLabelCurrent: { fontFamily: fonts.semiBold, color: colors.goldLight },
  stageNote: { ...typography.caption, color: colors.textMuted, textAlign: textStart },

  points: { gap: spacing.xs + 2 },
  pointsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  pointText: { ...typography.caption, fontSize: 14, lineHeight: 22, flex: 1, color: colors.textSecondary, textAlign: textStart },

  competitors: { gap: spacing.sm },
  sectionTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart, flex: 1 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  competitor: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  competitorTexts: { flex: 1, gap: spacing.xs },
  competitorTitle: { ...typography.body, fontFamily: fonts.semiBold, color: colors.textPrimary, textAlign: textStart },
  competitorWhy: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated },
  tagText: { ...typography.caption, color: colors.textSecondary },
  disclaimer: { ...typography.caption, color: colors.textMuted, textAlign: textStart },

  fallback: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  fallbackText: { ...typography.caption, flex: 1, color: colors.textMuted, textAlign: textStart },

  skeletonNote: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  skeletonBlock: { gap: spacing.sm },
  bar: { height: 12, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  barFull: { alignSelf: 'stretch' },
  barMedium: { width: '70%' },
  barShort: { width: '45%' },
  barTable: { height: 96, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
});
