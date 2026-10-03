import type { Translation } from '../i18n.js';
import type { FormsContent } from '../../forms/content.js';

/** The registration forms in English. Field keys, links and the shape of every form are the Arabic block's. */
export const FORMS_EN: Translation<FormsContent> = {
  forms: [
    {
      key: 'success-partners',
      title: 'Success Partners registration',
      intro:
        'Register your venture in the Success Partners programme: a specialised committee reviews your registration, and the venture is presented to investors in the Projects Bank only once approved. Subscribed members get priority in applying and in presentation.',
      closedText: "Registration in the programme is currently paused. Follow the club's announcements or write to the management.",
      submitLabel: 'Send the request',
      successText:
        'We received your Success Partners registration; the programme committee will review it and the management will contact you. If you have a pitch deck or extra files, you will be asked to send them when we call back.',
      fields: [
        { key: 'firstName', label: 'First name' },
        { key: 'lastName', label: 'Last name' },
        { key: 'country', label: 'Country', placeholder: 'For example: Saudi Arabia' },
        { key: 'city', label: 'City' },
        { key: 'whatsapp', label: 'WhatsApp number' },
        { key: 'email', label: 'E-mail' },
        { key: 'company', label: 'Company name' },
        {
          key: 'stage',
          label: 'Which stage describes your venture?',
          options: ['I have an early product', 'Started generating revenue', 'In the expansion stage', 'Other'],
        },
        {
          key: 'sector',
          label: 'Sector',
          options: [
            'Technology and software',
            'Health and biotechnology',
            'Education and training',
            'Energy and sustainability',
            'Financial services and FinTech',
            'Commerce and retail',
            'Consulting and management development',
            'Tourism and hospitality',
            'Logistics and transport',
            'Entertainment and media',
            'Industry and advanced manufacturing',
            'Real estate and urban development',
            'Cybersecurity and data solutions',
            'Food and beverages',
            'Other',
          ],
        },
        { key: 'summary', label: 'A brief description of the company, the idea or the proposed partnership' },
        { key: 'deck', label: 'Do you have a pitch deck (PDF, video, documents, photos and the like)?', options: ['Yes', 'No'] },
        { key: 'deckLink', label: 'A link to the file, if any (optional)' },
        { key: 'website', label: "Your company's or venture's website (optional)" },
        {
          key: 'ownership',
          label:
            'I accept that Vibes Holding receives a 10% official ownership stake in my business if any partnership with club members is completed, under the terms of the Success Partners programme agreement.',
        },
        { key: 'nda', label: 'I have read the non-disclosure agreement (NDA) and all of its clauses, and I agree to and abide by all of its terms and conditions.' },
      ],
    },
    {
      key: 'workshop',
      title: 'Workshop registration',
      intro:
        'The “Your venture from idea to execution” workshop: three practical days, 17 to 19 October 2026, at the club HQ in Riyadh and online. After registering, the management contacts you to settle the fee and confirm your seat.',
      closedText: "Registration for the current workshop is closed. Follow the club's announcements for the next one.",
      submitLabel: 'Register',
      successText: 'We received your workshop registration; the management will contact you to confirm your seat and settle the fee.',
      fields: [
        { key: 'city', label: 'City' },
        { key: 'mode', label: 'How you will attend', options: ['In person at the club HQ in Riyadh', 'Online'] },
        { key: 'bio', label: 'A short note about you and your business' },
        { key: 'terms', label: "I agree to the workshop's terms and conditions." },
      ],
    },
  ],
};
