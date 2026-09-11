// Mirrors the server response types (server/src/projectsBank/types.ts, server/src/content/golden.ts).

export type Term = { slug: string; name: string };

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
  viewsCount: number;
  publishedAt: string | null;
};

export type ProjectsSort = 'latest' | 'views' | 'discover' | 'golden';

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

export type GoldenCompany = {
  code: string;
  name: string;
  tagline: string | null;
  valuationSarMillions: number | null;
  offerUrl: string;
  logoUrl: string;
  order: number;
};

export type GoldenContent = {
  title: string;
  intro: string;
  portfolioValueSarMillions: number;
  disclaimer: string;
  umbrella: GoldenCompany;
  companies: GoldenCompany[];
  updatedAt: string;
};
