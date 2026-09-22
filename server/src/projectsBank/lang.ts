import type { AppLang } from '../lang.js';
import { ESTIMATED_MARK, type StageKey } from './stage.js';
import type { FilterOption, ProjectsFilters, ProjectsPage, ProjectsSort, PublicProject, StageTerm, Term } from './types.js';

/**
 * The Projects Bank in English (M27 stage 4). The site publishes an English title, company name, excerpt and
 * details for the projects whose founders filled them (`title_en`…): the English app gets those in the place of
 * the Arabic fields and keeps the Arabic where a founder left the English empty. Sectors and stages are the
 * site's Arabic terms; their English names live here, and a sector this list does not know keeps its Arabic name.
 * The Arabic app gets every project exactly as before.
 */
export const SECTOR_EN: Record<string, string> = {
  'التكنولوجيا والبرمجيات': 'Technology and Software',
  'تقنية المعلومات': 'Information Technology',
  'التجارة الإلكترونية': 'E-commerce',
  'التجارة والتجزئة': 'Trade and Retail',
  'الخدمات اللوجستية والنقل': 'Logistics and Transport',
  'الصحة والتكنولوجيا الحيوية': 'Health and Biotechnology',
  'الصناعة والتصنيع المتقدم': 'Industry and Advanced Manufacturing',
  'الغذاء والمشروبات': 'Food and Beverages',
  'التعليم والتدريب': 'Education and Training',
  'السياحة والضيافة': 'Tourism and Hospitality',
  'الاستشارات والتطوير الإداري': 'Consulting and Management Development',
  'الخدمات المالية والتكنولوجيا المالية (FinTech)': 'Financial Services and FinTech',
  'الترفيه والإعلام': 'Entertainment and Media',
  'العقار والتطوير العمراني': 'Real Estate and Urban Development',
  'الطاقة والاستدامة': 'Energy and Sustainability',
  'الأمن السيبراني وحلول البيانات': 'Cybersecurity and Data Solutions',
  'الزراعة': 'Agriculture',
  'أخرى': 'Other',
};

export const STAGE_EN: Record<StageKey, string> = {
  idea: 'Idea',
  prototype: 'Founding and prototype',
  launch: 'Launch and operation',
  revenue: 'Revenue',
  growth: 'Growth and expansion',
};

export const ESTIMATED_MARK_EN = "adviser's estimate";

const SORT_EN: Record<ProjectsSort, string> = { latest: 'Latest', views: 'Most viewed', discover: 'Discover', golden: 'Golden Projects' };

const isStageKey = (slug: string): slug is StageKey => slug in STAGE_EN;

/** The sector's name in the app's language: the site's Arabic term, or its English name from the list above. */
export function sectorName(term: Term | null, lang: AppLang): string | null {
  if (!term) return null;
  return lang === 'en' ? (SECTOR_EN[term.name] ?? term.name) : term.name;
}

/** The stage's name in the app's language: one of the five steps, marked when the adviser estimated it. */
export function stageName(term: StageTerm | null, lang: AppLang): string | null {
  if (!term) return null;
  if (lang !== 'en' || !isStageKey(term.slug)) return term.name;
  return term.estimated ? `${STAGE_EN[term.slug]} · ${ESTIMATED_MARK_EN}` : STAGE_EN[term.slug];
}

/** The English mark of an estimated stage, as `stageName` writes it, for texts that quote the Arabic one. */
export const estimatedMark = (lang: AppLang): string => (lang === 'en' ? ESTIMATED_MARK_EN : ESTIMATED_MARK);

/**
 * A project as the app of one language reads it. In English the founder's English fields take the place of the Arabic
 * ones (and are not repeated), the Arabic stays where there is no English, and the terms get their English names.
 */
export function localizeProject(project: PublicProject, lang: AppLang): PublicProject {
  if (lang !== 'en') return project;
  const pick = (english: string | null, arabic: string | null): [string | null, string | null] => (english ? [english, null] : [arabic, null]);
  const [title, titleEn] = pick(project.titleEn, project.title);
  const [companyName, companyNameEn] = pick(project.companyNameEn, project.companyName);
  const [excerpt, excerptEn] = pick(project.excerptEn, project.excerpt);
  const [details, detailsEn] = pick(project.detailsEn, project.details);
  return {
    ...project,
    title: title ?? project.title,
    titleEn,
    companyName,
    companyNameEn,
    excerpt,
    excerptEn,
    details,
    detailsEn,
    sector: project.sector ? { ...project.sector, name: sectorName(project.sector, lang) ?? project.sector.name } : null,
    stage: project.stage ? { ...project.stage, name: stageName(project.stage, lang) ?? project.stage.name } : null,
  };
}

export function localizePage(page: ProjectsPage, lang: AppLang): ProjectsPage {
  return lang === 'en' ? { ...page, items: page.items.map((project) => localizeProject(project, lang)) } : page;
}

export function localizeFilters(filters: ProjectsFilters, lang: AppLang): ProjectsFilters {
  if (lang !== 'en') return filters;
  const sectors: FilterOption[] = filters.sectors.map((option) => ({ ...option, name: sectorName(option, lang) ?? option.name }));
  const stages: FilterOption[] = filters.stages.map((option) => ({ ...option, name: stageName(option, lang) ?? option.name }));
  return { ...filters, sectors, stages, sorts: filters.sorts.map((sort) => ({ ...sort, label: SORT_EN[sort.key] ?? sort.label })) };
}
