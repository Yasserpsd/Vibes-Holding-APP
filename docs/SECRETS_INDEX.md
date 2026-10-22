# فهرس الأسرار — أماكن فقط، بدون أي قيمة (قاعدة 1)

آخر تحديث: 2026-10-23. القيم تعيش فقط في: متغيرات Railway، متغيرات EAS، أو ملفات محلية git-ignored على جهاز المالك. ممنوع أي قيمة هنا أو في الشات أو الكود.

## ملفات محلية (git-ignored، على جهاز المالك فقط)
| الملف | المحتوى | يُستخدم في |
|---|---|---|
| `server/.secrets.local/revenuecat-play-service-account.json` | مفتاح حساب الخدمة `revenuecat-play@vibes-holding.iam.gserviceaccount.com` (Pub/Sub Admin + Monitoring Viewer) | يُرفع في RevenueCat → Play app credentials، ودعوته في Play Console → Users and permissions |
| `server/.secrets.local/SubscriptionKey_4K8A2U49KC.p8` | مفتاح In-App Purchase من App Store Connect (Key ID `4K8A2U49KC`، Issuer `f360c8ab-8d6a-4d8f-878d-97086c20c4d1`) — تنزيله من Apple مرة واحدة فقط، فهذه النسخة الوحيدة | مرفوع في RevenueCat → App Store app (app65d5f4e808) In-app purchase key |
| `server/.rc-webhook-auth.local` | قيمة Authorization لويبهوك RevenueCat (اتولدت 2026-10-21 بعد تسريب القديمة) | RevenueCat webhook config + Railway `REVENUECAT_WEBHOOK_AUTH` (test + prod) |
| `server/.env` | أسرار التشغيل المحلي (hub bridge، Paymob test، …) | السيرفر المحلي |
| `server/.env.admin.local` | توكن جلسة الأدمن للسكريبتات المحلية | scripts/admin-*.mjs |
| `app/google-services.json` | إعداد Firebase (ليس سرًا خالصًا لكنه git-ignored) | البناء المحلي + مصدر متغير EAS |

## Railway — سيرفس `vibes-holding-app` (TEST) و`club-api-prod` (PROD)
بدون قيم: `MOYASAR_SECRET_KEY`، `PAYMOB_*`، `OPENAI_API_KEY`، `SMTP_*` (كلمة سر الصندوق)، `HUB_*` و`PB_*` (مفاتيح جسر vcmem/بنك المشاريع)، `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (ample-vault، اتجددت 2026-10-22)، `REVENUECAT_WEBHOOK_AUTH`، `REVENUECAT_PUBLIC_KEY_ANDROID` (قيمة علنية goog_…)، `REVENUECAT_PUBLIC_KEY_IOS` (قيمة علنية appl_…).
حالة prod 2026-10-22: `REVENUECAT_PUBLIC_KEY_ANDROID` و`REVENUECAT_WEBHOOK_AUTH` اتضافوا واتأكدوا live. 2026-10-23: `REVENUECAT_PUBLIC_KEY_IOS` **لسه ناقص على club-api-prod** (القيمة العلنية: `appl_IQlIRokuJfzKLgduAZgxeftlQdz`).

## EAS (expo.dev — مشروع vibes-holding)
| المتغير | البيئة | النوع |
|---|---|---|
| `GOOGLE_SERVICES_JSON` | preview | ملف سري |
| `GOOGLE_SERVICES_JSON` | production | ملف سري (اتعمل 2026-10-22 بالملف الجديد ذي الباكدجين) |
| Android keystore | تُدار على سيرفر EAS (Build Credentials `nA7kBr7AIP`) | — |

## أماكن خارجية
- **RevenueCat** (project aa216991): المفتاح العلني goog_… + قيمة الويبهوك (مصدرها `.rc-webhook-auth.local`).
- **Google Cloud** (vibes-holding): حساب الخدمة `revenuecat-play` — مفتاحه الوحيد هو الملف المحلي أعلاه (private_key_id يبدأ ccc2a897…).
- **Moyasar / Paymob / vcmem hub**: لوحاتها الخاصة بحساب المالك.
