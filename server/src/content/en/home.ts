import type { HomeContent } from '../home.js';
import type { Translation } from '../i18n.js';

/** The home screen in English (M27 stage 3): the same block, read through this translation. The owner edits it from the dashboard. */
export const HOME_EN: Translation<HomeContent> = {
  hero: {
    eyebrow: 'Investors Club',
    title: 'A refined community that believes ideas are wealth',
    subtitle: 'Choose your portal and start your journey in the group: partnership opportunities, business services and a smart advisor.',
  },
  portals: [
    { key: 'neutral', title: 'Neutral', subtitle: 'Exploring my direction' },
    { key: 'entrepreneur', title: 'Entrepreneur', subtitle: 'I have a venture' },
    { key: 'investor', title: 'Investor', subtitle: 'Seeking opportunities' },
  ],
  golden: {
    title: 'Golden Projects from Vibes Holding',
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
  videos: {
    title: 'Video library',
    subtitle: "The club's story, its meetups and the group's companies",
    cta: 'All videos',
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
