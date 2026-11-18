// One-off helper kept for reruns: adds the labels the server sends (wording groups, news tiers, lead levels, and
// every `label` / `labelEn` pair in server/src) to the dashboard dictionary. Run from the repo root.
const fs = require('fs');
const path = require('path');
const dictPath = 'admin/src/i18n/en.json';
const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
Object.assign(dict, require('./i18n-server-labels.json'));
const KEEP = new Set(['العنوان', 'الحضور', 'المكان', 'الغرض']); // words the dashboard uses with its own meaning
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
for (const file of walk('server/src')) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/label: '([^']*)', labelEn: '([^']*)'/g)) {
    if (!/[؀-ۿ]/.test(m[2]) && !KEEP.has(m[1])) dict[m[1]] = m[2];
  }
}
fs.writeFileSync(dictPath, JSON.stringify(dict, null, 1) + '\n');
console.log(Object.keys(dict).length, 'entries');
