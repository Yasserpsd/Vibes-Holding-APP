import type { Translation } from '../i18n.js';
import type { ServicesContent } from '../services.js';

/** The services catalogue in English. Prices, phones, links, icons and the kind of every action are the Arabic block's. */
export const SERVICES_EN: Translation<ServicesContent> = {
  title: 'Club services',
  intro: "Entrepreneur services are open to everyone; the group's benefits and discounts are for subscribed members.",
  groups: [
    { key: 'entrepreneur', title: 'Entrepreneur services' },
    { key: 'member', title: 'Benefits for subscribed members' },
    { key: 'discount', title: 'Group discounts' },
  ],
  lockedText: 'This service is for subscribed members. Activate your annual membership to use it.',
  lockedGuestText: 'This service is for subscribed members. Sign in and activate your annual membership to use it.',
  lockedExpiredText: 'Your membership has ended. Renew your annual membership to use this service.',
  services: [
    {
      key: 'meetup',
      title: 'Make your meetup',
      summary: "A meetup in your name, attended by the club's investors and entrepreneurs, which we organise for you from the idea to the stage.",
      detail: "You choose the meetup's topic and audience, and the club team handles the organisation, invitations and production at the club HQ in Riyadh or online. Subscribed members get a 50% discount.",
      priceLabel: 'SAR 30,000',
      memberLabel: 'SAR 15,000 for members',
      action: {
        message: 'Request for the “Make your meetup” service',
        fields: [
          { key: 'topic', label: 'Meetup topic', placeholder: 'For example: partnership opportunities in the retail sector' },
          { key: 'date', label: 'Preferred date', placeholder: 'For example: the second half of October' },
        ],
      },
    },
    {
      key: 'success-partners',
      title: 'Success Partners',
      summary: 'Register your venture to be reviewed by a specialised committee and listed in the Projects Bank if approved.',
      detail: "The Success Partners programme is the source of the group's distinctive ventures. After registration a specialised committee reviews your venture, and it is presented to investors in the Projects Bank only once approved. Subscribed members get priority in applying and in presentation.",
      memberLabel: 'Priority for members',
      action: { label: 'Register your venture' },
    },
    {
      key: 'pitch-deck',
      title: 'Pitch deck design',
      summary: 'A professional presentation of your venture prepared by the PV Business Incubators and Accelerators team.',
      detail: "It covers writing the venture's story, a brief financial model and slide design with a professional identity ready to present to investors.",
      priceLabel: 'SAR 5,000',
      memberLabel: 'SAR 2,500 for members',
      action: {
        message: 'Request for the pitch deck design service',
        fields: [
          { key: 'project', label: 'Venture name' },
          { key: 'stage', label: 'Venture stage', options: ['Idea', 'Prototype', 'Running venture', 'Expansion'] },
        ],
      },
    },
    {
      key: 'workshop',
      title: 'Workshops',
      summary: 'The “Your venture from idea to execution” workshop: 17 to 19 October 2026 at the club HQ and online.',
      detail: "Three practical days that take your venture from the idea to a clear execution plan, with the club's experts.",
      priceLabel: 'SAR 290 instead of 1,200',
      memberLabel: '50% discount for members',
      action: {
        message: 'I would like to register for the “Your venture from idea to execution” workshop.',
        fields: [{ key: 'mode', label: 'How you will attend', options: ['In person in Riyadh', 'Online'] }],
      },
    },
    {
      key: 'studio',
      title: 'Al-Moltaqa podcast: studio booking',
      summary: "The studio packages (basic, advanced, full, theatre, outdoor filming) at a 50% discount for members; booking through the studio's WhatsApp.",
      detail: 'Choose the package and your preferred time, and the studio team will contact you on WhatsApp to confirm the booking and the details.',
      memberLabel: '50% discount for members with no usage limit',
      action: {
        message: 'I would like to book the Al-Moltaqa podcast studio.',
        fields: [
          { key: 'package', label: 'Package', options: ['Basic', 'Advanced', 'Full', 'Theatre', 'Outdoor filming', 'Add-ons'] },
          { key: 'time', label: 'Preferred time', placeholder: 'For example: Tuesday at 4 pm' },
        ],
      },
    },
    {
      key: 'hq-visit',
      title: 'Club HQ visit',
      summary: 'Book your visit to the club HQ in Riyadh; once the administration confirms, you receive the entry barcode for your appointment.',
      memberLabel: 'For subscribed members',
    },
    {
      key: 'theater',
      title: 'Club theatre and meeting room',
      summary: 'The club theatre and the meeting room (8 people with Zoom) at the club HQ, at a 50% discount for members.',
      memberLabel: '50% discount for members',
      action: {
        message: 'I would like to book the club theatre or the meeting room.',
        fields: [
          { key: 'space', label: 'Space', options: ['Club theatre', 'Meeting room'] },
          { key: 'time', label: 'Preferred date' },
        ],
      },
    },
    {
      key: 'consultation',
      title: "Online consultation with the club's experts",
      summary: "An online consultation session with the club's experts, at no charge for subscribed members.",
      memberLabel: 'No charge for members',
      action: {
        message: "I would like to book an online consultation with the club's experts.",
        fields: [{ key: 'topic', label: 'Consultation topic' }],
      },
    },
    {
      key: 'famous',
      title: 'Profile and Journey',
      summary: "Your appearance in a “Profile and Journey” interview on the club's platforms, at no charge for subscribed members.",
      memberLabel: 'No charge for members',
      action: { message: 'I would like to appear in a “Profile and Journey” interview.' },
    },
    {
      key: 'repost',
      title: "Publishing your venture on the club's platforms",
      summary: "Publishing your venture 3 times a month on the club's groups, platforms and the app.",
      memberLabel: '3 times a month for members',
      action: {
        message: "I would like to publish my venture on the club's platforms.",
        fields: [{ key: 'project', label: 'Venture name or its link in the Projects Bank' }],
      },
    },
    {
      key: 'credit',
      title: 'Projects Bank balance',
      summary: 'A balance worth SAR 2,500 that opens the details of 5 complete real ventures you pick yourself.',
      memberLabel: 'Included in the membership',
    },
    {
      key: 'groups',
      title: 'Club groups',
      summary: "Joining the club members' groups and contacting investors and entrepreneurs directly.",
      memberLabel: 'For subscribed members',
      action: { message: 'I would like to join the club groups.' },
    },
    {
      key: 'momentum',
      title: 'Momentum: websites, apps and marketing',
      summary: 'Website and app design, digital marketing packages and influencer advertising at a 50% discount for members.',
      memberLabel: '50% discount for members',
      action: {
        message: 'I would like to use the member discount on Momentum services.',
        fields: [{ key: 'service', label: 'Service', options: ['Website', 'App', 'Digital marketing', 'Influencer advertising'] }],
      },
    },
    {
      key: 'franchise',
      title: 'Franchise package',
      summary: 'The franchise package from Franchment to expand your brand, at a 50% discount for members.',
      memberLabel: '50% discount for members',
      action: {
        message: 'I would like to use the member discount on the franchise package.',
        fields: [{ key: 'brand', label: 'Brand' }],
      },
    },
    {
      key: 'manfaz',
      title: '“Manfaz” products discount code',
      summary: 'A discount code of up to 20% on “Manfaz” products from Quick Deals Trading.',
      memberLabel: 'Up to 20% for members',
      action: { message: 'I would like to get the “Manfaz” products discount code.' },
    },
  ],
};
