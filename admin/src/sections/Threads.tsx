import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';

import { api, ApiError, newRequestId } from '../api';
import { formatDateTime, formatNumber, formatRelative } from '../format';
import type { Account, Thread, ThreadFilter, ThreadMessage } from '../types';
import { AsyncPage, Boundary, Broken, Chips, ErrorCard, Icon, Intent, MemberLink, messageOf, Pill, SearchBox, SectionHead, sessionOver, Skeleton, useDebounced, useLoad, useShell } from '../ui';
import { StatePill } from './Members';

const PER_PAGE = 25;
const LIST_EVERY_MS = 30_000;
const THREAD_EVERY_MS = 20_000;
const FILTERS: { value: ThreadFilter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'waiting', label: 'بانتظار رد' },
  { value: 'human', label: 'مع الفريق' },
  { value: 'unread', label: 'غير مقروءة' },
];
const ROLES: Record<string, string> = { user: 'الزائر', assistant: 'المستشار', human: 'فريق النادي' };

/** Runs while the tab is in front; a hidden tab asks the hub for nothing. */
function useEvery(run: () => void, ms: number) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const timer = window.setInterval(() => (document.visibilityState === 'visible' ? latest.current() : undefined), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
}

function ThreadRow({ thread, open, onOpen }: { thread: Thread; open: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className={open ? 'thread-row on' : 'thread-row'} aria-current={open ? 'true' : undefined} onClick={onOpen}>
        <span className="member-top">
          <strong>{thread.name || thread.phone || `زائر رقم ${thread.contact_id}`}</strong>
          <span className="muted hint">{formatRelative(thread.last_at)}</span>
        </span>
        <span className="thread-last">{thread.last_role === 'user' ? '' : `${ROLES[thread.last_role] ?? thread.last_role}: `}{thread.last_text}</span>
        <span className="pills">
          {thread.unread > 0 ? <Pill tone="gold">{formatNumber(thread.unread)} جديدة</Pill> : null}
          {thread.waiting ? <Pill tone="danger">بانتظار رد</Pill> : null}
          {thread.human ? <Pill tone="ok">مع الفريق</Pill> : null}
          {thread.is_member ? <Pill tone="gold">عضو</Pill> : null}
          <span className="muted hint">{thread.site}</span>
        </span>
      </button>
    </li>
  );
}

/** A page address the visitor wrote from, shown without its scheme; only http(s) links are clickable. */
function PageLink({ url }: { url: string }) {
  if (!/^https?:\/\//i.test(url)) return url ? <bdi dir="ltr" className="muted hint">{url}</bdi> : null;
  return <a className="muted hint" dir="ltr" href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https?:\/\//i, '')}</a>;
}

type Detail = { account: Account; messages: ThreadMessage[]; hasMore: boolean };

/** One conversation, oldest first, with the box that answers it as the club's team. */
function ThreadView({ contactId, onBack, onReplied }: { contactId: number; onBack: () => void; onReplied: () => void }) {
  const { signOut, notify } = useShell();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [older, setOlder] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // The same text sent again after a lost answer keeps its id, so the hub never gets the reply twice.
  const pending = useRef<{ text: string; id: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const alive = useRef(contactId);
  alive.current = contactId;

  const fail = useCallback(
    (failure: unknown) => {
      if (sessionOver(failure)) signOut();
      setError(failure instanceof ApiError ? failure : new ApiError(messageOf(failure), 0, 'error'));
    },
    [signOut],
  );

  const load = useCallback(
    async (mode: 'fresh' | 'poll') => {
      try {
        const result = await api.thread(contactId);
        if (alive.current !== contactId) return;
        setError(null);
        setDetail((current) => {
          if (mode === 'fresh' || !current) return { account: result.account, messages: result.messages, hasMore: result.has_more };
          const known = new Set(current.messages.map((message) => message.id));
          return { ...current, account: result.account, messages: [...current.messages, ...result.messages.filter((message) => !known.has(message.id))] };
        });
      } catch (failure) {
        // A failed background refresh keeps what is on screen.
        if (mode === 'fresh' && alive.current === contactId) fail(failure);
      }
    },
    [contactId, fail],
  );

  useEffect(() => {
    setDetail(null);
    setError(null);
    setText('');
    setSendError(null);
    stick.current = true;
    void load('fresh');
  }, [load]);
  useEvery(() => void load('poll'), THREAD_EVERY_MS);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [detail?.messages.length]);

  async function loadOlder() {
    const first = detail?.messages[0];
    if (!first) return;
    setOlder(true);
    stick.current = false;
    try {
      const result = await api.thread(contactId, first.id);
      if (alive.current !== contactId) return;
      setDetail((current) => (current ? { ...current, messages: [...result.messages, ...current.messages], hasMore: result.has_more } : current));
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setOlder(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (pending.current?.text !== body) pending.current = { text: body, id: newRequestId() };
    setSending(true);
    setSendError(null);
    try {
      await api.reply(contactId, body, pending.current.id);
      pending.current = null;
      setText('');
      stick.current = true;
      await load('poll');
      onReplied();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      setSendError(messageOf(failure));
    } finally {
      setSending(false);
    }
  }

  const name = detail ? detail.account.name || detail.account.phone || `زائر رقم ${contactId}` : 'المحادثة';
  return (
    <section className="thread card" aria-label={`محادثة ${name}`}>
      <header className="thread-head">
        <button className="icon-button thread-back" type="button" onClick={onBack} aria-label="رجوع إلى المحادثات">
          <Icon name="back" size={18} />
        </button>
        <div className="list-main">
          {detail ? <MemberLink id={detail.account.id} name={name} /> : <strong>{name}</strong>}
          {detail ? <span className="pills"><StatePill account={detail.account} /><Intent score={detail.account.intent} label={detail.account.intent_label} /></span> : null}
        </div>
      </header>
      {error ? <ErrorCard error={error} onRetry={() => void load('fresh')} /> : null}
      {!detail && !error ? <Skeleton rows={5} /> : null}
      {detail ? (
        <>
          <div
            className="messages"
            ref={scroller}
            tabIndex={0}
            role="log"
            aria-label="الرسائل"
            onScroll={(event) => {
              const node = event.currentTarget;
              stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            }}
          >
            {detail.hasMore ? <button className="link" type="button" disabled={older} onClick={() => void loadOlder()}>{older ? 'جارٍ التحميل…' : 'رسائل أقدم'}</button> : null}
            {detail.messages.length === 0 ? <p className="muted">لا توجد رسائل في هذه المحادثة.</p> : null}
            {detail.messages.map((message) => (
              <article key={message.id} className={`bubble ${message.role === 'user' ? 'user' : message.role === 'human' ? 'human' : 'assistant'}`}>
                <span className="bubble-by">{message.role === 'human' && message.by ? message.by : ROLES[message.role] ?? message.role}</span>
                <p dir="auto">{message.content}</p>
                <span className="bubble-meta">
                  <span className="muted hint">{formatDateTime(message.at)}</span>
                  {message.role === 'user' ? <PageLink url={message.page_url} /> : null}
                </span>
              </article>
            ))}
          </div>
          <form className="reply" onSubmit={(event) => void send(event)}>
            <label>
              <span className="sr-only">ردّ فريق النادي</span>
              <textarea rows={2} maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} placeholder="اكتب ردّك: يصل باسمك إلى الموقع والتطبيق" disabled={sending} />
            </label>
            {sendError ? <p className="error" role="alert">{sendError}</p> : null}
            <div className="row">
              <span className="muted hint">يظهر الرد للزائر موقّعًا باسمك، ويُحفظ في سجل الإجراءات.</span>
              <button className="primary" type="submit" disabled={sending || !text.trim()}>{sending ? 'جارٍ الإرسال…' : 'إرسال الرد'}</button>
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}

/** The adviser's conversations from every site and the app: who waits for a person, and the reply box. The shell owns the address, so opening and closing one are its calls. */
export function Threads({ openId, onOpen, onClose }: { openId: number | null; onOpen: (contactId: number) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const [page, setPage] = useState(1);
  const q = useDebounced(text.trim());
  const state = useLoad(() => api.threads({ q, filter, page, perPage: PER_PAGE }), [q, filter, page]);
  useEffect(() => setPage(1), [q, filter]);
  useEvery(state.reload, LIST_EVERY_MS);

  return (
    <>
      <SectionHead title="المحادثات" hint={state.data ? `عدد المحادثات: ${formatNumber(state.data.total)}` : undefined} onReload={state.reload} busy={state.loading} />
      <div className={openId ? 'split open' : 'split'}>
        <div className="split-list">
          <div className="filters">
            <SearchBox value={text} onChange={setText} placeholder="ابحث بالاسم أو الجوال" />
            <Chips label="تصفية المحادثات" options={FILTERS} value={filter} onChange={setFilter} />
          </div>
          <AsyncPage state={state} onPage={setPage} rows={8} emptyText={q || filter !== 'all' ? 'لا توجد محادثات تطابق هذا العرض.' : 'لا توجد محادثات بعد.'}>
            {(data) => (
              <ul className="member-list">
                {data.items.map((thread) => <ThreadRow key={thread.contact_id} thread={thread} open={thread.contact_id === openId} onOpen={() => onOpen(thread.contact_id)} />)}
              </ul>
            )}
          </AsyncPage>
        </div>
        <div className="split-view">
          {openId ? (
            // One conversation that cannot be drawn leaves the list alive; on a phone the list is hidden behind it, so the card brings its own way back.
            <Boundary
              key={openId}
              fallback={(retry) => (
                <div className="stack">
                  <Broken onRetry={retry} />
                  <button className="thread-back" type="button" onClick={onClose}>رجوع إلى المحادثات</button>
                </div>
              )}
            >
              <ThreadView contactId={openId} onBack={onClose} onReplied={state.reload} />
            </Boundary>
          ) : (
            <p className="state-card empty split-hint">اختر محادثة لعرضها والرد عليها.</p>
          )}
        </div>
      </div>
    </>
  );
}
