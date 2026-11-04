// Design tokens — premium champagne gold on deep black, tuned to the official logo gradient.
// V2 (full visual overhaul): neon glows, gradients and glass surfaces, all core-RN so OTA-safe.
//
// M196 (owner, 2026-11-04: «اعمل وضع فاتح كمان»): two palettes behind ONE set of names. `colors`,
// `shadows` and `gradients` are mutable objects filled by applyTheme() before the first screen draws
// (theme/theme.ts); the dark palette is the V2 look unchanged, the light one is the navy-and-gold of
// the club's e-mails (see `brand` below). Screens keep reading `colors.x` — but only at render time
// or inside themedStyles() (theme/styles.ts), never in a module-scope constant.

const darkColors = {
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
  // M128 (owner): placeholders only — barely-there gray so an empty field never looks prefilled.
  textFaint: '#55555E',

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
  // WhatsApp's own brand green: the support line wears the real logo colours.
  whatsapp: '#25D366',
  warning: '#D9A21B',
  danger: '#E05252',

  // M85 «paper» light zones (owner): ivory surfaces with ink text, breaking the single dark tone.
  paper: '#FAF7F0',
  paperCard: '#FFFFFF',
  paperInk: '#17130A',
  paperInkSoft: '#57503F',
  paperMuted: '#8C8472',
  // M128: the paper fields' placeholder — same barely-there idea on the light surface.
  paperFaint: '#BDB6A6',
  paperBorder: '#E7E0D1',
  /** Gold dark enough to read on paper. */
  paperGold: '#8A6D1D',
} as const;

export type ColorTokens = { -readonly [K in keyof typeof darkColors]: string };

/**
 * M196 light palette: the same token names, so every screen renders in both. Ink is the club navy,
 * the gold goes one step deeper (#B8842A) so it still reads on white; the ivory «paper» zones stay.
 */
const lightColors: ColorTokens = {
  gold: '#B8842A',
  goldLight: '#D9A83C',
  goldDark: '#8A6D1D',
  goldNeon: '#C9922E',
  goldInk: '#141005',

  black: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceElevated: '#EEF2F7',
  border: '#DCE3EE',

  white: '#FFFFFF',
  textPrimary: '#0D274A',
  textSecondary: '#3E5068',
  textMuted: '#6B7A90',
  textFaint: '#A9B4C4',

  goldSoft: 'rgba(184, 132, 42, 0.14)',
  goldFaint: 'rgba(184, 132, 42, 0.07)',
  borderGold: 'rgba(184, 132, 42, 0.45)',
  borderGoldSoft: 'rgba(184, 132, 42, 0.22)',
  glass: 'rgba(255, 255, 255, 0.92)',
  overlay: 'rgba(13, 39, 74, 0.55)',

  success: '#1E8E63',
  whatsapp: '#25D366',
  warning: '#B8842A',
  danger: '#D92D20',

  paper: '#FAF7F0',
  paperCard: '#FFFFFF',
  paperInk: '#17130A',
  paperInkSoft: '#57503F',
  paperMuted: '#8C8472',
  paperFaint: '#BDB6A6',
  paperBorder: '#E7E0D1',
  paperGold: '#8A6D1D',
};

/** The active palette (dark until applyTheme() says otherwise). Mutated in place, never reassigned. */
export const colors: ColorTokens = { ...darkColors };

// M85: each service group wears its own soft accent on the light tiles (icon tint + CTA).
export const serviceAccents = {
  entrepreneur: { ink: '#8A6D1D', tint: '#F7EFD8' },
  member: { ink: '#0E7A5F', tint: '#E2F3EC' },
  discount: { ink: '#6D4FC2', tint: '#EDE8FA' },
} as const;

// Neon glows and depth shadows (RN boxShadow — works on iOS and Android with the new architecture).
const darkShadows = {
  /** Soft golden halo for hero surfaces and primary buttons. */
  glowGold: '0 0 24px rgba(255, 216, 101, 0.25)',
  /** Stronger halo for the moments that should feel electric (active tab, membership card). */
  glowGoldStrong: '0 0 34px rgba(255, 216, 101, 0.4)',
  /** Whisper of gold around bordered cards. */
  glowGoldFaint: '0 0 16px rgba(255, 216, 101, 0.14)',
  /** Depth without color: lifts floating elements off the black. */
  lift: '0 10px 30px rgba(0, 0, 0, 0.55)',
} as const;

export type ShadowTokens = { -readonly [K in keyof typeof darkShadows]: string };

/** M196: in the light the neon becomes quiet navy depth — a halo on white reads as dirt. */
const lightShadows: ShadowTokens = {
  glowGold: '0 6px 18px rgba(13, 39, 74, 0.10)',
  glowGoldStrong: '0 8px 24px rgba(184, 132, 42, 0.24)',
  glowGoldFaint: '0 4px 14px rgba(13, 39, 74, 0.08)',
  lift: '0 8px 24px rgba(13, 39, 74, 0.10)',
};

export const shadows: ShadowTokens = { ...darkShadows };

// CSS gradients for experimental_backgroundImage (always pair with a backgroundColor fallback).
const darkGradients = {
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

export type GradientTokens = { -readonly [K in keyof typeof darkGradients]: string };

/** M196: the gold metal stays; the dark sheens become white-to-mist. The photo scrim is the same in both. */
const lightGradients: GradientTokens = {
  gold: darkGradients.gold,
  surface: 'linear-gradient(180deg, #FFFFFF 0%, #F7F9FC 100%)',
  goldWash: 'linear-gradient(160deg, rgba(184, 132, 42, 0.14) 0%, rgba(184, 132, 42, 0.03) 55%, rgba(255, 255, 255, 0) 100%)',
  screen: 'linear-gradient(180deg, #FFFFFF 0%, #F4F6FA 34%)',
  scrim: darkGradients.scrim,
};

export const gradients: GradientTokens = { ...darkGradients };

export type ThemeName = 'dark' | 'light';

export const palettes: Record<ThemeName, { colors: ColorTokens; shadows: ShadowTokens; gradients: GradientTokens }> = {
  dark: { colors: { ...darkColors }, shadows: { ...darkShadows }, gradients: { ...darkGradients } },
  light: { colors: lightColors, shadows: lightShadows, gradients: lightGradients },
};

let activeTheme: ThemeName = 'dark';

/** The theme the token objects currently hold. */
export const getThemeName = (): ThemeName => activeTheme;

/** Fills `colors`, `shadows` and `gradients` with a palette, in place. Call before the first screen renders. */
export function applyTheme(name: ThemeName): void {
  activeTheme = name;
  Object.assign(colors, palettes[name].colors);
  Object.assign(shadows, palettes[name].shadows);
  Object.assign(gradients, palettes[name].gradients);
}

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

/**
 * M195 (owner, 2026-11-04): ONE brand identity for every form — the navy and gold of the club's own
 * e-mails (server/src/mail/royal.ts), nothing invented. The forms read this palette through
 * <FormCard tone="light" | "dark"> (components/form/FormTheme.tsx); the rest of the app keeps the
 * black-and-gold tokens above until the app-wide light mode (M196) lands.
 */
export const brand = {
  navy: '#0d274a',
  navyDeep: '#081a33',
  navySoft: '#1b3a63',
  gold: '#e7ad3f',
  goldDeep: '#b8842a',
  goldPale: '#fbf1dc',
  /** The error red the owner asked for (#D92D20) — the same in both tones. */
  danger: '#D92D20',
  dangerSoft: '#FEF3F2',
} as const;

export type FormTone = 'light' | 'dark';

export type FormPalette = {
  tone: FormTone;
  /** The sheet the form sits on, and the card around it. */
  bg: string;
  card: string;
  cardBorder: string;
  /** Text. */
  ink: string;
  inkSoft: string;
  muted: string;
  placeholder: string;
  /** Inputs (every field, the country row and the pickers share these). */
  field: string;
  fieldBorder: string;
  fieldFocus: string;
  /** Chips: quiet when unselected, navy (or gold on dark) when chosen. */
  chipBg: string;
  chipBorder: string;
  chipText: string;
  chipSelectedBg: string;
  chipSelectedBorder: string;
  chipSelectedText: string;
  /** The primary (gold) button. */
  buttonBg: string;
  buttonBorder: string;
  buttonText: string;
  /** Accents. */
  accent: string;
  danger: string;
  dangerBg: string;
  /** Info notice. */
  noticeBg: string;
  noticeBorder: string;
  noticeText: string;
};

export const formPalettes: Record<FormTone, FormPalette> = {
  light: {
    tone: 'light',
    bg: '#F4F6FA',
    card: '#FFFFFF',
    cardBorder: '#DCE3EE',
    ink: brand.navy,
    inkSoft: '#3E5068',
    muted: '#6B7A90',
    placeholder: '#A9B4C4',
    field: '#FFFFFF',
    fieldBorder: '#C9D3E0',
    fieldFocus: brand.gold,
    chipBg: '#FFFFFF',
    chipBorder: brand.gold,
    chipText: brand.navy,
    chipSelectedBg: brand.navy,
    chipSelectedBorder: brand.navy,
    chipSelectedText: brand.gold,
    buttonBg: brand.gold,
    buttonBorder: brand.goldDeep,
    buttonText: brand.navy,
    accent: brand.goldDeep,
    danger: brand.danger,
    dangerBg: brand.dangerSoft,
    noticeBg: brand.goldPale,
    noticeBorder: '#EBD8A8',
    noticeText: brand.navy,
  },
  dark: {
    tone: 'dark',
    bg: brand.navyDeep,
    card: brand.navy,
    cardBorder: brand.navySoft,
    ink: '#FFFFFF',
    inkSoft: '#D5DEEB',
    muted: '#9FB0C6',
    placeholder: '#6E829C',
    field: brand.navyDeep,
    fieldBorder: brand.navySoft,
    fieldFocus: brand.gold,
    chipBg: 'transparent',
    chipBorder: brand.gold,
    chipText: '#FFFFFF',
    chipSelectedBg: brand.gold,
    chipSelectedBorder: brand.gold,
    chipSelectedText: brand.navy,
    buttonBg: brand.gold,
    buttonBorder: brand.goldDeep,
    buttonText: brand.navy,
    accent: brand.gold,
    danger: '#FF6B61',
    dangerBg: 'rgba(217, 45, 32, 0.16)',
    noticeBg: 'rgba(231, 173, 63, 0.12)',
    noticeBorder: 'rgba(231, 173, 63, 0.4)',
    noticeText: '#F3E4B5',
  },
};
