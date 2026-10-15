/**
 * M8 store readiness: the public legal pages (privacy policy, terms, account deletion).
 * Server-rendered static HTML in the app's dark/gold style, Arabic first with an English
 * section below (store reviewers read English). The wording must stay in sync with the
 * store data-safety forms (docs/STORES.md) — above all the M33 first-party analytics line.
 */

const BRAND_GOLD = '#C9A227';
const EFFECTIVE_DATE = '2026-10-16';
const CONTACT_EMAIL = 'info@vibesholding.com';

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

/** Long-form article page (the payments htmlPage is a centered card; legal text needs a document layout). */
export function articlePage(input: { title: string; body: string }): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(input.title)}</title>
<style>
body{margin:0;background:#0B0B0B;color:#EDEDED;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;line-height:1.9}
main{max-width:760px;margin:0 auto;padding:40px 20px 60px}
h1{color:${BRAND_GOLD};font-size:26px;margin:0 0 6px}
h2{color:${BRAND_GOLD};font-size:19px;margin:34px 0 10px;border-bottom:1px solid #2A2A2A;padding-bottom:8px}
h3{color:#E6CC6E;font-size:16px;margin:22px 0 8px}
p,li{color:#C9C9C9;font-size:15px;margin:8px 0}
ul{padding-inline-start:22px;margin:8px 0}
.meta{color:#7A7A7A;font-size:13px;margin-bottom:28px}
.en{direction:ltr;text-align:left}
.en h2,.en h3{text-align:left}
.divider{margin:44px 0 10px;border-top:2px solid #2A2A2A}
a{color:${BRAND_GOLD}}
.card{background:#161616;border:1px solid #2A2A2A;border-radius:14px;padding:18px;margin:16px 0}
label{display:block;color:#C9C9C9;font-size:14px;margin:12px 0 4px}
input,textarea{width:100%;box-sizing:border-box;background:#0F0F0F;border:1px solid #333;border-radius:10px;color:#EDEDED;padding:10px 12px;font-family:inherit;font-size:15px}
textarea{min-height:90px;resize:vertical}
button{display:block;width:100%;margin-top:18px;padding:12px 18px;border-radius:12px;border:none;background:${BRAND_GOLD};color:#0B0B0B;font-weight:700;font-size:16px;font-family:inherit;cursor:pointer}
.hp{position:absolute;left:-9999px;top:-9999px}
.brand{margin-top:40px;font-size:12px;color:#7A7A7A;text-align:center}
</style></head><body><main>${input.body}<div class="brand">تطبيق نادي المستثمرين — شركة المجتمع الافتراضي للاستثمار</div></main></body></html>`;
}

export function privacyPage(): string {
  const body = `
<h1>سياسة الخصوصية — تطبيق نادي المستثمرين</h1>
<p class="meta">تاريخ السريان: ${EFFECTIVE_DATE}</p>

<h2>من نحن</h2>
<p>تطبيق «نادي المستثمرين» تصدره شركة المجتمع الافتراضي للاستثمار (vcmem.com) ضمن منظومة Vibes Ventures. هذه السياسة تشرح البيانات التي يجمعها التطبيق وكيف نستخدمها. للتواصل: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

<h2>البيانات التي نجمعها</h2>
<h3>بيانات الحساب</h3>
<p>عند إنشاء حساب نجمع: الاسم، البريد الإلكتروني، رقم الجوال، الفئة (محايد، رائد أعمال، مستثمر)، والدولة. تُحفظ الحسابات في منصة حسابات vcmem.com التابعة لنا، وهي مصدر الهوية الوحيد لخدماتنا.</p>
<h3>العضوية والمدفوعات</h3>
<ul>
<li>العضوية السنوية تُشترى داخل التطبيق عبر App Store أو Google Play؛ عملية الدفع نفسها تتم لدى المتجر ولا نرى بيانات بطاقتك. نستخدم خدمة RevenueCat لإدارة حالة الاشتراك.</li>
<li>مدفوعات الخدمات الأخرى داخل التطبيق تتم عبر مزود الدفع Paymob؛ بيانات البطاقة تُدخل لدى المزود مباشرة ولا تمر بخوادمنا ولا نخزنها. نحتفظ بحالة الطلب والمبلغ والخدمة.</li>
</ul>
<h3>استخدام التطبيق (تحليلات طرف أول)</h3>
<p>يرسل التطبيق أسماء الشاشات التي تُفتح مع معرّف جهاز عشوائي إلى خادمنا نحن فقط، لنعرف أكثر الصفحات استخدامًا كأعداد يومية مجمعة. لا نستخدم أي أداة تحليلات خارجية، ولا نبني سجل تصفح لكل عضو، والمعرّف العشوائي لا يكشف هويتك.</p>
<h3>الإشعارات</h3>
<p>عند سماحك بالإشعارات نحفظ رمز جهازك ونرسل الإشعارات عبر خدمة Expo.</p>
<h3>المستشار الذكي</h3>
<p>الرسائل التي ترسلها إلى المستشار داخل التطبيق تُعالج آليًا لتوليد الرد وتحسين الإجابة.</p>
<h3>الحجوزات والنماذج</h3>
<p>عند حجز زيارة للمقر أو التسجيل في ورشة أو إرسال طلب خدمة، نحفظ بيانات الطلب ونبلّغ إدارة النادي به بالبريد.</p>

<h2>فيم نستخدم البيانات</h2>
<ul>
<li>تقديم خدمات النادي وتفعيل العضوية وإدارة الحساب.</li>
<li>التواصل معك بخصوص طلباتك وحجوزاتك وعضويتك.</li>
<li>تحسين التطبيق بأرقام استخدام مجمعة.</li>
</ul>
<p>لا نبيع بياناتك ولا نشاركها لأغراض إعلانية.</p>

<h2>مع من نشارك البيانات</h2>
<p>نشارك الحد الأدنى اللازم مع مزودي التشغيل: Apple وGoogle (شراء العضوية من المتجر)، RevenueCat (حالة الاشتراك)، Paymob (مدفوعات الخدمات)، Expo (توصيل الإشعارات)، ومزود معالجة لغوية لتوليد ردود المستشار. ولا يتلقى أي منهم أكثر مما تتطلبه مهمته.</p>

<h2>الاحتفاظ بالبيانات وحذف الحساب</h2>
<p>نحتفظ ببياناتك ما دام حسابك قائمًا. يمكنك حذف حسابك نهائيًا من داخل التطبيق (تبويب «حسابي» ← «حذف الحساب») أو عبر <a href="/legal/account-deletion">صفحة طلب حذف الحساب</a>. عند الحذف تُزال بيانات حسابك وملفك الشخصي ورموز إشعاراتك؛ وقد نحتفظ بسجلات المدفوعات للمدد التي تفرضها الأنظمة المالية، وتبقى أرقام الاستخدام المجمعة لأنها لا ترتبط بهوية أحد.</p>

<h2>الأمان والأهلية</h2>
<p>تُنقل البيانات مشفّرة عبر HTTPS وتُقيّد صلاحيات الوصول إليها. خدمات النادي موجهة لمن أتموا 18 عامًا.</p>

<h2>التغييرات على هذه السياسة</h2>
<p>عند أي تعديل جوهري ننشر النسخة المحدثة في هذه الصفحة مع تاريخ سريان جديد.</p>

<div class="divider"></div>
<div class="en">
<h2>Privacy Policy — Investors Club (English summary)</h2>
<p>Effective date: ${EFFECTIVE_DATE}. The Investors Club app («نادي المستثمرين») is published by the Virtual Community Investment Company (vcmem.com), part of the Vibes Ventures ecosystem. Contact: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
<h3>Data we collect</h3>
<ul>
<li><b>Account data</b>: name, e-mail, phone number, member category and country, stored on our own vcmem.com accounts platform.</li>
<li><b>Membership and payments</b>: the annual membership is purchased through the App Store / Google Play (we never see your card); RevenueCat manages the subscription state. Other in-app services are paid through the Paymob gateway; card details are entered with the provider and never stored by us.</li>
<li><b>First-party analytics</b>: the app sends the names of opened screens together with a random device identifier to our own server only. We keep daily aggregate counts, use no third-party analytics SDK, and build no per-member browsing history.</li>
<li><b>Notifications</b>: your device push token, delivered through Expo's push service.</li>
<li><b>Advisor chat</b>: messages you send to the in-app advisor are processed automatically to generate replies.</li>
<li><b>Bookings and forms</b>: HQ visit bookings, workshop registrations and service requests are stored and e-mailed to the club's management.</li>
</ul>
<h3>How we use it</h3>
<p>To provide the club's services, activate memberships, respond to your requests, and improve the app with aggregate numbers. We do not sell your data and we do not share it for advertising.</p>
<h3>Sharing</h3>
<p>Minimal data is shared with our processors: Apple/Google (store purchase), RevenueCat (subscription state), Paymob (service payments), Expo (push delivery), and a language-model provider (advisor replies).</p>
<h3>Retention and deletion</h3>
<p>You can permanently delete your account inside the app (Account tab → Delete account) or through the <a href="/legal/account-deletion">account deletion page</a>. Account and profile data and push tokens are removed; payment records may be retained as required by financial regulations; aggregate usage counts are not linked to any identity.</p>
<h3>Security and eligibility</h3>
<p>Data travels over HTTPS with restricted access. The club's services are intended for adults aged 18 or older.</p>
</div>`;
  return articlePage({ title: 'سياسة الخصوصية — نادي المستثمرين', body });
}

export function termsPage(): string {
  const body = `
<h1>شروط الاستخدام — تطبيق نادي المستثمرين</h1>
<p class="meta">تاريخ السريان: ${EFFECTIVE_DATE}</p>

<h2>عن الخدمة</h2>
<p>«نادي المستثمرين» ناد للأعمال تصدره شركة المجتمع الافتراضي للاستثمار (vcmem.com) ضمن منظومة Vibes Ventures، ويقدم لأعضائه محتوى ومزايا وخدمات وفرص شراكات. التطبيق ليس وسيطًا ماليًا ولا يقدم توصيات استثمارية، والمعلومات المعروضة فيه تعريفية وليست عرضًا تعاقديًا أو ضمانًا لعوائد.</p>

<h2>الحساب والعضوية</h2>
<ul>
<li>الحساب شخصي ولمن أتموا 18 عامًا، وأنت مسؤول عن صحة بياناتك وسرية كلمة مرورك.</li>
<li>العضوية السنوية اشتراك متجدد تلقائيًا يُشترى داخل التطبيق عبر App Store أو Google Play، ويُدار ويُلغى من إعدادات الاشتراكات في المتجر نفسه في أي وقت قبل تاريخ التجديد.</li>
<li>بعض الخدمات داخل التطبيق مدفوعة وتُسدد عبر مزود الدفع، ويتواصل معك فريق النادي لتنفيذها.</li>
</ul>

<h2>الاستخدام المقبول</h2>
<p>يمتنع العضو عن إساءة استخدام التطبيق أو محاولة الوصول غير المصرح به أو انتحال صفة الغير أو استخدام المحتوى خارج نطاق العضوية. يحق للنادي إيقاف الحسابات المخالفة.</p>

<h2>حدود المسؤولية</h2>
<p>المحتوى وفرص الشراكات المعروضة في التطبيق لا تمثل نصيحة استثمارية، وأي قرار تتخذه بناءً عليها مسؤوليتك. أي تقييمات أو أرقام معروضة معلومات تعريفية وليست عرضًا تعاقديًا أو ضمانًا لعوائد.</p>

<h2>التواصل</h2>
<p>للاستفسارات: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. راجع أيضًا <a href="/legal/privacy">سياسة الخصوصية</a>.</p>

<div class="divider"></div>
<div class="en">
<h2>Terms of Use — Investors Club (English summary)</h2>
<p>Effective date: ${EFFECTIVE_DATE}. Investors Club is a business club published by the Virtual Community Investment Company (vcmem.com), part of the Vibes Ventures ecosystem. The app is not a financial intermediary and provides no investment advice; all information is descriptive and is neither a contractual offer nor a guarantee of returns.</p>
<ul>
<li>Accounts are personal and for adults aged 18 or older.</li>
<li>The annual membership is an auto-renewing subscription purchased through the App Store / Google Play and managed or cancelled from the store's subscription settings at any time before the renewal date.</li>
<li>Some in-app services are paid through a payment provider; the club's team contacts you to deliver them.</li>
<li>Misuse, unauthorized access and impersonation are prohibited; violating accounts may be suspended.</li>
</ul>
<p>Contact: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> — see also the <a href="/legal/privacy">privacy policy</a>.</p>
</div>`;
  return articlePage({ title: 'شروط الاستخدام — نادي المستثمرين', body });
}

export function accountDeletionPage(state: 'form' | 'sent' | 'rate_limited' | 'invalid'): string {
  const notice =
    state === 'sent'
      ? '<div class="card" style="border-color:#2E9E6B"><p style="color:#2E9E6B;font-weight:700">استلمنا طلبك.</p><p>سيتحقق فريق النادي من ملكية الحساب عبر بريدك المسجل ثم يحذف الحساب خلال 30 يومًا كحد أقصى، ويصلك تأكيد بالبريد.</p></div>'
      : state === 'rate_limited'
        ? '<div class="card" style="border-color:#D14343"><p style="color:#D14343">وصلتنا طلبات كثيرة من هذا الجهاز. حاول مرة أخرى بعد ساعة.</p></div>'
        : state === 'invalid'
          ? '<div class="card" style="border-color:#D14343"><p style="color:#D14343">اكتب بريدًا إلكترونيًا صحيحًا (هو البريد المسجل في حسابك).</p></div>'
          : '';
  const form =
    state === 'sent'
      ? ''
      : `
<div class="card">
<form method="post" action="/legal/account-deletion">
<label for="email">البريد الإلكتروني المسجل في الحساب (مطلوب)</label>
<input id="email" name="email" type="email" required maxlength="200" dir="ltr">
<label for="name">الاسم (اختياري)</label>
<input id="name" name="name" type="text" maxlength="120">
<label for="phone">رقم الجوال المسجل (اختياري، يساعدنا في التحقق)</label>
<input id="phone" name="phone" type="tel" maxlength="30" dir="ltr">
<label for="note">ملاحظة (اختياري)</label>
<textarea id="note" name="note" maxlength="1000"></textarea>
<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button type="submit">أرسل طلب حذف الحساب</button>
</form>
</div>`;
  const body = `
<h1>حذف الحساب — تطبيق نادي المستثمرين</h1>
<p class="meta">التطبيق: نادي المستثمرين — الناشر: شركة المجتمع الافتراضي للاستثمار (vcmem.com)، منظومة Vibes Ventures</p>
${notice}
<h2>الطريقة الأسرع: من داخل التطبيق</h2>
<p>افتح تبويب «حسابي» ← «حذف الحساب» وأكد بكلمة المرور. يُحذف الحساب فورًا.</p>

<h2>أو اطلب الحذف من هنا</h2>
<p>إن لم تستطع الدخول إلى التطبيق، أرسل الطلب بالنموذج التالي وسيتحقق فريق النادي من ملكية الحساب عبر بريدك المسجل ثم ينفذ الحذف خلال 30 يومًا كحد أقصى.</p>
${form}

<h2>ماذا يُحذف وماذا يبقى</h2>
<ul>
<li><b>يُحذف:</b> حسابك في منصة vcmem.com وبيانات ملفك الشخصي وفئتك ورموز إشعارات أجهزتك.</li>
<li><b>قد يبقى:</b> سجلات المدفوعات والفواتير للمدد التي تفرضها الأنظمة المالية والمحاسبية، وأرقام الاستخدام المجمعة لأنها لا ترتبط بهوية أحد (معرّف الجهاز العشوائي لا يُربط بالحساب).</li>
</ul>

<div class="divider"></div>
<div class="en">
<h2>Account deletion — Investors Club (English)</h2>
<p>App: Investors Club («نادي المستثمرين») — developer: Virtual Community Investment Company (vcmem.com), Vibes Ventures ecosystem.</p>
<p><b>Fastest way:</b> inside the app, open the Account tab → Delete account, and confirm with your password. The account is deleted immediately.</p>
<p><b>Or request deletion here:</b> submit the form above with your registered e-mail; the club's team verifies ownership through that e-mail and completes the deletion within 30 days at most.</p>
<p><b>Deleted:</b> your vcmem.com account, profile data and push tokens. <b>May be retained:</b> payment records for legally required periods, and aggregate usage counts which are not linked to any identity.</p>
</div>`;
  return articlePage({ title: 'حذف الحساب — نادي المستثمرين', body });
}
