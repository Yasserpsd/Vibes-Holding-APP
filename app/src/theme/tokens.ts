// Design tokens — premium champagne gold on deep black, tuned to the official logo gradient.
// V2 (full visual overhaul): neon glows, gradients and glass surfaces, all core-RN so OTA-safe.

export const colors = {
  // Champagne gold scale sampled from the official logo (highlight → body → shadow).
  gold: '#D9A83C',
  goldLight: '#F2CE74',
  goldDark: '#A67C22',
  // The neon accent: brighter than the body gold, used for glows and active states.
  goldNeon: '#FFD865',
  // Ink for text sitting on gold surfaces (buttons, gold bubbles).
  goldInk: '#141005',

  black: '#070708',
  surface: '#131316',
  surfaceElevated: '#1C1C21',
  border: '#28282E',

  white: '#FFFFFF',
  textPrimary: '#FFFFFF',
  textSecondary: '#B9B9C0',
  textMuted: '#7E7E86',

  // Translucent accents shared by the cards.
  goldSoft: 'rgba(217, 168, 60, 0.14)',
  goldFaint: 'rgba(217, 168, 60, 0.07)',
  // Hairline gold for premium card borders — visible but quiet.
  borderGold: 'rgba(230, 186, 84, 0.38)',
  borderGoldSoft: 'rgba(230, 186, 84, 0.18)',
  // Glass surface for overlays and floating bars.
  glass: 'rgba(22, 22, 26, 0.86)',
  overlay: 'rgba(5, 5, 6, 0.74)',

  success: '#34B27B',
  warning: '#D9A21B',
  danger: '#E05252',

  // M85 «paper» light zones (owner): ivory surfaces with ink text, breaking the single dark tone.
  paper: '#FAF7F0',
  paperCard: '#FFFFFF',
  paperInk: '#17130A',
  paperInkSoft: '#57503F',
  paperMuted: '#8C8472',
  paperBorder: '#E7E0D1',
  /** Gold dark enough to read on paper. */
  paperGold: '#8A6D1D',
} as const;

// M85: each service group wears its own soft accent on the light tiles (icon tint + CTA).
export const serviceAccents = {
  entrepreneur: { ink: '#8A6D1D', tint: '#F7EFD8' },
  member: { ink: '#0E7A5F', tint: '#E2F3EC' },
  discount: { ink: '#6D4FC2', tint: '#EDE8FA' },
} as const;

// Neon glows and depth shadows (RN boxShadow — works on iOS and Android with the new architecture).
export const shadows = {
  /** Soft golden halo for hero surfaces and primary buttons. */
  glowGold: '0 0 24px rgba(255, 216, 101, 0.25)',
  /** Stronger halo for the moments that should feel electric (active tab, membership card). */
  glowGoldStrong: '0 0 34px rgba(255, 216, 101, 0.4)',
  /** Whisper of gold around bordered cards. */
  glowGoldFaint: '0 0 16px rgba(255, 216, 101, 0.14)',
  /** Depth without color: lifts floating elements off the black. */
  lift: '0 10px 30px rgba(0, 0, 0, 0.55)',
} as const;

// CSS gradients for experimental_backgroundImage (always pair with a backgroundColor fallback).
export const gradients = {
  /** The brand gold, lit from the top-start corner like the logo. */
  gold: 'linear-gradient(135deg, #F7DA8A 0%, #E6BA54 38%, #C2912E 78%, #A67C22 100%)',
  /** Subtle vertical sheen that makes dark cards feel machined, not flat. */
  surface: 'linear-gradient(180deg, #1E1E24 0%, #131316 100%)',
  /** Barely-there golden wash for highlighted dark surfaces. */
  goldWash: 'linear-gradient(160deg, rgba(242, 206, 116, 0.16) 0%, rgba(242, 206, 116, 0.03) 55%, rgba(0, 0, 0, 0) 100%)',
  /** Screen backdrop: deep black with a faint golden dawn at the top. */
  screen: 'linear-gradient(180deg, #121014 0%, #070708 34%)',
  /** M96: bottom-up dark scrim that makes text readable on top of a photo. */
  scrim: 'linear-gradient(0deg, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.5) 45%, rgba(0, 0, 0, 0) 78%)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

// Font family names as registered by expo-font (see src/app/_layout.tsx).
export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semiBold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const typography = {
  display: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 44 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 36 },
  subtitle: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  tabLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
} as const;
