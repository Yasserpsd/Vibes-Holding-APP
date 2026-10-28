import type { Href } from 'expo-router';

import type { AppScreen } from '@/api/advisor';

/** M145: the server names a screen; the app knows its route (mirrors APP_SCREENS in server/src/advisor/intents.ts). */
export const SCREEN_ROUTES: Record<AppScreen, Href> = {
  home: '/',
  projects: '/projects',
  golden: '/golden',
  membership: '/membership',
  services: '/services',
  hq: '/hq',
  news: '/news',
  videos: '/videos',
  posts: '/posts',
  account: '/account',
  card: '/card',
  invite: '/invite' as Href,
  agenda: '/agenda',
  people: '/people',
  people_apply: '/people/apply',
  guide: '/guide',
  workshops: '/workshops',
  meetups: '/meetups',
  payments: '/payments',
  profile: '/profile-edit',
  security: '/security',
  about: '/about',
};
