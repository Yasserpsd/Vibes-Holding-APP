// M151 — sends a real PDF through the REAL pipeline (app server /api/advisor/file → hub 2.23.0 store_file → n8n PDF
// branch → reply) with the cached admin session, then polls until the advisor answers and records the result in
// docs/M151_TEST_RESULTS.md. Needs: hub 2.23.0 installed on vcmem, the n8n draft published, the server deployed.
//   node scripts/m151-file.mjs [--api prod] [--pdf path] [--text "سؤال"]
import { readFile, writeFile } from 'node:fs/promises';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const api = arg('--api', '') === 'prod' ? API_PROD : API;
const pdfPath = arg('--pdf', new URL('./m151-sample.pdf', import.meta.url));
const text = arg('--text', 'هذه دراسة الجدوى الأولية لمشروعي. وين المشكلة بالضبط وأعمل إيه؟');
const name = arg('--name', 'دراسة الجدوى — مطبخ سحابي.pdf');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (path, params) => path + '?' + new URLSearchParams(params).toString();

const pdf = await readFile(pdfPath);
if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF: ' + pdfPath);
console.log(`sending ${name} (${pdf.length} bytes) to ${api}`);

const t0 = Date.now();
const sent = await adminCall('/api/advisor/file', { method: 'POST', body: JSON.stringify({ file: pdf.toString('base64'), name, text }), signal: AbortSignal.timeout(90_000) }, api);
console.log('sent:', JSON.stringify(sent).slice(0, 200));
if (sent.gate) throw new Error('gated: ' + JSON.stringify(sent.gate));
const after = sent.messageId ?? 0;

// The member's own row must show the file (url on vcmem, name, size).
const history = await adminCall('/api/advisor/history', {}, api);
const mine = (history.messages ?? []).find((m) => m.id === after);
console.log('my row:', JSON.stringify({ text: mine?.text, file: mine?.file }).slice(0, 300));

let reply = null, timeout = false;
while (Date.now() - t0 < 170_000) {
  await sleep(3000);
  const p = await adminCall(q('/api/advisor/poll', { after: String(after) }), {}, api);
  const bot = (p.messages ?? []).find((m) => m.role === 'assistant' || m.role === 'bot');
  if (bot) { reply = bot; break; }
  if (p.timeout) { timeout = true; break; }
}
const ms = Date.now() - t0;
const replyText = reply ? String(reply.text ?? '') : '';
console.log(`reply after ${(ms / 1000).toFixed(1)} s${timeout ? ' TIMEOUT' : ''}${reply ? '' : ' (no reply)'}`);
if (reply) console.log('\n' + replyText + '\n');

const checks = {
  'file stored on vcmem (url + name + size)': !!(mine?.file?.url && /vcmem\.com\/wp-content\/uploads\//.test(mine.file.url) && mine.file.size === pdf.length),
  'reply arrived within 60 s': !!reply && ms <= 60_000,
  'reply reads the file (mentions CAC / 180 / margin / runway)': /180|CAC|اكتساب|هامش|runway|نقد|ثلاثة أشهر|3 أشهر/i.test(replyText),
  'privacy reassurance line present': /Vibes Ventures/.test(replyText) && /(محفوظ|خوادم|سيرفر|طرف ثالث)/.test(replyText),
  'no investment wording for our offer': !/(فرصة استثمارية|عائد استثماري|صندوق|تمويل)/.test(replyText),
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
let md = `\n## Run ${stamp} UTC — ${api === API_PROD ? 'production API' : 'test API'} (admin account) — ${name} (${pdf.length} bytes)\n\n`;
md += `- الزمن حتى وصول الرد: **${(ms / 1000).toFixed(1)} ث**${timeout ? ' (TIMEOUT)' : ''}${reply ? '' : ' — لا رد'}\n`;
md += `- صف العضو: ${mine?.file ? `📎 ${mine.file.name} (${mine.file.size} bytes) — ${mine.file.url}` : 'بلا ملف!'}\n`;
for (const [k, v] of Object.entries(checks)) md += `- ${v ? '✅' : '❌'} ${k}\n`;
md += `\n**الرد:**\n\n> ${replyText.replace(/\n/g, '\n> ') || '—'}\n`;
const out = new URL('../../docs/M151_TEST_RESULTS.md', import.meta.url);
let prev = '';
try { prev = await readFile(out, 'utf8'); } catch { prev = '# M151 — نتائج اختبار قراءة ملفات PDF (عبر التطبيق → الهب → n8n)\n'; }
await writeFile(out, prev + md);
console.log('recorded in docs/M151_TEST_RESULTS.md');
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
