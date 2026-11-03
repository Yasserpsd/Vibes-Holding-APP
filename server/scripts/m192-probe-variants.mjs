// M192: every rendition the master playlist lists must answer (AVPlayer fails on a listed-but-missing one).
import { adminCall, API_PROD as api } from './admin-session.mjs';
const body = await adminCall('/api/agenda/6d10ef18-563e-4519-9697-1ab1a986b419/recordings', {}, api);
const get = (u) => fetch(u, { signal: AbortSignal.timeout(15000) });
for (const r of body.recordings) {
  const master = await (await get(r.url)).text();
  console.log('==', r.title, '\n' + master.trim());
  for (const line of master.split('\n').filter((l) => l && !l.startsWith('#'))) {
    const res = await get(new URL(line, r.url).href);
    const txt = await res.text();
    console.log(line, res.status, txt.split('\n').filter((l) => l && !l.startsWith('#')).length, 'segments');
  }
}
