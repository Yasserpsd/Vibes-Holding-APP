import { getAboutContent } from '../content/about.js';
import { getGoldenContent } from '../content/golden.js';
import { getHomeContent, type PortalKey } from '../content/home.js';
import { getHqContent } from '../content/hq.js';
import { getMembershipContent } from '../content/membership.js';
import { getServicesContent } from '../content/services.js';
import type { NewsService } from '../news/service.js';
import type { PostsService } from '../posts/service.js';
import { stripContacts } from '../projectsBank/redact.js';
import type { ProjectsService } from '../projectsBank/service.js';
import type { KV } from '../store.js';
import type { VideosService } from '../videos/service.js';

/**
 * What the member is looking at when he asks «المستشار» (docs/BRIDGE_V2.md 4): the app sends only a type and an id, and
 * the server builds `context{type, id, title, text}` from its own public data. So nothing private can ride along:
 * a project is its public feed fields with contact data stripped (rule 4, no founder contacts, no pitch deck); a news
 * item is the original title, the source's name and the source's own snippet, nothing rewritten (rule 7).
 */
export type AdvisorContext =
  | { type: 'project'; id: number; selection?: string | null }
  | { type: 'news'; id: string; selection?: string | null }
  | { type: 'portal'; id: PortalKey; selection?: string | null }
  | { type: 'service'; id: string; selection?: string | null }
  | { type: 'post'; id: string; selection?: string | null }
  | { type: 'video'; id: string; selection?: string | null }
  | { type: 'screen'; id: string; selection?: string | null };

/** `context` of the hub's `message` op: what reaches the workflow as `focus`. */
export type HubFocus = { type: string; id: string; title: string; text: string; selection?: string };
export type ResolvedContext = { url: string; title: string; focus: HubFocus | null };

export const CONTEXT_TEXT_MAX = 6000;
const SELECTION_MAX = 1000;
const APP = 'تطبيق نادي المستثمرين';
const NONE: ResolvedContext = { url: '', title: '', focus: null };

/** What suits whoever stands at a portal (the owner's direction, 2026-09-21): a fact the adviser builds on. */
const PORTAL_NOTES: Partial<Record<PortalKey, string>> = {
  neutral:
    'يناسب المحايد الذي لم يحدّد وجهته بعد: حضور ملتقيات النادي وندواته وورش عمله الدورية في مقر النادي بالرياض، والحضور متاح عبر الإنترنت أينما كان.',
};
const PORTAL_TITLES: Record<PortalKey, string> = {
  investor: 'بوابة المستثمر',
  entrepreneur: 'بوابة رواد الأعمال',
  neutral: 'بوابة المحايدين',
};

/** App screens the advisor can be opened from. The text says what the screen offers, from the server's own content. */
const SCREENS: Record<string, { title: string; text: string }> = {
  home: { title: 'الشاشة الرئيسية', text: 'الرئيسية: رسائل الإدارة، بوابات المستثمر ورواد الأعمال والمحايدين، المشاريع الذهبية، العضوية، الخدمات والفيديو.' },
  projects: { title: 'بنك المشاريع', text: 'بنك المشاريع: مشاريع حقيقية تبحث عن شراكات، تُصفّى بالقطاع والمرحلة. يفتح العضو بيانات التواصل مع المؤسس برصيد عضويته، والمشاريع الذهبية لا تستهلك رصيدًا.' },
  news: { title: 'أخبار الأعمال', text: 'الأخبار: عناوين ومقتطفات من مصادرها الأصلية كما هي، مع زر «اقرأ من المصدر». قرارات وأنظمة المملكة في قسم مستقل.' },
  videos: { title: 'مكتبة الفيديو', text: 'مكتبة الفيديو: حلقات ولقاءات قناة نادي المستثمرين.' },
  posts: { title: 'رسائل الإدارة', text: 'رسائل الإدارة: ما تنشره إدارة النادي للأعضاء من إعلانات وفعاليات.' },
  advisor: { title: 'المستشار', text: 'محادثة المستشار: المحادثة نفسها التي يراها العضو في مواقع المنظومة.' },
  account: { title: 'حسابي', text: 'حساب العضو: بياناته وحالة عضويته وعملياته داخل التطبيق.' },
};

const clip = (value: string, max: number): string => value.replace(/[ \t]+/g, ' ').trim().slice(0, max);
const lines = (rows: (string | null | undefined | false)[]): string => rows.filter((row): row is string => Boolean(row)).join('\n');

type Deps = { projects: ProjectsService; news: NewsService; kv: KV; posts?: PostsService; videos?: VideosService };

export class ContextResolver {
  constructor(private readonly deps: Deps) {}

  async resolve(context: AdvisorContext | null): Promise<ResolvedContext> {
    if (!context) return NONE;
    const found = await this.find(context);
    if (!found.focus) return found;
    const selection = clip(stripContacts(context.selection ?? ''), SELECTION_MAX);
    return { ...found, title: found.title.slice(0, 200), focus: { ...found.focus, title: found.focus.title.slice(0, 200), text: found.focus.text.slice(0, CONTEXT_TEXT_MAX), ...(selection ? { selection } : {}) } };
  }

  private async find(context: AdvisorContext): Promise<ResolvedContext> {
    const focus = (title: string, text: string): HubFocus => ({ type: context.type, id: String(context.id), title, text });
    switch (context.type) {
      case 'project': {
        const project = this.deps.projects.get(context.id);
        if (!project) return NONE;
        const title = `${project.title}${project.number ? ` (مشروع رقم ${project.number})` : ''}`;
        const text = lines([
          `مشروع في بنك المشاريع: ${title}`,
          project.companyName && `الشركة: ${project.companyName}`,
          project.sector && `القطاع: ${project.sector.name}`,
          project.stage && `المرحلة: ${project.stage.name}`,
          project.isGolden && 'مشروع ذهبي يحمل علامة V.',
          project.excerpt && `نبذة: ${project.excerpt}`,
          project.details && `الوصف:\n${project.details}`,
        ]);
        // The founder's free text can carry a phone, an e-mail or a link: never into a context.
        return { url: this.deps.projects.pageUrl(context.id) ?? '', title, focus: focus(title, stripContacts(text)) };
      }
      case 'news': {
        const item = this.deps.news.contextOf(context.id);
        if (!item) return NONE;
        // The source's own words only: original title, source name, the source's snippet.
        const text = lines([`العنوان الأصلي: ${item.title}`, `المصدر: ${item.source}`, item.snippet && `مقتطف المصدر: ${item.snippet}`]);
        return { url: item.url, title: item.title, focus: focus(item.title, text) };
      }
      case 'portal': {
        const portal = (await getHomeContent(this.deps.kv)).portals.find((entry) => entry.key === context.id);
        const title = `${PORTAL_TITLES[context.id]} — ${APP}`;
        return { url: '', title, focus: focus(PORTAL_TITLES[context.id], lines([portal?.title, portal?.subtitle, PORTAL_NOTES[context.id]])) };
      }
      case 'service': {
        const service = (await getServicesContent(this.deps.kv)).services.find((entry) => entry.key === context.id);
        if (!service) return NONE;
        const text = lines([`خدمة: ${service.title}`, service.summary, service.detail, service.priceLabel && `السعر: ${service.priceLabel}`, service.memberLabel && `للأعضاء: ${service.memberLabel}`, service.access === 'member' && 'الخدمة للأعضاء المشتركين.']);
        return { url: service.infoUrl ?? '', title: `خدمة ${service.title} — ${APP}`, focus: focus(service.title, text) };
      }
      case 'post': {
        const post = await this.deps.posts?.get(context.id);
        if (!post || post.status !== 'published') return NONE;
        const event = post.kind === 'event' && post.event ? lines([post.event.date && `الموعد: ${post.event.date}`, post.event.place && `المكان: ${post.event.place}`, post.event.onlineUrl && 'يُبث عبر الإنترنت أيضًا.']) : '';
        return { url: '', title: `${post.title} — رسائل الإدارة`, focus: focus(post.title, lines([post.kind === 'event' ? `فعالية من إدارة النادي: ${post.title}` : `رسالة من إدارة النادي: ${post.title}`, event, post.body])) };
      }
      case 'video': {
        const video = await this.deps.videos?.get(context.id);
        if (!video) return NONE;
        return { url: video.url, title: `${video.title} — مكتبة الفيديو`, focus: focus(video.title, lines([`فيديو من قناة نادي المستثمرين: ${video.title}`, video.blurb, clip(stripContacts(video.description), 1500)])) };
      }
      case 'screen':
        return this.screen(context.id, focus);
    }
  }

  private async screen(id: string, focus: (title: string, text: string) => HubFocus): Promise<ResolvedContext> {
    const done = (title: string, text: string): ResolvedContext => ({ url: '', title: `${title} — ${APP}`, focus: focus(title, text) });
    const { kv } = this.deps;
    switch (id) {
      case 'membership': {
        // Benefits only: the store shows the price at purchase, and web prices never enter the app (rule 3).
        const content = await getMembershipContent(kv);
        return done(content.title, lines([content.subtitle, content.intro, ...content.groups.flatMap((group) => [`${group.title}${group.comingSoon ? ' (قريبًا)' : ''}:`, ...group.items.map((item) => `• ${item.text}`)])]));
      }
      case 'golden': {
        const content = await getGoldenContent(kv);
        const rows = [content.umbrella, ...content.companies].map((company) => `• ${company.name}${company.tagline ? `: ${company.tagline}` : ''}${company.valuationSarMillions ? ` (تقييم ${company.valuationSarMillions} مليون ريال)` : ''}`);
        return done(content.title, lines([content.intro, ...rows, content.disclaimer]));
      }
      case 'services': {
        const content = await getServicesContent(kv);
        return done(content.title, lines([content.intro, ...content.services.map((service) => `• ${service.title}: ${service.summary}`)]));
      }
      case 'hq': {
        const content = await getHqContent(kv);
        return done(content.title, lines([content.intro, content.address, `ساعات الاستقبال: من ${content.hours.open} إلى ${content.hours.close}`, ...content.facilities.map((entry) => `• ${entry}`), ...content.rules.map((entry) => `• ${entry}`)]));
      }
      case 'about': {
        const content = await getAboutContent(kv);
        return done('عن النادي', lines(content.sections.map((section) => section.title)));
      }
      default: {
        const known = SCREENS[id];
        return known ? done(known.title, known.text) : { url: '', title: APP, focus: focus(APP, '') };
      }
    }
  }
}
