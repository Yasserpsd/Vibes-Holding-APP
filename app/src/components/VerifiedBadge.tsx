import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { Me } from '@/api/auth';
import { t } from '@/i18n';
import { brand, colors } from '@/theme/tokens';

/**
 * M209 (owner, 2026-11-06, from his reference image): the verification seal on the avatar's corner.
 * M209e (owner, 2026-11-07: «ممكن تبقى أشيك»): the classic verified glyph (`check-decagram`, bundled with
 * @expo/vector-icons — no new package, OTA-safe) over a dark knock-out disc; its cut-out check shows a
 * white disc beneath.
 * `verified` = the WhatsApp number is proven but no active membership: grey and dimmed.
 * `member` = proven AND an active membership: gold with a soft gold glow (boxShadow, no native module).
 */
export type BadgeTier = 'verified' | 'member';

/** Which badge an account wears: none until the WhatsApp number is proven; gold while a membership is active (honorary included). */
export function badgeTierOf(me: Pick<Me, 'phoneVerified' | 'membership'> | null | undefined): BadgeTier | null {
  if (!me || me.phoneVerified !== true) return null;
  return me.membership?.status === 'active' ? 'member' : 'verified';
}

const LOOK: Record<BadgeTier, { seal: string; glow: string | null; opacity: number }> = {
  verified: { seal: '#9AA3AF', glow: null, opacity: 0.75 },
  member: { seal: brand.gold, glow: '0 0 10px rgba(231, 173, 63, 0.7)', opacity: 1 },
};

export function VerifiedBadge({ tier, size = 24, style }: { tier: BadgeTier; size?: number; style?: StyleProp<ViewStyle> }) {
  const look = LOOK[tier];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(tier === 'member' ? 'badge.member' : 'badge.verified')}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.black,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: look.opacity,
          ...(look.glow ? { boxShadow: look.glow } : null),
        },
        style,
      ]}
    >
      <View style={{ position: 'absolute', width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25, backgroundColor: '#FFFFFF' }} />
      <MaterialCommunityIcons name="check-decagram" size={size * 0.86} color={look.seal} />
    </View>
  );
}
