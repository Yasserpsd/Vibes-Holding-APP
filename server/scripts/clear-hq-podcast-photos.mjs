// M127b (owner, 2026-10-25): the home banner must rotate over CLUB/HQ photos only — slots
// «صورة المقر 4/5/6» held a handshake shot and two podcast shots (same six photos on both
// servers, verified visually). Clearing the slots fixes the already-shipped app instantly
// (the photos list is server-driven): run once with `node scripts/clear-hq-podcast-photos.mjs`.
// The owner can re-upload real HQ photos into the freed slots from the dashboard anytime.
import { adminCall, API, API_PROD } from './admin-session.mjs';

for (const [name, api] of [['TEST', API], ['PROD', API_PROD]]) {
  for (const key of ['hq.4', 'hq.5', 'hq.6']) {
    const out = await adminCall('/api/admin/content/image', { method: 'PUT', body: JSON.stringify({ key, url: null }) }, api);
    console.log(name, key, out.ok ? 'cleared' : JSON.stringify(out));
  }
  const r = await fetch(`${api}/api/hq`, { signal: AbortSignal.timeout(15000) });
  const b = await r.json();
  console.log(name, 'photos now:', b.photos.length, '(should be 3)');
}
console.log('done');
