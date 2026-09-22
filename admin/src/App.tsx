import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, session, type Me } from './api';
import { Login } from './Login';
import { Home } from './sections/Home';
import { Audit, CardRequests, Invites, Leads, Mail, Tickets } from './sections/Lists';
import { Members } from './sections/Members';
import { MemberSheet } from './sections/MemberSheet';
import { Payments } from './sections/Payments';
import { Posts } from './sections/Posts';
import { Threads } from './sections/Threads';
import { Content } from './sections/Content';
import { News } from './sections/News';
import { Stats } from './sections/Stats';
import { Wording } from './sections/Wording';
import type { AccountFilter } from './types';
import { Boundary, Broken, Icon, ShellContext, Sheet, type IconName, type SectionKey, type Shell } from './ui';

const SECTIONS: { key: SectionKey; label: string; icon: IconName }[] = [
  { key: 'home', label: 'الرئيسية', icon: 'home' },
  { key: 'stats', label: 'الإحصائيات', icon: 'stats' },
  { key: 'members', label: 'الأعضاء', icon: 'members' },
  { key: 'payments', label: 'المدفوعات', icon: 'payments' },
  { key: 'cards', label: 'طلبات الكروت', icon: 'cards' },
  { key: 'invites', label: 'الدعوات', icon: 'invites' },
  { key: 'tickets', label: 'التذاكر', icon: 'tickets' },
  { key: 'leads', label: 'العملاء المحتملون', icon: 'leads' },
  { key: 'threads', label: 'المحادثات', icon: 'threads' },
  { key: 'mail', label: 'البريد', icon: 'mail' },
  { key: 'audit', label: 'سجل الإجراءات', icon: 'audit' },
  { key: 'posts', label: 'المنشورات', icon: 'posts' },
  { key: 'wording', label: 'نصوص التطبيق', icon: 'wording' },
  { key: 'content', label: 'محتوى التطبيق', icon: 'content' },
  { key: 'news', label: 'مصادر الأخبار', icon: 'news' },
];
/** A phone's bar holds four sections and «المزيد»; a desk's rail lists them all. */
const BAR: SectionKey[] = ['home', 'members', 'payments', 'threads'];
const LEAVE_EDITOR = 'لم تحفظ المنشور بعد. هل تترك الصفحة وتفقد ما كتبته؟';
const NOTICE_MS = 6000;

/** `#threads/45@12`: the section, the open conversation, and the member whose sheet is up. The phone's back button walks them. */
type Route = { section: SectionKey; thread: number | null; member: number | null };

function readRoute(): Route {
  const match = /^#?([a-z]+)(?:\/(\d+))?(?:@(\d+))?$/.exec(window.location.hash);
  const section = SECTIONS.find((entry) => entry.key === match?.[1])?.key ?? 'home';
  return { section, thread: section === 'threads' && match?.[2] ? Number(match[2]) : null, member: match?.[3] ? Number(match[3]) : null };
}

const toHash = (route: Route) => `#${route.section}${route.thread ? `/${route.thread}` : ''}${route.member ? `@${route.member}` : ''}`;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  const [route, setRoute] = useState<Route>(readRoute);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [more, setMore] = useState(false);
  const [memberFilter, setMemberFilter] = useState<{ state: AccountFilter; turn: number }>({ state: 'all', turn: 0 });
  const [stamp, setStamp] = useState(0);
  const editing = useRef(false);
  // The route on screen. After the phone's back button the address has already moved on; this has not.
  const shown = useRef(route);
  shown.current = route;
  // True when the sheet was opened from inside the page: closing it then steps back instead of piling history up.
  const pushedMember = useRef(false);
  // The same for a conversation opened from its list.
  const pushedThread = useRef(false);

  const signOut = useCallback(() => {
    session.set(null);
    setMe(null);
  }, []);

  useEffect(() => {
    if (!session.get()) return;
    api
      .me()
      .then((result) => (result.me.isAdmin || result.me.isModerator ? setMe(result.me) : signOut()))
      .catch(() => signOut())
      .finally(() => setChecking(false));
  }, [signOut]);

  /** Leaving the posts section with the editor open drops the draft and its uploads: whoever asks to leave, the owner is asked once. */
  const mayLeave = useCallback((next: Route): boolean => {
    if (!editing.current || next.section === shown.current.section) return true;
    if (!window.confirm(LEAVE_EDITOR)) return false;
    editing.current = false;
    return true;
  }, []);

  useEffect(() => {
    const onHash = () => {
      const next = readRoute();
      if (!mayLeave(next)) {
        // The back button has moved the address already: the editor's own address goes back on top, and nothing on screen changes.
        window.history.pushState(null, '', toHash(shown.current));
        return;
      }
      if (!next.member) pushedMember.current = false;
      if (!next.thread) pushedThread.current = false;
      shown.current = next;
      setRoute(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [mayLeave]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // A section opens at its top; without this the page keeps the scroll position of the section before it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.section]);

  /** Moves to another address. False when nothing was pushed: the owner stayed in the editor, or is there already. */
  const go = useCallback(
    (next: Route): boolean => {
      if (!mayLeave(next)) return false;
      setMore(false);
      if (toHash(next) === toHash(readRoute())) return false;
      window.location.hash = toHash(next);
      return true;
    },
    [mayLeave],
  );

  /** Closes what was opened over a page: one step back when the page itself pushed it, else the address is rewritten in place. */
  const stepBack = useCallback((pushed: { current: boolean }, to: Route) => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(null, '', toHash(to));
    shown.current = to;
    setRoute(to);
  }, []);
  const closeMember = useCallback(() => stepBack(pushedMember, { ...readRoute(), member: null }), [stepBack]);
  const closeThread = useCallback(() => stepBack(pushedThread, { section: 'threads', thread: null, member: null }), [stepBack]);

  /** A conversation picked from the list. Beside an open one (a desk shows both) it takes that one's place, so back always leads to the list. */
  const pickThread = useCallback(
    (contactId: number) => {
      const next: Route = { section: 'threads', thread: contactId, member: null };
      if (shown.current.section !== 'threads' || !shown.current.thread) {
        if (go(next)) pushedThread.current = true;
        return;
      }
      if (shown.current.thread === contactId) return;
      window.history.replaceState(null, '', toHash(next));
      shown.current = next;
      setRoute(next);
    },
    [go],
  );

  const shell = useMemo<Shell>(
    () => ({
      signOut,
      notify: (kind, text) => setNotice({ kind, text }),
      openMember: (contactId) => {
        if (go({ ...readRoute(), member: contactId })) pushedMember.current = true;
      },
      openMembers: (state) => {
        setMemberFilter((current) => ({ state, turn: current.turn + 1 }));
        go({ section: 'members', thread: null, member: null });
      },
      openSection: (section) => go({ section, thread: null, member: null }),
      openThread: (contactId) => {
        // The sheet was opened from this very conversation: closing it is the whole way back.
        if (shown.current.section === 'threads' && shown.current.thread === contactId && shown.current.member) return closeMember();
        if (!go({ section: 'threads', thread: contactId, member: null })) return;
        // Reached from a member's sheet, not from the list: the arrow in the conversation then rewrites the address instead of stepping back into the sheet.
        pushedMember.current = false;
        pushedThread.current = false;
      },
    }),
    [signOut, go, closeMember],
  );

  const onEditing = useCallback((value: boolean) => {
    editing.current = value;
  }, []);

  if (checking) return <main className="login"><p className="muted">جارٍ التحميل…</p></main>;
  if (!me) return <Login onSignedIn={setMe} />;

  // M28: a moderator's dashboard is the posts section alone; any other address lands there too.
  const sections = me.isAdmin ? SECTIONS : SECTIONS.filter((entry) => entry.key === 'posts');
  const bar = me.isAdmin ? BAR : sections.map((entry) => entry.key);
  const section = me.isAdmin || route.section === 'posts' ? route.section : 'posts';
  const inBar = bar.includes(section);
  const navButton = (entry: (typeof SECTIONS)[number]) => (
    <button key={entry.key} type="button" className={entry.key === section ? 'nav-item on' : 'nav-item'} aria-current={entry.key === section ? 'page' : undefined} onClick={() => shell.openSection(entry.key)}>
      <Icon name={entry.icon} />
      <span>{entry.label}</span>
    </button>
  );
  const logout = () => void api.logout().catch(() => undefined).finally(signOut);

  return (
    <ShellContext.Provider value={shell}>
      <div className="app">
        <aside className="rail">
          <div className="brand">
            <strong>نادي المستثمرين</strong>
            <span>لوحة الإدارة</span>
          </div>
          <nav className="rail-nav" aria-label="أقسام اللوحة">{sections.map(navButton)}</nav>
          <div className="rail-foot">
            <span className="muted">{me.name || me.email}{me.isAdmin ? '' : ' — موديريتور'}</span>
            <button className="link" type="button" onClick={logout}>خروج</button>
          </div>
        </aside>

        <header className="topbar">
          <div className="brand">
            <strong>نادي المستثمرين</strong>
            <span>لوحة الإدارة</span>
          </div>
          <span className="muted topbar-name">{me.name}</span>
          <button className="icon-button" type="button" onClick={logout} aria-label="خروج">
            <Icon name="logout" size={18} />
          </button>
        </header>

        <main className="main">
          {notice ? (
            <p className={`toast ${notice.kind}`} role="status">
              <span>{notice.text}</span>
              <button className="icon-button" type="button" onClick={() => setNotice(null)} aria-label="إخفاء">
                <Icon name="close" size={14} />
              </button>
            </p>
          ) : null}
          {/* A section that throws while drawing shows a card in its place: the bars around it keep working, and another address tries again. */}
          <Boundary key={section} watch={route.thread}>
            {section === 'home' ? <Home /> : null}
            {section === 'stats' ? <Stats /> : null}
            {section === 'members' ? <Members key={memberFilter.turn} initial={memberFilter.state} stamp={stamp} /> : null}
            {section === 'payments' ? <Payments /> : null}
            {section === 'cards' ? <CardRequests /> : null}
            {section === 'invites' ? <Invites /> : null}
            {section === 'tickets' ? <Tickets /> : null}
            {section === 'leads' ? <Leads /> : null}
            {section === 'threads' ? <Threads openId={route.thread} onOpen={pickThread} onClose={closeThread} /> : null}
            {section === 'mail' ? <Mail /> : null}
            {section === 'audit' ? <Audit /> : null}
            {section === 'posts' ? <Posts onEditing={onEditing} isAdmin={me.isAdmin} /> : null}
            {section === 'wording' ? <Wording /> : null}
            {section === 'content' ? <Content /> : null}
            {section === 'news' ? <News /> : null}
          </Boundary>
        </main>

        <nav className="tabbar" aria-label="أقسام اللوحة">
          {sections.filter((entry) => bar.includes(entry.key)).map(navButton)}
          {sections.length > bar.length ? (
            <button type="button" className={!inBar || more ? 'nav-item on' : 'nav-item'} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
              <Icon name="more" />
              <span>المزيد</span>
            </button>
          ) : null}
        </nav>

        {more ? (
          <Sheet title="كل الأقسام" onClose={() => setMore(false)}>
            <nav className="more-nav" aria-label="باقي الأقسام">{sections.filter((entry) => !bar.includes(entry.key)).map(navButton)}</nav>
          </Sheet>
        ) : null}

        {me.isAdmin && route.member ? (
          <Boundary key={route.member} fallback={(retry) => <Sheet title="بيانات الحساب" onClose={closeMember}><Broken onRetry={retry} /></Sheet>}>
            <MemberSheet contactId={route.member} onClose={closeMember} onChanged={() => setStamp((value) => value + 1)} />
          </Boundary>
        ) : null}
      </div>
    </ShellContext.Provider>
  );
}
