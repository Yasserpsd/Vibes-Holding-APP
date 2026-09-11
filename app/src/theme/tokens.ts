// Design tokens — premium gold on black with white text.
// Initial palette approved by the owner for M1; final palette is confirmed at the design step.

export const colors = {
  gold: '#C9A227',
  goldLight: '#E2C25A',
  goldDark: '#9A7B1A',

  black: '#0B0B0B',
  surface: '#161616',
  surfaceElevated: '#1F1F1F',
  border: '#2A2A2A',

  white: '#FFFFFF',
  textPrimary: '#FFFFFF',
  textSecondary: '#B5B5B5',
  textMuted: '#7A7A7A',

  success: '#2E9E6B',
  warning: '#D9A21B',
  danger: '#D14343',
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
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 36 },
  subtitle: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 28 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  tabLabel: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
} as const;
