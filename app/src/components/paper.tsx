import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, gradients, radii, shadows, spacing } from '@/theme/tokens';

/**
 * M85 «paper» light zones (owner): selected areas — forms above all — sit on an ivory sheet
 * with ink text, so the eye rests from the dark. Components inside (FormField…) read the
 * context and switch their palette on their own; screens just wrap the area in <PaperCard>.
 */
const PaperContext = createContext(false);

/** True inside a <PaperCard>: the component should wear its light palette. */
export const usePaper = (): boolean => useContext(PaperContext);

type PaperCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** M85 (owner): «ايفيكت ورق على المكتب عليه دبوس» — a golden pin head at the top and a hair of tilt, like a sheet pinned to the desk. */
  pinned?: boolean;
};

export function PaperCard({ children, style, pinned = false }: PaperCardProps) {
  return (
    <PaperContext.Provider value={true}>
      <View style={[styles.card, pinned && styles.pinnedCard, style]}>
        {pinned ? (
          <View style={styles.pin} pointerEvents="none">
            <View style={styles.pinHead}>
              <View style={styles.pinShine} />
            </View>
          </View>
        ) : null}
        {children}
      </View>
    </PaperContext.Provider>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.paperBorder,
    padding: spacing.md,
    gap: spacing.md,
    boxShadow: shadows.lift,
  },
  // The faint tilt sells the «sheet dropped on the desk» read without hurting legibility.
  pinnedCard: { transform: [{ rotate: '-0.4deg' }], paddingTop: spacing.md + 6 },
  pin: { position: 'absolute', top: -9, left: 0, right: 0, alignItems: 'center', zIndex: 1 },
  pinHead: {
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    experimental_backgroundImage: gradients.gold,
    boxShadow: '0 3px 6px rgba(0, 0, 0, 0.35)',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    padding: 3,
  },
  pinShine: { width: 5, height: 5, borderRadius: radii.pill, backgroundColor: 'rgba(255, 255, 255, 0.85)' },
});
