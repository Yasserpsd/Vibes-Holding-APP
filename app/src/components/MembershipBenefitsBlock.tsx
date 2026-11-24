import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Image, ScrollView, Text, View } from 'react-native';

import { useMembershipContent, type MembershipGroup } from '@/api/auth';
import { useHq } from '@/api/hq';
import { launchStart, usePhotoSet } from '@/api/images';
import { useAuth } from '@/auth/AuthProvider';
import { GlassCard, GoldGradient } from '@/components/lux';
import { entranceDelay, FadeInView, PressScale } from '@/components/motion';
import { SectionHeader } from '@/components/SectionHeader';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { iconFor } from '@/lib/icons';
import { sized } from '@/lib/imageUrl';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, spacing, typography } from '@/theme/tokens';

const CARD_WIDTH = 232;
const LINES_SHOWN = 3;
const TITLE_SLOT = 46;
const LINE_SLOT = 40;
const PHOTO_HEIGHT = 112;

/**
 * M261 (owner, 2026-11-22: «كل شئ يخص العضوية مخفي… نبين كل المميزات المخفية»): the membership's benefit
 * groups, on the home, for everyone — one card per group with its first lines, the whole list one tap
 * away on the membership page. The words are the server's membership content (the owner edits them from
 * the dashboard); nothing here is written in the app. Groups still marked «قريبًا» stay on the page only.
 *
 * M270 (owner, 2026-11-25: «في مزايا العضوية عايزين صور المقر كده و صور رائعة مميزة»): every card opens on a
 * photograph of the club — the dashboard set `membership.photo`, or the HQ gallery while that set is empty —
 * with the group's name written on it. Each card takes the next picture and every launch starts the row on a
 * different one. With no picture at all the card keeps its icon-and-title head.
 */
export function MembershipBenefitsBlock() {
  const router = useRouter();
  const { status, me } = useAuth();
  const { data } = useMembershipContent();
  const own = usePhotoSet('membership.photo');
  const hq = useHq().data?.photos;
  const photos = own.length ? own : (hq ?? []);
  const groups = (data?.groups ?? []).filter((group) => !group.comingSoon && group.items.length > 0);
  if (!groups.length) return null;
  const first = launchStart(photos.length);
  const member = status === 'signedIn' && me?.membership.status === 'active';
  const open = () => router.push('/membership');
  return (
    <FadeInView delay={160}>
      <SectionHeader icon="ribbon-outline" title={t(member ? 'home.benefitsMine' : 'home.benefitsTitle')} cta={t('home.benefitsAll')} onPress={open} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {groups.map((group, index) => (
          <FadeInView key={group.key} delay={entranceDelay(index)}>
            <BenefitCard group={group} photo={photos.length ? photos[(first + index) % photos.length] : undefined} onPress={open} />
          </FadeInView>
        ))}
      </ScrollView>
    </FadeInView>
  );
}

function BenefitCard({ group, photo, onPress }: { group: MembershipGroup; photo?: string; onPress: () => void }) {
  const rest = group.items.length - LINES_SHOWN;
  // Owner's TestFlight pass (2026-11-22: «لازم شكل الكروت دي يتوحد كله يكون نفس المقاس»): every card is the same
  // size whatever its words — the title, each of the three lines and the footer hold a fixed slot (two lines of
  // text each), and a group with fewer lines keeps its empty slots.
  const slots = Array.from({ length: LINES_SHOWN }, (_, index) => group.items[index] ?? null);
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.lg} accessibilityRole="button" accessibilityLabel={group.title}>
      <GlassCard golden radius={radii.lg} style={[styles.card, photo ? styles.photoCard : null]}>
        {photo ? (
          <View style={styles.photo}>
            <Image source={{ uri: sized(photo, CARD_WIDTH) }} style={styles.fill} resizeMode="cover" resizeMethod="resize" accessibilityIgnoresInvertColors />
            <View style={[styles.fill, styles.scrim]} />
            <View style={styles.photoHead}>
              <GoldGradient style={styles.photoIcon}>
                <Ionicons name={iconFor(group.icon, 'checkmark-circle-outline')} size={17} color={colors.goldInk} />
              </GoldGradient>
              <Text style={styles.photoTitle} numberOfLines={2}>
                {group.title}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.head}>
            <View style={styles.icon}>
              <Ionicons name={iconFor(group.icon, 'checkmark-circle-outline')} size={20} color={colors.gold} />
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {group.title}
            </Text>
          </View>
        )}
        <View style={photo ? styles.body : styles.plain}>
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
        </View>
      </GlassCard>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  card: { width: CARD_WIDTH, padding: spacing.md, gap: spacing.xs },
  // With a photograph the picture runs edge to edge, so the padding moves to the lines under it.
  photoCard: { padding: 0, gap: 0, overflow: 'hidden' },
  photo: { height: PHOTO_HEIGHT, backgroundColor: '#0B0B0E', justifyContent: 'flex-end' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: { experimental_backgroundImage: gradients.scrim },
  photoHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 4, paddingBottom: spacing.sm },
  photoIcon: { width: 30, height: 30, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  photoTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.onPhoto, textAlign: textStart },
  body: { padding: spacing.md, paddingTop: spacing.sm, gap: spacing.xs },
  plain: { gap: spacing.xs },
  icon: { width: 36, height: 36, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldSoft },
  // Slot heights = two lines of each text style (title 23 × 2, caption 20 × 2), so one-line and two-line cards match.
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs, minHeight: TITLE_SLOT },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, lineHeight: 23, color: colors.goldLightText, textAlign: textStart },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, minHeight: LINE_SLOT },
  tick: { marginTop: 4 },
  lineText: { ...typography.caption, flex: 1, color: colors.textPrimary, textAlign: textStart },
  more: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 18, color: colors.goldText, textAlign: textStart, marginTop: spacing.xs },
}));
