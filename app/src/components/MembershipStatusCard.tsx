import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import type { Membership, MembershipContent } from '@/api/auth';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { cardGlow, cardKindOf, cardLook, PARTNERS_LOGO } from '@/components/membershipLook';
import { PopIn, Sheen, useCountUp } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { showAdvisorBalance } from '@/lib/advisorBalance';
import { formatArabicDate } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type Props = {
  membership: Membership | null;
  texts: MembershipContent['statusTexts'] | undefined;
  activationNote?: string;
  /** Server-driven membership name («العضوية السنوية لنادي المستثمرين»). */
  title?: string;
  /** M122 (owner): a loud subscribe button on the card for a non-member — straight into the purchase popup. */
  subscribeCta?: boolean;
};

/** Membership state as a badge: guest, unactivated, active with the days left, or expired. */
export function MembershipStatusCard({ membership, texts, activationNote, title, subscribeCta }: Props) {
  const status = membership?.status ?? 'guest';
  const active = status === 'active';
  // V2: an active membership is a golden card with a metal sheen; the numbers count up into place.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const daysShown = useCountUp(active ? membership?.daysLeft ?? 0 : 0);
  const advisorLeftShown = useCountUp(active ? membership?.aiDailyLeft ?? 0 : 0);
  const tone = active ? colors.success : status === 'expired' ? colors.danger : status === 'unactivated' ? colors.warning : colors.textMuted;
  const icon = active ? 'shield-checkmark' : status === 'guest' ? 'person-circle-outline' : 'alert-circle-outline';
  // M205: the honorary membership is its own status — never the paid wording, no days, no end date, nothing to buy.
  // M271: and the Success Partners one — its own wording, with its days and end date. Each wears its card's colour.
  const kind = cardKindOf(membership);
  const honorary = kind === 'honorary';
  const given = kind === 'honorary' || kind === 'partner' ? cardLook(kind) : null;
  const label = t(honorary ? 'membership.badge.honorary' : `membership.badge.${status}`);
  const name = honorary ? t('membership.honorary') : kind === 'partner' ? t('membership.partner') : (title ?? t('membership.annual'));
  const line = honorary ? t('membership.status.honorary') : kind === 'partner' ? t('membership.status.partner') : (texts?.[status] ?? t(`membership.status.${status}`));

  const meta =
    membership?.status === 'active' ? (
      <View style={styles.meta}>
        {membership.daysLeft !== null && !honorary ? <Text style={[styles.metaText, given && { color: given.body }]}>{t('membership.daysLeft', { days: daysShown })}</Text> : null}
        {membership.endDate && !honorary ? <Text style={[styles.metaText, given && { color: given.body }]}>{t('membership.endsOn', { date: formatArabicDate(membership.endDate) })}</Text> : null}
        {showAdvisorBalance(membership.aiDailyLeft, membership.aiDailyLimit) ? (
          <Text style={[styles.metaText, given && { color: given.body }]}>{t('membership.advisorBalance', { left: advisorLeftShown, limit: membership.aiDailyLimit })}</Text>
        ) : null}
      </View>
    ) : null;

  // The card is keyed by its kind: a coloured card is another view, never the golden one repainted in place (Android).
  if (given) {
    return (
      <View key={kind} onLayout={(event) => setSize(event.nativeEvent.layout)}>
        <View style={[styles.card, styles.given, { borderColor: given.frame, backgroundColor: given.face, experimental_backgroundImage: given.image, boxShadow: cardGlow(kind) }]}>
          {size.width > 0 ? <Sheen width={size.width} height={size.height} color={given.sweep} /> : null}
          {kind === 'partner' ? (
            <View style={styles.partnerPlate}>
              <Image source={PARTNERS_LOGO} style={styles.partnerLogo} resizeMode="contain" accessibilityLabel={t('card.partnerLogo')} />
            </View>
          ) : null}
          <View style={styles.row}>
            <Ionicons name="shield-checkmark" size={28} color={given.accent} />
            <View style={styles.texts}>
              <View style={styles.badgeRow}>
                <Text style={[styles.title, { color: given.strong }]}>{name}</Text>
                <PopIn delay={160} style={[styles.badge, { backgroundColor: given.pill }]}>
                  <Text style={[styles.badgeText, { color: given.pillInk }]} numberOfLines={1}>{label}</Text>
                </PopIn>
              </View>
              <Text style={[styles.status, { color: given.soft }]}>{line}</Text>
            </View>
          </View>
          {meta}
        </View>
      </View>
    );
  }

  return (
    <View key="plain" onLayout={(event) => setSize(event.nativeEvent.layout)}>
      <GlassCard golden={active} style={styles.card}>
        {active && size.width > 0 ? <Sheen width={size.width} height={size.height} /> : null}
        <View style={styles.row}>
          <Ionicons name={icon} size={28} color={tone} />
          <View style={styles.texts}>
            <View style={styles.badgeRow}>
              <Text style={styles.title}>{name}</Text>
              <PopIn delay={160} style={[styles.badge, { backgroundColor: tone }]}>
                <Text style={styles.badgeText} numberOfLines={1}>{label}</Text>
              </PopIn>
            </View>
            <Text style={styles.status}>{line}</Text>
          </View>
        </View>
        {meta}
        {(status === 'unactivated' || status === 'expired') && activationNote ? <Text style={styles.note}>{activationNote}</Text> : null}
        {subscribeCta && (status === 'unactivated' || status === 'expired') ? (
          <AppButton label={t('gate.activateNow')} icon="card-outline" onPress={showMembershipGate} />
        ) : null}
      </GlassCard>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // M271: the Success Partners and honorary cards (components/membershipLook.ts); the logo sits on its own white plate.
  given: { borderRadius: radii.lg, borderWidth: 1.5, overflow: 'hidden' },
  partnerPlate: { alignSelf: 'flex-start', width: 168, height: 44, borderRadius: radii.md, backgroundColor: '#FFFFFF', paddingHorizontal: spacing.sm, paddingVertical: 6 },
  partnerLogo: { width: '100%', height: '100%' },
  texts: { flex: 1, gap: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // A long server title wraps inside the row instead of pushing the badge out of the card.
  title: { ...typography.subtitle, color: colors.textPrimary, flexShrink: 1, textAlign: textStart },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radii.pill },
  // The badge is a solid status tone (success / warning / danger / muted). Those tones are made to stand out
  // against the page colour of each theme, so the page colour is their ink: near-black in the dark theme,
  // near-white in the light one (the fixed dark `goldInk` was unreadable on the light theme's deep tones).
  badgeText: { ...typography.caption, color: colors.black, fontSize: 12 },
  status: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
  meta: { gap: 2, paddingStart: spacing.xl + spacing.sm },
  metaText: { ...typography.caption, color: colors.goldLightText, textAlign: textStart },
  note: { ...typography.caption, color: colors.textMuted, textAlign: textStart },
}));
