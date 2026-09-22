import { useEffect, useState } from 'react';

import { api, type Post, type PostAudience } from '../api';
import { formatDateTime, formatEventDate, formatNumber } from '../format';
import { personaLabel, PostEditor } from '../PostEditor';
import { Async, messageOf, Pill, SectionHead, sessionOver, useLoad, useShell } from '../ui';

const audienceOf = (post: Post): PostAudience => post.audience ?? { type: 'all' };

/** M29: who the message is for, named on its row. Nothing shows for a public post. */
function AudiencePill({ post }: { post: Post }) {
  const audience = audienceOf(post);
  if (audience.type === 'all') return null;
  if (audience.type === 'persona') return <Pill tone="gold">لفئة {personaLabel(audience.persona)}</Pill>;
  return <Pill tone="gold">لعضو: {audience.name || `#${audience.contactId}`}</Pill>;
}

/** How the hand-over to the hub went: the websites' feed and the assistant hear a published post through it. */
function HubSync({ post }: { post: Post }) {
  const sync = post.hubSync;
  if (post.status !== 'published') return null;
  // A targeted message is private: it never travels to the websites or the assistant.
  if (audienceOf(post).type !== 'all') return <Pill tone="muted">داخل التطبيق فقط</Pill>;
  if (!sync) return null;
  if (sync.state === 'ok') return <Pill tone="ok">وصل للمواقع والمستشار</Pill>;
  if (sync.state === 'unsupported') return <Pill tone="muted">المواقع تحتاج إضافة الهب 2.7.0</Pill>;
  return <Pill tone="danger">لم يصل للمواقع بعد · يُعاد عند التعديل التالي</Pill>;
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

  async function push(post: Post) {
    const again = post.notifiedAt ? ' سبق إرسال إشعار لهذا المنشور.' : '';
    const audience = audienceOf(post);
    const target = audience.type === 'all' ? `إلى ${devices} جهاز` : audience.type === 'persona' ? `إلى أجهزة فئة ${personaLabel(audience.persona)}` : `إلى أجهزة العضو ${audience.name || `#${audience.contactId}`}`;
    if (!window.confirm(`إرسال إشعار بهذا المنشور ${target}؟${again}`)) return;
    setBusyId(post.id);
    try {
      const result = await api.notifyPost(post.id);
      if (result.sent > 0) notify(result.failed ? 'error' : 'ok', `أُرسل الإشعار إلى ${result.sent} جهاز، وفشل ${result.failed}.`);
      else notify('error', `لم يصل الإشعار إلى أي جهاز (فشل ${result.failed}). لم يُسجَّل كإشعار مُرسل.`);
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
          notify('ok', post.kind === 'event' ? 'تم حفظ الفعالية.' : 'تم حفظ المنشور.');
          state.reload();
        }}
      />
    );
  }

  return (
    <>
      <SectionHead title="المنشورات" hint={state.data ? `الأجهزة المسجلة للإشعارات: ${formatNumber(devices)}` : undefined} onReload={state.reload} busy={state.loading}>
        <button className="primary" type="button" onClick={() => setEditing('new')}>منشور جديد</button>
      </SectionHead>
      {state.data && devices === 0 ? <p className="muted">زر «إرسال إشعار» متوقف الآن لأن أي جهاز لم يسجّل بعد. يبدأ التسجيل بعد تثبيت نسخة التطبيق التي تدعم الإشعارات وتسجيل الدخول منها.</p> : null}
      <Async state={state} rows={5} empty={() => posts.length === 0} emptyText="لا توجد منشورات بعد.">
        {() => (
          <ul className="posts">
            {posts.map((post) => (
              <li key={post.id} className="card">
                <div className="row">
                  <h2>{post.pinned ? '📌 ' : ''}{post.title}</h2>
                  <span className="pills">
                    {post.kind === 'event' ? <Pill tone="gold">فعالية</Pill> : null}
                    <AudiencePill post={post} />
                    <span className={post.status === 'published' ? 'badge on' : 'badge'}>{post.status === 'published' ? 'منشور' : 'مسودة'}</span>
                  </span>
                </div>
                {post.kind === 'event' && post.event ? <p className="event-line">{formatEventDate(post.event.date)}{post.event.place ? ` · ${post.event.place}` : ''}{post.event.onlineUrl ? ' · حضور عن بُعد' : ''}</p> : null}
                <p className="muted">
                  {post.status === 'published' ? `نُشر: ${formatDateTime(post.publishedAt)}` : `آخر تعديل: ${formatDateTime(post.updatedAt)}`}
                  {post.notifiedAt ? ` · إشعار: ${formatDateTime(post.notifiedAt)}` : ''}
                  {post.images.length > 0 ? ` · صور: ${post.images.length}` : ''}
                  {post.video ? ' · فيديو مرفوع' : ''}
                </p>
                <HubSync post={post} />
                <div className="actions">
                  <button type="button" onClick={() => setEditing(post)} disabled={busyId === post.id}>تعديل</button>
                  <button type="button" onClick={() => void push(post)} disabled={busyId === post.id || post.status !== 'published' || devices === 0}>إرسال إشعار</button>
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
