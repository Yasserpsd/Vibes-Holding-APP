import { useState, type FormEvent } from 'react';

import { api, ApiError, type Post, type PostInput, type PostLink } from './api';

type Props = { post: Post | null; onClose: (saved: boolean) => void };

const isHttp = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** New post or edit. Media are links for now: image URLs and one YouTube link (uploads come later). */
export function PostEditor({ post, onClose }: Props) {
  const [title, setTitle] = useState(post?.title ?? '');
  const [body, setBody] = useState(post?.body ?? '');
  const [links, setLinks] = useState<PostLink[]>(post?.links ?? []);
  const [images, setImages] = useState<string[]>(post?.images ?? []);
  // The server stores the YouTube id and accepts a bare id back, so an edit starts from it.
  const [video, setVideo] = useState(post?.youtubeId ?? '');
  const [pinned, setPinned] = useState(post?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent, status: PostInput['status']) {
    event.preventDefault();
    if (!title.trim()) {
      setError('اكتب عنوان المنشور أولًا.');
      return;
    }
    const cleanLinks = links.filter((link) => link.label.trim() || link.url.trim());
    const cleanImages = images.map((url) => url.trim()).filter(Boolean);
    if (cleanLinks.some((link) => !link.label.trim() || !isHttp(link.url)) || cleanImages.some((url) => !isHttp(url))) {
      setError('كل رابط يحتاج عنوانًا ويبدأ بـ http أو https.');
      return;
    }
    const input: PostInput = { title: title.trim(), body: body.trim(), links: cleanLinks.map((link) => ({ label: link.label.trim(), url: link.url.trim() })), images: cleanImages, video: video.trim() || null, status, pinned };
    setBusy(true);
    setError(null);
    try {
      if (post) await api.updatePost(post.id, input);
      else await api.createPost(input);
      onClose(true);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'حدث خطأ غير متوقع');
      setBusy(false);
    }
  }

  const setLink = (index: number, patch: Partial<PostLink>) => setLinks(links.map((link, at) => (at === index ? { ...link, ...patch } : link)));
  const setImage = (index: number, url: string) => setImages(images.map((value, at) => (at === index ? url : value)));

  return (
    <div className="shell">
      <header className="top">
        <strong>{post ? 'تعديل منشور' : 'منشور جديد'}</strong>
        <button className="link" type="button" onClick={() => onClose(false)}>رجوع بدون حفظ</button>
      </header>
      <main className="page">
        <form className="card editor" onSubmit={(event) => void save(event, post?.status ?? 'draft')}>
          <label>
            العنوان
            <input value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            نص الرسالة
            <textarea value={body} rows={8} maxLength={6000} onChange={(e) => setBody(e.target.value)} />
          </label>

          <fieldset>
            <legend>الروابط</legend>
            {links.map((link, index) => (
              <div className="pair" key={index}>
                <input placeholder="عنوان الزر" value={link.label} maxLength={80} onChange={(e) => setLink(index, { label: e.target.value })} />
                <input placeholder="https://" dir="ltr" value={link.url} onChange={(e) => setLink(index, { url: e.target.value })} />
                <button type="button" onClick={() => setLinks(links.filter((_, at) => at !== index))}>إزالة</button>
              </div>
            ))}
            {links.length < 8 ? <button type="button" onClick={() => setLinks([...links, { label: '', url: '' }])}>إضافة رابط</button> : null}
          </fieldset>

          <fieldset>
            <legend>الصور (روابط)</legend>
            {images.map((url, index) => (
              <div className="pair" key={index}>
                <input placeholder="https://…/image.png" dir="ltr" value={url} onChange={(e) => setImage(index, e.target.value)} />
                {isHttp(url) ? <img src={url.trim()} alt="" referrerPolicy="no-referrer" /> : null}
                <button type="button" onClick={() => setImages(images.filter((_, at) => at !== index))}>إزالة</button>
              </div>
            ))}
            {images.length < 10 ? <button type="button" onClick={() => setImages([...images, ''])}>إضافة صورة</button> : null}
          </fieldset>

          <label>
            فيديو يوتيوب (رابط)
            <input placeholder="https://youtu.be/…" dir="ltr" value={video} onChange={(e) => setVideo(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            تثبيت في أعلى الرسائل
          </label>

          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="actions">
            <button className="primary" type="button" disabled={busy} onClick={(event) => void save(event, 'published')}>
              {post?.status === 'published' ? 'حفظ التعديلات' : 'نشر'}
            </button>
            {post?.status !== 'published' ? (
              <button type="button" disabled={busy} onClick={(event) => void save(event, 'draft')}>حفظ كمسودة</button>
            ) : (
              <button type="button" disabled={busy} onClick={(event) => void save(event, 'draft')}>إلغاء النشر (مسودة)</button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
