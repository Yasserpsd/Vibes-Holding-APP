// M110 live test: ONE small real payment link (10 SAR) to prove the gateway + instant invoice end to end.
// Credentials come ONLY from server/.env.admin.local (git-ignored); nothing secret is printed.
import { readFile } from 'node:fs/promises';

const API = 'https://vibes-holding-app-production.up.railway.app';
const text = await readFile('C:/Projects/vibes-club-app/server/.env.admin.local', 'utf8');
const env = {};
for (const line of text.split(/\r?\n/)) {
  const match = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim());
  if (match) env[match[1]] = match[2].trim();
}
if (!env.ADMIN_LOGIN || !env.ADMIN_PASSWORD) throw new Error('ADMIN_LOGIN / ADMIN_PASSWORD missing');

async function call(path, options = {}, token) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body?.error ?? body ?? '')}`);
  return body;
}

const session = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: env.ADMIN_LOGIN, password: env.ADMIN_PASSWORD }) });
const created = await call(
  '/api/admin/paylinks',
  {
    method: 'POST',
    body: JSON.stringify({
      kind: 'other',
      label: 'تجربة تشغيل بوابة ميسر — دفعة اختبار',
      amountSar: 10,
      customer: { name: 'ياسر — اختبار التشغيل', phone: '', email: 'info@vibesholding.com' },
    }),
  },
  session.token,
);
console.log('\nادفع من اللينك ده (10 ريال):');
console.log(created.link.checkoutUrl);
console.log('\npaymentId:', created.link.paymentId);
