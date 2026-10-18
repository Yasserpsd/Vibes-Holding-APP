# ✅ Checklist الإطلاق — خطوة بخطوة (M8)

> الملف ده ليك انت يا صاحب التطبيق: الخطوات اللي محتاجة **كليكاتك انت** في المواقع.
> كل النصوص الجاهزة للنسخ موجودة في `docs/STORES.md` (الأقسام 6 و7 و8).
> القاعدة الثابتة: مفيش حاجة بتتحول production ومفيش أي build من غير ما تقول صراحةً.

## اللي جاهز خلاص (مش محتاج منك حاجة)

- ✅ صفحات السياسة والشروط وحذف الحساب شغالة لايف (اللينكات في STORES.md قسم 2).
- ✅ حساب المراجعة `ceo@vibesholding.com` متعمل وبعضوية سنوية فعّالة (الباسوورد معاك انت بس).
- ✅ إجابات فورم الخصوصية في المتجرين جاهزة سؤال بسؤال (قسم 6).
- ✅ نصوص الوصف والاسم والكلمات المفتاحية جاهزة للنسخ (قسم 7) وتعليمات المراجعين (قسم 8).
- ✅ سيرفر الإنتاج قائم على Railway (مش موصّل بحد لسه — ده طبيعي).

## المرحلة 1 — Google Play Console (play.google.com/console)

1. كمّل أي Verification ناقص في الحساب (الهوية، بيانات الدفع، صفحة المطور).
2. **Create app**: الاسم `Investors Club`، اللغة الافتراضية العربية، App، Free
   (التطبيق نفسه تنزيله بدون رسوم — العضوية اشتراك جواه).
3. **App content** (القائمة الشمال تحت):
   - Privacy policy → حط لينك السياسة من STORES.md قسم 2.
   - App access → «All or some functionality is restricted» → حط بيانات حساب
     الديمو + انسخ التعليمات من قسم 8.
   - Ads → **No ads**.
   - Content ratings → استبيان: تطبيق أعمال، مفيش محتوى حساس.
   - Target audience → **18+**.
   - Data safety → جاوب بالظبط زي الجدول في قسم 6 (أهم حاجة: التحليلات
     first-party والمعرّف عشوائي مش مربوط بالحساب).
   - Account deletion → حط لينك صفحة حذف الحساب من قسم 2.
   - Financial features → التطبيق بيبيع عضوية نادي وخدمات، مش منتجات مالية
     منظّمة (نراجع أسئلة الفورم سوا لو ظهرت).
4. **Store listing**: انسخ الوصف القصير والطويل من قسم 7، وارفع الأيقونة
   (العلامة الذهبية بس) + feature graphic + 4 سكرينشوتات عربي على الأقل.
5. **Monetization → Subscriptions**: اعمل `club_membership_annual`، خطة سنوية،
   الاسم «العضوية السنوية لنادي المستثمرين»، والسعر قرارك انت.
6. متنشرش حاجة لسه — هنطلع أول build إنتاج على **Internal testing** الأول.

## المرحلة 2 — App Store Connect (appstoreconnect.apple.com)

1. اقبل الاتفاقيات + كمّل **Paid Apps agreement** والبنك والضرائب.
2. **New App**: bundle id `com.vcmem.investorsclub`، الاسم `Investors Club`،
   اللغة الأساسية العربية، التصنيف Business.
3. **App Privacy**: جاوب زي قسم 6 (Apple) بالظبط + لينك السياسة.
4. **Subscriptions**: جروب «العضوية» → `club_membership_annual` سنوي،
   الاسم المعرّب «العضوية السنوية لنادي المستثمرين»، والسعر قرارك.
5. **App Review Information**: بيانات حساب الديمو + انسخ الـ Notes من قسم 8.
6. **Store listing**: الوصف من قسم 7 + subtitle + keywords + سكرينشوتات.

## المرحلة 3 — RevenueCat + مفاتيح الإنتاج (أنا بجهّز وانت بتدوس)

1. مشروع RevenueCat إنتاج: تطبيق Android + iOS، entitlement `membership`،
   المنتج `club_membership_annual` متوصّل بالـ offering.
2. Webhook → لينك سيرفر الإنتاج `/api/webhooks/revenuecat` + قيمة Authorization.
3. على Railway إنتاج: `REVENUECAT_PUBLIC_KEY_ANDROID` و`REVENUECAT_PUBLIC_KEY_IOS`.
4. Firebase: تطبيق Android لـ `com.vcmem.investorsclub` → ملف
   `google-services.json` يتحط كـ EAS production file variable (مفتاح FCM V1 موجود خلاص).

## المرحلة 4 — أول build إنتاج (محتاج موافقتك الصريحة — بياكل من حصة EAS)

1. قبلها: نحدّث `EXPO_PUBLIC_API_URL` في بروفايل production لسيرفر الإنتاج،
   ونسجّل SHA-1 بتاع keystore الإنتاج في Google Cloud (عشان تسجيل دخول Google).
2. انت تقول «اعمل build إنتاج» → أنا أجهّز الأمر وانت تشغّله:
   `eas build --platform all --profile production`
3. Android → Internal testing track الأول وتجرب على موبايلك.
   iOS → TestFlight وتجرب.
4. نتأكد: تسجيل دخول حساب الديمو، شاشات الأعضاء، بنك المشاريع، شاشة العضوية.

## المرحلة 5 — التقديم والإطلاق (كلمتك انت بس)

1. Submit for review في المتجرين (مراجعة Apple عادةً من يوم لأسبوع، Google أسرع غالبًا).
2. لو جه رفض: ابعتلي نص الرفض زي ما هو وأنا أرد عليه.
3. **يوم الإطلاق** (بعد الموافقة، وبكلمتك الصريحة) — التحويلة الوحيدة على الأنظمة الحية:
   - الهاب: `app_webhook_url` يتحول لسيرفر الإنتاج + صف موقع «خادم التطبيق — الإنتاج».
   - بنك المشاريع: `pdp_bridge_webhook` يتحول لسيرفر الإنتاج.
   - Paymob: مفاتيح اللايف على سيرفر الإنتاج (من غير أي تغيير في callback URLs — قاعدة 6).
   - الداشبورد `VITE_API_URL` لو هتحوّله.
4. Release للـ production track في Google + «Release this version» عند Apple.

---
*آخر تحديث: 2026-10-18 — الحالة التفصيلية في docs/PROJECT_BRIEF.md (M7/M8).*
