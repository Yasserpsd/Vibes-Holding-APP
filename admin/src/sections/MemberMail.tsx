import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';

import { api, type ContactThreadSummary } from '../api';
import { formatDateTime, formatNumber, formatRelative } from '../format';
import { Async, Boundary, Broken, Icon, MemberLink, messageOf, Pill, SearchBox, SectionHead, sessionOver, Skeleton, useDebounced, useLoad, useShell } from '../ui';

const LIST_EVERY_MS = 30_000;
const THREAD_EVERY_MS = 20_000;

/** Runs while the tab is in front; a hidden tab asks the server for nothing. */
function useEvery(run: () => void, ms: number) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const timer = window.setInterval(() => (document.visibilityState === 'visible' ? latest.current() : undefined), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
}

function ThreadRow({ row, open, onOpen }: { row: ContactThreadSummary; open: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className={open ? 'thread-row on' : 'thread-row'} aria-current={open ? 'true' : undefined} onClick={onOpen}>
        <span className="member-top">
          <strong>{row.name || `عضو رقم ${row.contactId}`}</strong>
          <span className="muted hint">{formatRelative(row.updatedAt)}</span>
        </span>
        <span className="thread-last">{row.lastFrom === 'admin' ? 'الإدارة: ' : ''}{row.lastText}</span>
        <span className="pills">
          {row.unread > 0 ? <Pill tone="gold">{formatNumber(row.unread)} بانتظار الرد</Pill> : <Pill tone="ok">تم الرد</Pill>}
          {row.personaLabel ? <Pill tone="muted">{row.personaLabel}</Pill> : null}
          <bdi dir="ltr" className="muted hint">{row.cardNumber}</bdi>
        </span>
      </button>
    </li>
  );
}

/** One member's thread, oldest first, with the management's reply box. */
function ContactThreadView({ contactId, onBack, onChanged }: { contactId: number; onBack: () => void; onChanged: () => void }) {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.contactThread(contactId), [contactId]);
  useEvery(state.reload, THREAD_EVERY_MS);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    setText('');
    setSendError(null);
    stick.current = true;
  }, [contactId]);

  const thread = state.data?.thread;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [thread?.messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api.contactReply(contactId, body);
      setText('');
      stick.current = true;
      notify('ok', 'وصل الرد إلى العضو في التطبيق مع إشعار.');
      state.reload();
      onChanged();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      setSendError(messageOf(failure));
    } finally {
      setSending(false);
    }
  }

  const name = thread ? thread.name || `عضو رقم ${contactId}` : 'المحادثة';
  return (
    <section className="thread card" aria-label={`رسائل ${name}`}>
      <header className="thread-head">
        <button className="icon-button thread-back" type="button" onClick={onBack} aria-label="رجوع إلى رسائل الأعضاء">
          <Icon name="back" size={18} />
        </button>
        <div className="list-main">
          {thread ? <MemberLink id={thread.contactId} name={name} /> : <strong>{name}</strong>}
          {thread ? (
            <span className="pills">
              {thread.personaLabel ? <Pill tone="muted">{thread.personaLabel}</Pill> : null}
              <bdi dir="ltr" className="muted hint">{thread.cardNumber}</bdi>
            </span>
          ) : null}
        </div>
      </header>
      {!thread ? <Skeleton rows={5} /> : null}
      {thread ? (
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
            {thread.messages.length === 0 ? <p className="muted">لا توجد رسائل في هذه المحادثة.</p> : null}
            {thread.messages.map((message) => (
              <article key={message.id} className={`bubble ${message.from === 'member' ? 'user' : 'human'}`}>
                <span className="bubble-by">{message.from === 'member' ? name : message.by || 'الإدارة'}</span>
                <p dir="auto">{message.text}</p>
                <span className="bubble-meta">
                  <span className="muted hint">{formatDateTime(message.at)}</span>
                </span>
              </article>
            ))}
          </div>
          <form className="reply" onSubmit={(event) => void send(event)}>
            <label>
              <span className="sr-only">ردّ الإدارة</span>
              <textarea rows={2} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder="اكتب رد الإدارة: يصل للعضو داخل التطبيق مع إشعار" disabled={sending} />
            </label>
            {sendError ? <p className="error" role="alert">{sendError}</p> : null}
            <div className="row">
              <span className="muted hint">يظهر الرد للعضو موقّعًا باسمك.</span>
              <button className="primary" type="submit" disabled={sending || !text.trim()}>{sending ? 'جارٍ الإرسال…' : 'إرسال الرد'}</button>
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}

/** M36: «رسائل الأعضاء» — every member with an active membership can write to the management from the app. */
export function MemberMail() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const state = useLoad(() => api.contactThreads(), []);
  useEvery(state.reload, LIST_EVERY_MS);

  const threads = state.data?.threads ?? [];
  const rows = q ? threads.filter((row) => row.name.includes(q) || row.cardNumber.includes(q)) : threads;
  const waiting = threads.filter((row) => row.unread > 0).length;

  return (
    <>
      <SectionHead title="رسائل الأعضاء" hint={state.data ? `بانتظار الرد: ${formatNumber(waiting)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">«راسل الإدارة» في التطبيق: متاح لأصحاب العضوية السنوية الفعّالة فقط. ردّك يصل للعضو داخل التطبيق مع إشعار على جهازه.</p>
      <div className={openId ? 'split open' : 'split'}>
        <div className="split-list">
          <div className="filters">
            <SearchBox value={search} onChange={setSearch} placeholder="ابحث بالاسم أو رقم العضوية" />
          </div>
          <Async state={state} rows={6} empty={() => rows.length === 0} emptyText={q ? 'لا توجد رسائل تطابق هذا البحث.' : 'لا توجد رسائل من الأعضاء بعد.'}>
            {() => (
              <ul className="member-list">
                {rows.map((row) => <ThreadRow key={row.contactId} row={row} open={row.contactId === openId} onOpen={() => setOpenId(row.contactId)} />)}
              </ul>
            )}
          </Async>
        </div>
        <div className="split-view">
          {openId ? (
            <Boundary
              key={openId}
              fallback={(retry) => (
                <div className="stack">
                  <Broken onRetry={retry} />
                  <button className="thread-back" type="button" onClick={() => setOpenId(null)}>رجوع إلى رسائل الأعضاء</button>
                </div>
              )}
            >
              <ContactThreadView contactId={openId} onBack={() => setOpenId(null)} onChanged={state.reload} />
            </Boundary>
          ) : (
            <p className="state-card empty split-hint">اختر محادثة لعرضها والرد عليها.</p>
          )}
        </div>
      </div>
    </>
  );
}
