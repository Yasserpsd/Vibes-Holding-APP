import { useMemo, useRef, useState } from 'react';

import { api, uploadFile, type ImageSlot } from '../api';
import { Async, SectionHead, messageOf, sessionOver, useLoad, useShell } from '../ui';

type SlotLang = 'ar' | 'en';

/**
 * M81 «صور التطبيق»: the owner's real photos, employed in context — each slot names where the photo
 * shows in the app (the HQ gallery, the top of a service page). Upload fills the slot, «إزالة» clears
 * it, and open apps see the change within seconds. Adding new slots stays code-side.
 *
 * M270: a slot whose pictures carry words (banners, service pages) takes a second, optional picture for the
 * English app. Left empty, the English app shows the slot's own picture.
 */
export function Images() {
  const { signOut, notify } = useShell();
  const state = useLoad(() => api.contentImages(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const fileRefs = useRef(new Map<string, HTMLInputElement>());

  function fail(failure: unknown) {
    if (sessionOver(failure)) signOut();
    notify('error', messageOf(failure));
  }

  const groups = useMemo(() => {
    const slots = state.data?.slots ?? [];
    const byGroup = new Map<string, ImageSlot[]>();
    for (const slot of slots) {
      const list = byGroup.get(slot.group) ?? [];
      list.push(slot);
      byGroup.set(slot.group, list);
    }
    return [...byGroup.entries()];
  }, [state.data]);

  const nameOf = (slot: ImageSlot, lang: SlotLang) => (lang === 'en' ? `${slot.label} (النسخة الإنجليزية)` : slot.label);

  async function pick(slot: ImageSlot, lang: SlotLang, file: File | undefined) {
    if (!file || busyKey) return;
    const busy = `${lang}:${slot.key}`;
    setBusyKey(busy);
    try {
      const uploaded = await uploadFile(file);
      if (uploaded.kind !== 'image') throw new Error('اختر صورة.');
      await api.saveContentImage(slot.key, uploaded.url, lang);
      notify('ok', `حُفظت «${nameOf(slot, lang)}». تصل للتطبيقات المفتوحة خلال ثوانٍ.`);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusyKey(null);
      const input = fileRefs.current.get(busy);
      if (input) input.value = '';
    }
  }

  async function clear(slot: ImageSlot, lang: SlotLang) {
    if (busyKey || !window.confirm(`إزالة صورة «${nameOf(slot, lang)}»؟`)) return;
    setBusyKey(`${lang}:${slot.key}`);
    try {
      await api.saveContentImage(slot.key, null, lang);
      notify('ok', `أُزيلت صورة «${nameOf(slot, lang)}».`);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusyKey(null);
    }
  }

  /** One picture of a slot: its preview, the upload and «إزالة». */
  function picture(slot: ImageSlot, lang: SlotLang) {
    const url = lang === 'en' ? slot.urlEn : slot.url;
    const busy = `${lang}:${slot.key}`;
    return (
      <div className="row-actions" style={{ alignItems: 'center', gap: 12 }}>
        {slot.bilingual ? <span className="muted hint" style={{ minWidth: 92 }}>{lang === 'en' ? 'النسخة الإنجليزية' : 'النسخة العربية'}</span> : null}
        {url ? (
          <img src={url} alt="" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8 }} referrerPolicy="no-referrer" />
        ) : (
          <span className="muted hint">{lang === 'en' ? 'تظهر الصورة العربية نفسها' : 'بدون صورة بعد'}</span>
        )}
        <input
          ref={(element) => {
            if (element) fileRefs.current.set(busy, element);
          }}
          type="file"
          accept="image/*"
          disabled={busyKey !== null}
          onChange={(event) => void pick(slot, lang, event.target.files?.[0])}
        />
        {url ? (
          <button type="button" className="ghost" disabled={busyKey !== null} onClick={() => void clear(slot, lang)}>
            إزالة
          </button>
        ) : null}
        {busyKey === busy ? <span className="muted hint">جارٍ الحفظ…</span> : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <SectionHead
        title="صور التطبيق"
        hint="صورك الحقيقية موظفة في مكانها: بنرات الرئيسية المتحركة، صور العضوية، معرض المقر، وصور كل خدمة. الصورة التي عليها كتابة لها خانة ثانية للنسخة الإنجليزية."
        onReload={state.reload}
        busy={state.loading}
      />
      <Async state={state} rows={4} empty={() => (state.data?.slots.length ?? 0) === 0} emptyText="لا توجد خانات صور.">
        {() => (
          <>
            {groups.map(([group, slots]) => (
              <section className="card" key={group}>
                <h3>{group}</h3>
                <ul className="list">
                  {slots.map((slot) => (
                    <li key={slot.key} className="value-row">
                      <div className="value-main">
                        <div className="row">
                          <strong>{slot.label}</strong>
                          <bdi dir="ltr" className="muted hint">{slot.key}</bdi>
                        </div>
                        {picture(slot, 'ar')}
                        {slot.bilingual ? picture(slot, 'en') : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </Async>
    </div>
  );
}
