import type { PublicPayment, RedirectResult } from './service.js';

/** Small server-rendered pages for the checkout return and the mock gateway (dark, gold, RTL). */
type Action = { label: string; href: string; primary?: boolean };
type Form = { label: string; action: string; value: string; primary?: boolean };

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function amountText(payment: PublicPayment, en = false): string {
  return `${new Intl.NumberFormat('en-US').format(payment.amount)} ${payment.currency === 'SAR' && !en ? 'ريال' : payment.currency}`;
}

export function htmlPage(input: { title: string; heading: string; tone: 'success' | 'warning' | 'info'; lines: string[]; actions?: Action[]; forms?: Form[]; en?: boolean }): string {
  const color = input.tone === 'success' ? '#2E9E6B' : input.tone === 'warning' ? '#D14343' : '#C9A227';
  const icon = input.tone === 'success' ? '✓' : input.tone === 'warning' ? '!' : '…';
  const lines = input.lines.map((line) => `<p>${escape(line)}</p>`).join('');
  const actions = (input.actions ?? [])
    .map((action) => `<a class="btn${action.primary ? ' primary' : ''}" href="${escape(action.href)}">${escape(action.label)}</a>`)
    .join('');
  const forms = (input.forms ?? [])
    .map(
      (form) =>
        `<form method="post" action="${escape(form.action)}"><input type="hidden" name="result" value="${escape(form.value)}"><button class="btn${form.primary ? ' primary' : ''}" type="submit">${escape(form.label)}</button></form>`,
    )
    .join('');
  return `<!doctype html><html lang="${input.en ? 'en' : 'ar'}" dir="${input.en ? 'ltr' : 'rtl'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(input.title)}</title>
<style>
body{margin:0;background:#0B0B0B;color:#fff;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{width:min(92vw,420px);background:#161616;border:1px solid #2A2A2A;border-radius:16px;padding:28px 22px;text-align:center}
.icon{width:64px;height:64px;border-radius:32px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#0B0B0B;background:${color}}
h1{font-size:22px;margin:0 0 12px;color:${color}}p{margin:6px 0;color:#B5B5B5;line-height:1.7}
.btn{display:block;margin:14px auto 0;padding:12px 18px;border-radius:12px;border:1px solid #C9A227;color:#C9A227;background:transparent;text-decoration:none;font-size:16px;font-family:inherit;width:100%;box-sizing:border-box;cursor:pointer}
.btn.primary{background:#C9A227;color:#0B0B0B;font-weight:600}.brand{margin-top:22px;font-size:12px;color:#7A7A7A}
</style></head><body><main class="card"><div class="icon">${icon}</div><h1>${escape(input.heading)}</h1>${lines}${forms}${actions}<div class="brand">${input.en ? 'Investors Club app' : 'تطبيق نادي المستثمرين'}</div></main></body></html>`;
}

/**
 * After checkout: the stored status decides the wording; the browser redirect never activates anything.
 * M265: the page speaks the language the customer's app was in when he paid (`payment.lang`), with the
 * service's English title when the payment kept one. A payment that is not found has no language: Arabic.
 */
export function returnPage(result: RedirectResult, appScheme: string): string {
  const { payment } = result;
  if (!payment) {
    return htmlPage({
      title: 'الدفع',
      heading: 'لم نعثر على عملية الدفع',
      tone: 'warning',
      lines: ['ارجع إلى التطبيق وافتح «مدفوعاتي» للتأكد من حالة العملية.'],
      actions: [{ label: 'العودة إلى التطبيق', href: `${appScheme}://payments`, primary: true }],
    });
  }
  const en = payment.lang === 'en';
  const service = en ? payment.serviceTitleEn || payment.serviceTitle : payment.serviceTitle;
  const amount = en ? `Amount: ${amountText(payment, true)}` : `المبلغ: ${amountText(payment)}`;
  const back = { label: en ? 'Back to the app' : 'العودة إلى التطبيق', href: `${appScheme}://payment/${payment.id}`, primary: true };
  if (payment.status === 'paid') {
    return htmlPage({
      title: en ? 'Payment complete' : 'تم الدفع',
      heading: en ? 'Payment successful' : 'تم الدفع بنجاح',
      tone: 'success',
      lines: [service, amount, en ? 'The club team will contact you to start the service.' : 'سيتواصل معك فريق النادي لبدء تنفيذ الخدمة.'],
      actions: [back],
      en,
    });
  }
  if (payment.status === 'failed') {
    return htmlPage({
      title: en ? 'Payment incomplete' : 'لم يكتمل الدفع',
      heading: en ? 'The payment was not completed' : 'لم تكتمل عملية الدفع',
      tone: 'warning',
      lines: [
        service,
        payment.failureReason ? (en ? `Gateway reason: ${payment.failureReason}` : `سبب البوابة: ${payment.failureReason}`) : en ? 'The gateway did not accept the payment.' : 'لم تقبل البوابة العملية.',
        en ? 'You can try again from the app.' : 'يمكنك المحاولة مرة أخرى من التطبيق.',
      ],
      actions: [back],
      en,
    });
  }
  const waiting = result.gatewaySuccess
    ? en
      ? 'The gateway accepted the payment, and the app will confirm it in a moment.'
      : 'نجحت العملية لدى البوابة، وسيؤكدها التطبيق خلال لحظات.'
    : en
      ? 'The final status shows in the app as soon as the gateway confirms.'
      : 'تظهر الحالة النهائية في التطبيق فور وصول تأكيد البوابة.';
  return htmlPage({
    title: en ? 'Awaiting confirmation' : 'بانتظار التأكيد',
    heading: result.gatewaySuccess ? (en ? 'We received the gateway result' : 'استلمنا نتيجة البوابة') : en ? 'Awaiting payment confirmation' : 'بانتظار تأكيد الدفع',
    tone: 'info',
    lines: [service, amount, waiting],
    actions: [back],
    en,
  });
}

/** Test environment only: stands in for the gateway page and fires the same signed callback. */
export function mockCheckoutPage(payment: PublicPayment): string {
  const done = payment.status !== 'created';
  return htmlPage({
    title: 'بوابة دفع تجريبية',
    heading: done ? 'هذه العملية منتهية' : 'بوابة دفع تجريبية',
    tone: 'info',
    lines: [payment.serviceTitle, `المبلغ: ${amountText(payment)}`, done ? `حالة العملية: ${payment.status === 'paid' ? 'مدفوعة' : 'غير مكتملة'}` : 'صفحة اختبار: لا يُخصم أي مبلغ. اختر نتيجة العملية.'],
    forms: done
      ? []
      : [
          { label: 'ادفع الآن (نجاح)', action: `/pay/mock/${payment.id}/complete`, value: 'success', primary: true },
          { label: 'محاكاة فشل الدفع', action: `/pay/mock/${payment.id}/complete`, value: 'failed' },
        ],
  });
}
