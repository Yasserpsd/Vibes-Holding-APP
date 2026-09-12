import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';

import { apiGet } from './client';

// Mirrors server/src/content/home.ts, services.ts and about.ts.
export type PortalKey = 'investor' | 'entrepreneur' | 'neutral';

export type HomePortal = {
  key: PortalKey;
  title: string;
  subtitle: string;
  icon: string;
  target: 'projects' | 'entrepreneurs' | 'advisor';
};

export type HomeContent = {
  hero: { eyebrow: string; title: string; subtitle: string };
  portals: HomePortal[];
  golden: { title: string; subtitle: string; cta: string };
  membership: { title: string; subtitle: string; cta: string; activeText: string };
  services: { title: string; subtitle: string; cta: string };
  videos: { title: string; subtitle: string; cta: string };
  entrepreneurs: { title: string; intro: string; serviceKeys: string[] };
  neutralOpening: { title: string; text: string; quickReplies: string[] };
  updatedAt: string;
};

export type ServiceField = { key: string; label: string; options?: string[]; placeholder?: string };

export type ServiceAction =
  | { type: 'whatsapp'; phone: string; message: string; fields: ServiceField[] }
  | { type: 'link'; url: string; label: string }
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
  infoUrl: string | null;
  order: number;
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
