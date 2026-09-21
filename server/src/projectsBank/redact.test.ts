import assert from 'node:assert/strict';
import test from 'node:test';

import { toPublicProject } from './mapper.js';
import { mentionsFunding, stripFunding } from './redact.js';

// Sentences modelled on how founders write in the Projects Bank (none is a real project's text).

test('the funding sought goes with what the money is for; the project itself stays', () => {
  const text =
    'منصة تربط المقاولين بالموردين في بيئة رقمية واحدة، وتضم حاليًا 8,210 شركات مسجلة. يعتمد نموذج الإيرادات على اشتراكات شهرية وعمولة بين 1% و2% من قيمة المعاملات. وتسعى الشركة حاليًا إلى مستثمر استراتيجي وتمويل بقيمة 4 ملايين ريال سعودي لدعم تطوير المنتج، والتسويق والنمو، بهدف التوسع الإقليمي.';
  const clean = stripFunding(text);
  assert.ok(clean.includes('8,210 شركات مسجلة') && clean.includes('عمولة بين 1% و2%'), 'numbers of the business stay');
  assert.ok(!/مستثمر|تمويل|4 ملايين|التسويق والنمو/.test(clean), clean);
  assert.equal(mentionsFunding(clean), false);
});

test('an ask inside a sentence keeps what stands before it', () => {
  const clean = stripFunding('بدأت المنصة التشغيل الفعلي مع أكثر من 51 مدربة معتمدة، و104 مستخدمين، وتتطلع إلى جمع جولة تمويلية بقيمة 150 ألف دولار لتطوير التقنية، وتوسيع فريق العمل.');
  assert.equal(clean, 'بدأت المنصة التشغيل الفعلي مع أكثر من 51 مدربة معتمدة، و104 مستخدمين.');
});

test('equity on offer, valuations, capital and investor returns are removed; a commission or a share of the market is not', () => {
  assert.equal(stripFunding('نطرح 15% من الشركة مقابل 1.5 مليون دولار لتوسيع فريق المبيعات.'), '');
  assert.equal(stripFunding('تم تقييم الشركة بمبلغ 1,431,897.86 دولار باستخدام ست طرق تقييم.'), '');
  assert.equal(stripFunding('شركة مساهمة مقفلة برأس مال يبلغ 7,820,000 ريال، متخصصة في حلول الطاقة الشمسية.'), 'متخصصة في حلول الطاقة الشمسية.');
  assert.equal(stripFunding('المشروع محمي بملكية فكرية مسجلة، ويتميز بعوائد استثمارية عالية مقارنة بتكاليف التشغيل.'), 'المشروع محمي بملكية فكرية مسجلة.');
  const model = 'يحصل التطبيق على دخله مقابل نسبة من كل عملية حجز أو اشتراك شهري، بنسبة أتمتة تقارب 70٪ من دورة العمل.';
  assert.equal(stripFunding(model), model);
  const market = 'يستهدف المشروع سوقًا يتجاوز حجمه 56 مليار ريال في المملكة، ويربط أصحاب العلامات التجارية بالمستثمرين الراغبين في تشغيلها.';
  assert.equal(stripFunding(market), market);
  const club = 'ملتقى دوري يجمع المستثمرين ورواد الأعمال لبناء علاقات نوعية وفرص شراكة.';
  assert.equal(stripFunding(club), club, '«يجمع» is not «جمع تمويل»');
});

test('spelling variants and a text without punctuation are handled', () => {
  assert.equal(stripFunding('الحجم الإستثمارى للمشروع يقدر بحوالى 65 مليون ريال سعودى ، وقمنا بتنفيذ 20% من الأعمال الإنشائية.'), 'وقمنا بتنفيذ 20% من الأعمال الإنشائية.');
  const runOn = 'مطعم سعودي في السوق منذ 6 سنوات يقدم الأكلات الشعبية والخليجية في ثلاثة فروع رأس المال المطلوب للاستثمار 3 ملايين ريال مقابل نسبة 30% من ملكية العلامة';
  assert.equal(stripFunding(runOn), 'مطعم سعودي في السوق منذ 6 سنوات يقدم الأكلات الشعبية والخليجية في ثلاثة فروع.');
});

test('English texts follow the same rule', () => {
  const clean = stripFunding(
    'The platform has started operating with over 51 certified instructors and 104 users. The platform is seeking to raise $150,000 in funding to develop its technology, enhance marketing, and expand its team. It offers a safe and easy experience for passengers.',
  );
  assert.equal(clean, 'The platform has started operating with over 51 certified instructors and 104 users. It offers a safe and easy experience for passengers.');
  assert.equal(stripFunding('We are offering SAR 300,000 in early-stage funding through a SAFE investment agreement.'), '');
  assert.equal(stripFunding('The required investment capital is 3 million riyals for a 30% ownership stake in the brand, which includes three branches.'), '');
  const kept = 'The club brings together owners of promising brands with investors seeking well-considered opportunities, raising the level of quality in the sector.';
  assert.equal(stripFunding(kept), kept);
});

test('the feed mapper hides the founder and strips the ask from every text it keeps', () => {
  const project = toPublicProject({
    id: 7,
    title: 'منصة تجريبية',
    meta: {
      founder_name: 'فلان الفلاني',
      founder_name_en: 'Someone',
      company_name: 'شركة تجريبية',
      project_details: '<p>منصة لحجز المواعيد تعمل في ثلاث مدن.</p><p>نبحث عن مستثمر بمبلغ 2 مليون ريال مقابل 20% من الشركة.</p>',
      project_details_en: '<p>A booking platform in three cities.</p><p>We are seeking an investor for SAR 2 million.</p>',
    },
  });
  assert.ok(project);
  assert.equal(project.founderName, null);
  assert.equal(project.founderNameEn, null);
  assert.equal(project.companyName, 'شركة تجريبية');
  assert.equal(project.details, 'منصة لحجز المواعيد تعمل في ثلاث مدن.');
  assert.equal(project.detailsEn, 'A booking platform in three cities.');
  assert.ok(!/مستثمر|2 مليون|investor/.test(JSON.stringify(project)));
});
