import type { GoldenContent } from '../golden.js';
import type { Translation } from '../i18n.js';

/** The golden projects portal in English: names as the companies write them; valuations, links and logos come from the Arabic block. */
export const GOLDEN_EN: Translation<GoldenContent> = {
  title: 'Golden Projects',
  intro: 'The companies carrying the V mark under the umbrella of Vibes Ventures.',
  disclaimer: 'This information is descriptive and is neither a contractual offer nor a guarantee of returns',
  umbrella: { code: 'V', name: 'Vibes Ventures' },
  companies: [
    { code: '01', name: 'Wdeny' },
    { code: '02', name: 'Virtual Community Company', tagline: 'The official operator of the Investors Club' },
    { code: '03', name: 'PV Business Incubators and Accelerators' },
    { code: '04', name: 'Seka' },
    { code: '05', name: 'Al-Moltaqa' },
    { code: '06', name: 'Quick Bite' },
    { code: '07', name: 'Quick Deals Trading' },
    { code: '08', name: 'Momentum' },
    { code: '09', name: 'Quick Deals Investment' },
    { code: '10', name: 'Franchment' },
  ],
  opportunity: {
    badge: 'Vibes Ventures opportunity',
    title: 'The Vibes Ventures investment portfolio',
    tagline: 'Ten companies under one umbrella, with real partnership opportunities across diverse sectors.',
    ctaLabel: 'Discover the opportunity',
  },
};
