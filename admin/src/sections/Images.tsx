import { useMemo, useRef, useState } from 'react';

import { api, uploadFile, type ImageSlot } from '../api';
import { Async, SectionHead, messageOf, sessionOver, useLoad, useShell } from '../ui';

/**
 * M81 «صور التطبيق»: the owner's real photos, employed in context — each slot names where the photo
 * shows in the app (the HQ gallery, the top of a service page). Upload fills the slot, «إزالة» clears
 * it, and open apps see the change within seconds. Adding new slots stays code-side.
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

  async function pick(slot: ImageSlot, file: File | undefined) {
    if (!file || busyKey) return;
    setBusyKey(slot.key);
    try {
      const uploaded = await uploadFile(file);
      if (uploaded.kind !== 'image') throw new Error('اختر صورة.');
      await api.saveContentImage(slot.key, uploaded.url);
      notify('ok', `حُفظت «${slot.label}». تصل للتطبيقات المفتوحة خلال ثوانٍ.`);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusyKey(null);
      const input = fileRefs.current.get(slot.key);
      if (input) input.value = '';
    }
  }

  async function clear(slot: ImageSlot) {
    if (busyKey || !window.confirm(`إزالة صورة «${slot.label}»؟`)) return;
    setBusyKey(slot.key);
    try {
      await api.saveContentImage(slot.key, null);
      notify('ok', `أُزيلت صورة «${slot.label}».`);
      state.reload();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="stack">
      <SectionHead
        title="صور التطبيق"
        hint="صورك الحقيقية موظفة في مكانها: معرض المقر في شاشة المقر، وصورة لكل خدمة أعلى صفحتها."
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
                        <div className="row-actions" style={{ alignItems: 'center', gap: 12 }}>
                          {slot.url ? (
                            <img src={slot.url} alt="" style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8 }} referrerPolicy="no-referrer" />
                          ) : (
                            <span className="muted hint">بدون صورة بعد</span>
                          )}
                          <input
                            ref={(element) => {
                              if (element) fileRefs.current.set(slot.key, element);
                            }}
                            type="file"
                            accept="image/*"
                            disabled={busyKey !== null}
                            onChange={(event) => void pick(slot, event.target.files?.[0])}
                          />
                          {slot.url ? (
                            <button type="button" className="ghost" disabled={busyKey !== null} onClick={() => void clear(slot)}>
                              إزالة
                            </button>
                          ) : null}
                          {busyKey === slot.key ? <span className="muted hint">جارٍ الحفظ…</span> : null}
                        </div>
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
