import type { GuideContent } from '../guide.js';
import type { Translation } from '../i18n.js';

/** «دليل المحايد» in English; targets, ids, flags and order come from the Arabic block. */
export const GUIDE_EN: Translation<GuideContent> = {
  title: 'The Neutral’s Guide',
  intro: 'Haven’t chosen your direction yet? You are in the right place. These are your steps in the Investors Club until you choose your path with confidence: entrepreneur, investor, or both.',
  steps: [
    {
      key: 'advisor',
      title: 'Start with the smart advisor',
      text: 'The advisor answers any question about the club and the ecosystem, learns what interests you, and recommends your next step.',
      cta: 'Open the advisor',
    },
    {
      key: 'workshops',
      title: 'Attend the meetups and workshops',
      text: 'Regular seminars and workshops held at the club HQ in Riyadh, and you can attend online from anywhere. Meet entrepreneurs and investors up close.',
      cta: 'Upcoming workshops and registration',
    },
    {
      key: 'projects',
      title: 'Browse the Projects Bank',
      text: 'See the entrepreneurs’ ventures with their public information, learn the sectors and stages, and get a real feel of the opportunities inside the ecosystem.',
      cta: 'Open the Projects Bank',
    },
    {
      key: 'membership',
      title: 'When your direction is clear: activate your membership',
      text: 'The annual membership opens every club benefit: reaching the founders, member services, the advisor without tight daily limits, and the club HQ.',
      cta: 'About the membership',
    },
  ],
  benefitsTitle: 'What does the club offer the neutral?',
  benefits: [
    'Regular workshops and seminars all year, at the HQ or online.',
    'A smart advisor with you from the first question until you choose your path.',
    'Full view of the entrepreneurs’ ventures with their public information.',
    'A community of entrepreneurs and investors you get to know before choosing your road.',
  ],
  workshops: {
    title: 'Workshops and meetups',
    intro: 'A recurring program that opens the ecosystem’s doors: learn, ask, and meet the community. Attend at the club HQ in Riyadh or online.',
    note: 'Your registration reaches the management directly, and the timing and attendance details reach your phone and e-mail.',
    registerCta: 'Register your interest',
    registeredText: 'Your interest is registered — the details will reach you from the management.',
    closedText: 'Registration is currently closed',
    items: [
      {
        id: 'investing-basics',
        title: 'Investing Basics Workshop',
        blurb: 'A practical entry to understanding and evaluating opportunities inside the ecosystem, for non-specialists first.',
        schedule: 'The next date will be announced soon',
      },
      {
        id: 'business-model',
        title: 'Business Model Workshop',
        blurb: 'For whoever has an idea and wants to turn it into a clearly shaped venture presented with confidence.',
        schedule: 'The next date will be announced soon',
      },
      {
        id: 'club-meetup',
        title: 'The Recurring Networking Meetup',
        blurb: 'An open gathering with club members, entrepreneurs and investors at the club HQ.',
        schedule: 'The next date will be announced soon',
      },
    ],
  },
};
