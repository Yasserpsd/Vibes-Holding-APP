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
  lockedText: 'This feature is exclusive to Investors Club members. Join now to enjoy all membership benefits.',
  lockedGuestText: 'This feature is exclusive to Investors Club members. Join now to enjoy all membership benefits.',
  lockedExpiredText: 'Your membership has ended. Renew your annual membership to use this service.',
  services: [
    {
      key: 'meetup',
      cta: 'Request your meetup',
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
      key: 'operating-rights',
      cta: 'Request operating rights',
      title: 'Investors Club operating rights',
      summary: 'Operate the “Investors Club” brand exclusively in your city or country, with the same methodology as the club HQ in Riyadh.',
      detail:
        'If you run a business incubator or accelerator, or own premium office space, the operating rights let you run every element of the Vibes Ventures ecosystem within a defined exclusive geographic area, with the same mechanism and methodology used at the Investors Club HQ in Riyadh.\nAs an exclusive operator you get: a unified mechanism to replicate the experience locally in your area, listing your own ventures in the Projects Bank, a 50% share of the membership values and percentages the club receives when a venture submitted by you is approved, 50% of membership subscription fees, the right to use the “Investors Club” trademark in the target city, and many more benefits set out in the operating-rights terms.\nThe model is designed for incubators, accelerators, owners of premium office space, investment funds, advisory firms and business development offices, and for companies and experienced individuals who wish to represent the club in their cities or countries.\nObtaining the operating rights requires a bank guarantee, and the management contacts you to complete the criteria and details.',
      action: {
        message: 'I would like to obtain the “Investors Club” operating rights.',
        fields: [
          { key: 'city', label: 'Target country and city' },
          { key: 'population', label: 'City population', options: ['100k to 250k', '250k to 500k', '500k to 1M', '1M to 2M', '2M and above'] },
          { key: 'entity', label: 'Your entity', options: ['Business incubator', 'Business accelerator', 'Office space', 'Investment fund', 'Advisory firm', 'Business development office', 'Company', 'Experienced individual'] },
          { key: 'about', label: 'About you and your business', placeholder: 'Your experience and why you seek the operating rights' },
        ],
      },
    },
    {
      key: 'success-partners',
      cta: 'Register your venture',
      title: 'Success Partners',
      summary: 'Register your venture to be reviewed by a specialised committee and listed in the Projects Bank if approved.',
      detail: "The Success Partners programme is the source of the group's distinctive ventures. After registration a specialised committee reviews and assesses your venture within 10 working days, and once it meets the acceptance criteria it moves to the Projects Bank and is shown to the club's members. Subscribed members get priority in applying and in presentation.",
      memberLabel: 'Priority for members',
      action: { label: 'Register your venture' },
    },
    {
      key: 'pitch-deck',
      cta: 'Order your deck',
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
      key: 'app-publish',
      cta: 'Publish your app',
      title: 'Publish your app on both stores',
      summary: 'The club publishes your app on Google Play and the App Store at no charge — an exclusive benefit for subscribed members.',
      detail: 'Fill in your app details and the management contacts you to collect the files and complete the publishing on both stores. The one condition is an active annual membership.',
      memberLabel: 'No fees for members',
      action: { label: 'Fill in your app details' },
    },
    {
      key: 'workshop',
      cta: 'Join the workshop',
      title: 'Workshops',
      summary: 'The “Your venture from idea to execution” workshop: 17 to 19 October 2026 at the club HQ and online.',
      detail: "Three practical days that take your venture from the idea to a clear execution plan, with the club's experts.",
      priceLabel: 'SAR 290 instead of 1,200',
      memberLabel: '50% discount for members',
      action: { label: 'Register for the workshop' },
    },
    {
      key: 'studio',
      cta: 'Book the studio',
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
      cta: 'Book your visit',
      title: 'Club HQ visit',
      summary: 'Book your visit to the club HQ in Riyadh; once the administration confirms, you receive the entry barcode for your appointment.',
      memberLabel: 'For subscribed members',
    },
    // M107: the meeting room books in-app through the HQ flow, no fees for the membership's whole term.
    {
      key: 'meeting-room',
      cta: 'Book the room',
      title: 'Meeting room booking',
      summary: 'A meeting room for 8 people with a Zoom subscription at the club HQ in Riyadh — no fees for the whole membership term.',
      detail: 'Book your slot from the app and pick the purpose “Meeting room booking”; once the administration confirms, you receive the entry barcode for your appointment.',
      memberLabel: 'No fees for the whole membership term',
    },
    {
      key: 'theater',
      cta: 'Book the theatre',
      title: 'Club theatre',
      summary: 'A theatre seating up to 80 people at the club HQ for your events and shows, at a 50% discount for members.',
      memberLabel: '50% discount for members',
      action: {
        message: 'I would like to book the club theatre.',
        fields: [{ key: 'time', label: 'Preferred date' }],
      },
    },
    {
      key: 'consultation',
      cta: 'Start your consultation',
      title: 'Online consultation with a smart advisor',
      summary: 'An online consultation session with a smart AI-powered advisor, at no extra fees for subscribed members.',
      detail: 'It helps you understand your idea and set your next steps, with a daily renewing usage balance around the clock.',
      memberLabel: 'No charge for members',
      action: { prompt: 'I would like an online consultation: I have an idea and need help understanding it and setting my next steps.' },
    },
    {
      key: 'famous',
      cta: 'Apply here',
      title: 'Profile and Journey',
      summary: "Your appearance in a “Profile and Journey” interview on the club's platforms, at no charge for subscribed members.",
      memberLabel: 'No charge for members',
      action: { label: 'Apply here' },
    },
    {
      key: 'repost',
      cta: 'Request a feature',
      title: "Highlighting your venture on the club's platforms",
      summary: "Your venture re-highlighted once a month to all club members on the club's platforms and the app.",
      memberLabel: 'Once a month for members',
      action: {
        message: "I would like to publish my venture on the club's platforms.",
        fields: [{ key: 'project', label: 'Venture name or its link in the Projects Bank' }],
      },
    },
    {
      key: 'credit',
      cta: 'Use your credit',
      title: 'Projects Bank balance',
      summary: 'A balance worth SAR 2,500 that opens the details of 5 complete real ventures you pick yourself.',
      memberLabel: 'Included in the membership',
    },
    {
      key: 'momentum',
      cta: 'Request the service',
      title: 'Momentum: websites, apps and marketing',
      summary: 'Website and app design, digital marketing packages and influencer advertising at a 50% discount for members.',
      memberLabel: '50% discount for members',
      action: {
        message: 'I would like to use the member discount on Momentum services.',
        fields: [{ key: 'service', label: 'Service', options: ['Website', 'App', 'Digital marketing', 'Influencer advertising'] }],
      },
    },
    // M107: «franchise» and «manfaz» removed with their Arabic entries.
  ],
};
