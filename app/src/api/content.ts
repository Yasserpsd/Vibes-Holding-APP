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
  | 'savings';

/** M74: how the home reads for one persona (or a guest). */
export type HomePersonaVariant = {
  heroSubtitle?: string;
  order?: HomeSectionKey[];
  ctas?: Partial<Record<HomeSectionKey, HomeCta>>;
};

export type HomeContent = {
  hero: { eyebrow: string; title: string; subtitle: string };
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
  infoUrl: string | null;
  order: number;
  /** M74: the imperative call to action on the service card; an older server sends none. */
  cta?: string;
  /** M81: the owner's photo for this service, shown atop its page; an older server sends none. */
  imageUrl?: string | null;
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
