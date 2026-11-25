import { useEffect, useState } from 'react';

import { api, type Post, type PostAudience, type PostFollow, type PostFollowRow, type PostWhatsapp, type PostWhatsappRow } from '../api';
import { formatDateTime, formatEventDate, formatNumber } from '../format';
import { paidLabel, personaLabel, PostEditor } from '../PostEditor';
import { Async, messageOf, Pill, SectionHead, sessionOver, useLoad, useShell } from '../ui';

const audienceOf = (post: Post): PostAudience => post.audience ?? { type: 'all' };

/** M29: who the message is for, named on its row. Nothing shows for a public post. */
function AudiencePill({ post }: { post: Post }) {
  const audience = audienceOf(post);
  if (audience.type === 'all') return null;
  // M273: «لم يدفع · رائد الأعمال» — the payment state first, then the category when one is chosen.
  if (audience.type === 'persona') return audience.paid ? <Pill tone="gold">{paidLabel(audience.paid)} · {personaLabel(audience.persona)}</Pill> : <Pill tone="gold">لفئة {personaLabel(audience.persona)}</Pill>;
  if (audience.type === 'paid') return <Pill tone="gold">{paidLabel(audience.paid)}</Pill>;
  if (audience.type === 'partners') return <Pill tone="blue">شركاء النجاح</Pill>;
  if (audience.type === 'member') return <Pill tone="gold">لعضو: {audience.name || `#${audience.contactId}`}</Pill>;
  const [first] = audience.members;
  if (audience.members.length === 1 && first) return <Pill tone="gold">لعضو: {first.name || `#${first.contactId}`}</Pill>;
  return <span title={audience.members.map((member) => member.name || `#${member.contactId}`).join('، ')}><Pill tone="gold">لأعضاء محددين: {audience.members.length}</Pill></span>;
}

/** How the hand-over to the hub went: the websites' feed and the assistant hear a published post through it. */
function HubSync({ post }: { post: Post }) {
  const sync = post.hubSync;
  if (post.status !== 'published') return null;
  // A targeted message is private, and a poll cannot be voted on a website: both stay in the app.
  if (audienceOf(post).type !== 'all' || post.kind === 'poll' || post.kind === 'popup') return <Pill tone="muted">داخل التطبيق فقط</Pill>;
  if (!sync) return null;
  if (sync.state === 'ok') return <Pill tone="ok">وصل للمواقع والمستشار</Pill>;
  if (sync.state === 'unsupported') return <Pill tone="muted">المواقع تحتاج إضافة الهب 2.7.0</Pill>;
  return <Pill tone="danger">لم يصل للمواقع بعد · يُعاد عند التعديل التالي</Pill>;
}

/** M31: the poll's live numbers on its row — a bar per option, the leader filled fullest. */
function PollResults({ post, picked = null, onPick }: { post: Post; picked?: string | null; onPick?: (optionId: string) => void }) {
  const results = post.pollResults;
  if (post.kind !== 'poll' || !results) return null;
  const total = results.totalVotes ?? 0;
  return (
    <div className="poll-results">
      {results.options.map((option) => {
        const votes = option.votes ?? 0;
        return (
          <div className="row-line" key={option.id}>
            <span>{option.label}</span>
            <span className="muted">
              {formatNumber(votes)}{total > 0 ? ` · ${Math.round((votes / total) * 100)}%` : ''}
              {/* M274: the names behind an option, one tap away (admins). */}
              {onPick && votes > 0 ? <> · <button type="button" className="link" aria-pressed={picked === option.id} onClick={() => onPick(option.id)}>{picked === option.id ? 'إخفاء الأسماء' : 'عرض الأسماء'}</button></> : null}
            </span>
            <div className="bar"><span style={{ width: total > 0 ? `${(votes / total) * 100}%` : 0 }} /></div>
          </div>
        );
      })}
      <span className="muted">
        {`المصوتون: ${formatNumber(total)}`}
        {results.closesAt ? ` · ${results.closed ? 'أُغلق' : 'يُغلق'} ${formatEventDate(results.closesAt)}` : ''}
        {results.resultsVisible ? '' : ' · النتائج للوحة فقط'}
      </span>
    </div>
  );
}

/** Arabic counting: one, two, 3–10 (plural), 11 and over (singular accusative). */
function counted(count: number, [one, two, few, many]: [string, string, string, string]): string {
  if (count === 1) return one;
  if (count === 2) return two;
  return `${formatNumber(count)} ${count % 100 >= 3 && count % 100 <= 10 ? few : many}`;
}

/** M274: which rows of the follow-up list show — everyone, one state, or one poll option (`option:<id>`). */
type FollowView = 'all' | 'voted' | 'opened' | 'unopened' | `option:${string}`;
const FOLLOW_PAGE = 100;
const followState = (row: PostFollowRow): 'voted' | 'opened' | 'unopened' => (row.vote !== null ? 'voted' : row.opened ? 'opened' : 'unopened');

/**
 * M243 (owner: «اعرف مين فتح المقال ... واقدر اضغط علي العضو اشوف مين ده») + M274 (owner, 2026-11-25: «مش عارف مين فتح
 * ومين ما فتح… ومين سجل وسجل وين»): the message followed member by member. The admin unfolds every account of its
 * audience — who voted and for what, who only opened, who has not opened — filters it, and a name opens the member's
 * sheet; an option of the poll opens the names behind it. A moderator sees the numbers only.
 */
function Tracking({ post, isAdmin }: { post: Post; isAdmin: boolean }) {
  const { openMember } = useShell();
  const [view, setView] = useState<FollowView | null>(null);
  const [data, setData] = useState<PostFollow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(FOLLOW_PAGE);
  const isPoll = post.kind === 'poll';
  const tracked = post.status === 'published' && post.kind !== 'popup';
  const canFollow = isAdmin && tracked;
  const count = post.opened ?? 0;
  const label = count === 0 ? 'لم يفتحها أي عضو بعد' : `فتحها ${counted(count, ['عضو واحد', 'عضوان', 'أعضاء', 'عضوًا'])}`;
  const show = async (next: FollowView | null) => {
    const wasClosed = view === null;
    setView(next);
    setLimit(FOLLOW_PAGE);
    if (next === null || !wasClosed) return;
    setError(null);
    setData(null);
    try {
      setData(await api.postFollow(post.id));
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const rank = { voted: 0, opened: 1, unopened: 2 };
  const rows = [...(data?.rows ?? [])].sort(
    (a, b) => rank[followState(a)] - rank[followState(b)] || (b.opened?.last ?? '').localeCompare(a.opened?.last ?? '') || a.name.localeCompare(b.name, 'ar'),
  );
  const total = (state: 'voted' | 'opened' | 'unopened') => rows.filter((row) => followState(row) === state).length;
  const optionLabel = (id: string) => data?.options.find((option) => option.id === id)?.label ?? '';
  const shown = rows.filter((row) => (view === null || view === 'all' ? true : view.startsWith('option:') ? row.vote === view.slice(7) : followState(row) === view));
  const stateLabel = { voted: 'صوّت', opened: isPoll ? 'فتح ولم يصوّت' : 'فتح', unopened: 'لم يفتح' };
  const chip = (key: FollowView, text: string, number: number, long = false) => (
    <button key={key} type="button" className={`${view === key ? 'chip on' : 'chip'}${long ? ' long' : ''}`} aria-pressed={view === key} title={long ? text : undefined} onClick={() => void show(key)}>
      <span lang={long ? 'ar' : undefined}>{text}</span>
      <span className="num">{formatNumber(number)}</span>
    </button>
  );
  return (
    <>
      <PollResults post={post} picked={view?.startsWith('option:') ? view.slice(7) : null} onPick={canFollow ? (optionId) => void show(view === `option:${optionId}` ? 'all' : `option:${optionId}`) : undefined} />
      {!tracked ? null : !isAdmin ? <p className="muted">👁 {label}</p> : (
        <div className="post-opens">
          <button type="button" className="link" onClick={() => void show(view === null ? 'all' : null)} aria-expanded={view !== null}>
            👁 {label} · {view !== null ? 'إخفاء المتابعة' : 'متابعة الأعضاء بالأسماء'}
          </button>
          {view !== null && error ? <p className="muted">{error}</p> : null}
          {view !== null && !error && data === null ? <p className="muted">جارٍ التحميل…</p> : null}
          {view !== null && data ? (
            <>
              <div className="chips" role="group" aria-label="تصفية المتابعة">
                {chip('all', 'الكل', rows.length)}
                {isPoll ? chip('voted', stateLabel.voted, total('voted')) : null}
                {chip('opened', stateLabel.opened, total('opened'))}
                {chip('unopened', stateLabel.unopened, total('unopened'))}
              </div>
              {isPoll ? (
                <div className="chips" role="group" aria-label="حسب الاختيار">
                  {data.options.map((option) => chip(`option:${option.id}`, option.label, rows.filter((row) => row.vote === option.id).length, true))}
                </div>
              ) : null}
              {data.complete ? null : <p className="muted hint">تعذّرت قراءة سجل الأعضاء الآن، فقائمة «لم يفتح» قد تكون ناقصة. أعد المحاولة بعد قليل.</p>}
              {shown.length === 0 ? <p className="muted">لا يوجد أحد في هذه القائمة.</p> : null}
              <ul className="list">
                {shown.slice(0, limit).map((row) => (
                  <li key={row.contactId}>
                    <button type="button" className="list-row" onClick={() => openMember(row.contactId)}>
                      <span className="list-main">
                        <strong>{row.name || `حساب رقم ${row.contactId}`}</strong>
                        <span className="muted">
                          {personaLabel(row.persona) || 'بدون فئة'}
                          {row.vote !== null ? <> · اختار: <span lang="ar">{optionLabel(row.vote)}</span></> : null}
                          {row.opened ? <> · فتحها {formatDateTime(row.opened.last)}</> : null}
                          {row.opened && row.opened.count > 1 ? ` · ${counted(row.opened.count, ['مرة واحدة', 'مرتان', 'مرات', 'مرة'])} (أول مرة ${formatDateTime(row.opened.first)})` : ''}
                        </span>
                      </span>
                      <Pill tone={followState(row) === 'voted' ? 'ok' : followState(row) === 'opened' ? 'gold' : 'muted'}>{stateLabel[followState(row)]}</Pill>
                    </button>
                  </li>
                ))}
              </ul>
              {shown.length > limit ? <button type="button" className="link" onClick={() => setLimit(limit + FOLLOW_PAGE)}>عرض المزيد ({formatNumber(shown.length - limit)})</button> : null}
            </>
          ) : null}
        </div>
      )}
    </>
  );
}

/** M274 (owner: «في رسالة توصل مع الاستفتاء مش ظاهرة»): the words the member reads, on the card — three lines, the rest on a tap. */
function BodyText({ post }: { post: Post }) {
  const [full, setFull] = useState(false);
  const text = post.body.trim();
  if (!text) return null;
  const long = text.length > 200 || text.split('\n').length > 3;
  return (
    <div className="post-body">
      <p className={full || !long ? 'prose' : 'prose clamp'} lang="ar" dir="auto">{text}</p>
      {long ? <button type="button" className="link" onClick={() => setFull(!full)}>{full ? 'إخفاء النص' : 'عرض النص كاملًا'}</button> : null}
    </div>
  );
}

/**
 * M251 (owner: «اجباري يوصل لكل الناس على واتس اب»): where the message's WhatsApp notice stands — how many numbers it
 * reached, and by name the ones it has not: still on its way, held back by WhatsApp and being tried again, or refused.
 */
function WhatsappDelivery({ post }: { post: Post }) {
  const { openMember } = useShell();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PostWhatsapp | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showReached, setShowReached] = useState(false);
  if (post.status !== 'published' || post.kind === 'popup') return null;
  const names = new Map<number, string>();
  if (post.audience?.type === 'members') for (const member of post.audience.members) names.set(member.contactId, member.name);
  if (post.audience?.type === 'member') names.set(post.audience.contactId, post.audience.name);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setError(null);
    try {
      setData((await api.postOpens(post.id)).whatsapp ?? null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  /** M269: the member's name (the hub's), else the name the audience carries, else the account number. */
  const labelOf = (row: { to: string; contactId: number | null; name?: string | null }) =>
    row.name || (row.contactId !== null && names.get(row.contactId)) || (row.contactId !== null ? `حساب رقم ${row.contactId}` : `+${row.to}`);
  const reached = data?.reached ?? [];
  const total = data ? data.delivered + data.sent + data.retrying + data.failed : 0;
  const stateText = (row: PostWhatsappRow) =>
    row.state === 'sent'
      ? 'في الطريق، لم يؤكد واتساب وصولها بعد'
      : row.state === 'retrying'
        ? 'حجبها واتساب مؤقتًا عن هذا الرقم، وتُعاد المحاولة تلقائيًا'
        : row.mailed
          ? 'لم تصل على واتساب، فأُرسلت إلى بريده الإلكتروني'
          : 'لم تصل على واتساب';
  return (
    <div className="post-opens">
      <button type="button" className="link" onClick={() => void toggle()} aria-expanded={open}>
        💬 {open ? 'إخفاء حالة واتساب' : 'عرض حالة واتساب'}
      </button>
      {open && error ? <p className="muted">{error}</p> : null}
      {open && !error && data === undefined ? <p className="muted">جارٍ التحميل…</p> : null}
      {open && !error && data !== undefined && total === 0 ? <p className="muted">لا توجد رسائل واتساب مسجلة لهذه الرسالة</p> : null}
      {open && data && total > 0 ? (
        <>
          <p className="muted">
            {[
              `وصلت إلى ${formatNumber(data.delivered)} من ${formatNumber(total)}`,
              data.sent ? `في الطريق: ${formatNumber(data.sent)}` : '',
              data.retrying ? `تُعاد المحاولة: ${formatNumber(data.retrying)}` : '',
              data.failed ? `لم تصل: ${formatNumber(data.failed)}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <ul className="list">
            {data.rows.map((row) => (
              <li key={`${row.to}-${row.at}`}>
                <button type="button" className="list-row" disabled={row.contactId === null} onClick={() => (row.contactId === null ? undefined : openMember(row.contactId))}>
                  <span className="list-main">
                    <strong dir="auto">{labelOf(row)}</strong>
                    <span className="muted">
                      {`${stateText(row)} · ${formatDateTime(row.at)}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {reached.length > 0 ? (
            <>
              <button type="button" className="link" onClick={() => setShowReached(!showReached)} aria-expanded={showReached}>
                ✅ {showReached ? 'إخفاء من وصلتهم الرسالة' : `عرض من وصلتهم الرسالة (${formatNumber(reached.length)})`}
              </button>
              {showReached ? (
                <ul className="list">
                  {reached.map((row) => (
                    <li key={`${row.to}-${row.at}`}>
                      <button type="button" className="list-row" disabled={row.contactId === null} onClick={() => (row.contactId === null ? undefined : openMember(row.contactId))}>
                        <span className="list-main">
                          <strong dir="auto">{labelOf(row)}</strong>
                          <span className="muted">{`وصلت على واتساب · ${formatDateTime(row.at)}`}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** «رسائل الإدارة»: messages and events. Publishing one reaches the app, the websites and the assistant together. */
export function Posts({ onEditing, isAdmin }: { onEditing: (editing: boolean) => void; isAdmin: boolean }) {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.posts(), []);
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  // The saved post replaces its row at once: a second edit must never start from the older copy,
  // because saving that copy would make the server remove the files uploaded in between.
  const [saved, setSaved] = useState<Post[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    onEditing(editing !== null);
    return () => onEditing(false);
  }, [editing, onEditing]);

  // Closing or reloading the tab with the editor open asks first (the browser words the question itself). The
  // listener lives only while the editor does: a page that always has one loses the browser's back-forward cache.
  useEffect(() => {
    if (editing === null) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only when this is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [editing]);

  const devices = state.data?.devices ?? 0;
  const loaded = state.data?.posts ?? [];
  const mine = new Map(saved.map((post) => [post.id, post]));
  const rows = loaded.map((entry) => {
    const own = mine.get(entry.id);
    mine.delete(entry.id);
    return own && own.updatedAt > entry.updatedAt ? own : entry;
  });
  // What is left was saved a moment ago and the list has not brought it yet.
  const posts = [...mine.values(), ...rows];

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  async function remove(post: Post) {
    if (!window.confirm(`حذف المنشور «${post.title}» نهائيًا؟`)) return;
    setBusyId(post.id);
    try {
      await api.deletePost(post.id);
      setSaved((current) => current.filter((entry) => entry.id !== post.id));
      notify('ok', 'تم حذف المنشور.');
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusyId(null);
    }
  }

  /** M269: «إرسال تذكير» — the app's notification and a WhatsApp notice, only to whoever did not open the message yet. */
  async function push(post: Post) {
    const audience = audienceOf(post);
    const target = audience.type === 'all' ? 'جميع الأعضاء' : audience.type === 'persona' ? `فئة ${personaLabel(audience.persona)}${audience.paid ? ` (${paidLabel(audience.paid)})` : ''}` : audience.type === 'paid' ? `كل من حالته «${paidLabel(audience.paid)}»` : audience.type === 'partners' ? 'شركاء النجاح' : audience.type === 'member' ? `العضو ${audience.name || `#${audience.contactId}`}` : `الأعضاء المحددين (${audience.members.length})`;
    const who = post.kind === 'poll' ? 'لمن لم يصوّت بعد' : 'لمن لم يفتح الرسالة بعد';
    const lines = [
      `إرسال تذكير بهذا المنشور إلى ${target}؟`,
      `يذهب التذكير ${who} فقط: إشعار على التطبيق، ورسالة واتساب.`,
      'واتساب: رسالة واحدة في اليوم لكل رقم، ولا يُرسل ليلًا (من 10 مساءً إلى 8 صباحًا).',
    ];
    if (!window.confirm(lines.join('\n'))) return;
    setBusyId(post.id);
    try {
      const result = await api.notifyPost(post.id);
      const app = result.sent > 0 ? `إشعار التطبيق: وصل إلى ${formatNumber(result.sent)} جهاز${result.failed ? `، وفشل ${formatNumber(result.failed)}` : ''}.` : result.failed ? `إشعار التطبيق: لم يصل إلى أي جهاز (فشل ${formatNumber(result.failed)}).` : 'إشعار التطبيق: لا يوجد جهاز يحتاج تذكيرًا.';
      const whatsapp = result.whatsapp === 'started' ? 'واتساب: بدأ الإرسال، وتظهر الأسماء في «عرض حالة واتساب».' : result.whatsapp === 'night' ? 'واتساب: لم يُرسل لأن الوقت ليل، أعد التذكير بعد 8 صباحًا.' : 'واتساب: غير مفعّل على هذا الخادم.';
      notify(result.ok ? 'ok' : 'error', `${app} ${whatsapp}`);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusyId(null);
    }
  }

  if (editing) {
    return (
      <PostEditor
        isAdmin={isAdmin}
        post={editing === 'new' ? null : editing}
        onClose={(post) => {
          setEditing(null);
          if (!post) return;
          setSaved((current) => [post, ...current.filter((entry) => entry.id !== post.id)]);
          notify('ok', post.kind === 'event' ? 'تم حفظ الفعالية.' : post.kind === 'poll' ? 'تم حفظ الاستفتاء.' : post.kind === 'popup' ? 'تم حفظ البوب أب.' : 'تم حفظ رسالة الإدارة.');
          state.reload();
        }}
      />
    );
  }

  return (
    <>
      <SectionHead title="أدوات التواصل" hint={state.data ? `الأجهزة المسجلة للإشعارات: ${formatNumber(devices)}` : undefined} onReload={state.reload} busy={state.loading}>
        <button className="primary" type="button" onClick={() => setEditing('new')}>أداة جديدة</button>
      </SectionHead>
      {state.data && devices === 0 ? <p className="muted">لم يسجّل أي جهاز للإشعارات بعد، فيذهب التذكير على واتساب فقط. يبدأ التسجيل بعد تثبيت نسخة التطبيق التي تدعم الإشعارات وتسجيل الدخول منها.</p> : null}
      <Async state={state} rows={5} empty={() => posts.length === 0} emptyText="لا توجد أدوات تواصل بعد.">
        {() => (
          <ul className="posts">
            {posts.map((post) => (
              <li key={post.id} className="card">
                <div className="row">
                  <h2>{post.pinned ? '📌 ' : ''}{post.title}</h2>
                  <span className="pills">
                    {post.kind === 'event' ? <Pill tone="gold">فعالية</Pill> : null}
                    {post.kind === 'poll' ? <Pill tone="gold">استفتاء</Pill> : null}
                    {post.kind === 'popup' ? <Pill tone="gold">بوب أب</Pill> : null}
                    {(post.kind ?? 'post') === 'post' ? <Pill tone="muted">رسالة الإدارة</Pill> : null}
                    <AudiencePill post={post} />
                    <span className={post.status === 'published' ? 'badge on' : 'badge'}>{post.status === 'published' ? 'منشور' : 'مسودة'}</span>
                  </span>
                </div>
                {post.kind === 'event' && post.event ? <p className="event-line">{formatEventDate(post.event.date)}{post.event.place ? ` · ${post.event.place}` : ''}{post.event.onlineUrl ? ' · حضور عن بُعد' : ''}</p> : null}
                <p className="muted">
                  {post.status === 'published' ? `نُشر: ${formatDateTime(post.publishedAt)}` : `آخر تعديل: ${formatDateTime(post.updatedAt)}`}
                  {post.kind === 'popup' ? ` · ${post.popup?.until ? `يظهر حتى ${formatEventDate(post.popup.until)}` : 'يظهر حتى إلغاء نشره'}` : ''}
                  {post.notifiedAt ? ` · إشعار: ${formatDateTime(post.notifiedAt)}` : ''}
                  {post.images.length > 0 ? ` · صور: ${post.images.length}` : ''}
                  {post.video ? ' · فيديو مرفوع' : ''}
                </p>
                <BodyText post={post} />
                <HubSync post={post} />
                <Tracking post={post} isAdmin={isAdmin} />
                {isAdmin ? <WhatsappDelivery post={post} /> : null}
                <div className="actions">
                  <button type="button" onClick={() => setEditing(post)} disabled={busyId === post.id}>تعديل</button>
                  {post.kind === 'popup' ? null : <button type="button" onClick={() => void push(post)} disabled={busyId === post.id || post.status !== 'published'}>إرسال تذكير</button>}
                  <button className="danger" type="button" onClick={() => void remove(post)} disabled={busyId === post.id}>حذف</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </>
  );
}
