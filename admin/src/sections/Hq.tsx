import { useState } from 'react';

import { api, type HqVisit } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, Chips, DataTable, MemberLink, messageOf, Pill, SectionHead, sessionOver, useLoad, useShell, type Tone } from '../ui';

/**
 * M109a «حجوزات المقر»: every HQ request — visits, and the hours-wallet bookings (مكتب خاص /
 * قاعة اجتماعات) — lands here pending. NOTHING confirms itself: approve issues the entry pass,
 * pushes to the member and (wallet bookings) deducts the hours; reject pushes and frees the slot.
 */
const STATUS: { value: HqVisit['status'] | 'all'; label: string }[] = [
  { value: 'pending', label: 'قيد المراجعة' },
  { value: 'confirmed', label: 'مؤكدة' },
  { value: 'rejected', label: 'مرفوضة' },
  { value: 'cancelled', label: 'ملغاة' },
  { value: 'all', label: 'الكل' },
];

const STATUS_PILL: Record<HqVisit['status'], { label: string; tone: Tone }> = {
  pending: { label: 'قيد المراجعة', tone: 'gold' },
  confirmed: { label: 'مؤكد', tone: 'ok' },
  rejected: { label: 'مرفوض', tone: 'danger' },
  cancelled: { label: 'ألغاه العضو', tone: 'muted' },
};

const SPACE_WORD: Record<string, string> = { office: 'مكتب خاص', meeting: 'قاعة الاجتماعات' };

export function HqBookings() {
  const { signOut, notify } = useShell();
  const [status, setStatus] = useState<HqVisit['status'] | 'all'>('pending');
  const state = useLoad(() => api.hqVisits(status === 'all' ? undefined : status), [status]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = state.data?.visits ?? [];

  async function decide(row: HqVisit, next: 'confirmed' | 'rejected') {
    const what = row.space ? `${SPACE_WORD[row.space] ?? row.space} (${formatNumber(row.hours ?? 1)} ساعة)` : row.purpose;
    const confirmText =
      next === 'confirmed'
        ? `تأكيد حجز «${row.name}» — ${what} يوم ${row.date} من ${row.time} إلى ${row.endTime}؟ يصدر باركود الدخول ويصل العضو إشعار${row.space ? ' وتُخصم الساعات من رصيده' : ''}.`
        : `رفض حجز «${row.name}»؟ يصل العضو إشعار لاختيار موعد آخر${row.space ? ' بدون خصم من رصيده' : ''}.`;
    if (!window.confirm(confirmText)) return;
    const note = next === 'rejected' ? (window.prompt('ملاحظة للعضو (اختياري):') ?? '') : '';
    setBusyId(row.id);
    try {
      await api.decideHqVisit(row.id, next, note.trim());
      notify('ok', next === 'confirmed' ? 'تأكد الحجز وصدر باركود الدخول.' : 'رُفض الحجز وأُخطر العضو.');
      state.reload();
    } catch (failure) {
      if (sessionOver(failure)) signOut();
      notify('error', messageOf(failure));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <SectionHead title="حجوزات المقر" hint={state.data && status === 'pending' ? `قيد المراجعة: ${formatNumber(rows.length)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        زيارات المقر وحجوزات المكاتب وقاعة الاجتماعات (رصيد 24 ساعة سنويًا لكل عضو). لا يتأكد أي حجز من تلقاء نفسه: التأكيد يصدر باركود الدخول ويخصم
        ساعات الحجوزات من الرصيد، والرفض يخطر العضو ليختار موعدًا آخر. الباركود لا يفتح الباب إلا لحجز مؤكد وداخل وقته.
      </p>
      <div className="filters">
        <Chips label="حالة الحجز" options={STATUS} value={status} onChange={setStatus} />
      </div>
      <Async state={state} rows={6} empty={() => rows.length === 0} emptyText={status === 'pending' ? 'لا توجد حجوزات قيد المراجعة.' : 'لا توجد حجوزات بهذه الحالة.'}>
        {() => (
          <DataTable<HqVisit>
            caption="حجوزات المقر"
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'who', label: 'العضو', cell: (row) => <MemberLink id={row.contactId} name={row.name || row.email} /> },
              { key: 'phone', label: 'الجوال', cell: (row) => <bdi dir="ltr" className="num">{row.phone || '—'}</bdi> },
              { key: 'what', label: 'الحجز', cell: (row) => (row.space ? `${SPACE_WORD[row.space] ?? row.space} · ${formatNumber(row.hours ?? 1)} ساعة` : row.purpose) },
              { key: 'when', label: 'الموعد', cell: (row) => <span>{row.date} · <bdi dir="ltr" className="num">{row.time}–{row.endTime}</bdi></span> },
              { key: 'note', label: 'ملاحظة العضو', cell: (row) => row.note || '—' },
              { key: 'at', label: 'طُلب', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'status',
                label: 'الحالة',
                cell: (row) =>
                  row.status === 'pending' ? (
                    <span className="actions">
                      <button type="button" disabled={busyId === row.id} onClick={() => void decide(row, 'confirmed')}>تأكيد</button>
                      <button type="button" className="danger" disabled={busyId === row.id} onClick={() => void decide(row, 'rejected')}>رفض</button>
                    </span>
                  ) : (
                    <Pill tone={STATUS_PILL[row.status].tone}>{STATUS_PILL[row.status].label}</Pill>
                  ),
              },
            ]}
          />
        )}
      </Async>
    </>
  );
}
