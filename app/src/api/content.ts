import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';

import { apiGet, apiRequest } from './client';

// Mirrors server/src/content/home.ts, services.ts and about.ts.
export type PortalKey = 'neutral' | 'entrepreneur' | 'investor';

export type HomePortal = {
  key: PortalKey;
  title: string;
  subtitle: string;
  icon: string;
  target: 'projects' | 'entrepreneurs' | 'advisor' | 'guide';
};

/** M74: a persona-matched call to action on a home block — `route` is an app path. */
export type HomeCta = { label: string; route: string };

/** M74: the home blocks the server can reorder per persona; unknown names are ignored. */
export type HomeSectionKey =
  | 'famous'
  | 'posts'
  | 'agenda'
  | 'portals'
  | 'quickActions'
  | 'projectsBank'
  | 'golden'
  | 'membership'
  | 'services'
  | 'partners'
  | 'videos'
  | 'advisor'
  | 'podcast'
  | 'savings'
  | 'tour'
  | 'opportunity'
  | 'wallet'
  | 'meetups';

/** M74: how the home reads for one persona (or a guest). M99: visibility, tabs and the services grid too. */
export type HomePersonaVariant = {
  heroSubtitle?: string;
  order?: HomeSectionKey[];
  ctas?: Partial<Record<HomeSectionKey, HomeCta>>;
  /** M99: blocks this persona never sees, even when the default order carries them. */
  hide?: HomeSectionKey[];
  /** M99: tab routes this persona never sees; the screens stay reachable by path. */
  hideTabs?: string[];
  /** M99: the service keys that LEAD this persona's services grid; the rest follow. */
  serviceKeys?: string[];
};

export type HomeContent = {
  /** `story` (M102): the paragraphs behind «اقرأ المزيد» under the hero; an older server sends none. */
  hero: { eyebrow: string; title: string; subtitle: string; story?: string[] };
  portals: HomePortal[];
  golden: { title: string; subtitle: string; cta: string };
  membership: { title: string; subtitle: string; cta: string; activeText: string };
  services: { title: string; subtitle: string; cta: string };
  /** M68 «شركاؤنا»: an older server sends no key and the home hides the strip. */
  partners?: { title: string; subtitle: string; cta: string };
  /** M73 «شخصية ومسيرة»; an older server sends none and the block hides. */
  famous?: { title: string; subtitle: string; cta: string };
  videos: { title: string; subtitle: string; cta: string };
  /** M84: the Projects Bank home block; an older server sends none and the block hides. */
  projectsBank?: { title: string; subtitle: string; cta: string };
  /** M74-8: the advisor-as-companion card; chips are next-step suggestions (label + app route). */
  advisor?: { title: string; subtitle: string; cta: string; chips: HomeCta[] };
  /** M74-7: the featured podcast card — the studio as the member's stage. */
  podcast?: { title: string; subtitle: string; cta: string; route: string };
  /** M74-5: what the membership saves while exploring. */
  savings?: { title: string; subtitle: string; items: string[]; cta: string };
  /** M99c «الفرصة الذهبية»: one featured project that changes on every app open. */
  opportunity?: { title: string; subtitle: string; cta: string };
  /** M99c: the investor's wallet card — words from the server, numbers from the wallet API. */
  wallet?: { title: string; subtitle: string; cta: string };
  /** M119: the club meetups strip; an older server sends none and the block hides. */
  meetups?: { title: string; subtitle: string; cta: string };
  /** M74: per-persona home variants; an older server sends none and one home serves everyone. */
  personas?: Partial<Record<PortalKey | 'guest', HomePersonaVariant>>;
  entrepreneurs: { title: string; intro: string; serviceKeys: string[] };
  neutralOpening: { title: string; text: string; quickReplies: string[] };
  updatedAt: string;
};

export type ServiceField = { key: string; label: string; options?: string[]; placeholder?: string };

export type ServiceAction =
  | { type: 'whatsapp'; phone: string; message: string; fields: ServiceField[] }
  | { type: 'paymob'; message: string; fields: ServiceField[]; amount: number; memberAmount: number | null; currency: 'SAR' }
  | { type: 'link'; url: string; label: string }
  | { type: 'form'; formKey: string; label: string }
  /** M73: opens an in-app screen by its route (e.g. the «شخصية ومسيرة» application). */
  | { type: 'route'; path: string; label: string }
  | { type: 'advisor'; prompt: string }
  | { type: 'hq' }
  | { type: 'projects' };

export type ServiceGroupKey = 'entrepreneur' | 'member' | 'discount';

export type Service = {
  key: string;
  title: string;
  summary: string;
  detail: string | null;
  icon: string;
  group: ServiceGroupKey;
  priceLabel: string | null;
  memberLabel: string | null;
  access: 'everyone' | 'member';
  locked: boolean;
  action: ServiceAction | null;
  /** What this account pays for a Paymob service (member price with an active membership); null otherwise. */
  price: { amount: number; currency: string; memberPrice: boolean } | null;
  /** M109b «وفّر … ريال بعضويتك»: list price minus member price; an older server sends none. */
  savingsSar?: number | null;
  infoUrl: string | null;
  order: number;
  /** M74: the imperative call to action on the service card; an older server sends none. */
  cta?: string;
  /** M81: the owner's photo for this service, shown atop its page; an older server sends none. */
  imageUrl?: string | null;
  /** M105: the service page's rotating banner photos, slot order; an older server sends none. */
  imageUrls?: string[];
};

export type ServicesList = {
  title: string;
  intro: string;
  groups: { key: ServiceGroupKey; title: string }[];
  lockedText: string;
  isMember: boolean;
  services: Service[];
  updatedAt: string;
};

export type AboutSection = {
  key: string;
  title: string;
  paragraphs: string[];
  bullets: string[];
  url: string | null;
  urlLabel: string | null;
  logoUrl: string | null;
};

export type AboutContent = {
  title: string;
  intro: string;
  logoUrl: string;
  sections: AboutSection[];
  ecosystem: { title: string; intro: string; companies: { name: string; role: string; url: string }[] };
  contact: { title: string; management: string; studio: string; email: string; websites: { label: string; url: string }[] };
  legal: { operator: string; cr: string; vat: string; address: string; trademark: string };
  updatedAt: string;
};

export function useHomeContent() {
  return useQuery({
    queryKey: ['content', 'home'],
    queryFn: () => apiGet<HomeContent>('/api/home'),
    staleTime: 10 * 60_000,
  });
}

// Mirrors server/src/content/meetups.ts (M119: the five club meetups).
export type MeetupFeature = { title: string; text: string };

export type Meetup = {
  key: string;
  number: string;
  badge: string;
  title: string;
  tagline: string;
  description: string;
  features: MeetupFeature[];
  /** Empty until the owner sends the film; the page shows the emblem hero instead. */
  videoUrl: string;
  formKey: string;
  cta: string;
};

export type MeetupsPersonaVariant = { intro: string; order: string[] };

export type MeetupsContent = {
  title: string;
  subtitle: string;
  personas: Partial<Record<PortalKey | 'guest', MeetupsPersonaVariant>>;
  meetups: Meetup[];
  updatedAt: string;
};

export function useMeetupsContent() {
  return useQuery({
    queryKey: ['content', 'meetups'],
    queryFn: () => apiGet<MeetupsContent>('/api/meetups'),
    staleTime: 10 * 60_000,
  });
}

/** The meetups the way one persona reads them: his intro line, his order first, the rest after. */
export function meetupsFor(content: MeetupsContent | undefined, persona: PortalKey | 'guest'): { intro: string; meetups: Meetup[] } {
  if (!content) return { intro: '', meetups: [] };
  const variant = content.personas?.[persona];
  const lead = variant?.order ?? [];
  const rank = (key: string): number => {
    const index = lead.indexOf(key);
    return index < 0 ? lead.length : index;
  };
  const meetups = [...content.meetups].sort((a, b) => rank(a.key) - rank(b.key));
  return { intro: variant?.intro ?? '', meetups };
}

export function useAboutContent() {
  return useQuery({
    queryKey: ['content', 'about'],
    queryFn: () => apiGet<AboutContent>('/api/about'),
    staleTime: 30 * 60_000,
  });
}

/** The lock state depends on the account, so the cache key follows the session. */
function useAccountKey(): string {
  const { status, me } = useAuth();
  return status === 'signedIn' && me ? `${me.id}:${me.membership.status}` : 'guest';
}

export function useServices() {
  const account = useAccountKey();
  return useQuery({
    queryKey: ['services', account],
    queryFn: () => apiGet<ServicesList>('/api/services'),
    staleTime: 5 * 60_000,
  });
}

export function useService(key: string | undefined) {
  const account = useAccountKey();
  return useQuery({
    queryKey: ['service', key, account],
    queryFn: () => apiGet<{ service: Service; lockedText: string; isMember: boolean }>(`/api/services/${encodeURIComponent(key ?? '')}`),
    enabled: Boolean(key),
    staleTime: 5 * 60_000,
  });
}

/** Tells the management about a WhatsApp handover before the app leaves for WhatsApp (never blocks the handover). */
export function reportServiceRequest(key: string, answers: Record<string, string>): void {
  void apiRequest('POST', `/api/services/${encodeURIComponent(key)}/request`, { body: { answers } }).catch(() => undefined);
}
