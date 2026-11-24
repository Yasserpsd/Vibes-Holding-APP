/**
 * M271 (owner, 2026-11-25: «كل واحد من أنواع العضويات يكون ليه لون مختلف تماما في الكارت»): one look per membership.
 * Annual = the gold-on-black card as it was; Success Partners = royal blue with the logo's orange; honorary = pearl
 * white with gold; no active membership = faded silver.
 *
 * Every value here is FIXED, in both themes: a membership card is an object with its own colour, and its text is
 * always drawn on its own surface, so the dark and the light theme read it the same way. (Only the halo around a card
 * follows the theme, because it falls on the page.)
 */
import type { Membership } from '@/api/auth';
import { getThemeName, shadows } from '@/theme/tokens';

export type CardKind = 'annual' | 'partner' | 'honorary' | 'inactive';

/** The look a membership wears. An unknown kind from a newer server reads as annual. */
export function cardKindOf(membership: Pick<Membership, 'status' | 'kind'> | null | undefined): CardKind {
  if (membership?.status !== 'active') return 'inactive';
  return membership.kind === 'partner' || membership.kind === 'honorary' ? membership.kind : 'annual';
}

export type CardLook = {
  /** The outer frame and the face of the card. `image` is a CSS gradient over `face`. */
  shell: string;
  face: string;
  image?: string;
  frame: string;
  edge: string;
  /** Text: the holder's name and the values, the club name and number, the small labels, the role and contacts. */
  strong: string;
  body: string;
  label: string;
  soft: string;
  /** Ornaments: rings, sheen band, the five-step rule, corner accents. */
  accent: string;
  rule: readonly string[];
  ringOpacity: number;
  sheen: string;
  /** The light band that sweeps the card now and then; the gold default when absent. */
  sweep?: string;
  /** The category pill and the VIP badge. */
  pill: string;
  pillImage?: string;
  pillInk: string;
  /** The disc behind the club emblem. */
  disc: string;
  textShadow: string;
};

const INK = '#141005';
const GOLD_METAL = 'linear-gradient(135deg, #F7DA8A 0%, #E6BA54 38%, #C2912E 78%, #A67C22 100%)';

const LOOKS: Record<CardKind, CardLook> = {
  annual: {
    shell: '#070708',
    face: '#0B0A08',
    frame: '#D9A83C',
    edge: '#A67C22',
    strong: '#F2CE74',
    body: '#D9A83C',
    label: '#9B9BA3',
    soft: '#B9B9C0',
    accent: '#D9A83C',
    rule: ['#A67C22', '#D9A83C', '#F2CE74', '#D9A83C', '#A67C22'],
    ringOpacity: 0.09,
    sheen: '#F2CE74',
    pill: '#D9A83C',
    pillImage: GOLD_METAL,
    pillInk: INK,
    disc: '#070708',
    textShadow: 'rgba(0, 0, 0, 0.9)',
  },
  // Royal blue, with the orange of the Success Partners hand.
  partner: {
    shell: '#06174A',
    face: '#0D2E86',
    image: 'linear-gradient(135deg, #2459C9 0%, #1440AC 32%, #0D2E86 64%, #07195A 100%)',
    frame: '#8FB4FF',
    edge: 'rgba(214, 228, 255, 0.42)',
    strong: '#FFFFFF',
    body: '#E3ECFF',
    label: '#BDD0FA',
    soft: '#DCE6FF',
    accent: '#FF9A3C',
    rule: ['#B4560C', '#F78F34', '#FFC68A', '#F78F34', '#B4560C'],
    ringOpacity: 0.1,
    sheen: '#A9C6FF',
    sweep: 'rgba(186, 212, 255, 0.16)',
    pill: '#F78F34',
    pillImage: 'linear-gradient(135deg, #FFC27A 0%, #F78F34 55%, #E5761A 100%)',
    pillInk: '#06174A',
    disc: '#06174A',
    textShadow: 'rgba(3, 12, 46, 0.7)',
  },
  // Pearl white: a soft iridescence from ivory to cool white, framed in gold.
  honorary: {
    shell: '#FFFFFF',
    face: '#FBF8F0',
    image: 'linear-gradient(135deg, #FFFFFF 0%, #FAF5E9 30%, #EEF1F7 55%, #FCF6E6 76%, #F0E3C2 100%)',
    frame: '#C99B3B',
    edge: '#DDC389',
    strong: '#4A360A',
    body: '#7A5A10',
    label: '#6F6140',
    soft: '#4F4631',
    accent: '#B8892B',
    rule: ['#EADAAE', '#C99B3B', '#8F6A17', '#C99B3B', '#EADAAE'],
    ringOpacity: 0.08,
    sheen: '#D9B45E',
    sweep: 'rgba(212, 170, 74, 0.14)',
    pill: '#D9A83C',
    pillImage: GOLD_METAL,
    pillInk: INK,
    disc: '#0B0A08',
    textShadow: 'rgba(255, 255, 255, 0.95)',
  },
  inactive: {
    shell: '#070708',
    face: '#0B0A08',
    frame: '#787D88',
    edge: '#787D88',
    strong: '#E9EAEF',
    body: '#B6BAC4',
    label: '#9B9BA3',
    soft: '#B9B9C0',
    accent: '#B6BAC4',
    rule: ['#787D88', '#B6BAC4', '#E9EAEF', '#B6BAC4', '#787D88'],
    ringOpacity: 0.09,
    sheen: '#E9EAEF',
    pill: '#B6BAC4',
    pillInk: INK,
    disc: '#070708',
    textShadow: 'rgba(0, 0, 0, 0.9)',
  },
};

export const cardLook = (kind: CardKind): CardLook => LOOKS[kind];

/** The halo around a card. Read at render time: it falls on the page, so it follows the theme. */
export function cardGlow(kind: CardKind): string {
  const light = getThemeName() === 'light';
  if (kind === 'partner') return light ? '0 10px 28px rgba(20, 64, 172, 0.34)' : '0 0 34px rgba(64, 124, 255, 0.55)';
  if (kind === 'honorary') return light ? '0 10px 28px rgba(122, 90, 16, 0.30)' : '0 0 34px rgba(255, 238, 196, 0.45)';
  if (kind === 'inactive') return '0 0 24px rgba(182, 186, 196, 0.18)';
  return shadows.glowGoldStrong;
}

/** The Success Partners logo as approved by the owner (2026-11-25): 900×250, drawn on white only, never recoloured. */
export const PARTNERS_LOGO = require('../../assets/images/success-partners-logo.png') as number;
