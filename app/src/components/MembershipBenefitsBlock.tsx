import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { useMembershipContent, type MembershipGroup } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { GlassCard } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { iconFor } from '@/lib/icons';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

const CARD_WIDTH = 232;
const LINES_SHOWN = 3;
const TITLE_SLOT = 46;
const LINE_SLOT = 40;

/**
 * M261 (owner, 2026-11-22: «كل شئ يخص العضوية مخفي… نبين كل المميزات المخفية»): the membership's benefit
 * groups, on the home, for everyone — one card per group with its first lines, the whole list one tap
 * away on the membership page. The words are the server's membership content (the owner edits them from
 * the dashboard); nothing here is written in the app. Groups still marked «قريبًا» stay on the page only.
 */
export function MembershipBenefitsBlock() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data } = useMembershipContent();
  const groups = (data?.groups ?? []).filter((group) => !group.comingSoon && group.items.length > 0);
  if (!groups.length) return null;
  const member = status === 'signedIn' && me?.membership.status === 'active';
  const open = () => router.push('/membership');
  return (
    <FadeInView delay={160}>
      <SectionHeader icon="ribbon-outline" title={t(member ? 'home.benefitsMine' : 'home.benefitsTitle')} cta={t('home.benefitsAll')} onPress={open} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {groups.map((group, index) => (
          <FadeInView key={group.key} delay={entranceDelay(index)}>
            <BenefitCard group={group} onPress={open} />
          </FadeInView>
        ))}
      </ScrollView>
    </FadeInView>
  );
}

function BenefitCard({ group, onPress }: { group: MembershipGroup; onPress: () => void }) {
  const rest = group.items.length - LINES_SHOWN;
  // Owner's TestFlight pass (2026-11-22: «لازم شكل الكروت دي يتوحد كله يكون نفس المقاس»): every card is the same
  // size whatever its words — the title, each of the three lines and the footer hold a fixed slot (two lines of
  // text each), and a group with fewer lines keeps its empty slots.
  const slots = Array.from({ length: LINES_SHOWN }, (_, index) => group.items[index] ?? null);
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={group.title}>
      <GlassCard golden radius={radii.lg} style={styles.card}>
        <View style={styles.head}>
          <View style={styles.icon}>
            <Ionicons name={iconFor(group.icon, 'checkmark-circle-outline')} size={20} color={colors.gold} />
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {group.title}
          </Text>
        </View>
        {slots.map((item, index) => (
          <View key={item?.text ?? `empty-${index}`} style={styles.line}>
            {item ? (
              <>
                <Ionicons name="checkmark-circle" size={14} color={colors.goldText} style={styles.tick} />
                <Text style={styles.lineText} numberOfLines={2}>
                  {item.text}
                </Text>
              </>
            ) : null}
          </View>
        ))}
        <Text style={styles.more} numberOfLines={1}>
          {rest > 0 ? t('home.benefitsMore', { count: rest }) : t('home.benefitsAll')}
        </Text>
      </GlassCard>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  card: { width: CARD_WIDTH, padding: spacing.md, gap: spacing.xs },
  icon: { width: 36, height: 36, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  // Slot heights = two lines of each text style (title 23 × 2, caption 20 × 2), so one-line and two-line cards match.
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs, minHeight: TITLE_SLOT },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 23, color: colors.goldLightText, textAlign: textStart },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, minHeight: LINE_SLOT },
  tick: { marginTop: 4 },
  lineText: { ...typography.caption, flex: 1, color: colors.textPrimary, textAlign: textStart },
  more: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 18, color: colors.goldText, textAlign: textStart, marginTop: spacing.xs },
}));
