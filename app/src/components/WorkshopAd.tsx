import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Modal, StyleSheet, Text, View } from 'react-native';

import { apiGet } from '@/api/client';
import { useHq } from '@/api/hq';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn, PressScale } from '@/components/motion';
import { SarText } from '@/components/SarText';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { formatEventDays, formatNumber } from '@/lib/format';
import { sized } from '@/lib/imageUrl';
import { colors, fonts, gradients, radii, shadows, spacing, typography } from '@/theme/tokens';

/** Mirrors server/src/agenda/ad.ts. */
type WorkshopAd = {
  eventId: string;
  title: string;
  date: string;
  dates: string[];
  time: string;
  imageUrl: string | null;
  feeSar: number;
  memberFeeSar: number;
  headline: string;
  body: string;
  cta: string;
  day: string;
};

const SEEN_KEY = 'investorsclub.workshopAd.day';
/** The first-open intro film goes first; the workshop ad starts from the next open. */
const INTRO_SEEN_KEY = 'investorsclub.introSeen.v2';
const LRM = '‎';

/**
 * M177 (owner, 2026-11-01): «كل اللي يدخل يشوف الورشة مرة في اليوم» — the opening popup, once per Riyadh day:
 * the next open workshop with the day's AI-written words (server/src/agenda/ad.ts), its photo (the HQ photo
 * when it has none) and one button to its page. Closing it leaves the home exactly as it was.
 * Owner (2026-11-02): the X over the photo never responded on real phones — removed; «لاحقًا» (and the
 * Android back button) is the one way out.
 */
export function WorkshopAdPopup() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const query = useQuery({ queryKey: ['workshop-ad'], queryFn: () => apiGet<{ ad: WorkshopAd | null }>('/api/workshop-ad'), staleTime: 30 * 60_000 });
  const hqPhoto = useHq().data?.photos?.[0] ?? null;
  const ad = query.data?.ad ?? null;

  useEffect(() => {
    if (!ad) return;
    let alive = true;
    void Promise.all([loadSetting(SEEN_KEY), loadSetting(INTRO_SEEN_KEY)]).then(([seenDay, introSeen]) => {
      if (alive && introSeen && seenDay !== ad.day) setVisible(true);
    });
    return () => {
      alive = false;
    };
  }, [ad]);

  if (!visible || !ad) return null;

  // Seen on ANY way out: tomorrow brings a new ad.
  const dismiss = () => {
    setVisible(false);
    void saveSetting(SEEN_KEY, ad.day);
  };
  const open = () => {
    dismiss();
    router.push(`/agenda/${ad.eventId}` as Href);
  };
  const photo = ad.imageUrl ?? hqPhoto;
  const when = `${formatEventDays(ad.dates, ad.date)}${ad.time ? ` · ${LRM}${ad.time}` : ''}`;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <PressScale onPress={open} accessibilityRole="button" accessibilityLabel={ad.title}>
              <View style={styles.photoBox}>
                {photo ? <Image source={{ uri: sized(photo, 600) }} style={styles.photo} resizeMode="cover" /> : <View style={styles.photo} />}
                <View style={styles.badge}>
                  <Ionicons name="school" size={13} color={colors.goldInk} />
                  <Text style={styles.badgeText}>{t('workshopAd.badge')}</Text>
                </View>
              </View>
            </PressScale>
            <Text style={styles.headline}>{ad.headline}</Text>
            <Text style={styles.body}>{ad.body}</Text>
            <View style={styles.facts}>
              <Text style={styles.title} numberOfLines={2}>{ad.title}</Text>
              <Text style={styles.when}>{when}</Text>
              {ad.feeSar > 0 ? (
                <SarText style={styles.fee}>
                  {ad.memberFeeSar > 0
                    ? t('workshopAd.feeBoth', { fee: formatNumber(ad.feeSar), member: formatNumber(ad.memberFeeSar) })
                    : t('workshopAd.feeMemberIncluded', { fee: formatNumber(ad.feeSar) })}
                </SarText>
              ) : null}
            </View>
            <AppButton label={ad.cta} icon="flash-outline" onPress={open} />
            <AppButton label={t('workshopAd.later')} variant="outline" onPress={dismiss} />
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch' },
  card: { gap: spacing.sm, padding: spacing.md },
  photoBox: { borderRadius: radii.lg, overflow: 'hidden' },
  photo: { width: '100%', height: 190, backgroundColor: colors.surfaceElevated },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    start: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 12, lineHeight: 16, color: colors.goldInk },
  headline: { ...typography.title, fontSize: 21, lineHeight: 33, color: colors.gold, textAlign: textStart, marginTop: spacing.xs },
  body: { ...typography.body, fontSize: 15, lineHeight: 25, color: colors.textPrimary, textAlign: textStart },
  facts: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.borderGoldSoft },
  title: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 22, color: colors.goldLight, textAlign: textStart },
  when: { ...typography.caption, color: colors.textSecondary, textAlign: textStart },
  fee: { ...typography.caption, fontFamily: fonts.medium, color: colors.textPrimary, textAlign: textStart },
});
