// OTP delivery probe (owner runs it): registers a throw-away pending account on the given API
// with the development@vibesholding.com inbox and prints whether the hub says the code mail went out.
// Usage: node server/scripts/otp-probe.mjs [https://api.vibesholdingsa.com]
const base = process.argv[2] || 'https://api.vibesholdingsa.com';
const run = Date.now().toString().slice(-7);
const body = {
  name: 'Fahad Alqahtani',
  memberType: 'individual',
  country: 'sa',
  phone: '05' + run.padStart(8, '1').slice(-8),
  email: 'development@vibesholding.com',
  password: 'Probe-' + run + '-Aa1!',
  persona: 'investor',
  bio: 'اختبار وصول رمز التحقق للبريد من فريق التطوير',
  jobTitle: 'Developer',
  interests: ['tech'],
};
const t0 = Date.now();
const r = await fetch(base + '/api/auth/register', {
  method: 'POST',
  // The hub (2.24.0+) accepts registrations only from the app, so the probe presents itself as the Android build.
  headers: { 'content-type': 'application/json', 'x-app-platform': 'android', 'x-app-lang': 'ar', 'user-agent': 'okhttp/4.12 otp-probe/1' },
  body: JSON.stringify(body),
});
const text = await r.text();
console.log(new Date().toISOString(), 'status', r.status, 'in', Date.now() - t0, 'ms');
try {
  const j = JSON.parse(text);
  if (j.pendingToken) j.pendingToken = j.pendingToken.slice(0, 6) + '…';
  console.log(JSON.stringify(j));
} catch {
  console.log(text.slice(0, 500));
}
