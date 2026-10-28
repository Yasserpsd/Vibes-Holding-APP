import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { AdvisorAction, HqProposal } from '@/api/advisor';
import { AppButton } from '@/components/AppButton';
import { Chip } from '@/components/Chip';
import { GlassCard } from '@/components/lux';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

export type HqBookAction = Extract<AdvisorAction, { type: 'hq_book' }>;

type Props = {
  action: HqBookAction;
  busy: boolean;
  /** A chip changed the proposal: the server re-checks it (free slots, missing parts). */
  onPick: (proposal: HqProposal) => void;
  onConfirm: (proposal: HqProposal) => void;
};

/**
 * M145: the booking the advisor understood, as a card inside the chat — the summary lines, chips
 * for whatever is still missing (day, free time, purpose), and «تأكيد الحجز» once complete.
 * Confirming calls the same booking API the HQ screen uses, with the member's own session.
 */
export function HqProposalCard({ action, busy, onPick, onConfirm }: Props) {
  const { proposal, missing, options } = action;
  const space = proposal.kind !== 'visit';
  const complete = missing.length === 0;
  const pick = (patch: Partial<HqProposal>) => {
    if (busy) return;
    // A new kind or duration changes which slots are free: the time is chosen again.
    const resetsTime = patch.kind !== undefined || patch.hours !== undefined || patch.date !== undefined;
    onPick({ ...proposal, ...patch, ...(resetsTime ? { time: null } : {}) });
  };
  return (
    <GlassCard radius={radii.md} style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="calendar-outline" size={18} color={colors.gold} />
        <Text style={styles.title}>{t('advisor.act.title')}</Text>
      </View>
      {action.summary.map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}

      <Text style={styles.label}>{t('advisor.act.kind')}</Text>
      <View style={styles.chips}>
        {options.kinds.map((kind) => (
          <Chip key={kind.key} label={kind.label} selected={kind.key === proposal.kind} onPress={() => pick({ kind: kind.key, hours: kind.key === 'visit' ? 1 : proposal.hours })} />
        ))}
      </View>

      {space ? (
        <>
          <Text style={styles.label}>{t('advisor.act.hours')}</Text>
          <View style={styles.chips}>
            {options.hours.slice(0, 8).map((hours) => (
              <Chip key={hours} label={String(hours)} selected={hours === proposal.hours} onPress={() => pick({ hours })} />
            ))}
          </View>
        </>
      ) : null}

      {missing.includes('date') || proposal.date ? (
        <>
          <Text style={styles.label}>{t('advisor.act.pickDay')}</Text>
          <View style={styles.chips}>
            {options.days.map((day) => (
              <Chip key={day.date} label={day.label} selected={day.date === proposal.date} onPress={() => pick({ date: day.date })} />
            ))}
          </View>
        </>
      ) : null}

      {proposal.date ? (
        <>
          <Text style={styles.label}>{t('advisor.act.pickTime')}</Text>
          {options.times.length ? (
            <View style={styles.chips}>
              {options.times.map((time) => (
                <Chip key={time} label={time} selected={time === proposal.time} onPress={() => pick({ time })} />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>{t('advisor.act.noTimes')}</Text>
          )}
        </>
      ) : null}

      {!space ? (
        <>
          <Text style={styles.label}>{t('advisor.act.pickPurpose')}</Text>
          <View style={styles.chips}>
            {options.purposes.map((purpose) => (
              <Chip key={purpose} label={purpose} selected={purpose === proposal.purpose} onPress={() => pick({ purpose })} />
            ))}
          </View>
        </>
      ) : null}

      <AppButton
        label={busy ? t('advisor.act.working') : complete ? t('advisor.act.confirm') : t('advisor.act.incomplete')}
        icon={complete ? 'checkmark-circle-outline' : 'time-outline'}
        loading={busy}
        disabled={!complete || busy}
        onPress={() => (complete && !busy ? onConfirm(proposal) : null)}
      />
      <Text style={styles.foot}>{t('advisor.act.foot')}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.xs, alignSelf: 'stretch' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  title: { ...typography.body, fontFamily: fonts.semiBold, color: colors.gold, textAlign: textStart },
  line: { ...typography.body, color: colors.textPrimary, textAlign: textStart },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: textStart, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  empty: { ...typography.caption, color: colors.warning, textAlign: textStart },
  foot: { ...typography.caption, color: colors.textMuted, textAlign: textStart, marginTop: spacing.xs },
});
