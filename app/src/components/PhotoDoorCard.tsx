import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { FadingPhotos } from '@/components/FadingPhotos';
import { GoldGradient } from '@/components/lux';
import { PressScale } from '@/components/motion';
import { chevronForward, textStart } from '@/i18n/direction';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, radii, shadows, spacing, typography } from '@/theme/tokens';

const DOOR_SCRIM = 'linear-gradient(0deg, rgba(0, 0, 0, 0.96) 0%, rgba(0, 0, 0, 0.82) 34%, rgba(0, 0, 0, 0.25) 62%, rgba(0, 0, 0, 0) 85%)';

/**
 * M270 (owner, 2026-11-25, on the flat gold «انشر تطبيقك» bar: «نهائي مش حلو خالص… وريني ابداعك»): a home
 * door as a photograph — the door's own pictures fill the card and change on their own, its name and one
 * line are written at the foot of the picture, and a gold arrow says it opens. The caller keeps the old gold
 * bar for a door whose photo set is still empty.
 */
export function PhotoDoorCard({ photos, title, hint, onPress }: { photos: string[]; title: string; hint: string; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} glow glowRadius={radii.xl} accessibilityRole="button" accessibilityLabel={title}>
      <View style={styles.card}>
        <FadingPhotos urls={photos} points={360} />
        <View style={styles.scrim} />
        <View style={styles.foot}>
          <View style={styles.texts}>
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {title}
            </Text>
            <Text style={styles.hint} numberOfLines={2}>
              {hint}
            </Text>
          </View>
          <GoldGradient style={styles.go}>
            <Ionicons name={chevronForward()} size={18} color={colors.goldInk} />
          </GoldGradient>
        </View>
      </View>
    </PressScale>
  );
}

const styles = themedStyles(() => ({
  card: {
    height: 184,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: '#0B0B0E',
    boxShadow: shadows.lift,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  // A door photo can be busy (app screens), so its scrim is deeper than the shared one where the words sit.
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: DOOR_SCRIM },
  foot: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm + 2 },
  texts: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 29, color: colors.onPhoto, textAlign: textStart },
  hint: { ...typography.caption, color: colors.onPhotoSoft, textAlign: textStart },
  go: { width: 36, height: 36, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
}));
