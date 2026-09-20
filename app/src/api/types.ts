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
  hasPitchDeck: boolean;
  contactRule: string | null;
  viewsCount: number;
  modifiedAt: string | null;
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

// Mirrors server/src/projectsBank/brief.ts: «ملخص المستشار», built on the server from the public feed fields only.
export type BriefStageKey = 'idea' | 'prototype' | 'launch' | 'revenue' | 'growth' | 'unknown';

export type ProjectBrief = {
  summary: string;
  table: { label: string; value: string }[];
  /** `index` is 0-based into `steps`, -1 when the stage is unknown; `label` is the feed's own wording. */
  /** `estimated`: the site does not place the project («أخرى», empty) and the step is the adviser's reading of its description. */
  stage: { key: BriefStageKey; label: string; index: number; total: number; steps: string[]; estimated?: boolean };
  strengths: string[];
  risks: string[];
  competitors: { id: number; title: string; sector: string | null; stage: string | null; why: string }[];
  disclaimer: string;
  generatedAt: string;
  source: 'ai' | 'rules';
};

// Mirrors server/src/projectsBank/access.ts. The founder's contact data exists only in the answer for the member
// who unlocked the project (CLAUDE.md rule 4); empty strings mean the founder gave none.
export type ProjectAccessState = 'golden' | 'not_member' | 'can_unlock' | 'exhausted' | 'unlocked' | 'unavailable';
export type ProjectContact = { whatsapp: string; email: string; website: string; pitchUrl: string };
/** رصيد بنك المشاريع for the membership year: `left` of `credits + granted` projects. */
export type ProjectsBalance = { credits: number; granted: number; used: number; left: number };

export type ProjectAccess = {
  state: ProjectAccessState;
  isMember: boolean;
  balance: ProjectsBalance | null;
  contact: ProjectContact | null;
  message: string | null;
};

export type ProjectUnlockResult = { ok: true; already: boolean; left: number; contact: ProjectContact };
