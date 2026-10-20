import { useMemo, useState } from 'react';

import { api, uploadFile, type ManualReviewInput, type RatingReview, type RatingRow } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, Sheet, useLoad, useShell } from '../ui';

/**
 * M116 «تقييمات المشاريع»: the owner enters the old meetup feedback by hand (name + stars +
 * comment + photo — each person gave his permission), members rate from the app, and the bank's
 * default order follows the stars. The pinned value (تثبيت النجوم) wins over the computed average
 * wherever the app shows stars.
 */

const EMPTY: ManualReviewInput = { name: '', stars: 5, comment: '', photoUrl: '' };

function Stars({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  return <span style={{ color: '#b8860b', fontWeight: 600 }}>★ {formatNumber(value)}</span>;
}

export function Ratings() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.ratings(), []);
  const [editor, setEditor] = useState<{ review: RatingReview | null; projectId: number | null; input: ManualReviewInput } | null>(null);
  const [reviewsOf, setReviewsOf] = useState<{ row: RatingRow; reviews: RatingReview[] } | null>(null);
  const [pinOf, setPinOf] = useState<{ row: RatingRow; value: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  const catalog = state.data?.catalog ?? [];
  const pickable = useMemo(() => {
    const needle = filter.trim();
    if (!needle) return catalog;
    return catalog.filter((entry) => entry.title.includes(needle) || (entry.number ?? '').includes(needle));
  }, [catalog, filter]);

  async function reloadReviews(row: RatingRow) {
    const answer = await api.ratingReviews(row.projectId);
    setReviewsOf({ row, reviews: answer.reviews });
  }

  async function save() {
    if (!editor || busy) return;
    if (!editor.review && !editor.projectId) {
      notify('error', 'اختر المشروع أولًا');
      return;
    }
    setBusy(true);
    try {
      if (editor.review) await api.updateRatingReview(editor.review.id, editor.input);
      else await api.addRatingReview(editor.projectId as number, editor.input);
      notify('ok', 'حُفظ التقييم.');
      setEditor(null);
      state.reload();
      if (reviewsOf) await reloadReviews(reviewsOf.row);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHidden(review: RatingReview) {
    setBusy(true);
    try {
      await api.updateRatingReview(review.id, { hidden: !review.hidden });
      notify('ok', review.hidden ? 'أصبح التقييم ظاهرًا.' : 'أُخفي التقييم.');
      state.reload();
      if (reviewsOf) await reloadReviews(reviewsOf.row);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove(review: RatingReview) {
    if (!window.confirm(`حذف تقييم «${review.name}» نهائيًا؟`)) return;
    setBusy(true);
    try {
      await api.deleteRatingReview(review.id);
      notify('ok', 'حُذف التقييم.');
      state.reload();
      if (reviewsOf) await reloadReviews(reviewsOf.row);
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function savePin() {
    if (!pinOf || busy) return;
    const raw = pinOf.value.trim();
    const stars = raw === '' ? null : Number(raw);
    if (stars !== null && (!Number.isFinite(stars) || stars < 1 || stars > 5 || Math.round(stars * 2) !== stars * 2)) {
      notify('error', 'النجوم المثبتة من 1 إلى 5 بخطوة نصف نجمة (مثل 4.5) — أو اتركها فارغة للإلغاء.');
      return;
    }
    setBusy(true);
    try {
      await api.setRatingOverride(pinOf.row.projectId, stars);
      notify('ok', stars === null ? 'أُلغي التثبيت ورجع المتوسط المحسوب.' : 'ثُبتت النجوم الظاهرة.');
      setPinOf(null);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file);
      setEditor((current) => (current ? { ...current, input: { ...current.input, photoUrl: uploaded.url } } : current));
      notify('ok', 'رُفعت الصورة.');
    } catch (failure) {
      fail(failure);
    } finally {
      setUploading(false);
    }
  }

  const edit = (patch: Partial<ManualReviewInput>) => setEditor((current) => (current ? { ...current, input: { ...current.input, ...patch } } : current));

  return (
    <>
      <SectionHead title="تقييمات المشاريع" hint={state.data ? `مشاريع مُقيّمة: ${formatNumber(state.data.rows.length)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        أدخل هنا آراء الملتقيات القديمة (الاسم والنجوم والتعليق وصورة صاحب الرأي — بعد إذنه)، وتقييمات الأعضاء من التطبيق تظهر في نفس القائمة.
        «النجوم المثبتة» تتقدم على المتوسط المحسوب أينما ظهرت النجوم، وترتيب بنك المشاريع الافتراضي صار «الأعلى تقييمًا».
        التطبيق يعرض الاسم والصورة والتقييم فقط — لا يمكن لأحد الوصول لحساب صاحب التقييم.
      </p>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => setEditor({ review: null, projectId: null, input: { ...EMPTY } })}>+ تقييم يدوي</button>
      </div>
      <Async state={state} rows={5} empty={() => (state.data?.rows.length ?? 0) === 0} emptyText="لا توجد تقييمات بعد — أضف أول تقييم يدوي أو انتظر تقييمات الأعضاء.">
        {(data) => (
          <DataTable<RatingRow>
            caption="تقييمات المشاريع"
            rows={data.rows}
            rowKey={(row) => String(row.projectId)}
            columns={[
              { key: 'title', label: 'المشروع', cell: (row) => <>{row.title}{row.number ? <span className="muted"> ({row.number})</span> : null}</> },
              { key: 'stars', label: 'الظاهر في التطبيق', cell: (row) => <><Stars value={row.stars} />{row.override !== null ? <Pill tone="muted">مثبت</Pill> : null}</> },
              { key: 'average', label: 'المتوسط المحسوب', cell: (row) => <Stars value={row.average} /> },
              {
                key: 'count',
                label: 'عدد التقييمات',
                cell: (row) => (
                  <button type="button" className="link" onClick={() => void reloadReviews(row).catch(fail)}>
                    {formatNumber(row.count)}
                    {row.hiddenCount ? ` (+${formatNumber(row.hiddenCount)} مخفي)` : ''}
                  </button>
                ),
              },
              { key: 'latest', label: 'آخر تقييم', cell: (row) => (row.latestAt ? formatDateTime(row.latestAt) : '—') },
              {
                key: 'actions',
                label: '',
                cell: (row) => (
                  <span className="row-actions">
                    <button type="button" onClick={() => setEditor({ review: null, projectId: row.projectId, input: { ...EMPTY } })}>+ تقييم</button>
                    <button type="button" className="ghost" onClick={() => setPinOf({ row, value: row.override === null ? '' : String(row.override) })}>تثبيت النجوم</button>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Async>

      {editor ? (
        <Sheet title={editor.review ? `تعديل تقييم «${editor.review.name}»` : 'تقييم يدوي جديد'} onClose={() => setEditor(null)}>
          <form className="card editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            {editor.review ? null : (
              <>
                <label>
                  ابحث عن المشروع
                  <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="اسم المشروع أو رقمه" />
                </label>
                <label>
                  المشروع
                  <select value={editor.projectId ?? ''} onChange={(event) => setEditor((current) => (current ? { ...current, projectId: Number(event.target.value) || null } : current))} required>
                    <option value="">— اختر المشروع —</option>
                    {pickable.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title}
                        {entry.number ? ` (${entry.number})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              اسم صاحب التقييم (سيظهر في التطبيق)
              <input value={editor.input.name} maxLength={80} onChange={(event) => edit({ name: event.target.value })} required />
            </label>
            <label>
              النجوم
              <select value={editor.input.stars} onChange={(event) => edit({ stars: Number(event.target.value) })}>
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>{'★'.repeat(value)}{'☆'.repeat(5 - value)}</option>
                ))}
              </select>
            </label>
            <label>
              التعليق (اختياري)
              <textarea value={editor.input.comment} maxLength={500} rows={3} onChange={(event) => edit({ comment: event.target.value })} />
            </label>
            <label>
              صورة صاحب التقييم (اختياري)
              <input type="file" accept="image/*" disabled={uploading} onChange={(event) => void pickPhoto(event.target.files?.[0] ?? null)} />
            </label>
            {editor.input.photoUrl ? (
              <div className="row-actions" style={{ alignItems: 'center' }}>
                <img src={editor.input.photoUrl} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                <button type="button" className="ghost" onClick={() => edit({ photoUrl: '' })}>إزالة الصورة</button>
              </div>
            ) : null}
            <div className="row-actions">
              <button type="submit" disabled={busy || uploading}>{busy ? 'جارٍ الحفظ…' : uploading ? 'جارٍ رفع الصورة…' : 'حفظ'}</button>
            </div>
          </form>
        </Sheet>
      ) : null}

      {pinOf ? (
        <Sheet title={`تثبيت النجوم — ${pinOf.row.title}`} onClose={() => setPinOf(null)}>
          <form className="card editor" onSubmit={(event) => { event.preventDefault(); void savePin(); }}>
            <p className="muted">القيمة المثبتة تظهر في التطبيق بدل المتوسط المحسوب ({pinOf.row.average === null ? 'لا متوسط بعد' : formatNumber(pinOf.row.average)}). اتركها فارغة لإلغاء التثبيت.</p>
            <label>
              النجوم الظاهرة (1 إلى 5، نصف نجمة مسموح)
              <input dir="ltr" inputMode="decimal" value={pinOf.value} placeholder="4.5" onChange={(event) => setPinOf((current) => (current ? { ...current, value: event.target.value } : current))} />
            </label>
            <div className="row-actions">
              <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
            </div>
          </form>
        </Sheet>
      ) : null}

      {reviewsOf ? (
        <Sheet title={`تقييمات «${reviewsOf.row.title}»`} onClose={() => setReviewsOf(null)}>
          {reviewsOf.reviews.length === 0 ? (
            <p className="state-card empty">لا توجد تقييمات لهذا المشروع.</p>
          ) : (
            <DataTable<RatingReview>
              caption="تقييمات المشروع"
              rows={reviewsOf.reviews}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'who',
                  label: 'الاسم',
                  cell: (row) => (
                    <span className="row-actions" style={{ alignItems: 'center' }}>
                      {row.photoUrl ? <img src={row.photoUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} /> : null}
                      {row.contactId ? <MemberLink id={row.contactId} name={row.name} /> : row.name}
                    </span>
                  ),
                },
                { key: 'source', label: 'المصدر', cell: (row) => (row.source === 'member' ? <Pill tone="ok">من التطبيق</Pill> : <Pill tone="muted">يدوي</Pill>) },
                { key: 'stars', label: 'النجوم', cell: (row) => <Stars value={row.stars} /> },
                { key: 'comment', label: 'التعليق', cell: (row) => row.comment || '—' },
                { key: 'at', label: 'متى', cell: (row) => formatDateTime(row.createdAt) },
                {
                  key: 'actions',
                  label: '',
                  cell: (row) => (
                    <span className="row-actions">
                      {row.hidden ? <Pill tone="muted">مخفي</Pill> : null}
                      {row.source === 'manual' ? (
                        <button type="button" onClick={() => setEditor({ review: row, projectId: row.projectId, input: { name: row.name, stars: row.stars, comment: row.comment, photoUrl: row.photoUrl } })}>تعديل</button>
                      ) : null}
                      <button type="button" className="ghost" disabled={busy} onClick={() => void toggleHidden(row)}>{row.hidden ? 'إظهار' : 'إخفاء'}</button>
                      <button type="button" className="ghost" disabled={busy} onClick={() => void remove(row)}>حذف</button>
                    </span>
                  ),
                },
              ]}
            />
          )}
        </Sheet>
      ) : null}
    </>
  );
}
