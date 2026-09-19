import { useCallback, useEffect, useState } from 'react';

import { api, ApiError, session, type Me, type Post } from './api';
import { Login } from './Login';
import { PostEditor } from './PostEditor';

const dateFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const when = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : 'غير محدد');

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(Boolean(session.get()));
  const [posts, setPosts] = useState<Post[]>([]);
  const [devices, setDevices] = useState(0);
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const signOut = useCallback(() => {
    session.set(null);
    setMe(null);
    setPosts([]);
  }, []);

  const fail = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) signOut();
      setNotice({ kind: 'error', text: failure instanceof ApiError ? failure.message : 'حدث خطأ غير متوقع' });
    },
    [signOut],
  );

  const load = useCallback(async () => {
    try {
      const result = await api.posts();
      setPosts(result.posts);
      setDevices(result.devices);
    } catch (failure) {
      fail(failure);
    }
  }, [fail]);

  useEffect(() => {
    if (!session.get()) return;
    api
      .me()
      .then((result) => (result.me.isAdmin ? setMe(result.me) : signOut()))
      .catch(() => signOut())
      .finally(() => setChecking(false));
  }, [signOut]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  async function remove(post: Post) {
    if (!window.confirm(`حذف المنشور «${post.title}» نهائيًا؟`)) return;
    setBusyId(post.id);
    try {
      await api.deletePost(post.id);
      setNotice({ kind: 'ok', text: 'تم حذف المنشور.' });
      await load();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusyId(null);
    }
  }

  async function notify(post: Post) {
    const again = post.notifiedAt ? ' سبق إرسال إشعار لهذا المنشور.' : '';
    if (!window.confirm(`إرسال إشعار بهذا المنشور إلى ${devices} جهاز؟${again}`)) return;
    setBusyId(post.id);
    try {
      const result = await api.notifyPost(post.id);
      setNotice(
        result.sent > 0
          ? { kind: result.failed ? 'error' : 'ok', text: `أُرسل الإشعار إلى ${result.sent} جهاز، وفشل ${result.failed}.` }
          : { kind: 'error', text: `لم يصل الإشعار إلى أي جهاز (فشل ${result.failed}). لم يُسجَّل كإشعار مُرسل.` },
      );
      await load();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusyId(null);
    }
  }

  if (checking) return <main className="login"><p className="muted">جارٍ التحميل…</p></main>;
  if (!me) return <Login onSignedIn={setMe} />;
  if (editing) {
    return (
      <PostEditor
        post={editing === 'new' ? null : editing}
        onClose={(saved) => {
          setEditing(null);
          if (saved) {
            setNotice({ kind: 'ok', text: 'تم حفظ المنشور.' });
            void load();
          }
        }}
      />
    );
  }

  return (
    <div className="shell">
      <header className="top">
        <strong>لوحة إدارة نادي المستثمرين</strong>
        <span className="muted">{me.name}</span>
        <button className="link" type="button" onClick={() => void api.logout().catch(() => undefined).finally(signOut)}>
          خروج
        </button>
      </header>
      <main className="page">
        <div className="row">
          <h1>رسائل الإدارة</h1>
          <button className="primary" type="button" onClick={() => setEditing('new')}>منشور جديد</button>
        </div>
        <p className="muted">الأجهزة المسجلة للإشعارات: {devices}</p>
        {devices === 0 ? <p className="muted">زر «إرسال إشعار» متوقف الآن لأن أي جهاز لم يسجّل بعد. يبدأ التسجيل بعد تثبيت نسخة التطبيق التي تدعم الإشعارات وتسجيل الدخول منها.</p> : null}
        {notice ? <p className={notice.kind === 'ok' ? 'ok' : 'error'} role="status">{notice.text}</p> : null}
        {posts.length === 0 ? <p className="muted">لا توجد منشورات بعد.</p> : null}
        <ul className="posts">
          {posts.map((post) => (
            <li key={post.id} className="card">
              <div className="row">
                <h2>{post.pinned ? '📌 ' : ''}{post.title}</h2>
                <span className={post.status === 'published' ? 'badge on' : 'badge'}>{post.status === 'published' ? 'منشور' : 'مسودة'}</span>
              </div>
              <p className="muted">
                {post.status === 'published' ? `نُشر: ${when(post.publishedAt)}` : `آخر تعديل: ${when(post.updatedAt)}`}
                {post.notifiedAt ? ` · إشعار: ${when(post.notifiedAt)}` : ''}
              </p>
              <div className="actions">
                <button type="button" onClick={() => setEditing(post)} disabled={busyId === post.id}>تعديل</button>
                <button type="button" onClick={() => void notify(post)} disabled={busyId === post.id || post.status !== 'published' || devices === 0}>إرسال إشعار</button>
                <button className="danger" type="button" onClick={() => void remove(post)} disabled={busyId === post.id}>حذف</button>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
