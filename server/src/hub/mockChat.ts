import { HubError, type HubBody, type HubContact, type HubMessage, type HubResponse } from './types.js';

/**
 * Chat part of the in-memory hub: `config`, `message`, `poll`, `history`.
 * Replies are canned and appear after a short delay, like the real workflow. They deliberately
 * carry the web widgets the live hub sends (membership card, payment links, forms, videos) so
 * the advisor service's filtering is exercised in tests and on Railway while HUB_MODE=mock.
 */
export const MOCK_MEMBERSHIP_PAY_URL = 'https://accept.paymob.com/mock/membership';
export const MOCK_MEMBERSHIP_URL = 'https://vcmem.com/membership/';
export const MOCK_SITE_URL = 'https://vcmem.com/';
const FREE_REPLIES = 5;

type Row = HubMessage & { revealAt: number; pageUrl?: string };
/** A thread as the dashboard ops of the mock hub read it (bridge v2). */
export type MockThreadRow = { id: number; role: string; content: string; by: string; pageUrl: string; at: number };
type Room = { rows: Row[]; replies: number };

const str = (body: HubBody, key: string, max: number): string =>
  typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, max) : '';
const iso = (ms: number): string => new Date(ms).toISOString();
const publicRow = ({ revealAt: _revealAt, pageUrl: _pageUrl, ...row }: Row): HubMessage => row;

function membershipCard() {
  return {
    key: 'membership',
    title: 'العضوية السنوية',
    price: '1899 SAR',
    note: 'شامل الضريبة',
    terms: '',
    discount: '',
    bullets: ['رصيد المستشار الذكي', 'خمسة مشاريع من بنك المشاريع'],
    buttons: [
      { label: 'اشترك الآن', url: MOCK_MEMBERSHIP_PAY_URL, primary: true },
      { label: 'صفحة العضوية', url: MOCK_MEMBERSHIP_URL, primary: false },
    ],
  };
}

export class MockChat {
  private nextId = 1;
  private readonly rooms = new Map<number, Room>();

  constructor(private readonly replyDelayMs: number) {}

  config(): HubResponse {
    return {
      ok: true,
      config: {
        bot_name: 'المستشار',
        bot_subtitle: 'نادي المستثمرين',
        welcome: `حياك الله في نادي المستثمرين 🌹 كيف أقدر أخدمك اليوم؟ تفاصيل العضوية: ${MOCK_MEMBERSHIP_URL}`,
        menu: ['ما هو بنك المشاريع؟', 'كيف أختار مشروعًا مناسبًا؟', 'اشترك الآن'],
        membership: membershipCard(),
        links: [
          { l: 'صفحة العضوية', u: MOCK_MEMBERSHIP_URL, k: 'عضوية' },
          { l: 'موقع النادي', u: MOCK_SITE_URL, k: 'الموقع' },
        ],
        voice: 0,
      },
    };
  }

  message(contactId: number, contact: HubContact, body: HubBody): HubResponse {
    const text = str(body, 'message', 4000);
    if (!text) throw new HubError('empty', 'الرسالة فارغة', 400);
    const room = this.room(contactId);
    if (contact.member_expired) {
      return { ok: true, gated: true, gate: { type: 'membership', text: `انتهت عضويتك — جدّدها من ${MOCK_MEMBERSHIP_URL}`, card: membershipCard(), mgmt: '966558318777' }, contact };
    }
    if (!contact.is_member && room.replies >= FREE_REPLIES) {
      return { ok: true, gated: true, gate: { type: 'membership', text: `للمتابعة فعّل عضويتك السنوية: ${MOCK_MEMBERSHIP_URL}`, card: membershipCard(), mgmt: '966558318777', needs_account: 0 }, contact };
    }
    const now = Date.now();
    const pageTitle = str(body, 'page_title', 200);
    const userId = this.push(room, { role: 'user', content: text, actions: [], by: '', at: iso(now), revealAt: now, pageUrl: str(body, 'page_url', 300) });
    const revealAt = now + this.replyDelayMs;
    if (/الإدارة|موظف|بشري/.test(text)) {
      this.push(room, { role: 'human', by: 'فريق النادي', content: 'أهلًا بك، معك فريق النادي. وصلتنا رسالتك وسنرد عليك هنا.', actions: [], at: iso(revealAt), revealAt });
    } else {
      const about = pageTitle ? ` بخصوص «${pageTitle}»` : '';
      this.push(room, {
        role: 'assistant',
        by: '',
        content: `حياك الله 🌹 وصلتني رسالتك${about}: «${text.slice(0, 120)}». هذا رد تجريبي من الهب الوهمي.\n**للتفاصيل:** ${MOCK_MEMBERSHIP_URL} أو ${MOCK_SITE_URL}`,
        actions: [
          { type: 'quick_replies', options: ['مزايا العضوية', 'بنك المشاريع'] },
          { type: 'link', label: 'موقع النادي ↗', url: MOCK_SITE_URL, carry: false, auto: false },
          { type: 'link', label: 'اشترك الآن ↗', url: MOCK_MEMBERSHIP_PAY_URL, carry: true, auto: false },
          { type: 'card', card: membershipCard() },
          { type: 'open_page', url: MOCK_MEMBERSHIP_URL, carry: false },
          { type: 'video', title: 'فيديو تعريفي', url: 'https://www.youtube.com/watch?v=abc123', yt: 'abc123' },
          { type: 'prefill_form', form: 'contact', fields: {} },
        ],
        at: iso(revealAt),
        revealAt,
      });
    }
    room.replies += 1;
    return { ok: true, message_id: userId, waiting: true, human: false, image_url: '', audio_url: '', transcript: '', contact };
  }

  poll(contactId: number | null, contact: HubContact | null, body: HubBody): HubResponse {
    if (contactId === null || !contact) return { ok: true, messages: [], contact: null, waiting: false };
    const after = typeof body.after === 'number' ? body.after : Number(body.after) || 0;
    const now = Date.now();
    const room = this.room(contactId);
    const messages = room.rows
      .filter((row) => row.id > after && row.role !== 'user' && row.revealAt <= now)
      .slice(0, 20)
      .map(publicRow);
    const waiting = room.rows.some((row) => row.role !== 'user' && row.revealAt > now);
    return { ok: true, messages, waiting, timeout: false, human: false, cfg_rev: 1, contact };
  }

  history(contactId: number | null, contact: HubContact | null): HubResponse {
    if (contactId === null || !contact) return { ok: true, messages: [], contact: null };
    const now = Date.now();
    const messages = this.room(contactId)
      .rows.filter((row) => row.revealAt <= now)
      .slice(-40)
      .map(publicRow);
    return { ok: true, messages, contact };
  }

  forget(contactId: number): void {
    this.rooms.delete(contactId);
  }

  /** Bridge v2: every conversation with its visible rows, for `admin_threads` / `admin_thread` and the stats. */
  threads(now = Date.now()): { contactId: number; rows: MockThreadRow[] }[] {
    return [...this.rooms].map(([contactId, room]) => ({
      contactId,
      rows: room.rows
        .filter((row) => row.revealAt <= now)
        .map((row) => ({ id: row.id, role: row.role, content: row.content, by: row.by ?? '', pageUrl: row.pageUrl ?? '', at: row.revealAt })),
    }));
  }

  /** A staff reply written from the dashboard (`admin_reply`): the member sees it on the next poll. */
  staffReply(contactId: number, text: string, by: string, now = Date.now()): number {
    return this.push(this.room(contactId), { role: 'human', by, content: text, actions: [], at: iso(now), revealAt: now });
  }

  /** Demo history for the seeded contacts. */
  seed(contactId: number, rows: { role: string; content: string; by?: string; at: number; pageUrl?: string }[]): void {
    const room = this.room(contactId);
    for (const row of rows) {
      this.push(room, { role: row.role, content: row.content, by: row.by ?? '', actions: [], at: iso(row.at), revealAt: row.at, pageUrl: row.pageUrl ?? '' });
      if (row.role === 'assistant') room.replies += 1;
    }
  }

  private room(contactId: number): Room {
    let room = this.rooms.get(contactId);
    if (!room) {
      room = { rows: [], replies: 0 };
      this.rooms.set(contactId, room);
    }
    return room;
  }

  private push(room: Room, row: Omit<Row, 'id'>): number {
    const id = this.nextId++;
    room.rows.push({ id, ...row });
    return id;
  }
}
