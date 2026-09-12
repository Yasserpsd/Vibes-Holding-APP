import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { Membership, MembershipContent } from '@/api/auth';
import { formatArabicDate } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  membership: Membership | null;
  texts: MembershipContent['statusTexts'] | undefined;
  activationNote?: string;
  /** Server-driven membership name («العضوية السنوية لنادي المستثمرين»). */
  title?: string;
};

const FALLBACK_TEXTS: MembershipContent['statusTexts'] = {
  guest: 'سجّل الدخول أو أنشئ حسابك لعرض حالة عضويتك.',
  unactivated: 'عضويتك غير مفعّلة، برجاء تفعيل عضويتك.',
  active: 'عضويتك فعّالة.',
  expired: 'انتهت عضويتك، برجاء تجديد عضويتك.',
};

/** Membership state as a badge: guest, unactivated, active with the days left, or expired. */
export function MembershipStatusCard({ membership, texts, activationNote, title }: Props) {
  const t = texts ?? FALLBACK_TEXTS;
  const status = membership?.status ?? 'guest';
  const tone = status === 'active' ? colors.success : status === 'expired' ? colors.danger : status === 'unactivated' ? colors.warning : colors.textMuted;
  const icon = status === 'active' ? 'shield-checkmark' : status === 'guest' ? 'person-circle-outline' : 'alert-circle-outline';
  const label = status === 'active' ? 'عضو' : status === 'expired' ? 'منتهية' : status === 'unactivated' ? 'غير مفعّلة' : 'زائر';

  return (
    <View style={[styles.card, { borderColor: tone }]}>
      <View style={styles.row}>
        <Ionicons name={icon} size={28} color={tone} />
        <View style={styles.texts}>
          <View style={styles.badgeRow}>
            <Text style={styles.title}>{title ?? 'العضوية السنوية'}</Text>
            <View style={[styles.badge, { backgroundColor: tone }]}>
              <Text style={styles.badgeText}>{label}</Text>
            </View>
          </View>
          <Text style={styles.status}>{t[status]}</Text>
        </View>
      </View>
      {membership?.status === 'active' ? (
        <View style={styles.meta}>
          {membership.daysLeft !== null ? <Text style={styles.metaText}>{`المتبقي ${membership.daysLeft} يومًا`}</Text> : null}
          {membership.endDate ? <Text style={styles.metaText}>{`تنتهي في ${formatArabicDate(membership.endDate)}`}</Text> : null}
          {membership.aiDailyLeft !== null ? (
            <Text style={styles.metaText}>{`رصيد المستشار اليوم: ${membership.aiDailyLeft} من ${membership.aiDailyLimit}`}</Text>
          ) : null}
        </View>
      ) : null}
      {(status === 'unactivated' || status === 'expired') && activationNote ? <Text style={styles.note}>{activationNote}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  texts: { flex: 1, gap: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.textPrimary },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  badgeText: { ...typography.caption, color: colors.black, fontSize: 12 },
  status: { ...typography.body, color: colors.textSecondary, textAlign: 'right' },
  meta: { gap: 2, paddingStart: spacing.xl + spacing.sm },
  metaText: { ...typography.caption, color: colors.goldLight, textAlign: 'right' },
  note: { ...typography.caption, color: colors.textMuted, textAlign: 'right' },
});
