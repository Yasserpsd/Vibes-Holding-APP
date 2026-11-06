import Ionicons from '@expo/vector-icons/Ionicons';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { Me } from '@/api/auth';
import { t } from '@/i18n';
import { brand } from '@/theme/tokens';

/**
 * M209 (owner, 2026-11-06, from his reference image): the verification rosette — a 12-point seal with a white check.
 * `verified` = the WhatsApp number is proven but no active membership: grey and dimmed.
 * `member` = proven AND an active membership: gold with a soft gold glow (boxShadow, OTA-safe, no native module).
 * No SVG in the app: three rounded squares turned 0°, 30° and 60° make the twelve points.
 */
export type BadgeTier = 'verified' | 'member';

/** Which badge an account wears: none until the WhatsApp number is proven; gold while a membership is active (honorary included). */
export function badgeTierOf(me: Pick<Me, 'phoneVerified' | 'membership'> | null | undefined): BadgeTier | null {
  if (!me || me.phoneVerified !== true) return null;
  return me.membership?.status === 'active' ? 'member' : 'verified';
}

const LOOK: Record<BadgeTier, { body: string; rim: string; glow: string | null; opacity: number }> = {
  verified: { body: '#9AA3AF', rim: '#C3CAD3', glow: null, opacity: 0.7 },
  member: { body: brand.gold, rim: '#F7DA8A', glow: '0 0 10px rgba(231, 173, 63, 0.75)', opacity: 1 },
};

const ANGLES = [0, 30, 60] as const;

export function VerifiedBadge({ tier, size = 24, style }: { tier: BadgeTier; size?: number; style?: StyleProp<ViewStyle> }) {
  const look = LOOK[tier];
  // The square whose corners reach the badge's edge.
  const side = size / Math.SQRT2;
  const offset = (size - side) / 2;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(tier === 'member' ? 'badge.member' : 'badge.verified')}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity: look.opacity }, style]}
    >
      {ANGLES.map((angle) => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            top: offset,
            left: offset,
            width: side,
            height: side,
            borderRadius: side * 0.22,
            backgroundColor: look.body,
            borderWidth: Math.max(1, size / 22),
            borderColor: look.rim,
            transform: [{ rotate: `${angle}deg` }],
            ...(look.glow ? { boxShadow: look.glow } : null),
          }}
        />
      ))}
      <Ionicons name="checkmark" size={size * 0.62} color="#FFFFFF" />
    </View>
  );
}
