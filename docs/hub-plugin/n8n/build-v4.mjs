#!/usr/bin/env node
// Builds the n8n workflow «Vibes Web Agent v4.0» from the owner's v3.2 export (contract: docs/BRIDGE_V2.md §3).
//
//   node build-v4.mjs <v3.2 export.json> [<output.json>] [--app-host=<host>[,<host>]] [--force]
//
// --app-host: the host of the app's row on the hub's «المواقع» page (default app.vcmem.com). The workflow also knows the
// app by what only the app sends (an app:// page, a screen or portal focus, a message without a page URL).
// The export holds live keys inside its Config node. That node is carried through untouched, nothing from it is ever
// printed, and the output is refused inside this repository: keep both files on the owner's drive, never in git.
// Node 24, no dependencies.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = 'Vibes Web Agent v4.0';
const PROMPT_TARGET = 9000; // characters, contract target (v3.2 carried 44,847)
const PROMPT_LIMIT = 12000;
// the hub stores vai_clip(memo, 700) in 2.6.0 and in 2.7.0: a longer MEMO loses its tail on every turn. Raise this, the
// number in prompt-v4.md and the hub's clip together, never one alone.
const MEMO_MAX = 700;

// sha256 of the v3.2 fields this script replaces or patches: a different export must be looked at first (--force skips)
const V32 = {
  'Build Context': 'a6532c2bf46c5c73b8b81ef50ac73cb444ab9f93d4b05efa986ca605b1025f78',
  'Split Reply': '5ca7d508191046eddd43bb01ba0f1a10a2beb7b9430b6622551e118563f5523c',
  'Pick Model': '77b8732c2db44c6f7a8010993c6b3b538dc92759284bb1c37a7c81e72a81c4c7',
  'Fallback Reply': 'e2ea898afaf30f1bb2e2d4a8917964cc30bee03c1ed9752535a039bf6ece34ed',
  'AI Agent': 'b4df7ec71f872eeef62963d420e8513bc7e51c57b37610e301ffb558e7cdf17e',
};

const fail = (msg) => { console.error('build-v4: ' + msg); process.exit(1); };
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const force = process.argv.includes('--force');
const hostFlag = process.argv.find((a) => a.startsWith('--app-host='));
const appHosts = (hostFlag ? hostFlag.slice('--app-host='.length) : 'app.vcmem.com').split(',').map((h) => h.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
if (!appHosts.length || appHosts.some((h) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h))) fail('--app-host takes one or more host names separated by commas, as written on the hub\'s sites page');
if (!args[0]) fail('usage: node build-v4.mjs <v3.2 export.json> [<output.json>] [--app-host=<host>[,<host>]] [--force]');
const inPath = resolve(args[0]);
const outPath = resolve(args[1] || join(dirname(inPath), 'Vibes_Web_Agent_v4.0.json'));

// the output carries the owner's keys: never inside a git working tree that holds this script
let repo = HERE;
while (!existsSync(join(repo, '.git')) && dirname(repo) !== repo) repo = dirname(repo);
if (existsSync(join(repo, '.git')) && (outPath + sep).toLowerCase().startsWith((repo + sep).toLowerCase())) {
  fail('the output holds live keys and must not be written inside the repository: choose a path next to the original export');
}

const rawIn = readFileSync(inPath, 'utf8');
const wf = JSON.parse(rawIn);
const byName = (name) => wf.nodes.find((n) => n.name === name) || fail('node not found in the export: ' + name);

// ───────────────────────── Config: untouched, never printed ─────────────────────────
const configBefore = JSON.stringify(byName('Config'));
const configText = JSON.stringify(byName('Config'), null, 2).replace(/\n/g, '\n    ');

// ───────────────────────── v3.2 fingerprint ─────────────────────────
for (const [name, want] of Object.entries(V32)) {
  const n = byName(name);
  const got = sha(name === 'AI Agent' ? n.parameters.options.systemMessage : n.parameters.jsCode);
  if (got !== want) {
    const msg = '«' + name + '» differs from the v3.2 export this script was written against';
    if (!force) fail(msg + ' (read the difference first, then re-run with --force)');
    console.warn('build-v4: warning: ' + msg);
  }
}

/** Replaces `from` exactly once, so a drifted export fails loudly instead of being half patched. */
const swap = (code, from, to, label) => {
  const at = code.indexOf(from);
  if (at === -1 || code.indexOf(from, at + 1) !== -1) fail('patch anchor not found exactly once: ' + label);
  return code.slice(0, at) + to + code.slice(at + from.length);
};

// ───────────────────────── system prompt (prompt-v4.md) ─────────────────────────
const prompt = readFileSync(join(HERE, 'prompt-v4.md'), 'utf8')
  .replace(/\r\n?/g, '\n')
  .replace(/^﻿?\s*<!--[\s\S]*?-->\s*/, '')
  .trim();
const PLACEHOLDER = '{{ $json.contextBlock }}';
if (!prompt.endsWith(PLACEHOLDER)) fail('prompt-v4.md must end with ' + PLACEHOLDER);
if (prompt.split('{{').length !== 2) fail('prompt-v4.md: the context placeholder is the only n8n expression allowed (found another «{{»)');
for (const tag of ['[[ACTIONS]]{"actions":[', ']}[[/ACTIONS]]', '[[MEMO]]', '[[/MEMO]]', '[[LEAD]]{"type":"service","reason":"","company":"","notes":""}[[/LEAD]]']) {
  if (!prompt.includes(tag)) fail('prompt-v4.md lost a protocol marker the hub side parses: ' + tag);
}
const memoAsk = /\[\[MEMO\]\]\.\.\.\[\[\/MEMO\]\][^\n]*?حتى (\d+) حرف/.exec(prompt);
if (!memoAsk || Number(memoAsk[1]) > MEMO_MAX) fail('prompt-v4.md must ask for a MEMO of at most ' + MEMO_MAX + ' characters: the hub stores no more');
if (prompt.length > PROMPT_LIMIT) fail('prompt-v4.md is ' + prompt.length + ' characters (limit ' + PROMPT_LIMIT + ')');
if (prompt.length > PROMPT_TARGET) console.warn('build-v4: warning: prompt is ' + prompt.length + ' characters, above the ' + PROMPT_TARGET + ' target');

// ───────────────────────── app-site scrub (shared by Build Context and Split Reply) ─────────────────────────
// Hard rule 3 must not depend on the model obeying: a pay link or the web price of the membership is taken out of every
// free text that enters the app's context (hints, MEMO, turns of other sites, catalog notes) and out of the reply itself.
const APP_SCRUB = String.raw`const PAY_URL = /(paymob|checkout|subscribe|\/pay(?:ment)?(?:[\/?#]|$))/i;
const PAY_LABEL = /(ادفع|اشترك الآن|الاشتراك والدفع)/;
const PRICE_NOTE = '(السعر في شاشة العضوية داخل التطبيق)';
const scrubApp = (s, price, whole) => {
  const MEMBERSHIP = /(عضوي|اشتراك\s*(?:في\s*)?(?:ال)?(?:نادي|سنوي)|membership)/i;
  const AMOUNT = /(?:\d[\d,.٬]*|[٠-٩][٠-٩,.٬]*)\s*(?:ريال(?:\s*سعودي)?|ر\.\s*س\.?|SAR|SR|﷼)|(?<![\d٠-٩.,])\d{1,3}(?:[,٬]\d{3})+(?![\d٠-٩])/gi;
  const AR = '٠١٢٣٤٥٦٧٨٩';
  let urls = 0, prices = 0;
  // a pay link goes together with the few words that hand it over («ادفع من هنا: …»), so no dangling call to pay is left
  let out = String(s == null ? '' : s).replace(/((?:و?(?:ادفع|تدفع|سدّد|اشترك)(?:\s+الآن)?\s+(?:من|عبر)(?:\s+(?:هنا|الرابط|هذا\s+الرابط))?|و?رابط\s*(?:ال)?(?:دفع|اشتراك)|للدفع|للاشتراك)\s*:?\s*)?(https?:\/\/[^\s<>"'«»()\]]+)/g, (m, cta, u) => { if (PAY_URL.test(u)) { urls++; return ''; } return m; });
  const digits = String(price || '').replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/[.٫]\d{1,2}$/, '').replace(/\D/g, '');
  // the membership's own price wherever it stands; any other amount only in a sentence that talks about the membership
  const own = digits.length >= 3 ? new RegExp('(?<![\\d٠-٩])' + digits.split('').map(d => '[' + d + AR[d] + ']').join('[,.٬]?') + '(?![\\d٠-٩])(?:\\s*(?:ريال(?:\\s*سعودي)?|ر\\.\\s*س\\.?|SAR|SR|﷼))?', 'g') : null;
  const hide = () => { prices++; return PRICE_NOTE; };
  out = out.split(/(\n|[.!؟?؛|](?=\s|$))/).map(seg => {
    const about = whole || MEMBERSHIP.test(seg);
    if (own) seg = seg.replace(own, hide);
    return about ? seg.replace(AMOUNT, hide) : seg;
  }).join('');
  if (prices > 1) { const note = PRICE_NOTE.replace(/[()]/g, '\\$&'); out = out.replace(new RegExp(note + '(?:[^\\n.؛|]{0,40}?' + note + ')+', 'g'), PRICE_NOTE); }
  if (urls || prices) out = out.replace(/ {2,}/g, ' ');
  return { text: out, urls, prices };
};
`;

// ───────────────────────── Build Context (full replacement) ─────────────────────────
const BUILD_CONTEXT_SOURCE = String.raw`// Vibes Web Agent v4.0 — builds the «سياق هذه المحادثة» block from the hub payload. Order: what the visitor points at (focus) and the live page text first, then hints, state, gates, the session-aware history (the hub's turns are the only history), catalog, links, forms.
const pm = $json;
const b = pm.body || {};
const c = b.contact || {};
const site = b.site || {};
const page = b.page || {};
const focus = (b.focus && typeof b.focus === 'object') ? b.focus : {};
const gate = b.gate || {};
const services = Array.isArray(b.services) ? b.services : [];
const forms = Array.isArray(b.forms) ? b.forms : [];
const videos = Array.isArray(b.videos) ? b.videos : [];
const event = String(b.event || 'message');
const cfgB = b.config || {};
const cfg = $('Config').first().json;
/*APP_SCRUB*/
// one key per contact (or uuid), never a shared zero key: without either there is nobody to answer
const contactId = Number(c.id || 0);
const who = contactId ? String(contactId) : String(c.uuid || b.uuid || '').trim();
if (!who) { return []; }
const sessionKey = 'vai-' + who;
const isAdmin = Number(c.is_admin) === 1 || c.is_admin === true;
const isMember = !!c.is_member;

// the app's site sells the membership through the stores only: no web membership price, no pay links
const normHost = h => String(h || '').trim().toLowerCase().replace(/^www\./, '');
// The app is known by its host (build flag --app-host, plus an optional app_hosts field in Config) and, so that a host
// typed differently on the hub's sites page cannot switch the rule off, by what only the app's server sends: an app://
// page, a screen or portal focus, the app's name, or a message without a page URL (the web widget always sends one).
const appHosts = ('__APP_HOSTS__,' + String(cfg.app_hosts || '')).split(/[,\s]+/).map(normHost).filter(Boolean);
const APP_NAME = /تطبيق\s*نادي\s*المستثمرين/;
const pageUrl = String(page.url || '').trim();
const appWhy = appHosts.includes(normHost(site.host)) ? 'host'
  : /^app:\/\//i.test(pageUrl) ? 'page'
  : (focus.type === 'screen' || focus.type === 'portal') ? 'focus'
  : APP_NAME.test(String(site.name || '') + ' ' + String(page.title || '')) ? 'name'
  : (event === 'message' && !pageUrl) ? 'no-page' : '';
const appSite = !!appWhy;
const PAY_TALK = /(paymob|\/payment|رابط\s*(?:ال)?دفع|اشترك الآن|للاشتراك|ريال|السعر|الأسعار|أسعار)/i;
const memberService = services.find(s => s && String(s.key) === 'membership');
const memberPrice = memberService ? String(memberService.price || '') : '';
// every free text passes through here: on the app site it loses pay links and the web price of the membership
const safe = (s, whole) => appSite ? scrubApp(s, memberPrice, whole).text : String(s == null ? '' : s);
const memo = safe(b.memo);

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const dt = iso => DateTime.fromISO(iso).setZone('Asia/Riyadh');
const fmt = iso => { try { const d = dt(iso); return d.isValid ? d.toFormat('yyyy-MM-dd HH:mm') : ''; } catch (e) { return ''; } };
const fmtTime = iso => { try { const d = dt(iso); return d.isValid ? d.toFormat('HH:mm') : ''; } catch (e) { return ''; } };
const fmtDay = iso => { try { const d = dt(iso); if (!d.isValid) return ''; return DAYS[d.weekday % 7] + ' ' + d.day + ' ' + MONTHS[d.month - 1] + ' ' + d.year; } catch (e) { return ''; } };
const plural = (n, one, two, few, many) => n === 1 ? one : n === 2 ? two : (n >= 3 && n <= 10) ? n + ' ' + few : n + ' ' + many;
const ago = iso => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!iso || isNaN(ms)) return 'غير معروف';
  const m = Math.round(ms / 60000);
  if (m < 2) return 'قبل لحظات';
  if (m < 60) return 'قبل ' + plural(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
  const h = Math.round(m / 60);
  if (h < 24) return 'قبل ' + plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
  const d = Math.round(h / 24);
  if (d < 30) return 'قبل ' + plural(d, 'يوم', 'يومين', 'أيام', 'يومًا');
  const mo = Math.round(d / 30);
  return 'قبل ' + plural(mo, 'شهر', 'شهرين', 'أشهر', 'شهرًا');
};
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// long text keeps its line breaks (price tables, lists and headings stay readable) and is cut at a line or a word
const clipText = (s, n) => {
  s = String(s || '').replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length <= n) return s;
  let cut = s.slice(0, n - 1);
  const nl = cut.lastIndexOf('\n'), sp = cut.lastIndexOf(' ');
  const at = nl > n * 0.8 ? nl : (sp > n * 0.8 ? sp : -1);
  if (at > 0) cut = cut.slice(0, at);
  return cut.trimEnd() + '…';
};
const norm = s => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
const count = n => n === 1 ? 'رد واحد' : n === 2 ? 'ردّان' : n + ' ' + (n >= 3 && n <= 10 ? 'ردود' : 'ردًّا');

// history: the hub's turns are the only memory (Simple Memory is disconnected). Sessions split on a 4 h gap.
const GAP = 4 * 3600 * 1000;
let turns = (Array.isArray(b.turns) ? b.turns : []).filter(t => t && t.t);
const curText = String((b.message && b.message.text) || '').trim();
// hub 2.7.0 leaves the current message out of turns; an older hub may still send it as the last turn
if (event !== 'identified' && curText && turns.length) {
  const lt = turns[turns.length - 1];
  const fresh = Date.now() - new Date(lt.at).getTime() < 3 * 60000;
  if (lt.r === 'c' && fresh && String(lt.t).replace(/^\[أرفق صورة\]\s*/, '').trim() === clip(curText, 500)) turns = turns.slice(0, -1);
}
// the hub clips every turn to 500 characters: a cut reply said more than what is seen here
const CUT = t => /…$/.test(String(t.t)) && String(t.t).length >= 480;
turns = turns.map(t => Object.assign({}, t, { t: safe(t.t), cut: CUT(t) }));
const sessions = [];
for (const t of turns) {
  const ts = new Date(t.at).getTime();
  if (!ts || isNaN(ts)) continue;
  const last = sessions[sessions.length - 1];
  if (!last || ts - last.end > GAP) sessions.push({ start: ts, end: ts, turns: [t] }); else { last.end = ts; last.turns.push(t); }
}
const lastS = sessions[sessions.length - 1];
const continuing = !!lastS && (Date.now() - lastS.end) <= GAP;
const live = continuing ? lastS.turns : [];
const mine = live.filter(t => t.r !== 'c' && t.r !== 'h');
const starred = mine.slice(-3);
const botText = mine.map(t => String(t.t)).join('\n');
const cutLive = mine.some(t => t.cut);
// a question he asks again, not an acknowledgement or a button pressed twice
const ASKS = /[?؟]|(?:^|\s)[وف]?(?:كم|وش|ايش|إيش|كيف|متى|ليش|ليه|لماذا|هل|وين|أين|ما\s*هي|ما\s*هو|what|how|when|why|where|which)(?:\s|$)/i;
const ACK = /^(?:تمام|طيب|اوك|أوك|اوكي|أوكي|ok|okay|شكرا|شكرًا|مشكور|يعطيك\s*العافية|تسلم|نعم|لا|ايوه|أيوه|اي|إي|ابشر|أبشر|زين|حلو|ممتاز|كمل|كمّل|وبعدين)(?![\p{L}\p{N}])(?:\s+(?:شكرا|شكرًا|يعطيك\s*العافية|الله\s*يعافيك))?[\s.!،,?؟]*$/iu;
const repeated = event !== 'identified' && norm(curText).length >= 10 && ASKS.test(curText) && !ACK.test(curText) && live.some(t => t.r === 'c' && norm(t.t) === norm(clip(curText, 500)));

// hints: the hub's excerpts are cut around the words of the current message, so a changed excerpt is new evidence
const kh = (Array.isArray(b.knowledge_hint) ? b.knowledge_hint : []).filter(k => k && k.title && !(appSite && PAY_URL.test(String(k.url || ''))));
const ph = (Array.isArray(b.projects_hint) ? b.projects_hint : []).filter(p => p && p.name && !(appSite && PAY_URL.test(String(p.url || ''))));
const sigK = kh.length ? hash(kh.map(k => (k.url || k.title) + '|' + (k.excerpt || '')).join('|')) : '';
const sigP = ph.length ? hash(ph.map(p => p.url || p.number || p.name).join('|')) : '';
// session ledger in the workflow's static data: Split Reply records what each full reply carried (links, cards, videos,
// the membership), because the turns above are clipped and hold no actions. Build Context reads it and keeps the hint signatures.
let ledger = {};
try {
  const store = $getWorkflowStaticData('global');
  store.sessions = store.sessions || {};
  const now = Date.now();
  for (const k of Object.keys(store.sessions)) { if (now - Number(store.sessions[k].at || 0) > GAP) delete store.sessions[k]; }
  const keys = Object.keys(store.sessions);
  if (keys.length > 500) keys.sort((x, y) => store.sessions[x].at - store.sessions[y].at).slice(0, keys.length - 500).forEach(k => delete store.sessions[k]);
  ledger = continuing ? (store.sessions[sessionKey] || {}) : {};
  store.sessions[sessionKey] = Object.assign({}, ledger, { k: sigK || ledger.k || '', p: sigP || ledger.p || '', at: now });
} catch (e) { ledger = {}; }
const sameK = !!sigK && ledger.k === sigK;
const sameP = !!sigP && ledger.p === sigP;
const bare = u => String(u || '').replace(/[.,،;:!?؟]+$/, '').replace(/\/+$/, '');
const sentUrls = Array.isArray(ledger.urls) ? ledger.urls : [];
const sentCards = Array.isArray(ledger.cards) ? ledger.cards.map(String) : [];
const sentVids = Array.isArray(ledger.videos) ? ledger.videos : [];
const sentBefore = u => { u = bare(u); return !!u && (botText.indexOf(u) !== -1 || sentUrls.includes(u)); };
const recorded = Number(ledger.n || 0) > 0;
// «pitched» must never be a false «no»: a cut reply or an unrecorded session falls back to his file, then to «unknown»
const PITCH = /(عضوي|اشتراك|اشترك)/;
const pitched = PITCH.test(botText) || ledger.pitched === true || (cutLive && !recorded && /عضوي/.test(memo));
const pitchUnknown = !pitched && cutLive && !recorded;

const lines = [];
const nowIso = new Date().toISOString();
lines.push('اليوم: ' + fmtDay(nowIso) + ' — الوقت الآن ' + fmtTime(nowIso) + ' بتوقيت الرياض.');
lines.push('الموقع الذي يتصفحه العميل الآن: ' + (site.host || '?') + (site.name ? ' (' + site.name + ')' : '') + ' — الصفحة: ' + (page.title ? '«' + clip(page.title, 90) + '» ' : '') + (page.url || ''));
// what this surface can show: the app's server drops the widget-only actions; tables are drawn by the app's chat (since the
// bridge v2 update) and by the 2.7.0 widget, the one that sends the live page text; an older widget gets «label: value» lines
const liveText = clipText(safe(page.live_text), 6000);
const tables = appSite || !!liveText;
if (appSite) lines.push('وضع التطبيق: المحادثة داخل تطبيق نادي المستثمرين. ممنوع سعر العضوية وأي رابط دفع أو اشتراك وأي دعوة للدفع خارج التطبيق؛ العضوية تُشترى من شاشة العضوية داخل التطبيق عبر المتجر (كارت membership يفتحها). لا تذكر العضوية من نفسك هنا. نبرة مستشار العضو أولًا. الأفعال المتاحة هنا: quick_replies وlink وopen_page وvideo وcard فقط — لا handoff ولا نماذج ولا request_contact ولا scroll_to، فلا تعد بزر الإدارة ولا بنموذج: ما يحتاج الفريق يُقال له بسطر إنه يُرفع للإدارة، مع LEAD.');
lines.push(tables ? 'العرض: الجداول مدعومة هنا.' : 'العرض: بلا جداول Markdown هنا — المقارنة أو التلخيص كقائمة قصيرة، كل سطر «البند: القيمة».');
lines.push('');

// 1) focus, 2) live page text: the first evidence
const FOCUS_TYPES = { element: 'عنصر في الصفحة', selection: 'نص ظلّله في الصفحة', project: 'مشروع في بنك المشاريع', news: 'خبر', post: 'منشور', video: 'فيديو', service: 'خدمة', portal: 'بوابة في التطبيق', screen: 'شاشة في التطبيق' };
const fType = String(focus.type || '');
const fTitle = clip(safe(focus.title), 160);
const fSel = clipText(safe(focus.selection), 1000);
const fText = clipText(safe(focus.text), 6000);
const hasFocus = !!(fTitle || fSel || fText);
if (hasFocus) {
  lines.push('ما يشير إليه العميل الآن — الدليل الأول، وسؤاله عنه ولو لم يسمّه (' + (FOCUS_TYPES[fType] || fType || 'عنصر') + (focus.id ? ' #' + focus.id : '') + ')' + (fTitle ? ': «' + fTitle + '»' : ''));
  if (fSel) lines.push('النص الذي ظلّله:\n' + fSel);
  if (fText && fText !== fSel) lines.push('نص العنصر:\n' + fText);
  lines.push('');
}
if (liveText) { lines.push('النص الحي للصفحة التي أمامه الآن — الدليل الثاني (ما يراه بأرقامه وعناوينه، ويغلب أي معلومة محفوظة):\n' + liveText); lines.push(''); }
else if (page.content) { lines.push('محتوى الصفحة التي أمامه الآن (من فهرس الهب):\n' + clipText(safe(page.content), 2500)); lines.push(''); }

if (b.message && b.message.text && String(b.message.text).indexOf('🎤') === 0) lines.push('الرسالة الحالية وصلت كرسالة صوتية بالعربية وتم تفريغها نصًا — تعامل معها كأي رسالة، وردّ نصًا.');
const hasImage = !!(b.message && b.message.image);
if (hasImage) {
  if (pm.imageNote) lines.push('العميل أرفق صورة (سكرين شوت) مع رسالته — تحليلها: ' + pm.imageNote + '\nتعامل مع ما في الصورة كأنك رأيته بنفسك: شخّص المشكلة أو أجب عن السؤال منها مباشرة، وإن احتاجت تدخلًا بشريًا فحوّل للإدارة مع ذكر ما رأيته.');
  else lines.push('العميل أرفق صورة لكن تعذّر تحليلها تقنيًا — اعتذر بسطر واطلب منه وصف ما فيها بجملة أو إعادة إرسالها.');
  lines.push('');
}

// The evidence is always there (every call starts from nothing: the model never saw last turn's excerpts). What changes
// once per change is the wording: new matches are announced, unchanged ones are marked as already used and come shorter.
if (kh.length) {
  lines.push(sameK
    ? 'المراجع المطابقة لم تتغير منذ ردك السابق في هذه الجلسة — مرجع لك لا نص للإرسال: لا تعد إرسال روابطها، وأجب منها عن الجديد في سؤاله فقط (get_page إن احتجت نص الصفحة كاملًا):'
    : 'مراجع من صفحات المنظومة قد تطابق سؤاله (مُجلبة الآن — مرجع لك لا نص للإرسال؛ الرابط يُرسل أول مرة يخدم فيها السؤال فقط):');
  kh.forEach(k => lines.push('• ' + safe(k.title) + (k.url ? ' — ' + k.url : '') + (sentBefore(k.url) ? ' (سبق إرسال رابطه في هذه الجلسة)' : '') + (k.excerpt ? ' — ' + clip(safe(k.excerpt), sameK ? 220 : 420) : '')));
  lines.push('');
}
if (ph.length) {
  lines.push(sameP
    ? 'المشاريع المطابقة من بنك المشاريع لم تتغير منذ ردك السابق — مرجع لك: لا تعد سردها ولا روابطها إلا إن طلب، وأجب منها عن الجديد في سؤاله:'
    : 'مشاريع من بنك المشاريع قد تطابق كلامه (مرجع لك — لا تخترع مشروعًا، ولا تعد مشروعًا أو رابطًا سبق أن أرسلته في هذه الجلسة):');
  ph.forEach(p => lines.push('• ' + (p.number ? '#' + p.number + ' ' : '') + p.name + (p.sector ? ' — ' + p.sector : '') + (p.stage ? ' — ' + p.stage : '') + (p.golden ? ' — ذهبي' : '') + (p.summary ? ' — ' + clip(safe(p.summary), sameP ? 160 : 400) : '') + (p.url ? ' — ' + p.url : '') + (sentBefore(p.url) ? ' (سبق إرساله في هذه الجلسة)' : '')));
  lines.push('');
}

// The hub sends its whole policy_text() here in front of the owner's own notes. Its facts and tone are a useful
// reference; its behaviour script is not: it forbids analysis for non-members, scripts an opening line, orders a pitch
// and the pay link in every reply, bans lists and buttons and orders save_note. Those lines are dropped (the state they
// describe comes from the structured fields below) and the rest is demoted from «orders» to «reference».
const POLICY_SCRIPT = /(^وضع العميل:|^الزائر غير معروف الهوية|^في أول رد للأدمن|الممنوع:|المسموح فقط|ابدأ ردك الأول|save_note|لا قوائم ولا أزرار|وجّهه للاشتراك أولًا|سؤال واحد في الرسالة)/;
let instr = String(cfgB.instructions || '').split(/\r?\n/).map(x => x.trim()).filter(x => x && !POLICY_SCRIPT.test(x)).map(x => x.replace(/\s*الخلاصة التي تكررها[^.]*\.?/, ''));
if (appSite) instr = instr.filter(x => !PAY_TALK.test(x)).map(x => safe(x));
if (instr.length) {
  lines.push('مرجع من الإدارة (حقائق ونبرة، لا أوامر سلوك) — إن تعارض شيء منه مع تعليماتك فتعليماتك هي الحاكمة (الرأي والتحليل، منع التكرار، ذكر العضوية مرة واحدة في الجلسة، وضع التطبيق، منع الوعود)، وما يقول «في كل رد» يعني مرة واحدة في الجلسة:');
  instr.forEach(x => lines.push('• ' + x));
  lines.push('');
}
if (b.admin_brief && isAdmin) {
  const ab = b.admin_brief;
  lines.push('ملخص العمليات (للأدمن — استخدمه للإجابة عن أسئلته مباشرة): محادثات آخر 24 ساعة: ' + ab.today_chats + ' (رسائل: ' + ab.today_messages + ') على ' + ab.today_sites + ' موقع | حسابات جديدة: ' + ab.new_accounts + ' | إجمالي الحسابات: ' + ab.accounts_total + ' | الأعضاء المفعّلون: ' + ab.paid_members + ' | محادثات لم تُقرأ: ' + ab.unread + (ab.per_site && ab.per_site.length ? ' | حسب الموقع: ' + ab.per_site.join('، ') : '') + (ab.leads && ab.leads.length ? ' | الليدز: ' + ab.leads.join('، ') : ''));
  if (ab.top && ab.top.length) { lines.push('أهم العملاء الآن (بدرجة الجدية):'); ab.top.forEach(t => lines.push('• ' + t)); }
  lines.push('');
}
const recentPages = (Array.isArray(b.recent_pages) ? b.recent_pages : []).filter(p => p && !(appSite && PAY_URL.test(String(p)))).slice(0, 6);
if (recentPages.length) {
  lines.push('آخر صفحات وقف فيها العميل (الأحدث أولًا) — لطلبات «رجّعني/ارجع لموقع كذا»: ' + recentPages.join(' | '));
  lines.push('');
}

// event: no second welcome inside a running session. The sign-up welcome carries the session's one membership mention,
// so it is left out when the session already had it, and always on the app site.
const where = site.host || 'الموقع';
const eventPitch = event === 'identified' && !!b.registered && !isAdmin && !isMember && !appSite && !pitched && !pitchUnknown;
if (event !== 'identified') lines.push('الحدث: رسالة جديدة من العميل.');
else if (b.registered) lines.push('الحدث: فعّل حسابه الآن برمز البريد. رحّب به باسمه بسطر، وأكّد أن حسابه يعمل بالبريد وكلمة المرور نفسيهما على كل مواقع المنظومة (أزرار المواقع تظهر تحت رسالتك تلقائيًا فلا تسردها). ' + (eventPitch ? 'ثم سطر واحد: الخطوة التالية تفعيل العضوية السنوية من رابط الدفع في الكتالوج، مع أنسب ميزة لصفته من الكتالوج — وهذا ذكر العضوية الوحيد في هذه الجلسة. ' : '') + 'بلا أفعال أخرى.');
else if (b.login && isAdmin) lines.push('الحدث: الأدمن ' + c.name + ' سجّل الدخول الآن على ' + where + '. رحّب به باسمه كمدير للمنظومة (بلا أي بيع)، أعطه سطرًا من ملخص العمليات، ثم اعرض خدماتك بأزرار quick_replies: ["كم عميل خلصت معه اليوم؟","أرسل تقرير اليوم الآن","رسالة لكل العملاء الأونلاين","إيميل لغير المشتركين"].');
else if (b.login) lines.push('الحدث: العميل سجّل الدخول الآن بحسابه على ' + where + (continuing ? ' أثناء جلسة جارية: لا ترحيب جديد — سطر واحد يؤكد أنه مسجّل الآن ثم أكمل الموضوع الجاري.' : ': رحّب به باسمه بسطر، واذكر آخر ما كنتما فيه (من ملفه وسجله) واسأله إن كان يكمل. سطران بلا قائمة.'));
else lines.push('الحدث: العميل سجّل بياناته الآن (الاسم والجوال' + (c.email ? ' والإيميل' : '') + ')' + (continuing ? ': سطر شكر واحد باسمه ثم أكمل الموضوع الجاري من حيث توقف — بلا ترحيب جديد.' : (b.returning ? ' وهو عميل عائد تعرّفنا عليه من بياناته: رحّب به باسمه واذكر متى وعن ماذا تواصلتما (من ملفه وسجله) واسأله إن كان يكمل. سطران بلا قائمة.' : ': رحّب به باسمه بسطر ثم أكمل ما كان يسأل عنه.')));
lines.push('');

// state only: what to do with it lives in the prompt, once
const stageTxt = isAdmin ? 'أدمن المنظومة — أنت مساعد إدارة معه، بلا بيع ولا بوابات' : isMember ? 'عضو مدفوع في النادي ⭐' : (c.stage >= 1 ? (c.has_account ? 'له حساب وعضويته غير مفعّلة' : 'سجّل بياناته وليس عضوًا') : 'زائر لم يسجّل بياناته');
const msgCount = Number(c.msg_count || 0);
lines.push('حالة العميل: ' + ((!msgCount && !memo && !turns.length) ? 'جديد تمامًا — لا توجد محادثات سابقة. ' : 'له محادثات سابقة معنا. ') + stageTxt + '.');
if (c.name) lines.push('اسم العميل: ' + c.name + (c.phone ? ' | جواله: ' + c.phone : '') + (c.email ? ' | إيميله: ' + c.email : '') + (c.company ? ' | شركته/مشروعه: ' + c.company : '') + (c.city ? ' | مدينته: ' + c.city : '') + (c.job_title ? ' | وظيفته: ' + c.job_title : '') + ' — لا تسأل عن أي من هذه البيانات.');
if (c.persona) lines.push('صفته التي اختارها عند التسجيل: ' + (({ entrepreneur: 'رائد أعمال — لديه مشروع', investor: 'باحث عن فرص شراكة (مستثمر)', neutral: 'محايد — مهتم بعالم الأعمال وسيحدد توجهه لاحقًا' })[c.persona] || c.persona));
if (c.bio) lines.push('نبذة كتبها العميل عن نفسه: ' + clip(c.bio, 600));
if (Array.isArray(c.sites) && c.sites.length) lines.push('المواقع التي تواصل منها سابقًا: ' + c.sites.join('، '));
if (c.first_at) lines.push('أول تواصل معنا: ' + fmtDay(c.first_at) + ' (' + ago(c.first_at) + ').');
if (c.last_at && msgCount) lines.push('آخر تواصل قبل هذه الرسالة: ' + ago(c.last_at) + ' — ' + fmtDay(c.last_at) + ' الساعة ' + fmtTime(c.last_at) + ' | عدد رسائله السابقة: ' + msgCount + '.');
if (c.lead_type) lines.push('سبق أن أُصدر له LEAD من نوع (' + c.lead_type + ') — لا تكرره للموضوع نفسه.');
if (memo) lines.push('ملف العميل (MEMO من محادثاتكم السابقة — ما عُرض عليه أو رفضه لا يُعاد): ' + memo);
const sentVideos = (memo.match(/فيديو\s*(\d{1,2})/g) || []).join('، ');
if (sentVideos) lines.push('فيديوهات أُرسلت له سابقًا (لا تعدها): ' + sentVideos + '.');

// membership and gates: admins are exempt, members get no selling, the rest hear about it once per session
if (isAdmin) {
  lines.push('لا بوابات ولا عروض عضوية لهذا المتحدث.');
} else if (isMember) {
  lines.push('عضو مدفوع ⭐' + (c.member_left != null ? ' — باقي من عضويته ' + c.member_left + ' يومًا' : '') + (c.daily_left != null ? ' — رصيده اليوم من ردودك: ' + c.daily_left + ' (لا تذكره إلا إن سأل)' : '') + ': أنت مستشاره الخاص — بلا بوابات وبلا بيع للعضوية' + (appSite ? '.' : '؛ خصومات الأعضاء في الكتالوج تنطبق عليه (اذكر سعر العضو عند ذكر خدمة).'));
  if (c.member_new) lines.push('هذه أول محادثة بعد تفعيل عضويته: هنّئه باسمه بسطر، ثم اشرح في أربعة أو خمسة أسطر كيف يستفيد عمليًا الآن من مزايا العضوية الواردة في الكتالوج وتوجيهات الإدارة (بلا أرقام من عندك)، واسأله بأيها يبدأ مع quick_replies.');
} else {
  const left = Number(gate.left || 0);
  if (appSite) lines.push('العضوية: لا تذكرها من نفسك في التطبيق؛ إن سأل عنها فاشرح المزايا بلا أسعار وأصدر كارت membership' + (sentCards.includes('membership') ? ' (أُرسل الكارت في هذه الجلسة فلا تعده).' : '.'));
  else if (eventPitch) lines.push('العضوية: ذكرها الوحيد في هذه الجلسة هو سطر الحدث أعلاه.');
  else if (pitched) lines.push('العضوية: ذُكرت له في هذه الجلسة — لا تعد ذكرها ولا رابطها ولا كارتها إلا إذا سأل عنها صراحة.');
  else if (pitchUnknown) lines.push('العضوية: غير مؤكد إن كانت ذُكرت في هذه الجلسة (ردودك السابقة وصلت مقصوصة) — اعتبرها ذُكرت: لا تذكرها إلا إذا سأل عنها صراحة.');
  else lines.push('العضوية: لم تُذكر في هذه الجلسة — يجوز ذكرها مرة واحدة فقط إن حلّت حاجة عبّر عنها هو، وإلا فلا تذكرها.');
  if (gate.next === 'contact') {
    lines.push('بوابة النظام: يتبقى للزائر ' + count(left) + ' قبل أن يُطلب اسمه وجواله ليكمل. ' + (left <= 1 ? 'أجب عن سؤاله أولًا، ثم اختم بجملة واحدة لطيفة بأنك تحتاج أن تتعرّف عليه لتكمل معه كما ينبغي، دون ذكر «النظام». إن ذكر شراكة: رحّب ولا تفتح التفاصيل ولا تحوّل للإدارة قبل التسجيل.' : 'لا تمهيد الآن.'));
  } else if (gate.next === 'membership') {
    lines.push('بوابة النظام: يتبقى للعميل ' + count(left) + ' قبل أن يوقفه النظام بكارت الاشتراك. ' + (left <= 1 ? 'في هذا الرد فقط: جملة واحدة صادقة بأن الاستمرار بعده يحتاج عضوية' + (appSite ? ' من شاشة العضوية داخل التطبيق' : '') + '، مربوطة بما يهمه.' : 'لا تمهيد الآن.'));
  }
}
lines.push('');

if (turns.length) {
  lines.push(continuing ? 'الوضع: ما زلنا في الجلسة نفسها (لا تعد التحية ولا تذكر آخر تواصل).' : 'الوضع: محادثة جديدة بعد غياب — إن سأل سؤالًا محددًا فأجب عنه مباشرة بلا تذكير؛ وإن كانت رسالته تحية أو غامضة فاذكر بسطر طبيعي واحد آخر ما كنتما فيه واسأله إن كان يكمل.');
  const past = continuing ? sessions.slice(0, -1) : sessions;
  if (past.length) {
    lines.push('سجل الجلسات السابقة (الأقدم أولًا):');
    for (const s of past.slice(-4)) {
      const firstC = s.turns.find(t => t.r === 'c');
      const lastB = [...s.turns].reverse().find(t => t.r !== 'c');
      const at = new Date(s.start).toISOString();
      let line = '• ' + fmtDay(at) + ' الساعة ' + fmtTime(at) + ' (' + ago(at) + ')' + (s.turns[0] && s.turns[0].s ? ' — على ' + s.turns[0].s : '') + ' — ' + plural(s.turns.length, 'رسالة واحدة', 'رسالتان', 'رسائل', 'رسالة');
      if (firstC) line += ' — بدأ العميل بـ«' + clip(firstC.t, 90) + '»';
      if (lastB) line += ' — وانتهت بـ«' + clip(lastB.t, 110) + '»';
      lines.push(line);
    }
  }
  const recent = continuing ? live.slice(-14) : lastS.turns.slice(-8);
  lines.push(continuing ? 'ما دار في هذه الجلسة حتى الآن — حرفيًا، الأقدم أولًا، والرسالة الحالية ليست ضمنه. ردودك الموسومة ★ هي آخر ثلاثة ردود لك: لا تُعد أي معلومة أو رابط أو عرض أو سؤال ورد فيها.' : 'آخر جلسة سابقة بينكما — للاطلاع، الأقدم أولًا:');
  for (const tr of recent) lines.push((tr.r === 'c' ? '• العميل' : (tr.r === 'h' ? '• أحد الفريق (رد بشري)' : '• أنت' + (starred.includes(tr) ? ' ★' : ''))) + (tr.at ? ' [' + fmt(tr.at) + ']' : '') + (tr.s ? ' (' + tr.s + ')' : '') + ': ' + tr.t + (tr.cut && tr.r !== 'c' && tr.r !== 'h' ? ' (مقصوص هنا — وما قلته بعده لا يُعاد أيضًا)' : ''));
  if (continuing) {
    const offered = [
      sentCards.length ? 'كروت: ' + sentCards.join('، ') : '',
      sentVids.length ? 'فيديوهات: ' + sentVids.join('، ') : '',
      ledger.handoff ? 'زر الإدارة' : '',
      (Number(ledger.menu || 0) > 0 && Number(ledger.n || 0) - Number(ledger.menu) < 2) ? 'قائمة أزرار اختيار (في آخر ردّين)' : '',
      sentUrls.length ? 'روابط: ' + sentUrls.slice(-8).join(' ، ') : '',
    ].filter(Boolean);
    if (offered.length) lines.push('ما قدّمته فعلًا في هذه الجلسة بأزرارك وردودك الكاملة (لا يُعاد شيء منه إلا بطلب صريح): ' + offered.join(' | '));
  }
  if (repeated) lines.push('تنبيه: العميل يكرر الآن سؤالًا سبق أن أجبته في هذه الجلسة — جوابك السابق لم يكفه: غيّر الزاوية أو اسأله ما الذي لم يتضح، ولا تعد الصياغة نفسها.');
  lines.push('');
}

// services catalog: every line carries name, price and links; the long details only for what he is asking about
if (services.length) {
  const hay = norm([curText, fTitle, page.title, live.filter(t => t.r === 'c').slice(-2).map(t => t.t).join(' ')].join(' '));
  const words = hay.split(' ');
  const GENERIC = ['خدمه', 'خدمات', 'باقه', 'باقات', 'برنامج', 'احترافي', 'احترافيه', 'نادي', 'النادي', 'المستثمرين'];
  const same = (x, y) => !!x && !!y && String(x).replace(/\/+$/, '') === String(y).replace(/\/+$/, '');
  const wanted = s => words.includes(String(s.key || '').toLowerCase()) || same(s.url, page.url) || norm(s.name).split(' ').some(w => w.length >= 4 && GENERIC.indexOf(w) === -1 && hay.indexOf(w) !== -1);
  lines.push(appSite ? 'خدمات المنظومة (وضع التطبيق: بلا سعر للعضوية وبلا أي رابط دفع — الدفع من داخل التطبيق؛ ولكل خدمة كارت بمفتاحها):' : 'كتالوج الخدمات — المرجع الوحيد للأسعار والروابط (انسخ الأرقام والروابط كما هي، ولكل خدمة كارت بمفتاحها):');
  for (const s of services) {
    const hidePrice = appSite && String(s.key) === 'membership';
    let l = '• [' + s.key + '] ' + s.name;
    if (!hidePrice) {
      l += ' — السعر: ' + (s.price ? s.price + ' ' + (s.currency || 'ريال') : 'حسب الاحتياج (عرض سعر من الفريق)');
      if (s.vat_note) l += ' (' + s.vat_note + ')';
      if (s.payment_terms) l += ' — الدفع: ' + safe(s.payment_terms);
      if (s.member_discount) l += ' — للأعضاء: ' + safe(s.member_discount);
      if (s.url && !(appSite && PAY_URL.test(s.url))) l += ' — الصفحة: ' + s.url;
    }
    if (s.pay_url && !appSite) l += ' — رابط الدفع: ' + s.pay_url;
    lines.push(l);
    if (wanted(s)) {
      // on the app site the membership's own notes lose every amount, the other services only pay links and membership prices
      if (Array.isArray(s.includes) && s.includes.length) lines.push('  تشمل: ' + safe(s.includes.join('؛ '), hidePrice));
      if (s.pitch && !(appSite && /(paymob|رابط\s*(?:ال)?دفع|اشترك الآن)/i.test(s.pitch))) lines.push('  قيمتها (بأسلوبك ومرة واحدة): ' + clip(safe(s.pitch, hidePrice), 400));
    }
  }
  lines.push('');
}

// links library
const links = (Array.isArray(b.links) ? b.links : []).filter(l => l && l.url && !(appSite && (PAY_URL.test(l.url) || PAY_LABEL.test(String(l.label || '')))));
if (links.length) {
  lines.push('مكتبة الروابط المعتمدة — افتحها بـ open_page (على أي موقع في المنظومة) أو أرسلها كزر link، مرة واحدة لكل رابط في الجلسة:');
  for (const l of links) lines.push('• ' + l.label + ' — ' + l.url + (sentBefore(l.url) ? ' (سبق إرساله في هذه الجلسة)' : '') + (l.when ? ' — متى: ' + safe(l.when) : ''));
  lines.push('');
}

// forms
if (forms.length) {
  lines.push('النماذج التي تستطيع تعبئتها (prefill_form بالمفتاح؛ الحقول هنا فلا حاجة إلى get_form):');
  for (const f of forms) lines.push('• [' + f.key + '] ' + f.label + ' — ' + f.url + ' — الحقول: ' + (f.fields || []).map(x => x.key + ' (' + x.label + ')').join('، ') + (f.notes ? ' — ملاحظة: ' + f.notes : ''));
  lines.push('');
}

// video library (from the hub, not from the prompt)
const vids = videos.filter(v => v && v.id && v.title);
if (vids.length) { lines.push('مكتبة الفيديو (فعل video بالرقم): ' + vids.map(v => v.id + ' ' + clip(v.title, 70)).join(' | ')); lines.push(''); }

if (cfgB.mgmt_whatsapp || cfgB.club_whatsapp) lines.push('أرقام الفريق (تُعطى عبر فعل handoff): ' + [cfgB.mgmt_whatsapp ? 'الإدارة ' + cfgB.mgmt_whatsapp : '', cfgB.club_whatsapp ? 'النادي الرسمي ' + cfgB.club_whatsapp : ''].filter(Boolean).join(' | ') + '.');
if (cfgB.saudi_only) lines.push('تذكير: الخدمة داخل المملكة فقط.');

const chatInput = event === 'identified' ? '(حدث النظام: سجّل بياناته الآن — اكتب له الترحيب المناسب حسب السياق أعلاه)' : String(pm.chatInput || '');
const pointer = (hasFocus && event !== 'identified') ? '\n(يشير الآن إلى: «' + (fTitle || clip(fSel || fText, 120)) + '» — التفاصيل في أول كتلة السياق)' : '';
return [{ json: {
  chatInput,
  agentInput: chatInput + pointer,
  contextBlock: lines.join('\n'),
  model: pm.model, effort: pm.effort, route: pm.routeReason, event,
  contact_id: contactId, site_id: Number(site.id || 0), message_id: Number((b.message && b.message.id) || 0),
  session_key: sessionKey, app_site: appSite, app_why: appWhy, membership_price: appSite ? memberPrice : '', tables, is_admin: isAdmin,
  imageNote: String(pm.imageNote || '')
} }];
`;
// function replacers: the scrub source holds «$&», which a replacement string would expand
const BUILD_CONTEXT = BUILD_CONTEXT_SOURCE.replace('/*APP_SCRUB*/', () => APP_SCRUB).replace('__APP_HOSTS__', () => appHosts.join(','));
if (BUILD_CONTEXT.includes('vai-0') || BUILD_CONTEXT.includes('`') || BUILD_CONTEXT.includes('/*APP_SCRUB*/') || BUILD_CONTEXT.includes('__APP_HOSTS__')) fail('Build Context: shared key, a stray backtick or an unfilled placeholder');

// ───────────────────────── node changes ─────────────────────────
wf.name = NAME;

// AI Agent: new prompt, the message with its focus pointer, room for search → page → answer
const agent = byName('AI Agent');
const oldPromptLength = agent.parameters.options.systemMessage.length;
agent.parameters.text = '=رسالة العميل الآن:\n{{ $json.agentInput }}';
agent.parameters.options.systemMessage = '=' + prompt;
agent.parameters.options.maxIterations = 6;

const build = byName('Build Context');
build.parameters.jsCode = BUILD_CONTEXT;
build.notes = 'يحوّل حمولة الهب إلى كتلة السياق: ما يشير إليه العميل والنص الحي للصفحة أولًا، ثم الحالة والبوابات وسجل الجلسات (turns من الهب هي الذاكرة الوحيدة) والكتالوج.';

// Pick Model: medium effort for analysis (comparisons, summaries, a pointed-at element) and for the heavy topics
const pick = byName('Pick Model');
let pickCode = pick.parameters.jsCode;
pickCode = swap(pickCode, '// Vibes Web Agent v1 — اختيار النموذج والجهد: gpt-5 بجهد low للردود العادية (سرعة)، medium للمواضيع الثقيلة، mini للتحية فقط', '// Vibes Web Agent v4.0 — اختيار النموذج والجهد: medium للتحليل والمقارنة وما يشير إليه العميل والمواضيع الثقيلة، low للباقي، mini للتحية فقط', 'Pick Model header');
pickCode = swap(pickCode, "let model = String(cfg.model_default", "const ANALYZE = /(قارن|مقارن|الفرق|فرق بين|أيهما|ايهما|أفضل|افضل|الأنسب|الانسب|حلل|حلّل|تحليل|لخص|لخّص|ملخص|تلخيص|جدول|منافس|مرحلة|مرحله|تقييم|قيّم|دراسة|جدوى|compare|analy[sz]e|summar)/i;\nconst f = b.focus || {};\nconst hasFocus = !!(f.title || f.text || f.selection);\nlet model = String(cfg.model_default", 'Pick Model analysis regex');
pickCode = swap(pickCode, 'else if (DEEP.test(t) || t.length > 400 || questions >= 3) {', 'else if (DEEP.test(t) || ANALYZE.test(t) || t.length > 400 || questions >= 3) {', 'Pick Model deep route');
pickCode = swap(pickCode, "else if (HEAVY.test(t)) { why = 'heavy-topic'; }", "else if (hasFocus) { model = String(cfg.model_deep || model); effort = String(cfg.effort_deep || effort); why = 'focus'; }\nelse if (HEAVY.test(t)) { effort = String(cfg.effort_deep || effort); why = 'heavy-topic'; }", 'Pick Model heavy route');
pick.parameters.jsCode = pickCode;
pick.notes = 'الدقة أولًا: جهد medium للتحليل والمقارنة والمواضيع الثقيلة وما يشير إليه العميل، وlow للباقي، وmini للتحية (القيم تُضبط من Config).';

// Split Reply: same output shape for hub/reply; MEMO cap, longer analytic replies, rotating empty reply, app-site guard
const split = byName('Split Reply');
let splitCode = split.parameters.jsCode;
splitCode = swap(splitCode, '// Vibes Web Agent v1 — يفصل', '// Vibes Web Agent v4.0 — يفصل', 'Split Reply header');
splitCode = swap(splitCode, ".trim().slice(0, 700); }", '.trim().slice(0, ' + MEMO_MAX + '); }', 'Split Reply memo cap');
// v3.2 deleted every fenced block; v4 asks for tables, and a table the model fences must reach the visitor: unwrap, and
// delete only what a fence was deleted for (leaked JSON)
splitCode = swap(splitCode, ".replace(/```[\\s\\S]*?```/g, '')", ".replace(/```[a-zA-Z]*\\n?([\\s\\S]*?)```/g, (m, inner) => /^\\s*[\\[{]/.test(inner) ? '' : inner)", 'Split Reply fenced blocks');
splitCode = swap(splitCode, '// emoji: remove negatives, cap 3', '// emoji: remove negatives, cap 6', 'Split Reply emoji comment');
splitCode = swap(splitCode, "\nconst ctx = $('Build Context').first().json;\nif (!lead) {", '\nif (!lead) {', 'Split Reply ctx position');
splitCode = swap(
  splitCode,
  "if (reply.length > 3500) { reply = reply.slice(0, 3490).trim() + '…'; guard.push('truncated'); }\nif (!reply && !clean.length) { reply = 'حياك الله 🌹 وش أقدر أخدمك فيه؟'; guard.push('empty-reply'); }",
  [
    "const ctx = $('Build Context').first().json;",
    '// app site: the membership is sold in-app through the stores — no pay link and no web price of it, in the text or the buttons',
    'if (ctx.app_site) {',
    ...APP_SCRUB.trimEnd().split('\n').map((l) => '  ' + l),
    String.raw`  let dropped = 0;
  for (let i = clean.length - 1; i >= 0; i--) { const a = clean[i]; if ((a.type === 'link' || a.type === 'open_page') && (PAY_URL.test(a.url) || PAY_LABEL.test(String(a.label || '')))) { clean.splice(i, 1); dropped++; } }
  const scrubbed = scrubApp(reply, ctx.membership_price);
  reply = scrubbed.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (dropped + scrubbed.urls) guard.push('app-site:' + (dropped + scrubbed.urls));
  if (scrubbed.prices) guard.push('app-site:price');
}
// a surface that cannot draw tables (a widget older than 2.7.0) gets them as short «label: value» lines
if (!ctx.tables && /^\s*\|.*\|\s*$/m.test(reply)) {
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
  const out = []; let head = null, found = 0;
  for (const l of reply.split('\n')) {
    if (!/^\s*\|.*\|\s*$/.test(l)) { head = null; out.push(l); continue; }
    const c = cells(l);
    if (c.every(x => /^:?-{2,}:?$/.test(x))) continue;
    if (!head) { head = c; found++; continue; }
    out.push('• ' + c[0] + (c.length === 2 ? ': ' + c[1] : c.length > 2 ? ' — ' + c.slice(1).map((x, i) => (head[i + 1] ? head[i + 1] + ': ' : '') + x).join('؛ ') : ''));
  }
  if (found) { reply = out.join('\n').replace(/\n{3,}/g, '\n\n').trim(); guard.push('table-flattened'); }
}
if (reply.length > 5000) { reply = reply.slice(0, 4990).trim() + '…'; guard.push('truncated'); }
// nothing to show: a greeting only where a greeting fits, otherwise ask him to send the question again
const HELLO = ['حياك الله 🌹 وش أقدر أخدمك فيه؟', 'معك المستشار 🌹 وش الموضوع اللي تبغى نبدأ فيه؟', 'أهلًا بك، أنا حاضر. اكتب لي سؤالك أو طلبك وأكمل معك.'];
const AGAIN = ['المعذرة، جوابي ما اكتمل هذه المرة 🙏 أرسل سؤالك مرة ثانية وأرد عليك مباشرة.', 'ما طلع معي جواب مرتب على سؤالك. اكتبه لي بصياغة ثانية، أو حدّد الجزء الأهم وأبدأ منه.', 'تعذّر عليّ تجهيز الجواب الآن 🙏 أعد إرسال سؤالك بعد لحظات وأكمل معك.'];
if (!reply && !clean.length) {
  const light = /^(greeting|identified)$/.test(String(ctx.route || '')) || String(ctx.chatInput || '').trim().length <= 12;
  const pool = light ? HELLO : AGAIN;
  reply = pool[(Number(ctx.message_id) || Math.floor(Date.now() / 1000)) % pool.length];
  guard.push('empty-reply');
}
// session ledger for Build Context: what this full reply carried (the hub's turns come back clipped and without actions)
try {
  const store = $getWorkflowStaticData('global');
  store.sessions = store.sessions || {};
  const led = store.sessions[ctx.session_key] || {};
  const bare = u => String(u || '').replace(/[.,،;:!?؟]+$/, '').replace(/\/+$/, '');
  const urls = new Set(Array.isArray(led.urls) ? led.urls : []), cards = new Set(Array.isArray(led.cards) ? led.cards : []), vids = new Set(Array.isArray(led.videos) ? led.videos : []);
  (reply.match(/https?:\/\/[^\s<>"'«»()\]]+/g) || []).forEach(u => urls.add(bare(u)));
  led.n = Number(led.n || 0) + 1;
  for (const a of clean) {
    if (a.url) urls.add(bare(a.url));
    if (a.type === 'card') cards.add(a.key);
    if (a.type === 'video') vids.add(a.id);
    if (a.type === 'handoff') led.handoff = true;
    if (a.type === 'quick_replies') led.menu = led.n;
  }
  led.urls = [...urls].slice(-40); led.cards = [...cards].slice(-12); led.videos = [...vids].slice(-20);
  led.pitched = led.pitched === true || /(عضوي|اشتراك|اشترك)/.test(reply) || cards.has('membership');
  led.at = Date.now();
  store.sessions[ctx.session_key] = led;
} catch (e) {}`,
  ].join('\n'),
  'Split Reply truncate + empty reply',
);
splitCode = swap(splitCode, "route: ctx.route + '/' + ctx.effort,", "route: ctx.route + '/' + ctx.effort + (ctx.app_site ? '/app' : ''),", 'Split Reply route');
split.parameters.jsCode = splitCode;

// Fallback Reply: the same apology every time reads as a loop — rotate it
const fallback = byName('Fallback Reply');
let fallbackCode = fallback.parameters.jsCode;
fallbackCode = swap(fallbackCode, '// Vibes Web Agent v1 —', '// Vibes Web Agent v4.0 —', 'Fallback header');
fallbackCode = swap(
  fallbackCode,
  "const ctx = $('Build Context').first().json;\n",
  "const ctx = $('Build Context').first().json;\nconst SORRY = [\n  'عذرًا، صار عندي تعثّر بسيط 🙏 أعد إرسال رسالتك بعد لحظات، أو تواصل مع الإدارة مباشرة من الزر.',\n  'المعذرة، ما قدرت أجهّز ردّي هذه المرة 🙏 أرسل رسالتك مرة ثانية بعد قليل، وزر الإدارة أمامك لو الموضوع مستعجل.',\n  'واجهت خللًا مؤقتًا وأنا أجهّز جوابك. جرّب إرسال رسالتك من جديد بعد لحظات، أو كمّل مع الإدارة من الزر.',\n  'تعذّر عليّ الرد الآن لسبب تقني مؤقت 🙏 أعد المحاولة بعد قليل، والإدارة متاحة لك من الزر مباشرة.'\n];\n",
  'Fallback variants',
);
fallbackCode = swap(fallbackCode, "  reply: 'عذرًا، صار عندي تعثّر بسيط 🙏 أعد إرسال رسالتك بعد لحظات، أو تواصل مع الإدارة مباشرة من الزر.',\n  actions:", '  reply: SORRY[(Number(ctx.message_id) || Math.floor(Date.now() / 1000)) % SORRY.length],\n  actions:', 'Fallback reply line');
fallback.parameters.jsCode = fallbackCode;

// Post Reply: hub/reply is deduplicated by user_message_id in 2.7.0, two tries are enough
byName('Post Reply').maxTries = 2;

// Simple Memory: disconnected (it replayed raw replies with their hidden blocks beside the hub's turns). The node stays
// on the canvas, unplugged, with a per-contact key so a manual reconnect can never share «vai-0».
const memory = byName('Simple Memory');
memory.parameters.sessionKey = "={{ $('Build Context').first().json.session_key }}";
memory.parameters.contextWindowLength = 4;
memory.notesInFlow = true;
memory.notes = 'مفصولة عمدًا في v4.0: سجل الهب (turns) هو الذاكرة الوحيدة. لا تعد توصيلها بالوكيل — توصيلها يعيد مشكلة التكرار.';
delete wf.connections['Simple Memory'];

// tools: search first, page by any known URL, notes are rare
byName('search_site').parameters.toolDescription = 'ابحث في معرفة كل مواقع المنظومة (صفحات، خدمات، شركات، فعاليات، منشورات التطبيق، ملاحظات الفريق). استخدمها قبل الإجابة عن أي سؤال يخص محتوى المواقع وليس جوابه حرفيًا في كتلة السياق. ترجع أفضل النتائج مع العنوان والرابط ومقتطف؛ إن لم يكفِ المقتطف فاقرأ الصفحة بـ get_page.';
byName('get_page').parameters.toolDescription = 'اقرأ محتوى صفحة كاملة من مواقع المنظومة عندما تحتاج تفاصيلها (خدمة، صفحة عرض شركة ذهبية، فعالية، سياسة). الرابط من كتلة السياق (الصفحة الحالية، مكتبة الروابط، المراجع المطابقة) أو من نتائج search_site — لا تركّب رابطًا من عندك.';
byName('get_form').parameters.toolDescription = 'اجلب تعريف نموذج قابل للتعبئة بمفتاحه (مثل sp لبوابة شركاء النجاح): الرابط والحقول المتاحة (key + label). استدعِها فقط إن لم تكن حقول النموذج مذكورة في كتلة السياق.';
byName('save_note').parameters.toolDescription = 'اختيارية ونادرة: احفظ حقيقة واحدة واضحة قرأتها حرفيًا في صفحة (title = عنوان قصير، content = المعلومة كما وردت، 20 حرفًا على الأقل، url = رابط المصدر) حتى لا تبحث عنها مرة أخرى. بعد أن يجهز جوابك للعميل فقط، ولا تحفظ آراء أو استنتاجات أو تخمينات ولا بيانات العملاء.';

byName('Sticky Note — Overview').parameters.content = [
  '## ' + NAME + ' — عقل «المستشار» على مواقع المنظومة والتطبيق',
  '**المسار:** الهب (vcmem.com — Vibes AI Assistant) يستقبل رسالة الزائر من أي موقع أو من التطبيق، يخزّنها، يطبّق البوابات، ثم يرسلها هنا مع السياق: ما يشير إليه العميل (focus)، النص الحي للصفحة (page.live_text)، ملف العميل، آخر 30 دورًا (turns)، الكتالوج، الروابط، النماذج، الفيديوهات. الويبهوك يرد فورًا (200)، والوكيل يفكّر ويستخدم الأدوات، ثم **Post Reply** يرسل الرد إلى الهب والويدجت يلتقطه.',
  '',
  '**الجديد في v4.0:** الذاكرة الوحيدة هي turns من الهب (Simple Memory مفصولة عمدًا — لا تعد توصيلها) · منع تكرار على مستوى المضمون (آخر ثلاثة ردود موسومة ★) · سجل جلسة في بيانات الوركفلو (ما أُرسل من روابط وكروت وفيديوهات) لأن turns تصل مقصوصة وبلا أفعال · العضوية تُذكر مرة واحدة في الجلسة، وفي موقع التطبيق لا تُذكر من نفسه ويُحذف سعرها وروابط الدفع من السياق ومن الرد · حتى 3 أدوات و6 دورات · جهد medium للتحليل · التعليمات مختصرة (هوية + قواعد + بروتوكول) والحقائق من الكتالوج ومعرفة الهب والأدوات.',
  '',
  '**الأدوات:** search_site · get_page · find_projects · get_form · save_note (نادرة).',
  '',
  '**البروتوكول:** الرد النصي + [[ACTIONS]] + [[MEMO]] + [[LEAD]] — **Split Reply** يفصلها ويحذف أي رابط خارج دومينات المنظومة.',
  '',
  '**التشغيل:** (1) عقدة **Config** كما هي من النسخة السابقة (hub_url وhub_key وwebhook_secret) — لا تنشر هذا الملف ولا تشاركه لأن المفاتيح بداخله. (2) تأكد من حساب OpenAI في عقدتي OpenAI Chat Model وAnalyze Image. (3) أوقف v3.2 ثم فعّل هذه النسخة (نفس مسار الويبهوك). (4) من إعدادات الهب اضغط «اختبار الاتصال الكامل مع n8n» — لازم يطلع أخضر. (5) أرسل رسالة من التطبيق وتأكد في محادثات الهب أن مسار الرد (route) ينتهي بـ /app — هوست التطبيق في هذه النسخة: ' + appHosts.join('، ') + '.',
  '',
  '**اختياري:** تنبيه واتساب للإدارة عند كل ليد: عبّئ Alert Config (Evolution API) والصق Production URL لعقدة Lead Alert Webhook في إعدادات الهب → «ويبهوك الإشعار».',
].join('\n');

// a new version id, stable for the same input + prompt so rebuilding does not churn
const digest = sha(String(wf.versionId || '') + NAME + prompt + BUILD_CONTEXT);
wf.versionId = [digest.slice(0, 8), digest.slice(8, 12), '4' + digest.slice(13, 16), 'a' + digest.slice(17, 20), digest.slice(20, 32)].join('-');

// ───────────────────────── asserts ─────────────────────────
const names = new Set(wf.nodes.map((n) => n.name));
if (names.size !== wf.nodes.length) fail('duplicate node names');
for (const [from, kinds] of Object.entries(wf.connections)) {
  if (!names.has(from)) fail('connections reference a missing node: ' + from);
  for (const outputs of Object.values(kinds)) for (const output of outputs) for (const link of output || []) {
    if (!names.has(link.node)) fail('connections reference a missing node: ' + link.node);
  }
}
const next = (name, output) => ((wf.connections[name] || {}).main || []).flatMap((links, i) => (output === undefined || output === i ? (links || []).map((l) => l.node) : []));
const reaches = (start, goal) => {
  const seenNodes = new Set([start]);
  for (const queue = [start]; queue.length;) {
    const at = queue.shift();
    if (at === goal) return true;
    for (const n of next(at)) if (!seenNodes.has(n)) { seenNodes.add(n); queue.push(n); }
  }
  return false;
};
if (!reaches('Webhook', 'AI Agent')) fail('graph: Webhook no longer reaches AI Agent');
if (!reaches('Webhook', 'Pong')) fail('graph: the ping branch no longer reaches Pong');
for (const [label, output, first] of [['success', 0, 'Split Reply'], ['error', 1, 'Fallback Reply']]) {
  const heads = next('AI Agent', output);
  if (heads.length !== 1 || heads[0] !== first) fail('graph: AI Agent ' + label + ' output must lead to ' + first);
  if (!reaches(first, 'Post Reply')) fail('graph: the ' + label + ' output no longer reaches Post Reply');
}
if (!reaches('Config Error Reply', 'Post Reply')) fail('graph: Config Error Reply no longer reaches Post Reply');
const into = (kind) => Object.entries(wf.connections).filter(([, kinds]) => (kinds[kind] || []).some((links) => (links || []).some((l) => l.node === 'AI Agent'))).map(([from]) => from);
if (into('ai_languageModel').join() !== 'OpenAI Chat Model') fail('graph: AI Agent lost its chat model');
if (into('ai_memory').length) fail('graph: a memory node is still plugged into AI Agent');
for (const tool of ['search_site', 'get_page', 'find_projects', 'get_form', 'save_note']) if (!into('ai_tool').includes(tool)) fail('graph: tool unplugged: ' + tool);
if (agent.onError !== 'continueErrorOutput') fail('AI Agent must keep its error output');

// every code field this script wrote must still parse (n8n runs them as async function bodies)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
for (const n of [build, pick, split, fallback]) {
  try { new AsyncFunction('$json', '$', 'DateTime', '$getWorkflowStaticData', n.parameters.jsCode); } catch (e) { fail('«' + n.name + '» does not parse: ' + e.message); }
}

// behaviour checks on synthetic payloads (no real keys, no network)
await selfTest();

if (JSON.stringify(byName('Config')) !== configBefore) fail('the Config node changed');
const rawOut = JSON.stringify(wf, null, 2);
JSON.parse(rawOut);
const sameBytes = rawIn.includes(configText) ? rawOut.includes(configText) : null;
if (sameBytes === false) fail('the Config node is not byte-identical in the output');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, rawOut, 'utf8');

console.log([
  'build-v4: ' + NAME + ' written',
  '  output: ' + outPath + ' (holds the live keys of the Config node: keep it off git and out of chats)',
  '  nodes: ' + wf.nodes.length + ', prompt: ' + prompt.length + ' characters (was ' + oldPromptLength + '), Build Context: ' + BUILD_CONTEXT.length + ' characters',
  '  Config node: ' + (sameBytes ? 'byte-identical' : 'identical (the export uses another indentation, compared as JSON)'),
  '  graph: Webhook → AI Agent → Split Reply → Post Reply and → Fallback Reply → Post Reply: ok; Simple Memory unplugged; 5 tools plugged',
  '  app mode: host ' + appHosts.join(', ') + (hostFlag ? '' : ' (default: pass --app-host=<host> when the app\'s row on the hub\'s sites page uses another host)') + '; also an app:// page, a screen/portal focus, the app\'s name, a message without a page URL. Check: a reply to a message sent from the app shows a route ending in /app',
  '  MEMO: ' + memoAsk[1] + ' characters asked, ' + MEMO_MAX + ' kept (what the hub stores)',
  '  self-test: ok',
].join('\n'));

function selfTest() {
  const must = (ok, what) => { if (!ok) fail('self-test: ' + what); };
  const DateTime = { fromISO: (iso) => ({ setZone: () => {
    const d = new Date(iso); const r = new Date(d.getTime() + 3 * 3600e3); const ok = !Number.isNaN(d.getTime());
    return { isValid: ok, weekday: ok ? ((r.getUTCDay() + 6) % 7) + 1 : 0, day: r.getUTCDate(), month: r.getUTCMonth() + 1, year: r.getUTCFullYear(), toFormat: (f) => (f === 'HH:mm' ? r.toISOString().slice(11, 16) : r.toISOString().slice(0, 16).replace('T', ' ')) };
  } }) };
  const config = { hub_url: 'https://hub.test', allowed_hosts: 'vcmem.com,vibesholding.com,paymob.link', model_default: 'big', model_deep: 'big', model_light: 'mini', effort_default: 'low', effort_deep: 'medium', effort_light: 'low' };
  const store = {};
  const run = (code, $json, others = {}) => new AsyncFunction('$json', '$', 'DateTime', '$getWorkflowStaticData', code)(
    $json, (name) => ({ first: () => ({ json: name === 'Config' ? config : others[name] }) }), DateTime, () => store,
  );
  const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
  const body = (over = {}) => ({
    event: 'message', message: { id: 501, text: 'وش رأيك في هذي الباقة؟' },
    site: { id: 3, host: 'almoltaqapodcast.com', name: 'بودكاست الملتقى' },
    page: { url: 'https://almoltaqapodcast.com/packages/', title: 'الباقات', content: 'old index text', live_text: 'باقة الإنتاج\r\n\r\n\r\nالسعر: 4,000 ريال   للساعة\nتشمل: تصوير\tومونتاج' },
    focus: { type: 'element', title: 'باقة الإنتاج المتكاملة', text: 'باقة الإنتاج المتكاملة\n4,000 ريال للساعة' },
    contact: { id: 77, name: 'فهد', stage: 1, has_account: true, is_member: false, is_admin: 0, msg_count: 4 },
    gate: { next: 'membership', left: 3, nudge: true },
    knowledge_hint: [{ title: 'باقات الاستوديو', url: 'https://almoltaqapodcast.com/packages/', excerpt: 'تفاصيل الباقات' }],
    turns: [
      { r: 'c', t: 'السلام عليكم', at: minutesAgo(30), s: 'vcmem.com' }, { r: 'b', t: 'وعليكم السلام، حياك الله', at: minutesAgo(29), s: 'vcmem.com' },
      { r: 'c', t: 'وش مزايا العضوية؟', at: minutesAgo(20), s: 'vcmem.com' }, { r: 'b', t: 'العضوية السنوية تفتح لك https://vcmem.com/member-benefits/', at: minutesAgo(19), s: 'vcmem.com' },
    ],
    services: [
      { key: 'membership', name: 'العضوية السنوية', price: '1,900', currency: 'ريال', url: 'https://vcmem.com/payment/', pay_url: 'https://paymob.link/abc', includes: ['ميزة'], pitch: 'نص' },
      { key: 'podcast', name: 'استوديو بودكاست الملتقى', price: '4,000', currency: 'ريال', url: 'https://almoltaqapodcast.com/packages/', pay_url: 'https://paymob.link/pod', includes: ['تصوير'], pitch: 'قيمة' },
      { key: 'pitchdeck', name: 'Pitch Deck الاحترافي', price: '5,000', currency: 'ريال', includes: ['شرائح'], pitch: 'عرض' },
    ],
    links: [{ label: 'الاشتراك والدفع', url: 'https://vcmem.com/payment/' }, { label: 'بنك المشاريع', url: 'https://vibesholding.com/pb' }],
    videos: [{ id: 1, title: 'ما هو النادي' }],
    config: { instructions: 'في كل رد دعوة للاشتراك مع رابط الدفع https://paymob.link/abc\nاللهجة سعودية بيضاء', mgmt_whatsapp: '+9665' },
    ...over,
  });
  const ctxOf = async (b) => { const out = await run(BUILD_CONTEXT, { body: b, chatInput: b.message ? b.message.text : '', model: 'm', effort: 'low', routeReason: 'default' }); return out.length ? out[0].json : null; };

  return (async () => {
    const fresh = () => { delete store.sessions; };
    // 1) web visitor: focus first, live text second with its line breaks, history after, state-only membership lines
    const a = await ctxOf(body());
    const block = a.contextBlock;
    const at = (s) => block.indexOf(s);
    must(a.session_key === 'vai-77' && a.contact_id === 77, 'session key per contact');
    must(at('ما يشير إليه العميل الآن') > 0 && at('ما يشير إليه العميل الآن') < at('النص الحي للصفحة') && at('النص الحي للصفحة') < at('ما دار في هذه الجلسة'), 'focus → live text → history order');
    must(block.includes('باقة الإنتاج\n\nالسعر: 4,000 ريال للساعة\nتشمل: تصوير ومونتاج'), 'live text keeps line breaks and collapses spaces');
    must(!block.includes('old index text'), 'the hub excerpt is only a fallback for live_text');
    must(!block.includes('لازم تسجّل') && !block.includes('تذكير الاشتراك'), 'no forced per-turn pitch');
    must(block.includes('العضوية: ذُكرت له في هذه الجلسة'), 'pitch state comes from the session turns');
    must((block.match(/• أنت ★/g) || []).length === 2, 'last assistant turns are starred');
    must(block.includes('لا تمهيد الآن'), 'gate is announced only on the last reply');
    must(block.includes('مُجلبة الآن') && block.includes('تفاصيل الباقات'), 'first time: the hint is announced with its excerpt');
    must(block.includes('تشمل: تصوير') && block.includes('[pitchdeck]') && !block.includes('تشمل: شرائح'), 'catalog details only for the services he is asking about');
    must(a.agentInput.includes('يشير الآن إلى: «باقة الإنتاج المتكاملة»') && a.chatInput === 'وش رأيك في هذي الباقة؟', 'agent input carries the focus pointer, chatInput stays raw');
    must(!a.app_site && a.tables && block.includes('العرض: الجداول مدعومة هنا'), 'web with the 2.7.0 widget: tables');
    must(!(await ctxOf(body({ page: { url: 'https://vcmem.com/', title: 'x' } }))).tables, 'no live text (older widget): no tables');
    must(!(await ctxOf(body({ focus: { type: 'project', id: '12', title: 'مشروع', text: 'نص' } }))).app_site, 'a Projects Bank card on a website is not the app');
    // 2) hints: unchanged matches come marked and shorter, never without their evidence; a new excerpt is new evidence
    const again = await ctxOf(body({ message: { id: 502, text: 'طيب' } }));
    must(again.contextBlock.includes('لم تتغير منذ ردك السابق') && again.contextBlock.includes('تفاصيل الباقات') && !again.contextBlock.includes('ولا مضمونها'), 'same hints: marked as used, excerpt kept');
    const follow = await ctxOf(body({ message: { id: 504, text: 'وكم مدة التصوير؟' }, knowledge_hint: [{ title: 'باقات الاستوديو', url: 'https://almoltaqapodcast.com/packages/', excerpt: 'مدة التصوير ساعتان' }] }));
    must(follow.contextBlock.includes('مُجلبة الآن') && follow.contextBlock.includes('مدة التصوير ساعتان'), 'same page, new excerpt: injected in full');
    // 3) a repeated question is flagged, an acknowledgement said twice is not
    const rep = await ctxOf(body({ message: { id: 503, text: 'وش مزايا العضوية؟' } }));
    must(rep.contextBlock.includes('تنبيه: العميل يكرر الآن سؤالًا'), 'repeated question flag');
    const ack = await ctxOf(body({ message: { id: 505, text: 'تمام شكرا' }, turns: [{ r: 'c', t: 'تمام شكرا', at: minutesAgo(9) }, { r: 'b', t: 'العفو', at: minutesAgo(8) }] }));
    must(!ack.contextBlock.includes('تنبيه: العميل يكرر'), 'an acknowledgement is not a repeated question');
    // 4) admin: no gates, no pitch lines
    const adm = await ctxOf(body({ contact: { id: 5, name: 'سالم', stage: 2, has_account: true, is_member: false, is_admin: 1 } }));
    must(adm.is_admin && !adm.contextBlock.includes('بوابة النظام') && !adm.contextBlock.includes('العضوية: '), 'admins are exempt from gates');
    // 5) app site: the web price of the membership and pay links are taken out of every text, whoever carries them
    const LEAK = /paymob|\/payment|1,900|3,900|١٬٩٠٠/;
    const appBody = (over = {}) => body({
      site: { id: 9, host: appHosts[0], name: 'تطبيق نادي المستثمرين' }, page: { url: '', title: '' }, focus: null,
      contact: { id: 78, name: 'نورة', stage: 1, has_account: true, msg_count: 6 }, message: { id: 601, text: 'وش مزايا العضوية السنوية؟' },
      knowledge_hint: [
        { title: 'الاشتراك والدفع', url: 'https://vcmem.com/payment/', excerpt: 'العضوية السنوية 1,900 ريال' },
        { title: 'مزايا العضوية', url: 'https://vcmem.com/member-benefits/', excerpt: 'العضوية السنوية 1,900 ريال بدلًا من 3,900 ريال لفترة محدودة. اشترك الآن https://paymob.link/abc' },
      ],
      memo: 'عُرض عليه: كارت العضوية ١٬٩٠٠ ريال ورابط الدفع https://paymob.link/abc | رفض: لا شيء',
      turns: [{ r: 'c', t: 'كم سعر العضوية؟', at: minutesAgo(40), s: 'vcmem.com' }, { r: 'b', t: 'سعر العضوية السنوية 1,900 ريال وتدفع من هنا https://paymob.link/abc', at: minutesAgo(39), s: 'vcmem.com' }],
      services: [
        { key: 'membership', name: 'العضوية السنوية', price: '1,900', currency: 'ريال', url: 'https://vcmem.com/payment/', pay_url: 'https://paymob.link/abc', includes: ['خصم 50% على الباقات', 'السعر 1,900 ريال بدلًا من 3,900 ريال'], pitch: 'تعيد ثمنها' },
        { key: 'podcast', name: 'استوديو بودكاست الملتقى', price: '4,000', currency: 'ريال', url: 'https://almoltaqapodcast.com/packages/', pay_url: 'https://paymob.link/pod', payment_terms: 'ادفع من الرابط https://paymob.link/pod' },
      ],
      config: { instructions: 'الشراكات للمشتركين فقط: وجّهه للاشتراك أولًا.\nخدمات الأعضاء: Pitch Deck بخصم 50% (رابط دفع الأعضاء) أرسل الرابط.\nاللهجة سعودية بيضاء' },
      ...over,
    });
    fresh();
    const app = await ctxOf(appBody());
    must(app.app_site && app.app_why === 'host' && app.contextBlock.includes('وضع التطبيق') && app.membership_price === '1,900', 'app site is detected by its host');
    must(!LEAK.test(app.contextBlock), 'app site: no membership price and no pay link in hints, MEMO, turns, catalog or notes');
    must(!/رابط دفع الأعضاء|وجّهه للاشتراك/.test(app.contextBlock) && app.contextBlock.includes('اللهجة سعودية'), 'app site: pay directives go, the rest of the notes stays');
    must(app.contextBlock.includes('4,000') && app.contextBlock.includes('مزايا العضوية — https://vcmem.com/member-benefits/'), 'app site: real-world prices and clean pages stay');
    must(app.tables && app.contextBlock.includes('الجداول مدعومة هنا') && app.contextBlock.includes('لا تذكر العضوية من نفسك'), 'app site: tables, no self-started pitch');
    for (const [why, over] of [['no-page', { site: { id: 9, host: 'unlisted.invalid', name: 'تطبيق النادي' } }], ['focus', { site: { id: 9, host: 'unlisted.invalid' }, page: { url: 'https://unlisted.invalid/', title: '' }, focus: { type: 'screen', id: 'home', title: 'الرئيسية', text: 'نص' } }], ['page', { site: { id: 9, host: 'unlisted.invalid' }, event: 'identified', login: true, page: { url: 'app://login', title: '' } }]]) {
      const other = await ctxOf(appBody(over));
      must(other.app_site && other.app_why === why && !LEAK.test(other.contextBlock), 'app site under another host is known by: ' + why);
    }
    // 6) nobody to answer: stop, never vai-0
    must((await ctxOf(body({ contact: { name: 'x' } }))) === null, 'no contact → no run');
    must((await ctxOf(body({ contact: { uuid: 'abc-1' } }))).session_key === 'vai-abc-1', 'uuid key when there is no id');
    // 7) sign-up welcome: the one membership mention, not a second one, and none on the app site
    const signup = (over = {}) => body({ event: 'identified', registered: true, message: { id: 0, text: '' }, contact: { id: 80, name: 'فهد', stage: 1, has_account: true, msg_count: 3 }, turns: [], focus: null, ...over });
    must((await ctxOf(signup())).contextBlock.includes('وهذا ذكر العضوية الوحيد'), 'sign-up welcome carries the one mention');
    const second = (await ctxOf(signup({ turns: [{ r: 'b', t: 'العضوية السنوية تفتح لك كذا', at: minutesAgo(5) }] }))).contextBlock;
    must(!second.includes('رابط الدفع في الكتالوج') && second.includes('العضوية: ذُكرت له'), 'sign-up welcome after a pitch: no second mention');
    must(!/تفعيل العضوية/.test((await ctxOf(appBody({ event: 'identified', registered: true, message: { id: 0, text: '' }, turns: [] }))).contextBlock.split('\n').find((l) => l.startsWith('الحدث:'))), 'sign-up welcome on the app site: no membership line');
    // 8) a reply the hub clipped: «not mentioned» is never claimed; the ledger of full replies decides when it exists
    fresh();
    const cutTurns = [{ r: 'c', t: 'حلل لي الباقة', at: minutesAgo(6) }, { r: 'b', t: ('تحليل مفصل للباقة. '.repeat(40)).slice(0, 499) + '…', at: minutesAgo(5) }];
    const cut = (await ctxOf(body({ contact: { id: 81, stage: 1, has_account: true, msg_count: 3 }, message: { id: 701, text: 'طيب وبعدين؟' }, turns: cutTurns }))).contextBlock;
    must(cut.includes('العضوية: غير مؤكد') && !cut.includes('لم تُذكر') && cut.includes('(مقصوص هنا'), 'clipped reply: pitch state unknown, the cut is marked');
    // 9) the hub's policy_text(): its behaviour script is dropped, its facts stay as a reference
    const policy = [
      'اللهجة: سعودية بيضاء جميلة وسلسة يفهمها كل عربي.',
      'أنت مستشار مالي وإداري خبير قبل أن تكون بائعًا: اسأل لتفهم بدقة من الذي أمامك وماذا يحتاج (سؤال واحد في الرسالة).',
      'الروابط بدقة: قبل إرسال أي رابط تأكد. عندما تكتشف معلومة جديدة احفظها لنفسك بأداة save_note حتى لا تبحث عنها مرة أخرى.',
      'وضع العميل: مسجّل لكن عضويته غير مفعّلة (لم يدفع) — ابدأ ردك الأول له بـ «عضويتك غير مفعّلة بعد» — الممنوع: الدردشة والسوالف والاستشارات والخطط والتحليلات؛ المسموح فقط: شرح مزايا العضوية بالأرقام، ثم في كل رد دعوة واضحة للاشتراك مع رابط الدفع المباشر https://paymob.link/abc.',
      'الشراكات والمجموعات وبنك المشاريع للمشتركين فقط: لا تفتح نقاش حصص قبل الاشتراك — وجّهه للاشتراك أولًا.',
      'ترشيح واحد فقط في كل رد حسب طلب العميل — لا قوائم ولا أزرار إلا لطلب محدد.',
      'ملاحظة المالك: الملتقى القادم يوم الخميس.',
    ].join('\n');
    const pol = (await ctxOf(body({ config: { instructions: policy, first_note: 'هذه المحادثة غير مسجّلة' }, gate: { next: 'contact', left: 1, first: true } }))).contextBlock;
    must(!/الممنوع:|المسموح فقط|ابدأ ردك الأول|save_note|لا قوائم ولا أزرار|وجّهه للاشتراك|سؤال واحد في الرسالة|التزم بمضمونها/.test(pol), 'policy_text behaviour script is dropped');
    must(pol.includes('اللهجة: سعودية بيضاء') && pol.includes('الملتقى القادم يوم الخميس') && pol.includes('تعليماتك هي الحاكمة'), 'facts and the owner\'s notes stay, as a reference');
    must(!pol.includes('غير مسجّلة'), 'first_note (a membership pitch) is not injected');
    // 10) back after a gap with a specific question: answer it, no scripted reminder
    const back = (await ctxOf(body({ contact: { id: 84, stage: 1, msg_count: 9 }, message: { id: 801, text: 'كم سعر باقة الإنتاج المتكاملة؟' }, turns: [{ r: 'c', t: 'أبغى أسجل مشروعي', at: minutesAgo(1800) }, { r: 'b', t: 'تمام', at: minutesAgo(1799) }] }))).contextBlock;
    must(back.includes('إن سأل سؤالًا محددًا فأجب عنه مباشرة') && !back.includes('ثم اسأل إن كان يكمل'), 'returning visitor: the question first');

    // Split Reply: the hub/reply body keeps its exact shape
    fresh();
    const output = 'هذا رأيي في الباقة.\nhttps://paymob.link/abc\nhttps://evil.example/x\n[[ACTIONS]]{"actions":[{"type":"card","key":"membership"},{"type":"link","label":"ادفع","url":"https://paymob.link/abc"},{"type":"open_page","url":"https://vibesholding.com/pb"},{"type":"video","id":5}]}[[/ACTIONS]]\n[[MEMO]]احتياجه: بودكاست | عُرض عليه: كارت العضوية ' + 'س'.repeat(1500) + '[[/MEMO]]\n[[LEAD]]{"type":"service","reason":"بودكاست","company":"","notes":""}[[/LEAD]]';
    const others = (ctx, route = 'focus') => ({ 'Build Context': { ...ctx, model: 'gpt-x', effort: 'medium', route }, Webhook: { body: body() } });
    const split = async (text, ctx, route) => (await run(splitCode, { output: text }, others(ctx, route)))[0].json;
    const web = await split(output, a);
    must(Object.keys(web).join() === 'contact_id,site_id,user_message_id,reply,actions,memo,lead,model,route,guard,event,registered', 'hub/reply keys unchanged');
    must(web.contact_id === 77 && web.user_message_id === 501 && web.route === 'focus/medium', 'ids and route');
    must(web.memo.length === MEMO_MAX && web.memo.startsWith('احتياجه'), 'MEMO kept to what the hub stores');
    must(web.lead && web.lead.type === 'service' && web.actions.length === 4, 'lead and actions parsed');
    must(web.reply.includes('paymob.link/abc') && !web.reply.includes('evil.example'), 'web: allowed pay link stays, foreign link goes');
    // the ledger of that full reply reaches the next Build Context, whatever the hub clips
    const next = await ctxOf(body({ message: { id: 506, text: 'طيب وبعدين؟' }, turns: [{ r: 'c', t: 'وش رأيك؟', at: minutesAgo(3) }, { r: 'b', t: ('تحليل. '.repeat(90)).slice(0, 499) + '…', at: minutesAgo(2) }] }));
    must(next.contextBlock.includes('العضوية: ذُكرت له') && next.contextBlock.includes('كروت: membership') && next.contextBlock.includes('فيديوهات: 5') && next.contextBlock.includes('https://vibesholding.com/pb'), 'session ledger: what the full reply carried');
    must(next.contextBlock.includes('بنك المشاريع — https://vibesholding.com/pb (سبق إرساله في هذه الجلسة)'), 'a link sent by a button is marked as sent');
    const inApp = await split(output.replace('هذا رأيي في الباقة.', 'العضوية السنوية بـ 1,900 ريال. ادفع من https://accept.paymob.com/x'), app);
    must(!/paymob|1,900/.test(inApp.reply) && inApp.actions.map((x) => x.type).join() === 'card,open_page,video', 'app site: pay links and the membership price removed, membership card kept');
    must(/app-site:\d/.test(inApp.guard) && inApp.guard.includes('app-site:price') && inApp.route === 'focus/medium/app', 'app site: guard and route say so');
    // tables: kept where they can be drawn (also out of a fence), flattened where they cannot; leaked JSON still goes
    const table = 'المقارنة:\n\n```markdown\n| البند | باقة أ | باقة ب |\n|---|---|---|\n| السعر | 4,000 | 2,500 |\n```\n\nموقفي: باقة أ.';
    const drawn = await split(table, a, 'deep-topic');
    must(drawn.reply.includes('| السعر | 4,000 | 2,500 |') && !drawn.reply.includes('```') && !drawn.guard.includes('table-flattened'), 'a fenced table is unwrapped, not deleted');
    const flat = await split(table, await ctxOf(body({ page: { url: 'https://vcmem.com/', title: 'x' } })), 'deep-topic');
    must(flat.reply.includes('• السعر — باقة أ: 4,000؛ باقة ب: 2,500') && !flat.reply.includes('|') && flat.guard.includes('table-flattened'), 'no table support: «label: value» lines');
    must(!(await split('تمام.\n```json\n{"actions":[]}\n```', a)).reply.includes('actions'), 'a fenced JSON leak is still deleted');
    const empty = await split('', { ...a, chatInput: 'قارن لي بين الباقتين بالتفصيل' }, 'deep-topic');
    must(empty.guard === 'empty-reply' && !/حياك|معك المستشار|أهلًا بك/.test(empty.reply) && empty.reply.length > 20, 'empty reply to a real question: no greeting');
    must(/حياك|معك المستشار|أهلًا بك/.test((await split('', { ...a, chatInput: 'هلا' }, 'greeting')).reply), 'empty reply to a greeting: a greeting');
    const sorry = (await run(fallbackCode, {}, others(a)))[0].json;
    must(sorry.reply.length > 20 && sorry.guard === 'agent-error' && sorry.actions[0].type === 'handoff', 'fallback reply');
    const route = async (text, focus) => { const p = (await run(pickCode, { body: body({ message: { id: 1, text }, focus }) }))[0].json; return p.routeReason + '/' + p.effort + '/' + p.model; };
    must((await route('قارن لي بين الباقتين', null)) === 'deep-topic/medium/big', 'comparison → medium');
    must((await route('كم المدة؟', { title: 'باقة' })) === 'focus/medium/big', 'pointed-at element → medium');
    must((await route('كم سعر العضوية', null)) === 'heavy-topic/medium/big', 'heavy topic → medium');
    must((await route('هلا', null)) === 'greeting/low/mini' && (await route('تمام يعطيك العافية يا غالي', null)) === 'default/low/big', 'greeting and default stay light');
  })();
}
