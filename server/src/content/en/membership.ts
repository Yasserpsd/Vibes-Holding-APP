import type { Translation } from '../i18n.js';
import type { MembershipContent, MembershipGroup } from '../membership.js';

/** The membership page in English, group by group; links, icons and keys are the Arabic block's. */
const GROUPS_EN: Translation<MembershipGroup>[] = [
  {
    key: 'why',
    title: 'Why it is worth it even before you set your direction',
    items: [
      { text: 'A full year of meetups included in your membership, and an online consultation with a smart advisor at no extra fees — a year in which you learn before putting a single riyal into any venture' },
      { text: 'The Projects Bank balance alone is SAR 2,500 ($667) — more than your subscription itself — and it opens the complete details of 5 ventures for you' },
      { text: 'And once you set your direction, you find the theatre, your website and app design and the group’s services at a 50% discount' },
      { text: 'Entry to the club HQ in Riyadh and attendance of its meetups, for subscribed members only' },
    ],
  },
  {
    key: 'network',
    title: 'Relationships are your real capital',
    items: [
      { text: 'Your gateway to the Saudi market, wherever you are: whether you are in Riyadh, Tokyo, Geneva, New York, Dubai or Cairo, your membership places you inside an established Saudi business community, before you arrive and after' },
      { text: 'A full year to build lasting relationships: meetups, evenings and workshops all year round, giving you enough time to get to know people, build trust and grow your professional network' },
      { text: 'A community of neutral members, entrepreneurs and investors: widen your network and see varied experiences and paths from inside the Kingdom and beyond' },
      { text: 'Fresh chances to meet and learn all year: attend the club’s meetups, workshops and private evenings at no charge' },
      { text: 'A stage for your venture before people interested in partnership opportunities: days dedicated to entrepreneurs, and priority booking of your slot at the “5 minutes” meetup to present your venture live' },
    ],
  },
  {
    key: 'hq',
    title: 'A permanent HQ and an app, one experience',
    items: [
      { text: 'The club HQ in the heart of Riyadh — Al-Olaya, Prince Mohammed bin Abdulaziz street — completed by an app that travels with you' },
      { text: 'An HQ equipped for meetings and events: 400 square metres holding 15 offices, with a stage and theatre seating up to 80 people' },
      { text: 'Present with us even outside Saudi Arabia: events held at the HQ and streamed online to members everywhere, inside the Kingdom and beyond' },
    ],
  },
  {
    key: 'bank',
    title: 'A business incubator and a Projects Bank of more than 260 ventures',
    items: [
      { text: 'Submit your venture to be considered for listing, and browse the ventures that passed the screening and valuation' },
      { text: 'A SAR 2,500 ($667) balance in the Projects Bank: open the complete details of five ventures you pick, and contact their founders directly to discuss partnership opportunities' },
      { text: 'Your venture assessed within 10 working days: once it meets the acceptance criteria it moves to the Projects Bank and is shown to the club’s members' },
      { text: 'Fresh visibility for your venture all year: your venture is re-highlighted once a month to all club members' },
    ],
  },
  {
    key: 'neutral',
    title: 'Neutral and not sure of your direction yet? This is your place',
    items: [
      { text: 'Explore entrepreneurship and partnership opportunities, and discover your interests before you choose your path' },
      { text: 'An online consultation at no extra fees: with a smart AI-powered advisor who helps you understand your idea and set your next steps' },
      { text: 'A smart assistant around the clock: with a daily renewing usage balance, for questions, drafting, analysis and getting to know the group’s services' },
      { text: 'Every benefit of the app is included in your membership: follow the ventures, the events and the notifications with one account' },
      { text: 'Present yourself and your experience to the members through the “Profile and Journey” initiative at no charge, among the figures the club’s committee picks periodically' },
    ],
  },
  {
    key: 'discounts',
    title: 'Privileges you start with at member prices',
    items: [
      { text: 'Hold your own meetup at a 50% discount: through the “Make your meetup” service and the club theatre rental, with media coverage and a live stream of your event' },
      { text: 'A meeting room at half price: seats 8 people and comes with a Zoom subscription, for your meetings and your partners’ gatherings' },
      { text: 'Design your website or app at a 50% discount: websites and mobile apps on Android and iOS' },
      { text: 'Prepare your pitch at a 50% discount: the “Pitch Deck” presentation built by the PV company' },
      { text: 'Marketing services at a 50% discount through Momentum: visual identity, content management, digital campaigns and influencer-ads packages' },
      { text: 'A fully equipped podcast studio, with a 50% discount on the Al-Moltaqa podcast services for recording episodes and producing video content' },
      { text: 'A promo code in your name with “Our partners”: one code tied to your membership that opens the club partners’ discounts at once' },
    ],
  },
  {
    key: 'upcoming',
    title: 'Upcoming benefits and discounts added to your membership automatically',
    items: [{ text: 'Many partners are being connected to offer varied discounts made for the club’s members, added to your membership automatically' }],
  },
];

/** The flat list older app versions read: the same rows as `flatBenefits` builds from the Arabic groups, in the same order. */
const BENEFITS_EN = GROUPS_EN.filter((group) => group.key !== 'upcoming').flatMap((group) => (group.items ?? []).map((entry) => ({ title: entry.text })));

export const MEMBERSHIP_EN: Translation<MembershipContent> = {
  title: 'The Investors Club annual membership',
  subtitle: 'Not sure of your direction yet? This membership was designed for you first',
  intro: [
    'The Investors Club® is an exclusive business community for neutral members, entrepreneurs and investors, serving its members through one app and a permanent HQ in the heart of the Saudi capital, Riyadh.',
    'From Saudi Arabia to the world… your membership travels with you: a full year to use every benefit of the club, in person at the club HQ in Riyadh, Saudi Arabia, and online, exploring the ventures and the partnership opportunities — building relationships that may open doors money alone does not open.',
    'And when you reach Riyadh, the club is your second home in the world of business: a meeting room to receive your guests, an equipped HQ seating up to 80 people with a complete stage for hosting your own meetups and workshops, 15 offices for temporary use, a podcast studio to carry your message, and a business incubator for your venture — all available to you as a member, with discounts that lighten your business costs.',
    'A full year to discover your direction — your gateway to the world of business. The annual membership does not merely give you attendance; it gives you a whole year to build relationships, discover opportunities and form partnerships that turn into real steps and results.',
  ].join('\n\n'),
  groups: GROUPS_EN,
  benefits: BENEFITS_EN,
  neutralReasons: {
    title: 'Why subscribe to the Investors Club membership before you set your direction?',
    intro:
      'You need not be an investor nor a venture owner to join; whether you are an employee, a student or hold savings and seek your path, one subscription places you for a full year inside a closed, governed business community of thousands of neutrals, entrepreneurs and investors, and opens the doors of the Vibes Ventures group companies with member-only discounts. In short, these are the reasons:',
    items: [
      {
        title: 'Your place is here before you choose your path',
        text: 'Neutral members are the largest group in the club: you attend the workshops and meetups, browse the ventures with your balance, consult your AI-powered expert advisor and build your relationships — a full year before deciding whether to start a venture or join someone else’s.',
      },
      {
        title: 'You learn the world of investment from the inside',
        text: 'You see how ventures are evaluated, how an investor thinks and how partnerships are built in practice… from people with real experience, not from theories, before you put a single riyal into any venture.',
      },
      {
        title: 'Every workshop and meetup is open to you',
        text: 'You attend all the regular workshops and meetups at the club HQ in Riyadh, or follow the meetups remotely from outside it; you listen, ask and learn — and when your venture is born, you present it to investors at the “5 minutes” meetup.',
      },
      {
        title: 'A ready network from day one',
        text: 'You join the club community of thousands of neutrals, entrepreneurs and investors, with one account for all the group’s platforms… and one relationship may be the start of your path.',
      },
      {
        title: 'You discover your direction through real ventures',
        text: 'Pre-evaluated ventures are presented inside the club all year, and a SAR 2,500 balance in the Projects Bank opens 5 complete ventures you pick to match your field and means — then you meet their founders directly… and your direction may turn out to be a partnership in one of them.',
      },
      {
        title: 'An AI-powered expert advisor in your pocket',
        text: 'Ask it in an online consultation at no charge: where do I start? An AI-powered expert advisor built on Vibes Ventures’ own patent-protected technology, running on Vibes Ventures’ own servers; it reads your situation and your numbers and lays your next step out clearly. You also have a renewable daily balance with the AI assistant around the clock, and every feature of the Investors Club app.',
        badges: ['Patent-protected', 'On Vibes Ventures’ own servers'],
      },
      {
        title: 'Your appearance in the “Profile & Journey” initiative',
        text: 'Because every person has a story and every journey has value, your profile and career are published on the club’s platforms and before its audience at no charge — even before your first venture — among the figures regularly chosen from the members.',
      },
      {
        title: 'Your first venture and all that follows, before investors',
        text: 'When you begin, you add any number of your ventures to the “Success Partners” programme as long as you founded them and your membership is active, with priority evaluation within 10 working days; each then moves to the Projects Bank, available to present to all the club’s members, with your venture published 3 times a month on the club’s platforms.',
      },
      {
        title: 'The club theatre is your stage to the world',
        text: 'When you want to share your idea or expertise, you hold your own meetup on a stage seating up to 80 people, with full media coverage and a live broadcast to the whole world — all at a 50% discount.',
        badges: ['Live'],
      },
      {
        title: 'Your services with priority and at half the value',
        text: 'And when your idea becomes a venture: the design of any website or mobile app of yours on Android or iOS, the pitch deck, marketing by Momentum, Al-Moltaqa podcast production and the meeting room — at a 50% discount, alongside up to 50% off outdoor filming and conference coverage.',
      },
    ],
  },
  comingSoonTitle: 'Upcoming benefits and discounts added to your membership automatically',
  comingSoon: ['Many partners are being connected to offer varied discounts made for the club’s members'],
  statusTexts: {
    guest: 'Sign in or create your account to see your membership status.',
    unactivated: 'Your membership is not activated; please activate your membership.',
    active: 'Your membership is active.',
    expired: 'Your membership has ended; please renew your membership.',
  },
  activationNote: 'Subscribing to the annual membership from inside the app arrives with the next release through the app store.',
};
