import { api, type InterestsReport } from '../api';
import { formatDateTime, formatNumber } from '../format';
import { Async, DataTable, MemberLink, SectionHead, useLoad } from '../ui';

/**
 * M107 «الاهتمامات»: how many members picked each interest, plus every «أخرى» text — the owner
 * reviews these monthly, and an interest that keeps repeating becomes a new category in the list.
 */
export function Interests() {
  const state = useLoad(() => api.interestsReport(), []);

  return (
    <>
      <SectionHead title="اهتمامات الأعضاء" hint={state.data ? `أعضاء اختاروا اهتماماتهم: ${formatNumber(state.data.total)}` : undefined} onReload={state.reload} busy={state.loading} />
      <p className="muted">
        القائمة الموحّدة تُستخدم في ترتيب الأخبار وفلترة بنك المشاريع واقتراح الورش والإشعارات. راجع خانة «أخرى» كل شهر:
        أي اهتمام يتكرر كثيرًا يتحوّل لتصنيف جديد في القائمة.
      </p>
      <Async state={state} rows={5} empty={() => (state.data?.total ?? 0) === 0} emptyText="لم يختر أي عضو اهتماماته بعد.">
        {(data: InterestsReport) => (
          <>
            <DataTable<InterestsReport['counts'][number]>
              caption="عدد الأعضاء لكل اهتمام"
              rows={data.counts}
              rowKey={(row) => row.key}
              columns={[
                { key: 'label', label: 'الاهتمام', cell: (row) => row.label },
                { key: 'count', label: 'الأعضاء', cell: (row) => formatNumber(row.count) },
              ]}
            />
            <h3 style={{ marginTop: 24 }}>نصوص «أخرى»</h3>
            {data.others.length === 0 ? (
              <p className="state-card empty">لا توجد نصوص «أخرى» بعد.</p>
            ) : (
              <DataTable<InterestsReport['others'][number]>
                caption="نصوص خانة أخرى"
                rows={data.others}
                rowKey={(row) => `${row.contactId}-${row.updatedAt}`}
                columns={[
                  { key: 'who', label: 'العضو', cell: (row) => <MemberLink id={row.contactId} name={`عضو ${row.contactId}`} /> },
                  { key: 'text', label: 'النص', cell: (row) => row.text },
                  { key: 'at', label: 'آخر تعديل', cell: (row) => formatDateTime(row.updatedAt) },
                ]}
              />
            )}
          </>
        )}
      </Async>
    </>
  );
}
