import type { HqContent } from '../hq.js';
import type { Translation } from '../i18n.js';

/** The HQ page in English; hours, capacity, the map and the tour video are the Arabic block's. */
export const HQ_EN: Translation<HqContent> = {
  title: 'Club HQ',
  intro: 'The Investors Club headquarters in Riyadh: 400 m² of offices, meeting rooms, the club theatre and a coffee shop, for subscribed members by prior booking.',
  address: 'Riyadh, Al Olaya district, Prince Mohammed bin Abdulaziz Street (formerly Tahlia), Al Jawhara Tower',
  facilities: ['15 equipped offices', 'The club theatre and presentation stage', 'A meeting room for eight people with Zoom', 'Coffee shop'],
  rules: [
    'Entry is for subscribed members only and by prior booking; visits without an appointment are not received.',
    'Once the administration confirms, you receive an entry barcode valid for your appointment only.',
    'Bring your digital membership card from the app when you arrive.',
  ],
  memberOnlyText: 'Booking an HQ visit is for subscribed members. Activate your annual membership to book your appointment.',
  guestText: 'Sign in to your account and activate your annual membership to book an HQ visit.',
  purposes: ['Business meeting', 'Introductory visit to the HQ', 'Filming or podcast', 'Attending an event', 'Other'],
};
