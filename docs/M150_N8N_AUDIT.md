# M150 — تدقيق عقل n8n (v4.11) والمعمارية المستهدفة

تاريخ التدقيق: 2026-10-28 (ليلًا). قراءة فقط: لم يُعدَّل أي شيء في n8n ولا في الهب ولا في السيرفر.
المصادر: الـ workflow الحي `Vibes Web Agent v4.11` (id `sGbo7xuJ79cDILKI`) عبر n8n MCP، الملف المصدَّر في New Era «3- عقل n8n v4.11»، آخر 30 تنفيذًا + تنفيذان بالتفصيل، بلجن الهب 2.21.6 (`class-vai-hub.php`)، وسيرفر التطبيق (`server/src`).

---

## 1) خريطة الوضع الحالي

### 1.1 الدخول والخروج (عقد الهب ↔ n8n)
- **الدخول:** الهب (vcmem.com، بلجن Vibes AI Assistant) يستقبل رسالة الزائر من أي موقع أو من التطبيق (`op_message`)، يخزّنها، يطبّق البوابات (rate / membership gate / site cap / human takeover)، يبني الـ payload (`n8n_payload`) ويرسله `POST` إلى n8n webhook `/webhook/vibes-web-agent` على `brown-spider-737266.hostingersite.com` (استضافة Hostinger). الـ webhook يرد فورًا (`onReceived`) ثم يشتغل بالخلفية.
- **الخروج:** n8n يرسل الرد إلى `POST {hub}/wp-json/vibes-ai/v1/hub/reply` بمفتاح `X-VAI-Key` (مفتاح الهب). الهب يخزّن الرد والأفعال، والويدجت/التطبيق يسحبه بـ `poll`. الهب يمنع تكرار الرد لنفس رسالة المستخدم (`umid` dedupe) — جيد.
- **الـ payload** (≈100 KB لكل رسالة!): `event, secret, hub_host, message{id,text,image}, site, page{url,title,content,live_text}, focus, projects_hint[5], knowledge_hint[3], contact{25 حقلًا}, recent_pages, admin_brief, memo, turns[≤30], gate, services[6 مع pitch وincludes], forms, videos[18], links[28], config{instructions ≈6k حرف, first_note, bot_name, whatsapp, allowed_hosts, app_links}`.

### 1.2 العُقد (29 عقدة، خط واحد + فرع تنبيه)
`Webhook → Config → Auth OK? → Is Ping? → (Pong | Pick Model) → Has Image? → (Image Payload → Analyze Image → Image Note) → Build Context → AI Agent → (Split Reply | Fallback Reply) → Post Reply`
وفرع مستقل: `Lead Alert Webhook → Alert Config → Alert Configured? → Send WhatsApp Alert (Evolution API)`.

| عنصر | الحال |
|---|---|
| النموذج | `OpenAI Chat Model` ديناميكي من `Pick Model`: `gpt-5` افتراضي وعميق (effort low/medium)، `gpt-5-mini` للتحية والصور. المفاتيح عبر n8n credential «OpenAI account» (سليم). |
| الـ Agent | `AI Agent` v3.1، `maxIterations: 6`، بلا timeout، system prompt **13,586 حرفًا** + كتلة سياق تُولَّد لكل رسالة. |
| الذاكرة | `Simple Memory` (window 4) **غير موصولة** بالـ Agent. الذاكرة الفعلية: `turns` من الهب (30 دورًا مقصوصة) + `MEMO` (≤650 حرفًا يكتبه النموذج ويخزّنه الهب في `contacts.memo`) + «سجل الجلسة» في `$getWorkflowStaticData('global')` (روابط/كروت/فيديوهات أُرسلت، هل ذُكرت العضوية). |
| الأدوات (5) | `search_site` (بحث LIKE في جدول knowledge بالهب، 6 نتائج)، `get_page`، `find_projects` (6 مشاريع، حقول عامة فقط)، `get_form`، `save_note`. كلها `GET` إلى `/hub/<tool>` بمفتاح الهب. |
| الإخراج | بروتوكول `[[ACTIONS]] [[MEMO]] [[LEAD]]` يُفصل في `Split Reply` مع حارس: روابط داخل `allowed_hosts` فقط، تنقية الأفعال (open_page, prefill_form, card, quick_replies, video, handoff, link, request_contact, scroll_to, admin)، حد إيموجي 6، LEAD من 8 أنواع. |
| Config | القيم الحية حقيقية (hub_key 40 حرفًا، webhook_secret 32) — الملف المصدَّر يحمل `PASTE_…` عمدًا. |
| التنبيهات | `Alert Config` evo_base_url/evo_apikey فارغة ⇒ تنبيه واتساب للّيدات **معطّل**. `Momentum WhatsApp Agent v33` موجود وغير مفعّل. |
| بيانات n8n | Data Tables: `ic_projects, ic_inbox, ic_memory, vc_memory, ic_campaigns` (من عصر واتساب). Credentials: OpenAI + Google Sheets فقط — **لا يوجد Postgres credential في n8n**. |
| الفرق بين الحي والمصدَّر | العُقد والوصلات متطابقة. الـ prompt الحي يحمل قاعدة المستثمر الجديدة (لا تسأل عن المبلغ؛ الشراكة حصة في عقد التأسيس) وهي **غير موجودة في الملف المصدَّر** ⇒ النسخة في New Era قديمة. |

### 1.3 ما يملكه الهب (طبقة الأدوات الجاهزة)
- **site ops** (بمفتاح الموقع): `config, message, poll, identify, member, token, claim, history, knowledge, ping, register, login, logout, account, reset_*, profile, verify, resend_code, member_status, setpass*, delete_account, feed, google, react`.
- **trusted ops** (خادم التطبيق فقط): `activate_member, social_login, changes, publish, admin_stats, admin_accounts, admin_member, admin_payments, admin_tickets, admin_leads, admin_threads, admin_thread, admin_reply, admin_mail, admin_grant, admin_set_role, send_mail, payment_get`.
- **tool ops** (بمفتاح الهب — هذه ما يستعمله n8n): `reply, search, page, projects, form, services, contact, save_note`.
- لا توجد في الهب أي عمليات فعاليات/حجز/تقييم أعمال.

### 1.4 ما يملكه سيرفر التطبيق (Railway, Postgres)
- `GET /api/projects`, `/api/projects/:id`, `/api/projects/filters` — بنك المشاريع مع **حجب بيانات المؤسسين سيرفريًا** (`projectsBank/redact.ts`, `access.ts`) حسب فتح العضو للمشروع (القاعدة 4).
- `hq/` (حجز المقر: زيارة/مكتب/قاعة)، `agenda/` + `workshops/` (الفعاليات والورش)، `membership/store`, `golden/`, `advisor/` (M145: `POST /api/advisor/intent` — نوايا التطبيق hq_book / open_screen / service تُجاب **قبل** وصول السطر للهب).
- السيرفر يكلّم الهب بـ 22 عملية (`account, login, admin_stats, verify, register, profile, poll, message, history, …`). لا يوجد أي اتصال مباشر بين n8n والسيرفر اليوم.

### 1.5 أداء آخر 30 تنفيذًا (2026-10-27/28)
| النمط | عدد | المدة | التفسير |
|---|---|---|---|
| ردود حقيقية (gpt-5 medium، focus/deep) | 5 | 95–141 ثانية | في العينة 147761: الـ Agent وحده 58 ثانية، والباقي (~80 ثانية) انتظار قبل بدء التنفيذ (تزاحم على instance Hostinger). |
| ردود عادية | 9 | 5–34 ثانية | طبيعي. |
| **ردود خطأ 401** | **16** (17:04 → 19:26) | 5.4 ثانية ثابتة | فترة الـ placeholders: `Auth OK?` فشل ⇒ `Config Error Reply` ⇒ `Post Reply` رُفض 401 من الهب — **والتنفيذ مسجَّل «success»**. |

---

## 2) قائمة المشاكل (مرتّبة بالأثر)

1. **مسار الخطأ يُحسب نجاحًا ولا ينبّه أحدًا.** 16 رسالة من أعضاء حقيقيين (منهم حسابك) لم تُجَب لست ساعات وبدا كل شيء أخضر. لا يوجد Error Workflow، ولا فحص لرد الهب (`ok:false` أو 401)، ولا تنبيه.
2. **الأسرار مكشوفة في بيانات التنفيذ.** الهب يرسل `secret` داخل جسم الرسالة، وعقدة Config تحمل مفتاح الهب نصًا، وn8n يحفظ بيانات كل تنفيذ ⇒ أي شخص يفتح أي تنفيذ يرى المفتاحين (رأيتهما أنا أثناء التدقيق ولم أدوّنهما). الحل: credentials/variables في n8n + توقيع HMAC في الهيدر (الهب يوقّع أصلًا webhooks السيرفر بـ `X-VAI-Signature`) + تقليل حفظ البيانات.
3. **البطء:** ردود الاستشارة الحقيقية دقيقة ونصف إلى دقيقتين ونصف. أسبابه: prompt ضخم + سياق ≈100 KB لكل رسالة، gpt-5 بـ effort medium وحتى 6 جولات أدوات، وتزاحم التنفيذ على الاستضافة. لا timeout على الـ Agent.
4. **ذاكرة هشّة:** لا ملف دائم منظّم للعضو — `MEMO` سطر واحد ≤650 حرفًا يُعاد كتابته كل رسالة، و«سجل الجلسة» في static data عالمية (تُفقد عند إعادة الاستيراد، لا تُنظَّف أبدًا، وتُكتب من تنفيذات متزامنة). لا تصنيف A–F، لا أهداف، لا تفضيلات، لا مسار متابعة.
5. **prompt واحد عملاق بمصادر تعليمات متعارضة:** system prompt (13.6k) + «مرجع الإدارة» من إعدادات الهب (≈6k) + كتالوج الخدمات + 18 فيديو + 28 رابطًا، في كل رسالة. التعارضات المرصودة في القسم 4.
6. **طبقة الأدوات ضعيفة:** بحث LIKE بلا ترتيب دلالي، 6 نتائج فقط، لا أداة للتحقق من العضوية (تأتي بالسياق فقط)، لا فعاليات، لا حجز، لا كتابة ملف، لا تصعيد كأداة (handoff فعل نصي فقط)، لا بحث سوق. الـ Agent لا يعرف نوايا التطبيق (M145) — تُجاب قبله.
7. **لا حماية من حقن التعليمات:** نص الصفحة الحي (≤6000 حرف) والنص المظلَّل ومقتطفات المعرفة تدخل السياق بوصفها «الدليل الأول/الثاني» بلا تحديد أو تحذير.
8. **لا إعادة محاولة ولا idempotency في n8n:** فشل OpenAI ⇒ `Fallback Reply` فورًا؛ `Post Reply` timeout 30 ثانية بلا retry؛ لا تحقق من تكرار `message.id` (الهب يمنع تكرار الرد، لكن n8n قد يشغّل الـ Agent مرتين ويدفع مرتين).
9. **تنبيهات الليدات معطّلة** (evo_* فارغة) — الفرع ميت، ومعه workflow واتساب v33.
10. **اختبار الاتصال من الهب يفشل:** `Pong` يرسل `{pong:true, ping_id}` إلى `hub/reply`؛ الأرجح أن `tool_reply` يطلب `contact_id` فيرفضه (لم أتحقق من كود `tool_reply` — نقطة للمرحلة 2).
11. **بيانات شخصية في سجل التنفيذات** (أسماء، جوالات، إيميلات، نصوص المحادثات) تبقى في n8n بلا سياسة حذف — PDPL.
12. **الملف المصدَّر في New Era قديم** (لا يحمل قاعدة المستثمر الجديدة) ⇒ لا يصلح كنسخة احتياطية حالية.
13. **لا تتبع تكلفة** (tokens/رسالة، نموذج، مدة) ولا لوحة مراقبة.

---

## 3) ما يمكن إعادة استخدامه (لا يُعاد بناؤه)
- الهب كمصدر الهوية والمحادثات والـ gates (القاعدة 2) + أدواته الثمانية + `contact` tool (يعيد الملف + memo + 30 دورًا).
- حارس `Split Reply` وبروتوكول الأفعال (ناضج ومجرَّب) — يبقى كما هو.
- منطق `Build Context` (وضع التطبيق، إخفاء الأسعار، الجلسات، ★) — يُقسَّم إلى أجزاء أصغر لا يُحذف.
- سيرفر التطبيق: بنك المشاريع المحجوب، الفعاليات/الورش، حجز المقر، intents M145.
- رُخص OpenAI الحالية في n8n.

---

## 4) قائمة التعارضات (قرارك مطلوب — لا أخترع)
| # | المصدر 1 | المصدر 2 | التعارض |
|---|---|---|---|
| C1 | prompt الحي: «لا تسأل المستثمر عن المبلغ أبدًا» | إعدادات الهب «instructions»: «المستثمر: هدفك أن تعرف كم المبلغ» | أيهما؟ (أرجّح الـ prompt الحي، وتُحذف الجملة من إعدادات الهب) |
| C2 | prompt: «العضوية سنوية فقط بلا أي سعر ترويجي» | الكتالوج: «سعر ترويجي لفترة محدودة — القيمة الأساسية 3,900» + «1,900 بدل 3,900» | هل 1,900 سعر دائم أم عرض؟ |
| C3 | قاعدة «بدون رسوم» | الكتالوج والـ instructions: «مجانًا»، «استشارة مجانية»، «كتاب … (مجاني)» | تصحيح النصوص في إعدادات الهب |
| C4 | قاعدة «الشراكات لا الصفقات» | روابط: «QDT الصفقات السريعة» | اسم شركة — يُستثنى؟ |
| C5 | brand: «Vibes Ventures» | عنوان الموقع في الهب: «فابيز القابضة»، مشروع «ڤايبز القابضة»، كلمات مفتاحية «فايبز القابضة» | تنظيف أسماء المواقع/الكلمات المفتاحية |
| C6 | instructions: «عرض سبتمبر حتى 30 سبتمبر» (أسعار البودكاست) | التاريخ اليوم 28 أكتوبر | عرض منتهٍ ما زال يُرسل للنموذج |
| C7 | instructions: «وضع العميل: مسجّل غير مفعّل ⇒ ممنوع الاستشارة» و«في كل رد دعوة للاشتراك» | prompt + طلب M150: «لا ضغط للاشتراك، التحليل حق لغير العضو» | سياسة غير العضو |
| C8 | instructions: «أي مستثمر: خذ اسمه وجواله وأعطه زر الإدارة فورًا» | M150: مسار مستثمر موجَّه بأسئلة ثم ترشيح | |
| C9 | instructions: «ركّز هذا الشهر على العضوية» | لا تاريخ انتهاء | |
| C10 | الكتالوج: «رصيد التواصل مع 5 مشاريع» / «رصيد 2,500 ريال» | M144 بطاقة الرصيد في التطبيق | التأكد من الرقم الحالي |

---

## 5) المعمارية المستهدفة (نسخة اختبار، v5)

```
Hub (كما هو) ──POST──▶ [W1 Brain v5 TEST]
  Webhook → Verify (HMAC header + secret) → Normalize & Dedupe (message.id, 10 دقائق)
  → Load (contact من الـ payload + profile_json من الهب) → Classify A–F (gpt-5-mini، يُخزَّن بالملف)
  → Router: {ping | identified-event | admin | app-intent-hint | advisor}
  → Advisor Agent (prompt ≈4k ثابت + «بطاقة الحالة» مختصرة، لا كتالوج كامل)
       tools ⇢ hub: search_knowledge, get_page, get_form, get_member_profile, verify_membership,
                      get_service_catalog, get_membership_benefits, save_profile, register_lead
                ⇢ app server (bridge key جديد): search_projects, get_project_details(محجوب),
                      get_upcoming_events, request_event_booking(طلب فقط، لا تأكيد), hq_slots
                ⇢ sub-workflows: W5 business_assessment/action_plan, W6 research_saudi_market,
                      W7 company_formation_checklist/founder_intake, escalate_to_human, create_followup_task
  → Validate (Split Reply الحالي + فحص «ادّعاء فعل بلا أداة» + تنويه التقييم)
  → Post Reply (retry ×2) → Memory update (profile_json + summary) → Log (Data Table: tokens, model, ms, route)
  [Error Workflow] → تنبيه للمالك (بريد عبر hub send_mail أو واتساب) + رد احتياطي
```

**الذاكرة الدائمة — التوصية:** تبقى في **الهب (MySQL)** لا في Postgres السيرفر: الهب هو مصدر الهوية الوحيد (القاعدة 2)، يحمل اليوم `memo` و`turns`، وفيه `delete_account` (حق الحذف PDPL). المطلوب: عمود `profile_json` + أداتان `profile_get/profile_put` في بلجن الهب 2.22 (schema: الفئة A–F، الهدف، القطاعات، المرحلة، رأس المال كنطاق اختياري، التفضيلات، ما عُرض/رُفض، المتابعات المُوافَق عليها، آخر ملخص). Postgres السيرفر يُستعمل فقط لما يخص التطبيق (الحجوزات، الفعاليات، سجل التكلفة لو أردنا لوحة في الداشبورد). n8n لا يملك Postgres credential أصلًا.

**قاعدة المعرفة:** جدول knowledge في الهب موجود ويُغذَّى من كل موقع. الإضافة: جدول KB منسَّق (Data Table في n8n أو جدول في الهب) بترتيب أولوية المصدر: (1) إعدادات الهب/الكتالوج ⇒ (2) صفحات vcmem.com (tiers, investors-process, payment, update, member-benefits) ⇒ (3) vibesholding.com ⇒ (4) بقية المواقع ⇒ (5) معرفة عامة. كل بند بمصدره وتاريخه، والتعارضات تُدوَّن في القسم 4 ولا تُحل آليًا.

**قائمة الـ workflows المقترحة**
| # | الاسم | الدور | يحتاج من المالك |
|---|---|---|---|
| W1 | `Vibes Brain v5 — TEST` | الخط الرئيسي (أعلاه)، webhook مسار جديد `/vibes-brain-test` | لا شيء (نسخة) |
| W2 | `Brain — Error & Monitor` | Error Workflow + ملخص يومي (عدد الردود، الأخطاء، المدة، التكلفة) | وجهة التنبيه (بريد/واتساب) |
| W3 | `Brain — Knowledge Builder` | يبني/يحدّث KB المنسَّق من الهب والمواقع، يدوّن التعارضات | الموافقة على ترتيب المصادر |
| W4 | `Brain — Projects & Events` (sub) | بنك المشاريع المحجوب + الفعاليات + طلبات الحجز عبر السيرفر | `BRIDGE` key جديد على Railway (test أولًا) |
| W5 | `Brain — Business Assessment` (sub) | تشخيص صاحب الشركة + خطة 30/60/90 | — |
| W6 | `Brain — Saudi Market Research` (sub) | بحث بمصادر رسمية فقط (GASTAT, MISA, MoC, SAMA, CMA) بصيغة «ما نعرفه/ماذا يعني/السيناريوهات/الخطوة» | أداة بحث ويب (OpenAI web search أو مزوّد) — قد تكون مدفوعة |
| W7 | `Brain — Founder Path` (sub) | intake + checklist تأسيس (سعودي/خليجي/أجنبي) من مصادر رسمية + الإحالة للشريك | اسم الشريك المعتمد |
| W8 | `Brain — Follow-ups` | متابعات بموافقة فقط (cron) عبر الهب/البريد | سياسة المتابعة |

**الاختبار بلا مساس بالإنتاج:** الهب الحي يرسل لـ v4.11 فقط. النسخة التجريبية تُغذَّى من (أ) payloads حقيقية مثبّتة (pin data) من التنفيذات، و(ب) نسخة الهب في الـ rig (`C:\Projects\vibes-test-rig`) موجّهة إلى webhook الاختبار. التبديل في الإنتاج قرار المالك وحده (تغيير رابط n8n في إعدادات الهب — خطوة واحدة قابلة للرجوع فورًا).

---

## 6) الأدوات المطلوبة في M150 ↔ ما يوجد
| الأداة المطلوبة | الوضع | التنفيذ |
|---|---|---|
| get_member_profile | جزئي (بالسياق) | hub `contact` tool + profile_json |
| verify_membership | جزئي (بالسياق) | من الـ payload؛ أداة للتأكيد عند الحاجة |
| search_projects / get_project_details | جزئي (`projects` 6 نتائج، بلا تفاصيل) | سيرفر التطبيق `/api/projects` محجوب |
| register_partnership_interest | جزئي (LEAD partner) | يبقى LEAD + تسجيل في الملف |
| get_upcoming_events / request_event_booking | غير موجود | سيرفر التطبيق agenda/hq (طلب فقط) |
| get_membership_benefits / get_service_catalog | بالسياق كاملًا كل مرة | أداة عند الطلب بدل حقن الكتالوج دائمًا |
| create_business_assessment / generate_business_action_plan | غير موجود | W5 |
| research_saudi_market | غير موجود | W6 |
| create_founder_intake / create_company_formation_checklist | غير موجود | W7 |
| request_consultation / escalate_to_human | جزئي (handoff) | أداة تكتب تذكرة في الهب (admin_tickets موجود للقراءة؛ يحتاج op كتابة) |
| create_followup_task | غير موجود | W8 + profile_json |
| save_conversation_summary | جزئي (MEMO) | profile_put |

---

## 7) ما أحتاجه منك قبل المرحلة 2 (نعم/لا)
1. الموافقة على المعمارية أعلاه، وعلى أن الذاكرة الدائمة في الهب (بلجن 2.22 بأداتي profile_get/put) لا في Postgres.
2. الموافقة على إنشاء workflow جديد `Vibes Brain v5 — TEST` في n8n (كتابة عبر MCP) + Error Workflow. v4.11 لا يُلمس.
3. مفتاح bridge جديد على سيرفر Railway **test** ليقرأ n8n المشاريع المحجوبة والفعاليات (أنا أكتب الكود، أنت تضيف المتغير).
4. قرار التعارضات C1–C10 (القسم 4) — أو «خذ الـ prompt الحي مرجعًا وأرني ما غيّرته».
5. أداة بحث الويب للسوق السعودي (W6): هل نستخدم OpenAI web search (تكلفة إضافية لكل بحث)؟
6. تصحيح فوري مستقل عن M150 (أنصح به اليوم): نقل الأسرار من عقدة Config إلى n8n Variables/Credentials وتقليل حفظ بيانات التنفيذ — تعديل صغير على v4.11 يحتاج إذنك لأنه يمس الإنتاج.
