import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import type { ServiceProgram } from '@/api/content';
import { GlassCard, GoldGradient, GoldHairline } from '@/components/lux';
import { FadeInView, PressScale } from '@/components/motion';
import { textStart } from '@/i18n/direction';
import { iconFor } from '@/lib/icons';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, spacing, typography } from '@/theme/tokens';

/**
 * M268 (owner, 2026-11-22: «وضح اوي قوة برنامج شركاء النجاح في التطبيق بشكل مميز جدا… يظهر علامة جوجل و ابل… ولما
 * يختار الأثنين يظهر انه كده بيستفيد من كامل مزايا البرنامج»): a programme's page as a showcase instead of a
 * paragraph — what it gives, the two stores by their marks, and the choices the member adds to his registration.
 * A choice says what it changes (the percentage) the moment it is ticked, not before, so the page stays short;
 * with every choice ticked the gold band says he now has the whole programme. Every word is the server's content;
 * the ticks travel to the form, where each one is an optional box he can still untick.
 */
export function ServiceProgramCard({ program, picked, onToggle }: { program: ServiceProgram; picked: string[]; onToggle: (key: string) => void }) {
  const all = program.options.length > 0 && program.options.every((option) => picked.includes(option.key));
  return (
    <GlassCard golden radius={radii.xl} style={styles.card}>
      <View style={styles.head}>
        <GoldGradient style={styles.headIcon}>
          <Ionicons name="ribbon" size={24} color={colors.goldInk} />
        </GoldGradient>
        <View style={styles.headTexts}>
          <Text style={styles.title}>{program.title}</Text>
          <Text style={styles.tagline}>{program.tagline}</Text>
        </View>
      </View>

      <View style={styles.points}>
        {program.points.map((point) => (
          <View key={point} style={styles.point}>
            <Ionicons name="checkmark-circle" size={16} color={colors.goldText} style={styles.pointTick} />
            <Text style={styles.pointText}>{point}</Text>
          </View>
        ))}
      </View>

      <GoldHairline />

      {/* The two stores by their own marks: the line that makes «تطبيقك على المتجرين» unmistakable. */}
      <View style={styles.stores}>
        <View style={styles.storeRow}>
          <StoreMark icon="logo-google-playstore" name="Google Play" />
          <StoreMark icon="logo-apple" name="App Store" />
        </View>
        <Text style={styles.storesTitle}>{program.storesTitle}</Text>
        <Text style={styles.storesText}>{program.storesText}</Text>
      </View>

      <Text style={styles.optionsTitle}>{program.optionsTitle}</Text>
      <View style={styles.options}>
        {program.options.map((option) => {
          const on = picked.includes(option.key);
          return (
            <PressScale key={option.key} onPress={() => onToggle(option.key)} glow glowRadius={radii.lg} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={option.title}>
              <View style={[styles.option, on && styles.optionOn]}>
                <View style={styles.optionRow}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.gold : colors.textSecondary} />
                  <Ionicons name={iconFor(option.icon, 'add-circle-outline')} size={20} color={colors.gold} />
                  <Text style={styles.optionTitle}>{option.title}</Text>
                </View>
                {on ? (
                  <View style={styles.note}>
                    <Ionicons name="information-circle" size={16} color={colors.goldLightText} style={styles.noteIcon} />
                    <Text style={styles.noteText}>{option.note}</Text>
                  </View>
                ) : null}
              </View>
            </PressScale>
          );
        })}
      </View>

      {all ? (
        <FadeInView offset={8}>
          <GoldGradient style={styles.full}>
            <Ionicons name="sparkles" size={22} color={colors.goldInk} />
            <View style={styles.fullTexts}>
              <Text style={styles.fullTitle}>{program.fullTitle}</Text>
              <Text style={styles.fullText}>{program.fullText}</Text>
            </View>
          </GoldGradient>
        </FadeInView>
      ) : null}
    </GlassCard>
  );
}

function StoreMark({ icon, name }: { icon: 'logo-google-playstore' | 'logo-apple'; name: string }) {
  return (
    <View style={styles.store}>
      <Ionicons name={icon} size={22} color={colors.textPrimary} />
      {/* Latin brand names read left-to-right in both languages. */}
      <Text style={styles.storeName}>{name}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { padding: spacing.md, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headIcon: { width: 52, height: 52, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  headTexts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 28, color: colors.textPrimary, textAlign: textStart },
  tagline: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 21, color: colors.goldLightText, textAlign: textStart },
  points: { gap: spacing.xs },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  pointTick: { marginTop: 4 },
  pointText: { ...typography.body, flex: 1, color: colors.textPrimary, textAlign: textStart },
  stores: { gap: spacing.xs, alignItems: 'center' },
  storeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  store: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGoldSoft,
    backgroundColor: colors.surfaceElevated,
  },
  storeName: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  storesTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 26, color: colors.goldLightText, textAlign: 'center' },
  storesText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  optionsTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  options: { gap: spacing.sm },
  option: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderGoldSoft, backgroundColor: colors.goldFaint },
  optionOn: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionTitle: { flex: 1, fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 24, color: colors.textPrimary, textAlign: textStart },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  noteIcon: { marginTop: 2 },
  noteText: { ...typography.caption, flex: 1, color: colors.goldLightText, textAlign: textStart },
  full: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg },
  fullTexts: { flex: 1, gap: 2 },
  fullTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 24, color: colors.goldInk, textAlign: textStart },
  fullText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 21, color: colors.goldInk, textAlign: textStart },
}));
