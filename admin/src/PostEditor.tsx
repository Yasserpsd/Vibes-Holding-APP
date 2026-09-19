import { useEffect, useRef, useState, type FormEvent } from 'react';

import { api, ApiError, uploadFile, type Post, type PostInput, type PostLink, type PostVideo, type UploadConfig, type Uploaded, type UploadKind } from './api';
import { capturePoster, DEFAULT_UPLOAD_CONFIG, fileProblem, megabytes, typedFile, typeNames } from './media';

type Props = { post: Post | null; onClose: (saved: Post | null) => void };
/** One row of the progress list. A failed row stays, with the reason, until the owner hides it. */
type Pending = { id: number; name: string; kind: UploadKind; progress: number; error: string | null };

const MAX_IMAGES = 10;
const POSTER_UPLOAD_TIMEOUT_MS = 30_000;
const isHttp = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/**
 * Uploads the poster frame. Never rejects and never hangs: a failed, cancelled or stalled poster answers null,
 * so a small optional image cannot hold the save back or force the owner to cancel a finished video.
 */
function sendPoster(frame: Blob, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const limit = new AbortController();
    const stop = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      limit.abort();
      resolve(null);
    };
    const timer = window.setTimeout(stop, POSTER_UPLOAD_TIMEOUT_MS);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) {
      stop();
      return;
    }
    uploadFile(new File([frame], 'poster.jpg', { type: 'image/jpeg' }), undefined, limit.signal)
      .then((result) => result.url, () => null)
      .then((url) => {
        window.clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        resolve(url);
      });
  });
}

/** New post or edit. Images and one video are picked from the device and uploaded; an image link and a YouTube link stay possible. */
export function PostEditor({ post, onClose }: Props) {
  const [title, setTitle] = useState(post?.title ?? '');
  const [body, setBody] = useState(post?.body ?? '');
  const [links, setLinks] = useState<PostLink[]>(post?.links ?? []);
  // Uploaded images and pasted links live side by side: both are just URLs, in display order.
  const [images, setImages] = useState<string[]>(post?.images ?? []);
  const [videoFile, setVideoFile] = useState<PostVideo | null>(post?.video ?? null);
  // The server stores the YouTube id and accepts a bare id back, so an edit starts from it.
  const [video, setVideo] = useState(post?.youtubeId ?? '');
  const [pinned, setPinned] = useState(post?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<UploadConfig>(DEFAULT_UPLOAD_CONFIG);
  const [uploads, setUploads] = useState<Pending[]>([]);
  const [imageNotes, setImageNotes] = useState<string[]>([]);
  const [videoNote, setVideoNote] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<number, AbortController>());
  const nextId = useRef(1);
  // Every batch of picked images waits for the one before it, so images land in the order they were picked.
  const imageChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    // A failed load keeps the defaults: the server checks every file again when the ticket is asked for.
    api.uploadsConfig().then((loaded) => (alive ? setConfig(loaded) : undefined)).catch(() => undefined);
    const running = controllers.current;
    return () => {
      alive = false;
      // Leaving the editor stops every transfer, queued or running.
      running.forEach((controller) => controller.abort());
    };
  }, []);

  const pendingImages = uploads.filter((item) => item.kind === 'image' && !item.error).length;
  const pendingVideo = uploads.some((item) => item.kind === 'video' && !item.error);
  const uploading = pendingImages > 0 || pendingVideo;
  const room = MAX_IMAGES - images.length - pendingImages;

  const patchUpload = (id: number, patch: Partial<Pending>) => setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const dropUpload = (id: number) => {
    controllers.current.delete(id);
    setUploads((current) => current.filter((item) => item.id !== id));
  };
  const cancelUpload = (id: number) => {
    controllers.current.get(id)?.abort();
    dropUpload(id);
  };

  function enqueue(file: File, kind: UploadKind) {
    const id = nextId.current++;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setUploads((current) => [...current, { id, name: file.name, kind, progress: 0, error: null }]);
    return { id, signal: controller.signal };
  }

  /** Runs one transfer and keeps its row in step. Null when it failed (the row shows why) or was cancelled (the row is gone). */
  async function send(id: number, file: File, signal: AbortSignal): Promise<Uploaded | null> {
    try {
      return await uploadFile(file, (progress) => patchUpload(id, { progress }), signal);
    } catch (failure) {
      if (!signal.aborted) patchUpload(id, { error: failure instanceof ApiError ? failure.message : 'تعذر رفع الملف.' });
      return null;
    }
  }

  async function addImages(picked: File[]) {
    const notes: string[] = [];
    const accepted: File[] = [];
    let extra = false;
    for (const file of picked.map(typedFile)) {
      const problem = fileProblem(file, config.images);
      if (problem) notes.push(problem);
      else if (accepted.length < room) accepted.push(file);
      else extra = true;
    }
    if (extra) notes.push(`الحد الأقصى ${MAX_IMAGES} صور في المنشور، ولم تُضَف الصور الزائدة.`);
    setImageNotes(notes);
    const queue = accepted.map((file) => ({ file, ...enqueue(file, 'image') }));
    imageChain.current = imageChain.current.then(async () => {
      for (const { file, id, signal } of queue) {
        if (signal.aborted) continue;
        const done = await send(id, file, signal);
        if (!done) continue;
        dropUpload(id);
        setImages((current) => (current.length < MAX_IMAGES ? [...current, done.url] : current));
      }
    });
    await imageChain.current;
  }

  async function addVideo(picked: File) {
    const file = typedFile(picked);
    const problem = fileProblem(file, config.videos);
    setVideoNote(problem);
    if (problem) return;
    const { id, signal } = enqueue(file, 'video');
    // The poster frame is grabbed while the video travels. No frame, or a failed poster upload, only means no poster.
    const [done, frame] = await Promise.all([send(id, file, signal), capturePoster(file)]);
    if (!done) return;
    const poster = frame ? await sendPoster(frame, signal) : null;
    dropUpload(id);
    if (!signal.aborted) setVideoFile({ url: done.url, poster });
  }

  function addImageLink() {
    const url = (linkDraft ?? '').trim();
    if (!isHttp(url)) {
      setImageNotes(['رابط الصورة يجب أن يبدأ بـ http أو https.']);
      return;
    }
    setImageNotes([]);
    setImages((current) => (current.length < MAX_IMAGES ? [...current, url] : current));
    setLinkDraft(null);
  }

  const moveImage = (index: number, step: -1 | 1) =>
    setImages((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved === undefined || index + step < 0 || index + step >= current.length) return current;
      next.splice(index + step, 0, moved);
      return next;
    });

  async function save(event: FormEvent, status: PostInput['status']) {
    event.preventDefault();
    if (uploading) {
      setError('انتظر حتى يكتمل رفع الملفات ثم احفظ.');
      return;
    }
    if (!title.trim()) {
      setError('اكتب عنوان المنشور أولًا.');
      return;
    }
    const cleanLinks = links.filter((link) => link.label.trim() || link.url.trim());
    // An image link typed but not yet added still counts, so it is not lost on save.
    const typedLink = (linkDraft ?? '').trim();
    const allImages = typedLink && images.length < MAX_IMAGES ? [...images, typedLink] : images;
    if (cleanLinks.some((link) => !link.label.trim() || !isHttp(link.url)) || allImages.some((url) => !isHttp(url))) {
      setError('كل رابط يحتاج عنوانًا ويبدأ بـ http أو https.');
      return;
    }
    const input: PostInput = { title: title.trim(), body: body.trim(), links: cleanLinks.map((link) => ({ label: link.label.trim(), url: link.url.trim() })), images: allImages, video: video.trim() || null, videoFile, status, pinned };
    setBusy(true);
    setError(null);
    try {
      const saved = post ? await api.updatePost(post.id, input) : await api.createPost(input);
      onClose(saved.post);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'حدث خطأ غير متوقع');
      setBusy(false);
    }
  }

  const setLink = (index: number, patch: Partial<PostLink>) => setLinks(links.map((link, at) => (at === index ? { ...link, ...patch } : link)));

  const progressRows = (kind: UploadKind) => {
    const rows = uploads.filter((item) => item.kind === kind);
    if (rows.length === 0) return null;
    return (
      <ul className="uploads">
        {rows.map((item) => (
          <li className="upload" key={item.id}>
            <span className="name" dir="auto">{item.name}</span>
            {item.error ? (
              <>
                <button className="link" type="button" onClick={() => dropUpload(item.id)}>إخفاء</button>
                <span className="error wide" role="alert">{item.error}</span>
              </>
            ) : (
              <>
                <span className="muted">
                  {item.progress >= 1 ? 'جارٍ الإنهاء…' : `${Math.round(item.progress * 100)}%`}
                  <button className="link" type="button" onClick={() => cancelUpload(item.id)}>إلغاء</button>
                </span>
                <progress className="wide" value={item.progress} max={1} />
              </>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="shell">
      <header className="top">
        <strong>{post ? 'تعديل منشور' : 'منشور جديد'}</strong>
        <button className="link" type="button" onClick={() => onClose(null)}>رجوع بدون حفظ</button>
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

          {!config.durable ? <p className="warn">تنبيه: الملفات المرفوعة في هذه البيئة مؤقتة، وتختفي مع أول تحديث للخادم.</p> : null}

          <fieldset>
            <legend>الصور ({images.length} من {MAX_IMAGES})</legend>
            {images.length > 0 ? (
              <ul className="thumbs">
                {images.map((url, index) => (
                  <li className="thumb" key={`${url}#${images.slice(0, index).filter((other) => other === url).length}`}>
                    <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" />
                    <span className="order">{index + 1}</span>
                    {/* Arrows are not mirrored by the browser: under RTL the earlier slot is to the right. */}
                    <div className="thumb-actions">
                      <button type="button" aria-label="تقديم الصورة" title="تقديم" disabled={index === 0} onClick={() => moveImage(index, -1)}>→</button>
                      <button type="button" aria-label="إزالة الصورة" title="إزالة" onClick={() => setImages(images.filter((_, at) => at !== index))}>✕</button>
                      <button type="button" aria-label="تأخير الصورة" title="تأخير" disabled={index === images.length - 1} onClick={() => moveImage(index, 1)}>←</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {progressRows('image')}
            {imageNotes.map((note, index) => <p className="error" role="alert" key={index}>{note}</p>)}
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                // Copy first: clearing the value (so the same file can be picked again) empties the live list.
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length > 0) void addImages(files);
              }}
            />
            {room > 0 ? (
              <div className="actions">
                <button className="pick" type="button" onClick={() => imageInput.current?.click()}>إضافة صور</button>
                {linkDraft === null ? <button className="link" type="button" onClick={() => setLinkDraft('')}>إضافة رابط صورة</button> : null}
              </div>
            ) : null}
            {linkDraft !== null && room > 0 ? (
              <div className="link-add">
                <input
                  placeholder="https://…/image.png"
                  dir="ltr"
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter here adds the link instead of submitting the whole post.
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addImageLink();
                  }}
                />
                <button type="button" onClick={addImageLink}>إضافة</button>
                <button className="link" type="button" onClick={() => setLinkDraft(null)}>إلغاء</button>
              </div>
            ) : null}
            <p className="muted hint">حتى {MAX_IMAGES} صور، وحجم الصورة حتى {megabytes(config.images.maxBytes)} ميجابايت ({typeNames(config.images.types)}).</p>
          </fieldset>

          <fieldset>
            <legend>الفيديو</legend>
            {videoFile ? (
              <div className="video-preview">
                <video src={videoFile.url} poster={videoFile.poster ?? undefined} controls playsInline preload="metadata" />
                <button type="button" onClick={() => setVideoFile(null)}>إزالة الفيديو</button>
              </div>
            ) : null}
            {progressRows('video')}
            {videoNote ? <p className="error" role="alert">{videoNote}</p> : null}
            <input
              ref={videoInput}
              type="file"
              accept={config.videos.types.join(',')}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void addVideo(file);
              }}
            />
            {!videoFile && !pendingVideo ? (
              <div className="actions">
                <button className="pick" type="button" onClick={() => videoInput.current?.click()}>إضافة فيديو</button>
              </div>
            ) : null}
            <p className="muted hint">فيديو واحد حجمه حتى {megabytes(config.videos.maxBytes)} ميجابايت ({typeNames(config.videos.types)}).</p>
            <label>
              فيديو يوتيوب (رابط)
              <input placeholder="https://youtu.be/…" dir="ltr" value={video} onChange={(e) => setVideo(e.target.value)} />
            </label>
          </fieldset>

          <label className="check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            تثبيت في أعلى الرسائل
          </label>

          {error ? <p className="error" role="alert">{error}</p> : null}
          {uploading ? <p className="muted" role="status">جارٍ رفع الملفات… يتاح الحفظ بعد اكتمال الرفع.</p> : null}
          <div className="actions">
            <button className="primary" type="button" disabled={busy || uploading} onClick={(event) => void save(event, 'published')}>
              {post?.status === 'published' ? 'حفظ التعديلات' : 'نشر'}
            </button>
            {post?.status !== 'published' ? (
              <button type="button" disabled={busy || uploading} onClick={(event) => void save(event, 'draft')}>حفظ كمسودة</button>
            ) : (
              <button type="button" disabled={busy || uploading} onClick={(event) => void save(event, 'draft')}>إلغاء النشر (مسودة)</button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
