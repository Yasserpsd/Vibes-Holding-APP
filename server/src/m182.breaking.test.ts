import assert from 'node:assert/strict';
import { test } from 'node:test';

import { biggestFigure } from './news/service.js';

test('M182c: the biggest figure wins — scale words beat percentages, Arabic digits read fine', () => {
  assert.equal(biggestFigure('أرامكو تحقق 120 مليار ريال وقيمتها 1.8 تريليون')?.text, '1.8 تريليون');
  assert.equal(biggestFigure('السهم يقفز 40% بعد صفقة بـ 500 مليون')?.text, '500 مليون');
  assert.equal(biggestFigure('المؤشر يرتفع ٣٥٪')?.text, '٣٥٪');
  assert.equal(biggestFigure('خبر بلا أرقام'), null);
});
