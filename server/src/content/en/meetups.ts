import type { Translation } from '../i18n.js';
import type { MeetupsContent } from '../meetups.js';

/** The club meetups in English. Keys, video URLs and form keys are the Arabic block's. */
export const MEETUPS_EN: Translation<MeetupsContent> = {
  title: 'Investors Club Meetups',
  subtitle: 'Five distinctive experiences designed to open partnership doors and shorten the distance between an idea and an opportunity.',
  personas: {
    guest: {
      intro: 'Attend the meetups and get to know the club community up close — each meetup has its own character and audience.',
    },
    neutral: {
      intro: 'Attend the meetups and get to know the community up close before choosing your direction.',
    },
    entrepreneur: {
      intro: 'Your stage in front of the club members: present your venture at the meetup that fits it best.',
    },
    investor: {
      intro: 'Meetups that bring you face to face with the owners of approved ventures — pick your next one.',
    },
  },
  meetups: [
    {
      key: 'five-minutes',
      badge: 'Meetup',
      title: '5 Minutes',
      description:
        'A window of no more than five minutes gives entrepreneurs an exceptional chance to present as many of their approved, Projects Bank-listed ventures as possible, before a hand-picked audience of Investors Club members — a professionally run experience with a timer and a bell that keep the presentations flowing and respect everyone’s time.',
      features: [
        { title: '12 entrepreneurs per meetup', text: 'A full hour of approved ventures from the Projects Bank' },
        { title: '5 minutes per speaker', text: 'A strong idea needs no padding… time is money' },
        { title: 'Partnership opportunities', text: 'Five minutes can start a partnership that changes everything' },
      ],
      cta: 'Register now',
    },
    {
      key: 'private-pitch',
      badge: 'Meetup',
      title: 'Private Pitch',
      description:
        'A focused meetup that gathers a select group of investors to explore promising partnership opportunities in companies founded or co-founded by Vibes Ventures. Each edition spotlights one company only, so it gets undivided attention and a full discussion, with its pitch deck reviewed before any decision.',
      features: [
        { title: 'One company per edition', text: 'Full focus on a single company gives the audience real depth' },
        { title: 'Strategic partnerships', text: 'A transparent, direct setting for trusted partnerships' },
        { title: 'Growth opportunities', text: 'Companies from the Vibes Ventures ecosystem with proven growth' },
      ],
      cta: 'Register your attendance',
    },
    {
      key: 'elite-challenge',
      badge: 'Meetup',
      title: 'Elite Challenge',
      description:
        'A meetup inspired by the format of Shark Tank — different in substance: standout partnerships start with a direct face-off between investors competing to close distinctive partnerships with entrepreneurs presenting approved, Projects Bank-listed ventures.',
      features: [
        { title: 'Approved ventures', text: 'Well-studied ventures officially listed in the Projects Bank' },
        { title: 'Serious investors', text: 'A select group of investors seeking distinctive partnerships' },
        { title: 'Direct face-off', text: 'Real competition to close distinctive partnerships' },
      ],
      cta: 'Join now',
    },
    {
      key: 'open-day',
      badge: 'Meetup',
      title: 'Open Day',
      description:
        'An open space without constraints — no set agenda and no limits on the conversation. The stage is fully open to all Investors Club members: a meetup made for members to meet each other, exchange business cards, network and talk without restraint. Take the microphone and share your experiences, your successes and your setbacks… every experience carries value, and every story may open a new door for someone in the room.',
      features: [
        { title: 'Open conversation', text: 'An open space with no set agenda or topic limits' },
        { title: 'Real experiences', text: 'Successes and setbacks shared openly by the members' },
        { title: 'Professional setting', text: 'An environment that respects every opinion and values every experience' },
      ],
      cta: 'Join now',
    },
    {
      key: 'your-own',
      badge: 'Initiative',
      title: 'Create Your Own Meetup',
      description:
        'Your venture may not have been approved by the Success Partners platform while you believe it deserves to be seen — so we created the option to host your own meetup and reach the largest possible audience of interested members on the club’s platform. Whether you want to pitch your venture, run a workshop, launch a product, attract people to your idea or look for partners — this is your chance to shape your meetup the way it deserves.',
      features: [
        { title: 'Your meetup is the event', text: 'A meetup dedicated entirely to you and what you offer' },
        { title: 'We bring them to you', text: 'We invite and gather the attendees interested in your pitch' },
        { title: 'Professional management', text: 'In cooperation with the Investors Club in Riyadh and the members outside Riyadh (online)' },
      ],
      cta: 'Create your meetup now',
    },
  ],
};
