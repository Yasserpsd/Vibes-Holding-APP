// Owner (2026-11-04, «مش عايز كلمة عربي لما اقلب انجليزي»): GET every member screen's API in English
// on prod and list the JSON strings that still carry Arabic. Read-only. Usage: node scripts/probe-english-leaks.mjs [prod]
import { adminCall, API, API_PROD } from './admin-session.mjs';

const api = process.argv[2] === 'prod' ? API_PROD : API;
const AR = /[؀-ۿ]/;
const PATHS = ['/api/home', '/api/me', '/api/auth/config', '/api/interests', '/api/about', '/api/guide', '/api/golden', '/api/meetups', '/api/membership', '/api/membership/store',
  '/api/news/topics', '/api/news/prefs', '/api/feed?limit=30', '/api/projects', '/api/projects/filters', '/api/services', '/api/partners', '/api/people', '/api/posts?limit=20',
  '/api/videos?limit=10', '/api/agenda', '/api/hq', '/api/affiliate', '/api/me/requests', '/api/payments', '/api/invites', '/api/workshops/mine', '/api/forms/mine',
  '/api/advisor/history', '/api/profiles/me', '/api/strings', '/api/badges', '/api/contact', '/api/projects/wallet', '/api/hq/wallet', '/api/hq/visits', '/api/services/credit'];
// Fields that are allowed to stay Arabic: the Arabic originals kept beside an English copy, search words, news (real source text).
const SKIP = /(^|\.)(label|unit|nameAr|titleAr|textAr|ar|sectorWords|aliases|keywords|match|matchers|original)$|^\/api\/strings|\.ar\./;

function walk(node, path, out) {
  if (typeof node === 'string') { if (AR.test(node)) out.push([path, node]); return; }
  if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`, out)); return; }
  if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`, out);
}

for (const p of PATHS) {
  let body;
  try { body = await adminCall(p, { headers: { 'x-app-lang': 'en' } }, api); } catch (error) { console.log(`${p}  ERROR ${String(error.message).slice(0, 80)}`); continue; }
  const hits = [];
  walk(body, '', hits);
  const shown = hits.filter(([path]) => !SKIP.test(path));
  if (!shown.length) { console.log(`${p}  clean`); continue; }
  console.log(`${p}  ${shown.length} Arabic strings`);
  const seen = new Set();
  for (const [path, text] of shown) {
    const shape = path.replace(/\[\d+\]/g, '[]');
    if (seen.has(shape)) continue;
    seen.add(shape);
    console.log(`   ${shape} = ${text.replace(/\s+/g, ' ').slice(0, 70)}`);
  }
}
