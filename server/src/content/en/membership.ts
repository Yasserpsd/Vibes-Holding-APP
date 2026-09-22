import type { Translation } from '../i18n.js';
import type { MembershipContent, MembershipGroup } from '../membership.js';

/** The membership page in English, group by group; links, icons and keys are the Arabic block's. */
const GROUPS_EN: Translation<MembershipGroup>[] = [
  {
    key: 'why',
    title: 'Why it is worth it even before you set your direction',
    items: [
      { text: 'A full year of workshops, meetups and consultation with no extra fees, in which you learn before putting a single riyal into any venture' },
      { text: 'The Projects Bank balance alone is SAR 2,500, and it opens 5 complete real ventures for you' },
      { text: "And once you set your direction, you find the theatre, your website and app design and the group's services at half price" },
      { text: 'Entry to the club HQ in Riyadh and attendance of its meetups, for subscribed members only' },
    ],
  },
  {
    key: 'learn',
    title: 'Learn and get to know people before you decide',
    items: [
      { text: 'Every workshop and regular meetup is open to you: you learn from people with experience, at the club HQ in Riyadh or online, including the “5 minutes” meetup' },
      { text: 'Entry to the club HQ in Riyadh: you meet experienced people face to face, and your entry barcode is issued once you book your appointment' },
      { text: 'Joining the club groups: they bring you together with investors and entrepreneurs, so you hear their experiences and ask before you decide' },
      { text: 'Your journey told in “Profile and Journey”: because everyone has a story and every journey has value, even before your first venture, at no charge' },
      { text: 'Every benefit of the Investors Club app: included in your membership without exception' },
      { text: 'One account for every website of the group' },
    ],
  },
  {
    key: 'discover',
    title: 'Discover your direction from inside the ventures',
    items: [
      { text: 'A SAR 2,500 balance in the Projects Bank: it opens 5 complete real ventures you pick yourself, so you see the opportunities from the inside' },
      { text: "The bank's ventures at your fingertips: browse them and contact their founders directly; you may find your direction as a partner in one of them" },
      { text: "The club's experts within reach: an online consultation at no charge where you ask them: where do I start?" },
      { text: 'Your smart assistant around the clock: a daily renewing balance to ask about any idea, term or venture' },
    ],
  },
  {
    key: 'start',
    title: 'When you start your first venture',
    items: [
      { text: 'Your first venture and every one after it in “Success Partners”: no limit to the number of your ventures as long as you are their founder and your membership is valid, published within 3 days at most' },
      { text: 'Priority in presenting your venture to investors inside the Projects Bank' },
      { text: 'Publishing your venture 3 times a month to all members through the Investors Club app' },
    ],
  },
  {
    key: 'discounts',
    title: 'Privileges you start with at member prices',
    items: [
      { text: 'The club theatre is your stage to the world: hold your own meetup on a stage that seats up to 80 people, with full media coverage and live streaming to the whole world, at a 50% discount' },
      { text: 'The meeting room at a 50% discount: for the first meeting with your potential partner, and for every working session after it' },
      { text: 'Outdoor filming and media coverage of your conferences at a discount of up to 50%' },
      { text: 'Your website and app at half price: the design of any website or mobile app of your own, on Android or iOS' },
      { text: "Priority for you in the group's services, at a 50% discount: Make your meetup, pitch deck, Momentum, the Al-Moltaqa podcast, franchise packages" },
      { text: 'A discount code of up to 20% on “Manfaz” products' },
    ],
  },
  {
    key: 'upcoming',
    title: 'Upcoming discounts added to your membership automatically',
    items: [
      { text: 'Wdeny Holding discounts: transport, shipping and travel in one app' },
      { text: 'Seka app discounts: shared school transport for your children' },
      { text: 'Wdeny Sky benefits: private aviation seats' },
      { text: 'Special prices at PV spaces: workspaces and offices inside the group, when you need your first office' },
    ],
  },
];

/** The flat list older app versions read: the same rows as `flatBenefits` builds from the Arabic groups, in the same order. */
const BENEFITS_EN = GROUPS_EN.filter((group) => group.key !== 'upcoming').flatMap((group) => (group.items ?? []).map((entry) => ({ title: entry.text })));

export const MEMBERSHIP_EN: Translation<MembershipContent> = {
  title: 'The Investors Club annual membership',
  subtitle: 'Not sure of your direction yet? This membership was designed for you first',
  intro: [
    'The Investors Club membership brings neutral members, entrepreneurs and investors together through the Investors Club® app, designed specifically for these three categories to build mutual relationships, present quality partnership opportunities and create real interaction between them through regular meetups, evenings and workshops held in person at the club HQ in Riyadh, and online for members outside Riyadh.',
    'As a neutral member, the annual membership gives you the chance to mix and learn, build relationships, explore the world of entrepreneurship and investment and see partnership opportunities up close. If you are still looking for the path that suits you best, this is your chance to be part of a group of entrepreneurs and investors who joined before you.',
    'A full year to discover your direction: your gateway to the world of business. The annual membership does not merely give you attendance; it gives you a whole year to build relationships, discover opportunities and form partnerships that turn into real steps and results.',
  ].join('\n\n'),
  groups: GROUPS_EN,
  benefits: BENEFITS_EN,
  comingSoonTitle: 'Upcoming discounts added to your membership automatically',
  comingSoon: ['Wdeny Holding discounts', 'The Seka app', 'Wdeny Sky', 'PV spaces'],
  statusTexts: {
    guest: 'Sign in or create your account to see your membership status.',
    unactivated: 'Your membership is not activated; please activate your membership.',
    active: 'Your membership is active.',
    expired: 'Your membership has ended; please renew your membership.',
  },
  activationNote: 'Subscribing to the annual membership from inside the app arrives with the next release through the app store.',
};
