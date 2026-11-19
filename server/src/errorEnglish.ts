import type { AppLang } from './lang.js';

/**
 * M242 (complaint «عربي في وضع الإنجليزية»): the server writes every refusal in Arabic, so the English app could
 * only show its general «something went wrong». These are the same refusals in English, written by hand beside
 * the Arabic they stand for — fixed sentences, no AI call, nothing cached.
 *
 * `SENTENCES_EN` is keyed by the Arabic sentence exactly as the code sends it (a test fails when one of the
 * keys no longer exists in the source, so an edited Arabic sentence cannot silently lose its English).
 * `PATTERNS_EN` covers the few sentences that carry a number. `CODES_EN` is the general sentence of a code,
 * for a sentence that has no twin of its own (the hub's own wording, a dashboard text, a new sentence).
 *
 * House wording: «management» for «الإدارة», «email» without a hyphen, never «free», no promised returns.
 * Dashboard-only sentences are left out on purpose: the dashboard is Arabic.
 */
export const SENTENCES_EN: Record<string, string> = {
  // The general answers (auth/guard.ts, app.ts).
  'البيانات غير مكتملة أو غير صحيحة': 'Some of the details are missing or not valid.',
  'سجّل الدخول أولًا': 'Sign in first.',
  'المسار غير موجود': 'This address does not exist.',
  'حدث خطأ غير متوقع': 'An unexpected error occurred.',
  'طلب غير صالح': 'The request is not valid.',
  'محاولات كثيرة، حاول بعد قليل': 'Too many attempts. Try again shortly.',
  'محاولات كثيرة في وقت قصير، حاول بعد قليل': 'Too many attempts in a short time. Try again shortly.',
  'طلبات كثيرة في وقت قصير، حاول بعد قليل': 'Too many requests in a short time. Try again shortly.',
  // M253: the sentence under a refused field whose rule has none of its own (auth/guard.ts).
  'هذه الخانة مطلوبة': 'This field is required.',
  'أضف عنصرًا واحدًا على الأقل في هذه الخانة': 'Add at least one item in this field.',
  'اختر أحد الخيارات المتاحة في هذه الخانة': 'Choose one of the available options in this field.',
  'قيمة هذه الخانة غير صحيحة': 'The value of this field is not valid.',
  'اكتب اسم الشركة لإكمال التسجيل': 'Enter the company name to complete your registration.',
  'اكتب المدينة': 'Enter the city.',
  'اكتب العنوان الذي تصل إليه البطاقة': 'Enter the address the card will be delivered to.',

  // Sign-up, sign-in and the account (auth/routes.ts, auth/service.ts, auth/social.ts, hub/phone.ts).
  'الاسم مطلوب': 'Your name is required.',
  'رقم الجوال مطلوب': 'Your mobile number is required.',
  'البريد الإلكتروني مطلوب': 'Your email is required.',
  'اكتب بريدك الإلكتروني': 'Enter your email.',
  'اكتب بريدًا إلكترونيًا صحيحًا (مثل name@example.com)': 'Enter a valid email (for example name@example.com).',
  'كلمة المرور 6 أحرف على الأقل': 'The password must be at least 6 characters.',
  'كلمة المرور مطلوبة': 'The password is required.',
  'كلمة المرور غير صحيحة': 'The password is not correct.',
  'الرمز 4 أرقام': 'The code is 4 digits.',
  'أدخل الرمز': 'Enter the code.',
  'اكتب نبذة مختصرة عنك (سطر على الأقل)': 'Write a short bio (at least one line).',
  'اكتب كلمة التأكيد': 'Type the confirmation word.',
  'أدخل كلمة المرور أو أكّد هويتك بحساب جوجل أو أبل': 'Enter your password, or confirm your identity with your Google or Apple account.',
  'هذا الحساب لا يطابق حسابك في النادي — أكّد بحساب جوجل أو أبل الذي تسجّل به الدخول': 'This account does not match your club account. Confirm with the Google or Apple account you sign in with.',
  'الرمز يُرسل على واتساب فقط. إذا لم يصلك، تواصل مع دعم النادي على واتساب.': 'The code is sent on WhatsApp only. If it does not arrive, contact the club support on WhatsApp.',
  'حدّث التطبيق لتغيير رقمك': 'Update the app to change your number.',
  'حدّث التطبيق لتسجيل الدخول': 'Update the app to sign in.',
  'تغيير التوجه يتم بالرمز المُرسل إلى بريدك الإلكتروني': 'Your direction is changed with the code sent to your email.',
  'هذا هو توجهك الحالي بالفعل': 'This is already your current direction.',
  'تعذر إرسال الرمز الآن، حاول بعد قليل': 'We could not send the code right now. Try again shortly.',
  'تعذر إرسال الرمز الآن، حاول بعد قليل أو تواصل مع الدعم': 'We could not send the code right now. Try again shortly or contact support.',
  'تعذر إرسال الرمز الآن، حاول لاحقًا أو تواصل مع الدعم': 'We could not send the code right now. Try again later or contact support.',
  'طلبات كثيرة، حاول لاحقًا': 'Too many requests. Try again later.',
  'تغييرك السنوي ما زال متاحًا — غيّر توجهك مباشرة بالرمز المرسل إلى بريدك': 'Your yearly change is still available. Change your direction directly with the code sent to your email.',
  'لديك طلب تغيير قائم بالفعل، وستصلك نتيجته بإشعار': 'You already have a change request open; you will be notified of its result.',
  'حذف حسابك مجدول بالفعل': 'The deletion of your account is already scheduled.',
  'التسجيل غير متاح في النسخة التجريبية حاليًا. سجّل الدخول بحساب الإدارة.': 'Registration is not open in the test version yet. Sign in with a management account.',
  'النسخة التجريبية متاحة لحسابات إدارة النادي فقط': 'The test version is open to club management accounts only.',
  'أكّد رقمك عبر واتساب لإكمال التسجيل': 'Confirm your number on WhatsApp to complete your registration.',
  'رقم الجوال هذا مسجّل لحساب آخر — سجّل الدخول برقم الجوال، أو استخدم «نسيت كلمة المرور»': 'This mobile number belongs to another account. Sign in with the mobile number, or use “Forgot your password?”.',
  'هذا البريد مسجّل لحساب آخر — سجّل الدخول، أو استخدم «نسيت كلمة المرور»': 'This email belongs to another account. Sign in, or use “Forgot your password?”.',
  'يوجد حساب بهذا الرقم، سجّل الدخول أو استخدم «نسيت كلمة المرور»': 'An account already uses this number. Sign in, or use “Forgot your password?”.',
  'لا يوجد حساب مسجل بهذه البيانات — أنشئ حسابك الجديد أولًا': 'No account is registered with these details. Create your account first.',
  'بريدك معروف لدى النادي، لكن لم يُنشأ له حساب في التطبيق بعد — أنشئ حسابك بالبريد نفسه ورقم جوالك':
    'The club knows your email, but no app account has been created for it yet. Create your account with the same email and your mobile number.',
  'رقم جوالك معروف لدى النادي، لكن لم يُنشأ له حساب في التطبيق بعد — أنشئ حسابك بالرقم نفسه وبريدك الإلكتروني':
    'The club knows your mobile number, but no app account has been created for it yet. Create your account with the same number and your email.',
  'بريد هذا الحساب غير موثّق لدى المزوّد — سجّل بالبريد وكلمة المرور': 'The email of this account is not verified by the provider. Register with your email and a password.',
  'الدخول بحساب جوجل أو أبل غير متاح حاليًا — سجّل بالبريد وكلمة المرور': 'Signing in with Google or Apple is not available at the moment. Register with your email and a password.',
  'لم يشارك الحساب بريدًا إلكترونيًا — اسمح بمشاركة البريد أو سجّل بالبريد وكلمة المرور': 'The account did not share an email. Allow sharing the email, or register with your email and a password.',
  'تعذّر التحقق من الحساب، حاول من جديد': 'We could not verify the account. Please try again.',
  'هذه الطريقة غير مفعّلة حاليًا — سجّل بالبريد وكلمة المرور': 'This sign-in method is not enabled at the moment. Use your email and password.',
  'تعذّر الاتصال بمزوّد الدخول، حاول بعد قليل': 'We could not reach the sign-in provider. Try again shortly.',
  'أغلق التطبيق وافتحه من جديد لإكمال التسجيل': 'Close the app and open it again to complete your registration.',
  'انتهت مهلة التسجيل، ابدأ من جديد': 'The registration time ran out. Please start again.',
  'انتهت مهلة الدخول، ابدأ من جديد': 'The sign-in time ran out. Please start again.',
  'انتهت مهلة التفعيل، ابدأ من جديد': 'The activation time ran out. Please start again.',
  'انتهت مهلة التحقق، ابدأ من جديد': 'The verification time ran out. Please start again.',
  'انتهت صلاحية الرمز، اضغط «إعادة الإرسال»': 'The code has expired. Tap “Resend”.',
  'محاولات خاطئة كثيرة، ابدأ الدخول من جديد': 'Too many wrong attempts. Start signing in again.',
  'تجاوزت عدد مرات إعادة الإرسال، ابدأ الدخول من جديد': 'You have used all the resend attempts. Start signing in again.',
  'أدخل رمز تطبيق المصادقة الحالي أولًا': 'Enter the current code from your authenticator app first.',
  'الرمز غير صحيح': 'The code is not correct.',
  'الرمز غير صحيح، تأكد من وقت جهازك وحاول مرة أخرى': "The code is not correct. Check your phone's time and try again.",
  'الحماية الإضافية غير مفعلة': 'Extra protection is not enabled.',
  'تطبيق المصادقة غير متاح على هذا الخادم': 'The authenticator app is not available on this server.',
  'حسابات إدارة النادي لا يمكنها إيقاف تطبيق المصادقة': 'Club management accounts cannot turn off the authenticator app.',
  'انتهت الجلسة، سجّل الدخول من جديد': 'Your session has ended. Sign in again.',
  'تعذّر حفظ كود الدعوة — امسحه وأكمل، أو تواصل مع الإدارة': 'The invite code could not be saved. Clear it and continue, or contact the management.',
  'الدعوات غير متاحة حاليًا — امسح كود الدعوة وأكمل التسجيل، وأخبر من دعاك': 'Invitations are not available at the moment. Clear the invite code, continue registering, and tell the person who invited you.',
  'تغيير الفئة غير متاح حاليًا، حاول لاحقًا': 'Changing your category is not available at the moment. Try again later.',
  'رمز واتساب غير مفعّل': 'The WhatsApp code is not enabled.',
  'هذا الرقم غير مفعّل على واتساب، اكتب رقمًا مفعّلًا لإكمال التسجيل': 'This number is not active on WhatsApp. Enter a number that is, to complete your registration.',
  'استجابة غير مكتملة من النادي': 'The club sent an incomplete answer.',
  'تعذّر الاتصال بالنادي الآن، حاول بعد قليل': "The club's service cannot be reached now. Try again shortly.",
  'هذه الخدمة غير متاحة حاليًا': 'This service is not available at the moment.',
  'استجابة غير متوقعة من النادي': 'The club sent an unexpected answer.',

  // The advisor (advisor/routes.ts).
  'اكتب رسالتك أولًا': 'Write your message first.',
  'الرسالة طويلة، الحد 4000 حرف': 'The message is too long; the limit is 4000 characters.',
  'ملف غير صالح': 'The file is not valid.',
  'الرد الصوتي غير متاح حاليًا': 'Spoken replies are not available at the moment.',
  'طلبات صوتية كثيرة في وقت قصير، حاول بعد قليل': 'Too many voice requests in a short time. Try again shortly.',
  'لا يوجد نص يُقرأ': 'There is no text to read.',
  'تعذر تحويل الرد إلى صوت، حاول مرة أخرى': 'The reply could not be turned into speech. Try again.',
  'رسائل كثيرة في وقت قصير، حاول بعد قليل': 'Too many messages in a short time. Try again shortly.',
  'الإدخال الصوتي غير متاح حاليًا': 'Voice input is not available at the moment.',
  'تسجيلات كثيرة في وقت قصير، حاول بعد قليل': 'Too many recordings in a short time. Try again shortly.',
  'تعذر قراءة التسجيل': 'The recording could not be read.',
  'التسجيل قصير جدًا': 'The recording is too short.',
  'تعذر تحويل الصوت إلى نص، حاول مرة أخرى': 'The recording could not be turned into text. Try again.',
  'ملفات كثيرة في وقت قصير، حاول بعد قليل': 'Too many files in a short time. Try again shortly.',
  'الملف ليس PDF صالحًا': 'The file is not a valid PDF.',
  'حجم الملف أكبر من 10 MB': 'The file is larger than 10 MB.',
  'التعبئة الصوتية غير متاحة حاليًا': 'Filling by voice is not available at the moment.',
  'تعذر فهم التسجيل، حاول مرة أخرى': 'The recording could not be understood. Try again.',

  // The affiliates programme, as the member meets it (affiliate/routes.ts, affiliate/service.ts).
  'اكتب اسم البنك': 'Enter the name of the bank.',
  'اكتب اسم صاحب الحساب كما هو مسجّل في البنك': 'Enter the account holder’s name as the bank has it.',
  'اكتب اسم صاحب الحساب بالأحرف الإنجليزية فقط كما هو مسجّل لدى البنك': 'Enter the account holder’s name in English letters only, as the bank has it.',
  'حدّد هل تقدّم الطلب بصفتك فردًا أم شركة': 'Say whether you are applying as an individual or as a company.',
  'اختر مدينة الإقامة': 'Choose your city of residence.',
  'اكتب عنوانًا فعليًا: الحي والشارع ورقم المبنى': 'Enter a real address: district, street and building number.',
  'اختر كيف عرفت عن نادي المستثمرين': 'Choose how you heard about the Investors Club.',
  'الرمز من 3 إلى 5 حروف لاتينية، ويمكن أن ينتهي برقم واحد من 2 إلى 9': 'The code is 3 to 5 Latin letters and may end with one digit from 2 to 9.',
  'هذا الرمز مستخدم لممثل آخر، أو يشبهه في الكتابة': 'This code is used by another affiliate, or looks too similar to one.',
  'قدّم طلب الانضمام أولًا': 'Submit your application to join first.',
  'هذه الخدمة لممثلي نادي المستثمرين المعتمدين': 'This service is for approved Investors Club affiliates.',
  'لديك طلب سحب قيد المراجعة بالفعل': 'You already have a withdrawal request under review.',
  'لا يوجد رصيد متاح للسحب حاليًا': 'There is no balance available to withdraw at the moment.',
  'أنت ممثل معتمد بالفعل': 'You are already an approved affiliate.',
  'طلبك قيد مراجعة الإدارة': 'Your application is under review by the management.',

  // The agenda and the workshops (agenda/routes.ts, agenda/service.ts, workshops/service.ts).
  'تسجيلات الورش حصرية لأعضاء العضوية السنوية': 'Workshop recordings are exclusive to annual members.',
  'الفعالية غير موجودة': 'This event does not exist.',
  'كود الخصم غير صحيح': 'The discount code is not correct.',
  'لا توجد رسوم على حضورك لهذه الفعالية': 'There is no fee for you to attend this event.',
  'هذه الفعالية بسعر مدعوم من النادي — لا يُجمع عليه عرض الشهر': 'This event is at a price supported by the club; the offer of the month does not add to it.',
  'التسجيل في هذه الفعالية مغلق حاليًا': 'Registration for this event is currently closed.',
  'هذه الفعالية انتهت': 'This event has ended.',
  'سجّلنا حضورك في هذه الفعالية من قبل': 'You are already registered for this event.',
  'التسجيل غير موجود': 'This registration does not exist.',
  'لم يتأكد حضورك في هذه الفعالية بعد': 'Your attendance at this event has not been confirmed yet.',
  'هذه الورشة غير موجودة': 'This workshop does not exist.',
  'التسجيل في هذه الورشة مغلق حاليًا': 'Registration for this workshop is currently closed.',
  'سجّلنا اهتمامك بهذه الورشة من قبل': 'We already have your interest in this workshop.',

  // The printed card, the contact thread, the content (card/service.ts, contact/*, content/routes.ts).
  'طلب النسخة المطبوعة متاح بعد تفعيل العضوية السنوية': 'The printed card can be requested once your annual membership is active.',
  'طلبك السابق ما زال قيد التنفيذ لدى الإدارة': 'Your previous request is still being processed by the management.',
  'الرسالة أطول من المسموح': 'The message is longer than allowed.',
  'الشركة غير موجودة': 'This company does not exist.',
  'أدخل رقم الجوال للتواصل معك': 'Enter your mobile number so we can reach you.',
  'الخدمة غير موجودة': 'This service does not exist.',
  'هذه الخدمة غير متاحة لحسابك': 'This service is not available for your account.',

  // Discount codes (discounts/service.ts).
  'اكتب كود الخصم': 'Enter the discount code.',
  'الكود غير موجود': 'This code does not exist.',
  'هذا الكود لم يبدأ بعد': 'This code is not active yet.',
  'انتهت صلاحية هذا الكود': 'This code has expired.',
  'استُنفدت مرات استخدام هذا الكود': 'This code has reached its usage limit.',

  // Forms and their files (forms/*).
  'رفع الملفات غير متاح حاليًا، أرسل الطلب بدون الملف وستطلبه منك الإدارة': 'File upload is not available at the moment. Send the request without the file and the management will ask you for it.',
  'نوع الملف غير مدعوم: ارفع ملف PDF أو PowerPoint أو Word أو صورة JPG أو PNG': 'This file type is not supported. Upload a PDF, PowerPoint or Word file, or a JPG or PNG picture.',
  'حجم الملف أكبر من 25 ميجابايت': 'The file is larger than 25 MB.',
  'هذا النموذج غير موجود': 'This form does not exist.',
  'هذا النموذج لا يقبل ملفات': 'This form does not take files.',
  'الملف غير موجود': 'This file does not exist.',
  'هذا النموذج للأعضاء المشتركين فقط — فعّل عضويتك السنوية ثم قدّم': 'This form is for subscribed members only. Activate your annual membership, then apply.',
  'سجّلنا طلبك في هذا النموذج من قبل، وستتواصل معك الإدارة': 'We already have your request in this form; the management will contact you.',
  'هذا التسجيل غير موجود': 'This registration does not exist.',

  // The headquarters (hq/*).
  'التاريخ غير صالح': 'The date is not valid.',
  'رقم الحجز غير صالح': 'The booking number is not valid.',
  'الوقت غير صالح': 'The time is not valid.',
  'الملاحظة طويلة، الحد 300 حرف': 'The note is too long; the limit is 300 characters.',
  'اختر مدة الحجز': 'Choose how long the booking is.',
  'الموعد خارج فترة الحجز المتاحة': 'The date is outside the period open for booking.',
  'الوقت خارج ساعات العمل': 'The time is outside working hours.',
  'المدة المطلوبة تتجاوز ساعات العمل، اختر وقتًا أبكر أو مدة أقصر': 'The booking runs past working hours. Choose an earlier time or a shorter booking.',
  'اختر الغرض من الزيارة': 'Choose the purpose of the visit.',
  'لديك حجز في هذا اليوم بالفعل': 'You already have a booking on this day.',
  'هذا الوقت محجوز، اختر وقتًا آخر': 'This time is booked. Choose another time.',
  'هذا الوقت مكتمل، اختر وقتًا آخر': 'This time is full. Choose another time.',
  'الحجز غير موجود': 'This booking does not exist.',
  'لا يمكن إلغاء هذا الحجز': 'This booking cannot be cancelled.',
  'لم تؤكد الإدارة هذا الحجز بعد': 'The management has not confirmed this booking yet.',

  // Interests, news, videos, the store, payments, polls, ratings, profiles, the Projects Bank.
  'اختر اهتمامًا واحدًا على الأقل': 'Choose at least one interest.',
  'رقم الخبر غير صالح': 'The news item number is not valid.',
  'الاهتمام غير معروف': 'This interest is not known.',
  'الخبر غير موجود': 'This news item does not exist.',
  'رقم الفيديو غير صالح': 'The video number is not valid.',
  'الفيديو غير موجود': 'This video does not exist.',
  'تعذّر التحقق من الاشتراك الآن، حاول بعد قليل': 'We could not verify the subscription right now. Try again shortly.',
  'البرومو كود لأعضاء العضوية السنوية المشتركين': 'The promo code is for subscribed annual members.',
  'تعذّر الاتصال ببوابة الدفع، حاول بعد قليل': 'The payment gateway cannot be reached. Try again shortly.',
  'تعذّر بدء عملية الدفع، حاول بعد قليل': 'The payment could not be started. Try again shortly.',
  'رد غير متوقع من بوابة الدفع': 'The payment gateway sent an unexpected answer.',
  'رقم العملية غير صالح': 'The payment number is not valid.',
  'هذه الخدمة لا تُدفع من داخل التطبيق': 'In-app payment is not available for this service.',
  'العملية غير موجودة': 'This payment does not exist.',
  'هذا المنشور ليس استفتاء': 'This post is not a poll.',
  'انتهى هذا الاستفتاء ولم يعد التصويت متاحًا': 'This poll has ended and voting is no longer available.',
  'هذا الخيار غير موجود في الاستفتاء': 'This option is not in the poll.',
  'سبق أن سجّلت صوتك في هذا الاستفتاء ولا يمكن تغييره': 'You have already voted in this poll, and the vote cannot be changed.',
  'المنشور غير موجود': 'This post does not exist.',
  'سجّل الدخول أولًا للمشاركة في الاستفتاء': 'Sign in first to take part in the poll.',
  'التقييم من نجمة إلى 5 نجوم': 'A rating is from 1 to 5 stars.',
  'التعليق طويل، الحد 500 حرف': 'The comment is too long; the limit is 500 characters.',
  'عنوان الرابط بحد أقصى 40 حرفًا': 'A link title is at most 40 characters.',
  'الرابط بحد أقصى 200 حرف': 'A link is at most 200 characters.',
  'خانة الروابط تقبل رابطًا كاملًا في كل سطر، مثل: instagram.com/username': 'The links box takes one full link per line, for example: instagram.com/username',
  'الروابط بحد أقصى 5 روابط': 'You can add up to 5 links.',
  'الوظيفة أو المنصب بحد أقصى 80 حرفًا': 'The job title is at most 80 characters.',
  'اسم الشركة بحد أقصى 120 حرفًا': 'The company name is at most 120 characters.',
  'المجال والخبرة بحد أقصى 160 حرفًا': 'Field and experience is at most 160 characters.',
  'المدينة بحد أقصى 80 حرفًا': 'The city is at most 80 characters.',
  'النبذة بحد أقصى 1200 حرف': 'The bio is at most 1200 characters.',
  'كل محطة في سطر مستقل، من 3 أحرف إلى 140 حرفًا': 'Each milestone goes on its own line, from 3 to 140 characters.',
  'المحطات بحد أقصى 10 أسطر': 'Milestones are at most 10 lines.',
  'كل إنجاز في سطر مستقل، من 3 أحرف إلى 300 حرف': 'Each achievement goes on its own line, from 3 to 300 characters.',
  'الإنجازات بحد أقصى 10 أسطر': 'Achievements are at most 10 lines.',
  'كل نقطة استفادة في سطر مستقل، من 3 أحرف إلى 200 حرف': 'Each benefit point goes on its own line, from 3 to 200 characters.',
  'نقاط الاستفادة بحد أقصى 10 أسطر': 'Benefit points are at most 10 lines.',
  'ما تبحث عنه من الأعضاء بحد أقصى 600 حرف': 'What you are looking for is at most 600 characters.',
  'رقم الجوال بحد أقصى 40 خانة': 'The mobile number is at most 40 characters.',
  'البريد الإلكتروني بحد أقصى 190 حرفًا': 'The email is at most 190 characters.',
  'اكتب وظيفتك أو منصبك': 'Enter your job or position.',
  'اكتب مجالك وخبرتك': 'Enter your field and experience.',
  'اكتب مدينتك': 'Enter your city.',
  'اكتب نبذة أوفى عن شخصيتك ومسيرتك': 'Write a fuller bio about yourself and your career.',
  'أضف محطة واحدة على الأقل من مسيرتك': 'Add at least one milestone of your career.',
  'التقديم في «شخصية ومسيرة» متاح بعد تفعيل العضوية السنوية': 'Applying to “Person and Career” is available once your annual membership is active.',
  'المشروع غير موجود': 'This project does not exist.',
  'رقم المشروع غير صالح': 'The project number is not valid.',
  'معاملات البحث غير صالحة': 'The search options are not valid.',
  'المشاريع الذهبية لا تحتاج إلى فتح: صفحة الشراكة متاحة للجميع': 'Golden projects need no unlocking: their partnership page is open to everyone.',
  'تعذّر الاتصال ببنك المشاريع الآن، حاول بعد قليل': 'The Projects Bank cannot be reached right now. Try again shortly.',
  'استجابة غير متوقعة من بنك المشاريع': 'The Projects Bank sent an unexpected answer.',
  'هذه الميزة لأعضاء النادي المشتركين': 'This feature is for subscribed club members.',
  'هذه الميزة حصرية لأعضاء نادي المستثمرين. انضم الآن للاستفادة من جميع مزايا العضوية.': 'This feature is exclusive to Investors Club members. Join now to enjoy all membership benefits.',
  'انتهى رصيدك في بنك المشاريع لهذا العام': 'Your Projects Bank balance for this year has been used up.',
  'رمز الإشعارات غير صالح': 'The notifications token is not valid.',
};

/** Sentences that carry a number: the same sentence in English, with the number as it came. */
export const PATTERNS_EN: [pattern: RegExp, english: (match: RegExpMatchArray) => string][] = [
  [/^رصيد ساعاتك السنوي لا يكفي: المتبقي (\d+) من (\d+) ساعة$/, (m) => `Your annual hours balance is not enough: ${m[1]} of ${m[2]} hours left.`],
  [/^يتاح سحب الأرباح بعد اكتمال (\d+) أعضاء مسدّدين لرسوم العضوية عبر رمزك، وعدد المسدّدين لديك الآن (\d+)$/, (m) => `Payouts open once ${m[1]} referred members have paid the membership fee; you have ${m[2]} so far.`],
  [/^اختر (\d+) اهتمامات كحد أقصى$/, (m) => `Choose at most ${m[1]} interests.`],
  [/^انتظر (\d+) ثانية قبل طلب رمز جديد$/, (m) => `Wait ${m[1]} seconds before asking for a new code.`],
  [/^انتظر (\d+) ثانية ثم اطلب رمزًا جديدًا$/, (m) => `Wait ${m[1]} seconds, then ask for a new code.`],
  [/^الرمز غير صحيح، باقي (\d+) محاولات$/, (m) => `The code is not correct; ${m[1]} attempts left.`],
  [/^محاولات دخول كثيرة لهذا الحساب، حاول بعد (\d+) دقيقة$/, (m) => `Too many sign-in attempts for this account. Try again in ${m[1]} minutes.`],
  [/^يمكنك تغيير فئتك مرة واحدة فقط خلال السنة — متبقٍ (\d+) يومًا\. يمكنك إرسال «طلب تغيير الفئة» إلى الإدارة\.$/, (m) => `You can change your category only once a year; ${m[1]} days left. You can send a category change request to the management.`],
  [/^أكمل تفاصيل الطلب قبل الدفع: /, () => 'Complete the details of the request before paying.'],
  // M253: the sentences auth/guard.ts writes for a rule that has none of its own.
  [/^النص أطول من المسموح، الحد الأقصى للأحرف: (\d+)$/, (m) => `The text is too long; the limit is ${m[1]} characters.`],
  [/^العدد أكثر من المسموح، الحد الأقصى: (\d+)$/, (m) => `Too many items; the limit is ${m[1]}.`],
  [/^القيمة أكبر من المسموح، الحد الأقصى: ([\d.]+)$/, (m) => `The value is too high; the limit is ${m[1]}.`],
  [/^النص أقصر من المطلوب، الحد الأدنى للأحرف: (\d+)$/, (m) => `The text is too short; write at least ${m[1]} characters.`],
  [/^القيمة أقل من المسموح، الحد الأدنى: ([\d.]+)$/, (m) => `The value is too low; the minimum is ${m[1]}.`],
];

/** The general sentence of a code, for an Arabic sentence that has no twin above. */
export const CODES_EN: Record<string, string> = {
  invalid: 'Some of the details entered are not valid.',
  bad_request: 'The request is not valid.',
  not_found: "We couldn't find what you asked for.",
  rate: 'Too many attempts. Wait a moment, then try again.',
  unauthorized: 'Sign in first.',
  forbidden: 'This page is not available for your account.',
  internal: 'An unexpected error occurred.',
  duplicate: 'This already exists.',
  decided: 'This request has already been decided.',
  members_only: 'This is for club members only.',
  locked: 'This is not available for your account.',
  bad_login: 'The email or mobile number, or the password, is wrong.',
  exists: 'You already have an account with this email or mobile number. Sign in, or use “Forgot your password?”.',
  no_account: 'No account is registered with these details. Create your account first.',
  session_expired: 'Your session has ended. Sign in again.',
  bad_password: 'The password is not correct.',
  hub_unreachable: "The club's service cannot be reached now. Try again shortly.",
  hub_error: 'The club sent an unexpected answer.',
  hub_not_supported: 'This service is not available at the moment.',
  uploads_unavailable: 'File upload is not available at the moment.',
  too_big: 'The file is too large.',
  too_large: 'The file is too large.',
  gateway: 'The payment gateway cannot be reached. Try again shortly.',
  bad_date: 'The date is outside the period open for booking.',
  bad_time: 'The time is outside working hours.',
  bad_span: 'The booking runs past working hours. Choose an earlier time or a shorter booking.',
  bad_purpose: 'Choose the purpose of the visit.',
  bad_option: 'This option is not in the poll.',
  totp_bad_code: "The code is not correct. Check your phone's time and try again.",
  totp_locked: 'Too many wrong attempts. Start signing in again.',
  totp_expired: 'Time ran out. Please start again.',
  totp_code_needed: 'Enter the current code from your authenticator app first.',
  totp_off: 'Extra protection with an authenticator app is not enabled.',
  totp_mandatory: 'Club management accounts cannot turn off the authenticator app.',
  already_registered: 'We already have your registration, so there is no need to register again.',
  closed: 'Registration is currently closed.',
  full: 'This time is not available. Choose another time.',
  not_cancellable: 'This booking cannot be cancelled.',
  wallet_exhausted: 'Your annual hours balance is not enough for this booking.',
  already_voted: 'You have already voted in this poll, and the vote cannot be changed.',
  poll_closed: 'This poll has ended and voting is no longer available.',
  not_poll: 'This post is not a poll.',
  membership_required: 'This service is available once your annual membership is active.',
  not_member: 'This feature is exclusive to Investors Club members. Join now to enjoy all membership benefits.',
  phone_proof_required: 'Confirm your number on WhatsApp to complete your registration.',
  phone_proof_busy: 'We could not send the code right now. Try again later or contact support.',
  phone_no_whatsapp: 'This number is not active on WhatsApp. Enter a number that is, to complete your registration.',
  phone_code_off: 'The WhatsApp code is not enabled at the moment.',
  phone_first_reopen: 'Close the app and open it again to complete your registration.',
  invite_code: 'The invite code is not correct. Check it with the person who invited you, or clear it and continue registering.',
  invite_unavailable: 'The invite code cannot be used at the moment. Clear it and continue.',
  short_code: 'The code is 3 to 5 Latin letters and may end with one digit from 2 to 9.',
  short_code_taken: 'This code is used by another affiliate, or looks too similar to one.',
  affiliate_exists: 'You already have an application in the Affiliates Program: you are an approved affiliate, or your application is under review by the management.',
  not_affiliate: 'This service is for approved Investors Club affiliates.',
  no_application: 'Submit your application to join first.',
  no_balance: 'There is no balance available to withdraw at the moment.',
  payout_min: 'Payouts open once the minimum number of referred members have paid the membership fee.',
  payout_open: 'You already have a withdrawal request under review.',
  store_unavailable: 'We could not verify the subscription right now. Try again shortly.',
  social_token: 'We could not verify the account. Please try again.',
  social_off: 'This sign-in method is not enabled at the moment. Use your email and password.',
  social_keys: 'We could not reach the sign-in provider. Try again shortly.',
  invalid_field: 'One of the fields is incomplete or not valid. Review the form and send it again.',
  field: 'This field is incomplete or not valid.',
  unsupported_type: 'This file type is not supported.',
  message_too_long: 'The text is longer than allowed.',
  empty_message: 'Write your message first.',
  already_requested: 'Your previous request is still being processed by the management.',
  no_credit: 'Your Projects Bank balance for this year has been used up.',
  exhausted: 'This code has reached its usage limit.',
  expired: 'This code has expired.',
  not_started: 'This code is not active yet.',
  not_payable: 'In-app payment is not available for this service.',
  not_confirmed: 'This has not been confirmed yet.',
  no_fee: 'There is no fee for you to attend this event.',
  supported_price: 'This event is at a price supported by the club; the offer of the month does not add to it.',
  persona_unsupported: 'Changing your category is not available at the moment. Try again later.',
  pb_unreachable: 'The Projects Bank cannot be reached right now. Try again shortly.',
  pb_error: 'The Projects Bank sent an unexpected answer.',
  golden: 'Golden projects need no unlocking: their partnership page is open to everyone.',
};

const ARABIC = /[؀-ۿ]/;

/** The English of one refusal, or null when there is none (the Arabic then stands, and the app shows its own general sentence). */
export function errorInEnglish(code: string, message: string): string | null {
  const exact = SENTENCES_EN[message];
  if (exact) return exact;
  for (const [pattern, english] of PATTERNS_EN) {
    const match = message.match(pattern);
    if (match) return english(match);
  }
  return CODES_EN[code] ?? null;
}

/**
 * The answer as the app of this language reads it: an `{ error: { code, message } }` body whose message holds
 * Arabic gets its English for the English app. Everything else — every other body, every Arabic request, a
 * message the server already wrote in English — passes through untouched.
 */
export function localizeError<T>(payload: T, lang: AppLang): T {
  if (lang !== 'en' || typeof payload !== 'object' || payload === null) return payload;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return payload;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof message !== 'string' || !ARABIC.test(message)) return payload;
  const english = errorInEnglish(typeof code === 'string' ? code : '', message);
  // M253: the sentence under each refused field is put in English too (code `field` is its general sentence).
  const fields = (error as { fields?: unknown }).fields;
  const englishFields = Array.isArray(fields)
    ? fields.map((entry: unknown) => {
        const text = (entry as { message?: unknown } | null)?.message;
        return typeof text === 'string' && ARABIC.test(text) ? { ...(entry as object), message: errorInEnglish('field', text) ?? text } : entry;
      })
    : null;
  if (!english && !englishFields) return payload;
  return { ...payload, error: { ...error, ...(english ? { message: english } : {}), ...(englishFields ? { fields: englishFields } : {}) } } as T;
}
