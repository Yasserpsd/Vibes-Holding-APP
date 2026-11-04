import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import type { AgendaEvent } from '@/api/agenda';
import { t } from '@/i18n';
import { themedStyles } from '@/theme/styles';
import { colors, fonts, gradients, radii, shadows } from '@/theme/tokens';

/** M192 (owner: «يتحط عليها ribbon يبان للناس انها متاحه تشوفها»): a finished workshop with recordings stays lit. */
export function isWatchable(event: AgendaEvent): boolean {
  return event.past === true && (event.recordings?.length ?? 0) > 0;
}

export function WatchRibbon({ small = false }: { small?: boolean }) {
  return (
    <View style={[styles.ribbon, small && styles.small]}>
      <Ionicons name="play" size={small ? 11 : 13} color={colors.goldInk} />
      <Text style={[styles.text, small && styles.textSmall]} numberOfLines={1}>
        {t('agenda.watchable')}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  ribbon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    experimental_backgroundImage: gradients.gold,
    backgroundColor: colors.gold,
    boxShadow: shadows.glowGoldFaint,
  },
  small: { paddingVertical: 3, paddingHorizontal: 8 },
  text: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 17, color: colors.goldInk },
  textSmall: { fontSize: 11, lineHeight: 16 },
}));
