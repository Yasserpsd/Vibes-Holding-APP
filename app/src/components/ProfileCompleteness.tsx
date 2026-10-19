import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import type { Me } from '@/api/auth';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { PopIn } from '@/components/motion';
import { t } from '@/i18n';
import { loadSetting, saveSetting } from '@/lib/deviceStore';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * M103 «كمّل بياناتك»: a meter of golden dots around the member's avatar shows how complete his
 * profile is, and a one-time popup (repeated gently every 7 days while incomplete) sends him to
 * the profile editor — the club knows its members better, and members find each other.
 */
const NUDGE_KEY = 'investorsclub.profileNudgeAt';
const NUDGE_DAYS = 7;
const DOTS = 12;

/** The profile fields that count, equally weighted: only what the member can fill in the app's editor. */
export function profileCompletion(me: Me): number {
  const fields = [me.jobTitle, me.company, me.city, me.bio, me.website, me.social];
  const filled = fields.filter((value) => Boolean(value && String(value).trim())).length;
  return Math.round((filled / fields.length) * 100);
}

/** Golden dots around the avatar — filled dots follow the completion, the rest stay quiet. */
export function CompletionMeter({ percent, size, children }: { percent: number; size: number; children: ReactNode }) {
  const radius = size / 2 + 7;
  const filled = Math.round((percent / 100) * DOTS);
  const frame = size + 28;
  return (
    <View style={{ width: frame, height: frame, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: DOTS }, (_, index) => {
        const angle = (index / DOTS) * 2 * Math.PI - Math.PI / 2;
        const x = frame / 2 + radius * Math.cos(angle) - 3;
        const y = frame / 2 + radius * Math.sin(angle) - 3;
        const on = index < filled;
        return (
          <View
            key={index}
            style={[styles.dot, { left: x, top: y }, on ? styles.dotOn : null]}
          />
        );
      })}
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
      if (alive && (!last || Date.now() - last > NUDGE_DAYS * 24 * 60 * 60_000)) setVisible(true);
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

  if (!visible || percent >= 100) return null;
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

const styles = StyleSheet.create({
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.gold, boxShadow: shadows.glowGoldFaint },
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
});
