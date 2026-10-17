import type { HomeContent } from '../home.js';
import type { Translation } from '../i18n.js';

/** The home screen in English (M27 stage 3): the same block, read through this translation. The owner edits it from the dashboard. */
export const HOME_EN: Translation<HomeContent> = {
  hero: {
    eyebrow: 'Investors Club',
    title: 'A refined community that believes ideas are wealth',
    subtitle:
      'The Investors Club® is an exclusive business community for neutrals, entrepreneurs and investors, serving its members through one app and a permanent HQ in the heart of the Saudi capital, Riyadh.',
  },
  portals: [
    { key: 'neutral', title: 'Neutral', subtitle: 'Exploring my direction' },
    { key: 'entrepreneur', title: 'Entrepreneur', subtitle: 'I have a venture' },
    { key: 'investor', title: 'Investor', subtitle: 'Seeking opportunities' },
  ],
  golden: {
    title: 'Golden Projects from Vibes Ventures',
    subtitle: "The companies carrying the V mark under the group's umbrella",
    cta: 'View all',
  },
  membership: {
    title: 'The Investors Club annual membership',
    subtitle: 'One annual membership opens every club benefit: the Projects Bank, the services, the smart advisor and the club HQ.',
    cta: 'See the benefits',
    activeText: 'Your membership is active; every club benefit is open to you.',
  },
  services: {
    title: 'Club services',
    subtitle: "Member services and the group's benefits in one place",
    cta: 'All services',
  },
  partners: {
    title: 'Our partners',
    subtitle: "Your personal promo code opens the club partners' discounts",
    cta: 'All partners',
  },
  famous: {
    title: 'Profile & Journey',
    subtitle: "A weekly space introducing the club's members, highlighting their expertise and building quality connections — apply yourself; applying is for subscribed members only",
    cta: 'Apply here',
  },
  videos: {
    title: 'Get to know us',
    subtitle: "The club's story, its meetups and the group's companies",
    cta: 'All videos',
  },
  projectsBank: {
    title: 'Projects Bank',
    subtitle: 'Over 260 ventures that passed screening and evaluation, waiting for a partner like you',
    cta: 'Browse the projects',
  },
  advisor: {
    title: 'Your smart advisor is with you',
    subtitle: 'He accompanies you on your journey inside the club and suggests your next step by your interest.',
    cta: 'Ask the advisor',
    chips: [{ label: 'Book an HQ visit' }, { label: 'Attend the next meetup' }, { label: 'Record your podcast episode' }, { label: 'Explore the Projects Bank' }],
  },
  podcast: {
    title: 'Record your episode at the club studio',
    subtitle: 'The podcast studio is your stage: introduce yourself and your field to the club community with an episode in your name.',
    cta: 'Book the studio',
  },
  savings: {
    title: 'Your membership saves you',
    subtitle: 'While you explore your direction, the membership lightens your costs:',
    items: ['Workshops and meetups with no fees for members', 'An annual credit that opens the club services for you', "Our partners' discounts with your personal member code"],
    cta: 'See the membership',
  },
  personas: {
    guest: {
      heroSubtitle:
        'The Investors Club® is an exclusive business community for neutrals, entrepreneurs and investors, serving its members through one app and a permanent HQ in the heart of the Saudi capital, Riyadh.',
    },
    neutral: {
      heroSubtitle: "Explore the meetups and the members' stories, and let your advisor accompany you until you set your direction with confidence.",
      ctas: {
        projectsBank: { label: 'Explore the projects for inspiration' },
        agenda: { label: 'Attend the next meetup' },
      },
    },
    entrepreneur: {
      heroSubtitle: "Your venture deserves the club's stage: services that take it further and a chance to present it to investors.",
      ctas: {
        golden: { label: 'Join the Vibes Ventures Golden Projects' },
        projectsBank: { label: 'Submit your venture to the bank' },
        services: { label: 'All your services' },
      },
    },
    investor: {
      heroSubtitle: 'Real partnership opportunities await you: the Projects Bank, the meetups and the business community in one place.',
      ctas: {
        projectsBank: { label: 'Explore partnership opportunities' },
        golden: { label: 'Discover the golden opportunities' },
      },
    },
  },
  entrepreneurs: {
    title: 'Entrepreneurs Portal',
    intro: 'Three services take your venture a step further: a meetup in your name, presenting your venture to investors through Success Partners, and a professional pitch deck.',
  },
  neutralOpening: {
    title: 'Neutral — exploring my direction',
    text: "Welcome to the Investors Club. Not sure of your direction yet? Start by attending: the club's meetups, seminars and workshops take place regularly at the club HQ in Riyadh, and wherever you are you can join them online. There you meet entrepreneurs and investors up close, then set your path with confidence. Tell me what interests you and I will suggest what suits you.",
    quickReplies: ['What are the upcoming meetups and workshops?', 'How do I attend online from outside Riyadh?', 'I have a venture idea and need guidance', 'I would like to get to know the group first'],
  },
};
