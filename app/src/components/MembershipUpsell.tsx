import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import type { ServicesUpsell } from '@/api/content';
import { AppButton } from '@/components/AppButton';
import { GlassCard } from '@/components/lux';
import { showMembershipGate } from '@/components/MembershipGate';
import { FadeInView, PopIn, PressScale } from '@/components/motion';
import { t } from '@/i18n';
import { textStart } from '@/i18n/direction';
import { claimWeeklyMembershipPrompt } from '@/lib/popupGate';
import { colors, radii, shadows, spacing, typography } from '@/theme/tokens';

/**
 * Owner (2026-10-25): «ليه تدفع المبلغ ده؟ اشترك بس في العضوية وهتاخد خصم 50%» — the membership
 * upsell on services for non-members. The lines are server content (the services block's `upsell`,
 * dashboard-editable); every appearance picks the NEXT line, so the pitch reads differently each
 * time. Subscribing stays in-app only: both doors open the store popup (CLAUDE.md rule 3).
 */

let rotation = Math.floor(Math.random() * 64);

/** The next persuasion line — round-robin, so no line repeats twice in a row. */
function nextLine(upsell: ServicesUpsell): string {
  if (!upsell.variants.length) return '';
  rotation += 1;
  return upsell.variants[rotation % upsell.variants.length] ?? '';
}

const POPUP_DELAY_MS = 1200;

/**
 * The popup over a service page: one rotated line and the direct subscribe door.
 * M164 (owner): it opens by itself only inside the device's ONE automatic membership pitch a week
 * (shared with the launch nudge and the after-form nudge); the card below stays in sight anyway.
 */
export function UpsellPopup({ upsell }: { upsell: ServicesUpsell }) {
  const [line] = useState(() => nextLine(upsell));
  const [visible, setVisible] = useState(false);

  // A breath after the page settles, so the service shows itself before the pitch does —
  // and only if this week has not had its one appearance yet.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void claimWeeklyMembershipPrompt().then((allowed) => {
        if (allowed && !cancelled) setVisible(true);
      });
    }, POPUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (!line || !visible) return null;
  const subscribe = () => {
    setVisible(false);
    showMembershipGate();
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setVisible(false)}>
      <View style={styles.backdrop}>
        <PopIn style={styles.popWrap}>
          <GlassCard golden radius={radii.xxl} style={styles.popCard}>
            <View style={styles.ring}>
              <Ionicons name="pricetags" size={24} color={colors.goldInk} />
            </View>
            <Text style={styles.popTitle}>{upsell.title}</Text>
            <Text style={styles.popText}>{line}</Text>
            <AppButton label={t('store.subscribe')} icon="ribbon-outline" onPress={subscribe} />
            <PressScale onPress={() => setVisible(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('gate.later')}>
              <Text style={styles.later}>{t('gate.later')}</Text>
            </PressScale>
          </GlassCard>
        </PopIn>
      </View>
    </Modal>
  );
}

/** The always-there card on the page itself: the owner wants the subscribe door in sight, not only in a popup. */
export function UpsellCard({ upsell }: { upsell: ServicesUpsell }) {
  const [line] = useState(() => nextLine(upsell));
  if (!line) return null;
  return (
    <FadeInView offset={10}>
      <GlassCard golden radius={radii.lg} style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.cardIcon}>
            <Ionicons name="sparkles" size={18} color={colors.goldLight} />
          </View>
          <View style={styles.cardTexts}>
            <Text style={styles.cardTitle}>{upsell.title}</Text>
            <Text style={styles.cardText}>{line}</Text>
          </View>
        </View>
        <AppButton label={t('store.subscribe')} icon="ribbon-outline" onPress={showMembershipGate} />
      </GlassCard>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  popWrap: { alignSelf: 'stretch' },
  popCard: { gap: spacing.sm, padding: spacing.md, alignItems: 'stretch' },
  ring: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    boxShadow: shadows.glowGold,
  },
  popTitle: { ...typography.subtitle, color: colors.gold, textAlign: 'center' },
  popText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  later: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xs },

  card: { gap: spacing.md, padding: spacing.md },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.goldFaint,
  },
  cardTexts: { flex: 1, gap: 4 },
  cardTitle: { ...typography.subtitle, color: colors.gold, textAlign: textStart },
  cardText: { ...typography.body, color: colors.textSecondary, textAlign: textStart },
});
