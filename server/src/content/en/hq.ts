import type { HqContent } from '../hq.js';
import type { Translation } from '../i18n.js';

/** The HQ page in English; hours, capacity, the map and the tour video are the Arabic block's. */
export const HQ_EN: Translation<HqContent> = {
  title: 'Club HQ',
  intro:
    'When you arrive in Riyadh, the club is your second home in the business world — no need to worry about your essential business needs: a meeting room to receive your guests, a fully equipped venue seating 80 with an integrated stage for hosting your own meetups and workshops, 15 offices for temporary use, a podcast studio to carry your message, and a business incubator to embrace your project. All yours as a member, with discounts that lighten your business costs.',
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
