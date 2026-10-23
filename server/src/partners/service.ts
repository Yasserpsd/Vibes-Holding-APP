import { randomInt, randomUUID } from 'node:crypto';

import { RequestError } from '../auth/guard.js';
import type { Me } from '../auth/service.js';
import type { AppLang } from '../lang.js';
import type { KV } from '../store.js';

/**
 * M68 «شركاؤنا»: the partners program. The owner manages the partner companies entirely from the
 * dashboard (logo, name, description, discount line, the link the member buys through, order,
 * visibility). Every subscribed member carries ONE personal promo code — 5 letters and digits,
 * its first letter from his category — that he uses with EVERY partner for the members' discount.
 * The code is issued once and never changes; the dashboard looks any code up to tell the owner
 * whose it is when a partner asks.
 */
export type Partner = {
  id: string;
  /** Arabic wording with its English mirror beside it (same pattern as the agenda's `en`). */
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  /** The discount line as the owner words it, e.g. «خصم 20% لأعضاء النادي بالبرومو كود». */
  discount: string;
  discountEn: string;
  /** M123: the short headline on the card's gold ribbon, e.g. «خصم 50%». Empty = no ribbon. */
  ribbon: string;
  ribbonEn: string;
  /** Where «اشترِ من الشريك» leads (opened in the in-app browser). */
  url: string;
  logoUrl: string | null;
  order: number;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PartnerInput = {
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  discount?: string;
  discountEn?: string;
  ribbon?: string;
  ribbonEn?: string;
  url: string;
  logoUrl?: string | null;
  order?: number;
  visible?: boolean;
};

/** The program's wording, owner-editable from the same dashboard section. */
export type PartnersSettings = {
  title: string;
  titleEn: string;
  intro: string;
  introEn: string;
  codeTitle: string;
  codeTitleEn: string;
  codeHint: string;
  codeHintEn: string;
  membersOnlyText: string;
  membersOnlyTextEn: string;
};

/** One member's personal code, with a snapshot of who he was when it was issued. */
export type PromoRecord = {
  code: string;
  contactId: number;
  name: string;
  persona: string;
  personaLabel: string;
  cardNumber: string;
  issuedAt: string;
};

export type PublicPartner = { id: string; name: string; description: string; discount: string; ribbon: string; url: string; logoUrl: string | null };

export const PARTNERS_LIST_KEY = 'partners:list';
export const PARTNERS_SETTINGS_KEY = 'partners:settings';
const promoMemberKey = (contactId: number): string => `partners:promo:member:${contactId}`;
const promoCodeKey = (code: string): string => `partners:promo:code:${code}`;

export const PARTNERS_SETTINGS_SEED: PartnersSettings = {
  title: 'Members Exclusive — حصريًا للأعضاء',
  titleEn: 'Members Exclusive',
  intro:
    'برنامج شركاء نادي المستثمرين: جهات من داخل المنظومة وخارجها — مثل بودكاست الملتقى ووديني — تمنح أعضاء العضوية السنوية خصومات خاصة. لكل عضو برومو كود واحد باسمه يستخدمه عند جميع الشركاء، فيحصل على خصم أعضاء النادي فورًا.',
  introEn:
    'The Investors Club partners program: companies inside and outside the group — such as the Al-Moltaqa podcast and Wdeny — give annual-membership members special discounts. Every member carries one personal promo code he uses with every partner, and the club members’ discount applies at once.',
  codeTitle: 'برومو كودك الخاص',
  codeTitleEn: 'Your personal promo code',
  codeHint: 'الكود خاص بعضويتك ويعمل عند جميع الشركاء: أدخله عند الشراء ليُطبّق خصم أعضاء النادي فورًا.',
  codeHintEn: 'The code belongs to your membership and works with every partner: enter it when you buy and the club members’ discount applies at once.',
  membersOnlyText: 'البرومو كود لأعضاء العضوية السنوية. فعّل عضويتك ليصلك كودك الخاص وتحصل على خصومات الشركاء.',
  membersOnlyTextEn: 'The promo code is for annual-membership members. Activate your membership to receive your personal code and the partners’ discounts.',
};

export const PARTNERS_SEED_KEY = 'partners:seed';
const PARTNERS_SEED_VERSION = 1;

/**
 * M123 «Members Exclusive»: the two headline partners the owner asked for, each with a gold
 * ribbon on its card. Seeded once; afterwards the owner edits everything from the dashboard
 * (including the logos, which start from the vibesholding.com uploads the golden companies use).
 */
export const HEADLINE_PARTNERS_SEED: PartnerInput[] = [
  {
    name: 'بودكاست الملتقى',
    nameEn: 'Al-Moltaqa Podcast',
    description: 'بودكاست الملتقى: استوديوهات مجهّزة بالكامل لتسجيل الحلقات والمحتوى — صوت وصورة بجودة احترافية وفريق إنتاج متكامل.',
    descriptionEn: 'Al-Moltaqa Podcast: fully equipped studios for recording episodes and content — professional audio and video with a complete production team.',
    discount: 'خصم 50% لأعضاء النادي بالبرومو كود الخاص بك.',
    discountEn: 'A 50% discount for club members with your personal promo code.',
    ribbon: 'خصم 50%',
    ribbonEn: '50% off',
    url: 'https://almoltaqapodcast.com/',
    logoUrl: 'https://vibesholding.com/wp-content/uploads/2026/08/Al-Moltaqa.webp',
    order: 1,
    visible: true,
  },
  {
    name: 'وديني',
    nameEn: 'Wdeny',
    description: 'وديني: النقل والشحن والسفر في تطبيق واحد — خدمات تنقّل وتوصيل داخل منظومة Vibes Ventures.',
    descriptionEn: 'Wdeny: transport, shipping and travel in one app — mobility and delivery services inside the Vibes Ventures group.',
    discount: 'هدية ترحيبية بقيمة 1000 ريال لأعضاء النادي بالبرومو كود.',
    discountEn: 'A welcome gift worth SAR 1,000 for club members with the promo code.',
    ribbon: 'هدية ترحيبية 1000 ريال',
    ribbonEn: 'SAR 1,000 welcome gift',
    url: 'https://wdeny.com/',
    logoUrl: 'https://vibesholding.com/wp-content/uploads/2026/08/Wdeny-logo-png.webp',
    order: 2,
    visible: true,
  },
];

/**
 * Seeds the headline partners ONCE (version marker, so an owner delete stays deleted). A partner
 * whose name already exists on the list is never duplicated or touched. Returns true when it wrote.
 */
export async function ensurePartnersSeed(kv: KV, options: { force?: boolean } = {}, now = new Date()): Promise<boolean> {
  const marker = await kv.get<{ version: number }>(PARTNERS_SEED_KEY);
  if (!options.force && (marker?.version ?? 0) >= PARTNERS_SEED_VERSION) return false;
  const stored = (await kv.get<{ partners: Partner[] }>(PARTNERS_LIST_KEY))?.partners ?? [];
  const names = new Set(stored.map((partner) => partner.name.trim()));
  let wrote = false;
  for (const input of HEADLINE_PARTNERS_SEED) {
    if (names.has(input.name)) continue;
    stored.push({
      id: randomUUID(),
      name: input.name,
      nameEn: input.nameEn ?? '',
      description: input.description ?? '',
      descriptionEn: input.descriptionEn ?? '',
      discount: input.discount ?? '',
      discountEn: input.discountEn ?? '',
      ribbon: input.ribbon ?? '',
      ribbonEn: input.ribbonEn ?? '',
      url: input.url,
      logoUrl: input.logoUrl ?? null,
      order: input.order ?? 100,
      visible: input.visible ?? true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    wrote = true;
  }
  if (wrote) {
    stored.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    await kv.set(PARTNERS_LIST_KEY, { partners: stored });
  }
  await kv.set(PARTNERS_SEED_KEY, { version: PARTNERS_SEED_VERSION });
  return wrote;
}

/** No lookalike characters (I, L, O, 0, 1) in the random part, so the code survives being read out loud. */
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
/** The code's first letter names the member's category — the same letters as the card number (N/E/I, C without one). */
const PERSONA_PREFIX: Record<string, string> = { neutral: 'N', entrepreneur: 'E', investor: 'I' };
export const PROMO_CODE_RE = /^[A-Z0-9]{5}$/;

function newCode(persona: string): string {
  const prefix = PERSONA_PREFIX[persona] ?? 'C';
  let code = prefix;
  for (let index = 0; index < 4; index += 1) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

const trimmed = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max);

type Deps = { kv: KV; onChange?: () => void };

export class PartnersService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private async loadList(): Promise<Partner[]> {
    return (await this.deps.kv.get<{ partners: Partner[] }>(PARTNERS_LIST_KEY))?.partners ?? [];
  }

  /** All writes queue behind each other (single-instance server, same pattern as the card requests). */
  private mutate<T>(change: (partners: Partner[]) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const partners = await this.loadList();
      const result = change(partners);
      partners.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
      await this.deps.kv.set(PARTNERS_LIST_KEY, { partners });
      this.deps.onChange?.();
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async settings(): Promise<PartnersSettings> {
    const stored = await this.deps.kv.get<Partial<PartnersSettings>>(PARTNERS_SETTINGS_KEY);
    return { ...PARTNERS_SETTINGS_SEED, ...(stored ?? {}) };
  }

  async saveSettings(input: Partial<PartnersSettings>): Promise<PartnersSettings> {
    const current = await this.settings();
    const next: PartnersSettings = { ...current };
    for (const key of Object.keys(PARTNERS_SETTINGS_SEED) as (keyof PartnersSettings)[]) {
      if (typeof input[key] === 'string') next[key] = trimmed(input[key], 1000);
    }
    await this.deps.kv.set(PARTNERS_SETTINGS_KEY, next);
    this.deps.onChange?.();
    return next;
  }

  async list(): Promise<Partner[]> {
    return this.loadList();
  }

  async create(input: PartnerInput, now = new Date()): Promise<Partner> {
    const partner: Partner = {
      id: randomUUID(),
      name: trimmed(input.name, 120),
      nameEn: trimmed(input.nameEn, 120),
      description: trimmed(input.description, 1000),
      descriptionEn: trimmed(input.descriptionEn, 1000),
      discount: trimmed(input.discount, 200),
      discountEn: trimmed(input.discountEn, 200),
      ribbon: trimmed(input.ribbon, 80),
      ribbonEn: trimmed(input.ribbonEn, 80),
      url: trimmed(input.url, 500),
      logoUrl: input.logoUrl ? trimmed(input.logoUrl, 500) : null,
      order: Number.isFinite(input.order) ? Number(input.order) : 100,
      visible: input.visible ?? true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.mutate((partners) => partners.push(partner));
    return partner;
  }

  async update(id: string, input: Partial<PartnerInput>, now = new Date()): Promise<Partner | null> {
    return this.mutate((partners) => {
      const partner = partners.find((entry) => entry.id === id);
      if (!partner) return null;
      if (typeof input.name === 'string') partner.name = trimmed(input.name, 120);
      if (typeof input.nameEn === 'string') partner.nameEn = trimmed(input.nameEn, 120);
      if (typeof input.description === 'string') partner.description = trimmed(input.description, 1000);
      if (typeof input.descriptionEn === 'string') partner.descriptionEn = trimmed(input.descriptionEn, 1000);
      if (typeof input.discount === 'string') partner.discount = trimmed(input.discount, 200);
      if (typeof input.discountEn === 'string') partner.discountEn = trimmed(input.discountEn, 200);
      if (typeof input.ribbon === 'string') partner.ribbon = trimmed(input.ribbon, 80);
      if (typeof input.ribbonEn === 'string') partner.ribbonEn = trimmed(input.ribbonEn, 80);
      if (typeof input.url === 'string') partner.url = trimmed(input.url, 500);
      if (input.logoUrl !== undefined) partner.logoUrl = input.logoUrl ? trimmed(input.logoUrl, 500) : null;
      if (Number.isFinite(input.order)) partner.order = Number(input.order);
      if (typeof input.visible === 'boolean') partner.visible = input.visible;
      partner.updatedAt = now.toISOString();
      return partner;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate((partners) => {
      const index = partners.findIndex((entry) => entry.id === id);
      if (index === -1) return false;
      partners.splice(index, 1);
      return true;
    });
  }

  /** The visible partners in the app's language (English falls back to the Arabic wording). */
  async visible(lang: AppLang): Promise<PublicPartner[]> {
    const partners = await this.loadList();
    return partners
      .filter((partner) => partner.visible)
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
      .map((partner) => ({
        id: partner.id,
        name: lang === 'en' && partner.nameEn ? partner.nameEn : partner.name,
        description: lang === 'en' && partner.descriptionEn ? partner.descriptionEn : partner.description,
        discount: lang === 'en' && partner.discountEn ? partner.discountEn : partner.discount,
        // A partner stored before M123 carries no ribbon fields at all.
        ribbon: (lang === 'en' && partner.ribbonEn ? partner.ribbonEn : partner.ribbon) ?? '',
        url: partner.url,
        logoUrl: partner.logoUrl,
      }));
  }

  /** The member's personal code: issued once on first ask (active annual membership only), then permanent. */
  async promoFor(me: Me, now = new Date()): Promise<PromoRecord> {
    if (me.membership.status !== 'active') {
      throw new RequestError('membership_required', 'البرومو كود لأعضاء العضوية السنوية المشتركين', 403);
    }
    const existing = await this.deps.kv.get<PromoRecord>(promoMemberKey(me.id));
    if (existing) return existing;
    const run = this.chain.then(async () => {
      const again = await this.deps.kv.get<PromoRecord>(promoMemberKey(me.id));
      if (again) return again;
      let code = newCode(me.persona);
      // A 5-character space is wide enough that one retry loop settles any collision.
      for (let tries = 0; (await this.deps.kv.get(promoCodeKey(code))) !== null && tries < 20; tries += 1) code = newCode(me.persona);
      const record: PromoRecord = {
        code,
        contactId: me.id,
        name: me.name,
        persona: me.persona,
        personaLabel: me.personaLabel,
        cardNumber: me.cardNumber,
        issuedAt: now.toISOString(),
      };
      await this.deps.kv.set(promoCodeKey(code), { contactId: me.id });
      await this.deps.kv.set(promoMemberKey(me.id), record);
      return record;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Dashboard lookup: whose code is this? The owner answers a partner's question with it. */
  async lookup(code: string): Promise<PromoRecord | null> {
    const clean = code.trim().toUpperCase();
    if (!PROMO_CODE_RE.test(clean)) return null;
    const pointer = await this.deps.kv.get<{ contactId: number }>(promoCodeKey(clean));
    if (!pointer) return null;
    return this.deps.kv.get<PromoRecord>(promoMemberKey(pointer.contactId));
  }
}
