import { htmlToText, makeExcerpt } from './text.js';
import type { PublicProject, Term } from './types.js';

/** Founder contact data. Never copied into a PublicProject (CLAUDE.md rule 4). */
export const PRIVATE_FIELDS = ['whatsapp', 'email', 'website', 'pitch_deck'] as const;

type Raw = Record<string, unknown>;

// WordPress plugins expose meta at the top level or under one of these containers.
const META_CONTAINERS = ['meta', 'acf', 'fields', 'project_meta'];

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readField(raw: Raw, key: string): unknown {
  if (key in raw) return raw[key];
  for (const container of META_CONTAINERS) {
    const nested = raw[container];
    if (isRecord(nested) && key in nested) return nested[key];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return asString(value[0]);
  if (isRecord(value)) {
    if (typeof value.rendered === 'string') return asString(value.rendered);
    if (typeof value.raw === 'string') return asString(value.raw);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value)) return asNumber(value[0]);
  return null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  if (Array.isArray(value)) return asBoolean(value[0]);
  return false;
}

function asUrl(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : null;
}

function asUrlList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((part) => asUrl(part))
      .filter((url): url is string => url !== null);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (isRecord(item) ? asUrl(item.url ?? item.full ?? item.src ?? item.source_url) : asUrl(item)))
      .filter((url): url is string => url !== null);
  }
  if (isRecord(value)) return asUrlList(Object.values(value));
  return [];
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

function asTerm(value: unknown): Term | null {
  if (Array.isArray(value)) return asTerm(value[0]);
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { slug: slugify(name), name } : null;
  }
  if (isRecord(value)) {
    const name = asString(value.name ?? value.title ?? value.label);
    if (!name) return null;
    const slug = asString(value.slug) ?? slugify(name);
    return { slug, name };
  }
  return null;
}

function asIsoDate(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Builds the public view of a feed item. Every field is picked explicitly,
 * so the raw object (and its private fields) can never be spread through.
 */
export function toPublicProject(raw: unknown): PublicProject | null {
  if (!isRecord(raw)) return null;
  const id = asNumber(raw.id ?? raw.ID ?? readField(raw, 'project_id'));
  if (id === null) return null;

  const title = asString(raw.title) ?? asString(raw.post_title) ?? asString(readField(raw, 'project_title')) ?? '';
  if (!title) return null;

  const detailsHtml = asString(readField(raw, 'project_details')) ?? asString(raw.content) ?? '';
  const detailsEnHtml = asString(readField(raw, 'project_details_en')) ?? '';
  const details = htmlToText(detailsHtml) || null;
  const detailsEn = htmlToText(detailsEnHtml) || null;
  const excerptRaw = asString(raw.excerpt) ?? asString(raw.post_excerpt);
  const excerpt = excerptRaw ? htmlToText(excerptRaw) : details ? makeExcerpt(details) : null;
  const excerptEnRaw = asString(readField(raw, 'excerpt_en'));
  const excerptEn = excerptEnRaw ? htmlToText(excerptEnRaw) : detailsEn ? makeExcerpt(detailsEn) : null;

  const gallery = asUrlList(readField(raw, 'project_gallery'));
  const image =
    gallery[0] ??
    asUrl(raw.thumbnail ?? raw.image ?? raw.featured_image ?? raw.featured_image_url ?? raw.featured_media_url) ??
    null;

  return {
    id,
    number: asString(readField(raw, 'project_number')),
    slug: asString(raw.slug ?? raw.post_name),
    title,
    titleEn: asString(readField(raw, 'title_en')),
    companyName: asString(readField(raw, 'company_name')),
    companyNameEn: asString(readField(raw, 'company_name_en')),
    founderName: asString(readField(raw, 'founder_name')),
    founderNameEn: asString(readField(raw, 'founder_name_en')),
    excerpt,
    excerptEn,
    details,
    detailsEn,
    image,
    gallery,
    sector: asTerm(raw.sector ?? raw.sectors ?? readField(raw, 'sector')),
    stage: asTerm(raw.project_stage ?? raw.stage ?? raw.stages ?? readField(raw, 'project_stage')),
    isGolden: asBoolean(raw.golden ?? readField(raw, 'is_featured')),
    featuredOrder: asNumber(readField(raw, 'featured_order')),
    goldenPartnerUrl: asUrl(raw.partner_url ?? readField(raw, 'golden_partner_url')),
    hasPitchDeck: asBoolean(readField(raw, 'has_pitch_deck')),
    contactRule: asString(raw.contact_rule),
    viewsCount: asNumber(readField(raw, 'views_count')) ?? 0,
    modifiedAt: asIsoDate(raw.modified ?? raw.modified_gmt ?? raw.date_gmt ?? raw.date),
  };
}
