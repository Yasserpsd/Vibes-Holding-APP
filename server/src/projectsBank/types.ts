export type Term = { slug: string; name: string };

/**
 * The only project shape that leaves the server. Built field by field from the
 * feed; founder contact data (whatsapp, email, website, pitch deck) is never copied.
 */
export type PublicProject = {
  id: number;
  number: string | null;
  slug: string | null;
  title: string;
  titleEn: string | null;
  companyName: string | null;
  companyNameEn: string | null;
  founderName: string | null;
  founderNameEn: string | null;
  excerpt: string | null;
  excerptEn: string | null;
  details: string | null;
  detailsEn: string | null;
  image: string | null;
  gallery: string[];
  sector: Term | null;
  stage: Term | null;
  isGolden: boolean;
  featuredOrder: number | null;
  goldenPartnerUrl: string | null;
  hasPitchDeck: boolean;
  contactRule: string | null;
  viewsCount: number;
  modifiedAt: string | null;
};

export const PROJECT_SORTS = ['latest', 'views', 'discover', 'golden'] as const;
export type ProjectsSort = (typeof PROJECT_SORTS)[number];

export type ProjectsQuery = {
  q?: string;
  sector?: string;
  stage?: string;
  sort: ProjectsSort;
  page: number;
  limit: number;
};

export type ProjectsPage = {
  items: PublicProject[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  updatedAt: string | null;
};

export type FilterOption = Term & { count: number };

export type ProjectsFilters = {
  sectors: FilterOption[];
  stages: FilterOption[];
  sorts: { key: ProjectsSort; label: string }[];
  updatedAt: string | null;
};

export type FeedSnapshot = {
  projects: PublicProject[];
  fetchedAt: string;
  /** Project id → public page on vibesholding.com. Server-side only: sent to the hub as screen context, never to the app. */
  pageUrls?: Record<string, string>;
};
