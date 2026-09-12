import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Server content names an icon family; only known names are used, anything else falls back. */
const ICONS: Record<string, IoniconName> = {
  briefcase: 'briefcase-outline',
  rocket: 'rocket-outline',
  compass: 'compass-outline',
  people: 'people-outline',
  'people-circle': 'people-circle-outline',
  ribbon: 'ribbon-outline',
  easel: 'easel-outline',
  school: 'school-outline',
  mic: 'mic-outline',
  business: 'business-outline',
  film: 'film-outline',
  chatbubbles: 'chatbubbles-outline',
  star: 'star-outline',
  megaphone: 'megaphone-outline',
  wallet: 'wallet-outline',
  globe: 'globe-outline',
  storefront: 'storefront-outline',
  pricetag: 'pricetag-outline',
  sparkles: 'sparkles-outline',
  time: 'time-outline',
  cart: 'cart-outline',
};

export function iconFor(name: string | null | undefined, fallback: IoniconName = 'sparkles-outline'): IoniconName {
  return (name && ICONS[name]) || fallback;
}
