import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ContextResolver } from './context.js';

/** M27 stage 3: the English app asks the hub's brain for English without a plugin change. */
test('the English app asks for English through the page title and the focus, never through a fabricated focus', async () => {
  // A null context and the plain screens read no dependency.
  const resolver = new ContextResolver({} as never);

  const none = await resolver.resolve(null, 'en');
  assert.match(none.title, /^تطبيق نادي المستثمرين \(English: reply in English\)$/);
  assert.equal(none.focus, null, 'a focus would route every English message to the deep model');
  assert.equal((await resolver.resolve(null)).title, '', 'Arabic sends what it always sent');

  const home = await resolver.resolve({ type: 'screen', id: 'home' }, 'en');
  assert.ok(home.title.startsWith('تطبيق نادي المستثمرين (English: reply in English) — الشاشة الرئيسية'), home.title);
  assert.ok(home.title.indexOf('reply in English') < 90, 'the brain shows the first 90 characters of the title');
  assert.match(home.focus?.text ?? '', /^العضو يستخدم النسخة الإنجليزية من التطبيق: أجب بالإنجليزية\. \(The member uses the English version of the app: reply in English\.\)\n/);

  const arabic = await resolver.resolve({ type: 'screen', id: 'home' }, 'ar');
  assert.equal(arabic.title, 'الشاشة الرئيسية — تطبيق نادي المستثمرين');
  assert.ok(!arabic.focus?.text.includes('English'));
});
