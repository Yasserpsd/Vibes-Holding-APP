import { useRouter, type Href } from 'expo-router';
import { Text, View } from 'react-native';

import { useHq, useHqWallet } from '@/api/hq';
import { useAuth } from '@/auth/AuthProvider';
import { AppButton } from '@/components/AppButton';
import { GlassCard, GoldGradient } from '@/components/lux';
import { GrowBar } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { formatHours, formatNumber } from '@/lib/format';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M261 (owner, 2026-11-22: «حجز المقر… ويبان جدا انه حجز غرفة الاجتماعات لمدة 24 ساعة»): the membership's
 * annual wallet of meeting-room / private-office hours, said LOUD — the number in a gold badge, the
 * member's live remainder as a bar, and one-tap doors into the booking screen on the right kind.
 * The number is the server's (`walletHours`, the member's own wallet once it loads); a non-member
 * reads the same benefit with a door to the membership page (never a payment link — rule 3).
 */
export function HqHoursCard({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { status } = useAuth();
  const { data } = useHq();
  const member = data?.access === 'member';
  const wallet = useHqWallet(status === 'signedIn' && member);
  if (!data) return null;
  const total = wallet.data?.wallet.total ?? data.content.walletHours ?? 0;
  if (total <= 0) return null;
  const remaining = wallet.data?.wallet.remaining ?? total;
  // «24 ساعة» splits into the badge's big numeral and its unit; a count the language spells out («ساعتان») keeps the digit.
  const words = formatHours(total).split(' ');
  const big = words.length > 1 ? (words[0] ?? '') : formatNumber(total);
  const unit = words.length > 1 ? words.slice(1).join(' ') : t('hq.hoursUnit');
  const book = (kind: 'meeting' | 'office') => router.push({ pathname: '/hq/book', params: { kind } } as Href);

  return (
    <GlassCard golden radius={radii.xl} style={styles.card}>
      <View style={styles.head}>
        <GoldGradient style={styles.badge}>
          <Text style={styles.badgeNumber} numberOfLines={1} adjustsFontSizeToFit>
            {big}
          </Text>
          <Text style={styles.badgeUnit} numberOfLines={1}>
            {unit}
          </Text>
        </GoldGradient>
        <View style={styles.texts}>
          <Text style={styles.title}>{t('hq.hoursTitle')}</Text>
          <Text style={styles.subtitle}>{member ? t('hq.hoursMember') : t('hq.hoursGuest', { hours: formatHours(total) })}</Text>
        </View>
      </View>
      {member && wallet.data ? (
        <View style={styles.meter}>
          <GrowBar percent={(remaining / total) * 100} height={8} />
          <Text style={styles.left}>{t('hq.walletLine', { left: formatNumber(remaining), total: formatNumber(total) })}</Text>
        </View>
      ) : null}
      {member ? (
        <View style={styles.actions}>
          <AppButton label={t('hq.bookMeeting')} icon="people-outline" onPress={() => book('meeting')} style={styles.action} />
          {compact ? null : <AppButton label={t('hq.bookOffice')} variant="outline" icon="briefcase-outline" onPress={() => book('office')} style={styles.action} />}
        </View>
      ) : (
        <AppButton label={t('hq.seeBenefits')} variant="outline" icon="ribbon-outline" onPress={() => router.push('/membership')} />
      )}
    </GlassCard>
  );
}

const styles = themedStyles(() => ({
  card: { padding: spacing.md, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { width: 76, height: 76, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeNumber: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 38, color: colors.goldInk, textAlign: 'center' },
  badgeUnit: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 18, color: colors.goldInk, textAlign: 'center' },
  texts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 27, color: colors.textPrimary, textAlign: textStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  meter: { gap: spacing.xs },
  left: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 20, color: colors.goldLightText, textAlign: textStart },
  // Emulator pass 2026-11-22: side by side the two labels were cut («Book the meeting ro…») and the wrapped row
  // left an empty band under them — one full-width button per line reads whole in both languages.
  actions: { gap: spacing.sm },
  action: { alignSelf: 'stretch' },
}));
