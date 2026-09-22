import type { AboutContent } from '../about.js';
import type { Translation } from '../i18n.js';

/** «عنّا» in English. Company names as the companies write them; registration numbers, links and logos are the Arabic block's. */
export const ABOUT_EN: Translation<AboutContent> = {
  title: 'About us',
  intro: 'The Investors Club is a refined community that believes ideas are wealth: it brings investors and entrepreneurs together to build relationships and partnerships through regular meetups in Riyadh and online.',
  sections: [
    {
      key: 'club',
      title: 'The Investors Club',
      paragraphs: [
        'Investors Club® is a trademark owned by Vibes Holding, with more than 11,000 members: investors, entrepreneurs and people interested in the world of business in the Kingdom.',
        'The club brings three categories together: investors looking for promising partnership opportunities, entrepreneurs with distinctive ventures, and neutral members who follow the opportunities and set their direction later.',
        'One annual membership is the only way to join the club, and it opens every club benefit to its holder for a full year.',
      ],
      urlLabel: 'Club website',
    },
    {
      key: 'how',
      title: 'How the club works',
      paragraphs: ["A venture's path in the club has three steps: qualification, presentation to investors, then the direct meeting."],
      bullets: [
        'Success Partners: a venture starts by registering, and a specialised committee reviews it before it is approved.',
        'The Projects Bank: approved ventures are presented to investors, and members can contact the founders directly.',
        "The “5 minutes” meetup: presenting the venture to investors directly at the club's meetups, in person in Riyadh or online.",
        'The club HQ in Riyadh: offices, a theatre, a meeting room and a coffee shop; entry is for subscribed members by prior booking.',
      ],
    },
    {
      key: 'operator',
      title: 'Virtual Community Investment Company',
      paragraphs: [
        'The official operator of the Investors Club and the publisher of this app. A Saudi company based in Riyadh, Al Olaya district, licensed by the competent authorities in the Kingdom.',
        "The company runs the club's platform and meetups and the unified member account that works on every website of the group and in the app.",
      ],
    },
    {
      key: 'vibes',
      title: 'Vibes Holding',
      paragraphs: [
        "Thabthabat Investment Holding Company (Vibes Holding) is the parent company of the group and the owner of the Investors Club® trademark. Founded in the summer of 2022 with an unconventional vision, it built a participatory business model that brings the company and the club's members together.",
        'Founder: Eng. Salem Al-Masrahi. Headquarters: Al Jawhara Tower, Prince Mohammed bin Abdulaziz Street (Tahlia), Al Olaya district, Riyadh.',
      ],
      bullets: [
        "The group's companies are permanently open to partnership according to their valuation.",
        'The group is built to run as an institution, unaffected by the presence or absence of its founders and managers.',
      ],
    },
  ],
  ecosystem: {
    title: "The group's companies",
    intro: 'The companies carrying the V mark under the umbrella of Vibes Holding, offering their services to club members with special benefits.',
    companies: [
      { name: 'Virtual Community', role: 'The official operator of the Investors Club' },
      { name: 'PV Business Incubators and Accelerators', role: 'A business incubator: a complete environment from the idea to the market' },
      { name: 'Wdeny', role: 'An app that gathers delivery services with smart comparison' },
      { name: 'Seka', role: 'Shared school transport' },
      { name: 'Al-Moltaqa', role: 'A podcast production and hosting platform' },
      { name: 'Quick Bite', role: 'A specialised partnership for the restaurant and café sector' },
      { name: 'Quick Deals Trading', role: 'The digital sales system and the “Manfaz” products' },
      { name: 'Quick Deals Investment', role: 'Fast access to the right investors' },
      { name: 'Momentum', role: 'Digital marketing and website and app design' },
      { name: 'Franchment', role: 'Expanding brands through franchising' },
    ],
  },
  contact: {
    title: 'Contact us',
    websites: [{ label: 'Investors Club' }, { label: 'Vibes Holding' }],
  },
  legal: {
    operator: 'Virtual Community Investment Company',
    address: 'Riyadh, Al Olaya district',
    trademark: 'Investors Club® is a registered trademark of Vibes Holding (Thabthabat Investment Holding Company).',
  },
};
