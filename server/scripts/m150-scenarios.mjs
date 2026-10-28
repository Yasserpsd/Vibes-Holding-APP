// M150 — runs the advisor test scenarios through the REAL pipeline (app server → hub → n8n → hub → poll) with the
// cached admin session (owner's order: sign in once, reuse). Measures the reply latency and records the replies.
// Usage (from server/): node scripts/m150-scenarios.mjs [--only 1,5,9] [--api prod]
// Output: scripts/m150-results.json + ../docs/M150_TEST_RESULTS.md (appended run).
import { readFile, writeFile } from 'node:fs/promises';
import { adminCall, API, API_PROD } from './admin-session.mjs';

const args = process.argv.slice(2);
const api = args.includes('--api') && args[args.indexOf('--api') + 1] === 'prod' ? API_PROD : API;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',').map(Number) : null;
const scenarios = JSON.parse(await readFile(new URL('./m150-scenarios.json', import.meta.url), 'utf8')).filter((s) => !only || only.includes(s.id));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (path, params) => path + '?' + new URLSearchParams(params).toString();

const results = [];
for (const s of scenarios) {
  const t0 = Date.now();
  let sent;
  try {
    sent = await adminCall('/api/advisor/message', { method: 'POST', body: JSON.stringify({ text: s.text }) }, api);
  } catch (e) {
    results.push({ ...s, error: String(e.message || e), ms: Date.now() - t0 });
    console.log(`#${s.id} SEND ERROR ${e.message}`);
    continue;
  }
  if (sent.gate) {
    results.push({ ...s, gate: sent.gate, ms: Date.now() - t0 });
    console.log(`#${s.id} GATED ${JSON.stringify(sent.gate).slice(0, 120)}`);
    continue;
  }
  const after = sent.messageId ?? 0;
  let reply = null, timeout = false;
  while (Date.now() - t0 < 170_000) {
    await sleep(3000);
    const p = await adminCall(q('/api/advisor/poll', { after: String(after) }), {}, api);
    const bot = (p.messages ?? []).find((m) => m.role === 'assistant' || m.role === 'bot');
    if (bot) { reply = bot; break; }
    if (p.timeout) { timeout = true; break; }
  }
  const ms = Date.now() - t0;
  results.push({ ...s, ms, timeout, reply: reply ? { text: reply.text ?? reply.content ?? '', actions: reply.actions ?? [] } : null });
  console.log(`#${s.id} ${s.tag} — ${(ms / 1000).toFixed(1)} s${timeout ? ' TIMEOUT' : ''}${reply ? '' : ' (no reply)'}`);
  if (reply) console.log('   ' + String(reply.text ?? reply.content ?? '').replace(/\s+/g, ' ').slice(0, 220));
  await sleep(2500);
}

await writeFile(new URL('./m150-results.json', import.meta.url), JSON.stringify(results, null, 2));
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const okCount = results.filter((r) => r.reply).length;
const avg = results.filter((r) => r.reply).reduce((a, r) => a + r.ms, 0) / Math.max(1, okCount);
let md = `\n## Run ${stamp} UTC — ${api === API_PROD ? 'production API' : 'test API'} (admin account) — replies ${okCount}/${results.length}, average ${(avg / 1000).toFixed(1)} s\n\n`;
md += '| # | السيناريو | الثواني | الرد (مقتطف) | الأفعال | المتوقع |\n|---|---|---|---|---|---|\n';
for (const r of results) {
  const text = r.reply ? String(r.reply.text).replace(/\|/g, '／').replace(/\s+/g, ' ').slice(0, 260) : (r.error ? 'ERROR ' + r.error : r.gate ? 'GATE ' + JSON.stringify(r.gate).slice(0, 80) : r.timeout ? 'TIMEOUT' : '—');
  const acts = r.reply ? (r.reply.actions || []).map((a) => a.type + (a.key ? ':' + a.key : '')).join(', ') : '';
  md += `| ${r.id} | ${r.tag} | ${(r.ms / 1000).toFixed(1)} | ${text} | ${acts} | ${r.expect} |\n`;
}
const out = new URL('../../docs/M150_TEST_RESULTS.md', import.meta.url);
let prev = '';
try { prev = await readFile(out, 'utf8'); } catch { prev = '# M150 — نتائج اختبار المستشار (سيناريوهات حقيقية عبر التطبيق → الهب → n8n)\n\nكل صف رسالة حقيقية أُرسلت من حساب الأدمن عبر `POST /api/advisor/message` ثم `poll` حتى وصول الرد. الزمن = من الإرسال حتى وصول الرد للتطبيق.\n'; }
await writeFile(out, prev + md);
console.log(`\nwritten: docs/M150_TEST_RESULTS.md (${okCount}/${results.length} replies, avg ${(avg / 1000).toFixed(1)} s)`);
