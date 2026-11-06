import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nManager, Modal, Text, View } from 'react-native';

import type { Me } from '@/api/auth';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn } from '@/components/motion';
import { t } from '@/i18n';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { claimAutoPopup } from '@/lib/popupGate';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M103 «كمّل بياناتك»: a meter (golden dots, since M209e a gold arc) around the member's avatar shows how complete his
 * profile is, and a one-time popup (repeated gently every 7 days while incomplete) sends him to
 * the profile editor — the club knows its members better, and members find each other.
 */
const NUDGE_KEY = 'investorsclub.profileNudgeAt';
const NUDGE_DAYS = 7;
// Left/right style props mirror under RTL unless the app turned the swap off; the arc colours follow.
const MIRRORED = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL;

/** The profile fields that count, equally weighted: only what the member can fill in the app's editor. */
export function profileCompletion(me: Me): number {
  const fields = [me.jobTitle, me.company, me.city, me.bio, me.website, me.social];
  const filled = fields.filter((value) => Boolean(value && String(value).trim())).length;
  return Math.round((filled / fields.length) * 100);
}

/**
 * M209e (owner, 2026-11-07: the dots looked like «لمبات أفراح»): a thin continuous gold arc around the avatar
 * follows the completion over a dim track. Pure Views, no SVG: two windows each clip one half of the frame,
 * and inside each a full circle whose far half is transparent turns to reveal the sweep.
 * Positions stay centred (RTL swaps left/right); the halves move by translateX, which never mirrors.
 */
export function CompletionMeter({ percent, size, children }: { percent: number; size: number; children: ReactNode }) {
  const frame = size + 16;
  const stroke = 3;
  const quarter = frame / 4;
  const sweep = Math.max(0, Math.min(100, percent)) * 3.6;
  const halves = [
    // The right half shows 0°–180° (from the top, clockwise); the left half the rest.
    { key: 'right', shift: quarter, deg: Math.min(sweep, 180), base: 45 },
    { key: 'left', shift: -quarter, deg: Math.max(0, sweep - 180), base: -135 },
  ];
  return (
    <View style={{ width: frame, height: frame, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.ring, { width: frame, height: frame, borderRadius: frame / 2, borderWidth: stroke }]} />
      {halves.map(({ key, shift, deg, base }) =>
        deg > 0 ? (
          <View
            key={key}
            pointerEvents="none"
            style={[styles.half, { width: frame / 2, height: frame, left: quarter, transform: [{ translateX: shift }] }]}
          >
            <View
              style={[
                styles.arc,
                {
                  width: frame,
                  height: frame,
                  borderRadius: frame / 2,
                  borderWidth: stroke,
                  left: -quarter,
                  transform: [{ translateX: -shift }, { rotate: `${base + deg}deg` }],
                },
              ]}
            />
          </View>
        ) : null,
      )}
      {children}
      {percent < 100 ? (
        <PopIn delay={320} style={styles.badgeWrap}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{percent}%</Text>
          </View>
        </PopIn>
      ) : null}
    </View>
  );
}

/** The gentle popup: shown when the profile is incomplete, at most once every 7 days. */
export function CompleteProfilePopup({ me }: { me: Me }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const percent = profileCompletion(me);

  useEffect(() => {
    if (percent >= 100) return;
    let alive = true;
    void loadSetting(NUDGE_KEY).then((seenAt) => {
      const last = seenAt ? Date.parse(seenAt) : 0;
      // M204: it shares the M128 slot — one self-opening popup per launch; the basic details and the number come first.
      if (alive && (!last || Date.now() - last > NUDGE_DAYS * 24 * 60 * 60_000) && claimAutoPopup()) setVisible(true);
    });
    return () => {
      alive = false;
    };
  }, [percent]);

  const dismiss = () => {
    setVisible(false);
    void saveSetting(NUDGE_KEY, new Date().toISOString());
  };

  const go = () => {
    dismiss();
    router.push('/profile-edit');
  };

  // M203: one popup at a time: confirming the number comes first.
  if (!visible || percent >= 100 || me.phoneConfirmDue || (me.profileMissing ?? []).length > 0) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.card}>
            <View style={styles.iconRing}>
              <Ionicons name="person-circle-outline" size={34} color={colors.gold} />
            </View>
            <Text style={styles.title}>{t('profileNudge.title')}</Text>
            <Text style={styles.text}>{t('profileNudge.text', { percent })}</Text>
            <AppButton label={t('profileNudge.cta')} icon="create-outline" onPress={go} />
            <AppButton label={t('profileNudge.later')} variant="outline" onPress={dismiss} />
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  ring: { position: 'absolute', borderColor: colors.border, opacity: 0.55 },
  half: { position: 'absolute', top: 0, overflow: 'hidden' },
  // The coloured half is bottom + left; when RTL swaps left/right the colours swap too, so name the mirror pair.
  arc: {
    position: 'absolute',
    top: 0,
    borderColor: colors.gold,
    borderTopColor: 'transparent',
    [MIRRORED ? 'borderLeftColor' : 'borderRightColor']: 'transparent',
  },
  badgeWrap: { position: 'absolute', bottom: -2, alignSelf: 'center' },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 15, color: colors.goldInk, writingDirection: 'ltr' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch' },
  card: { gap: spacing.sm, padding: spacing.md, alignItems: 'stretch' },
  iconRing: {
    width: 60,
    height: 60,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
    alignSelf: 'center',
  },
  title: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  text: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
}));
