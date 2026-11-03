// M192: is each rendition a finished VOD playlist (#EXT-X-ENDLIST / PLAYLIST-TYPE)? Without it players treat it as live (no scrubbing).
import { adminCall, API_PROD as api } from './admin-session.mjs';
const body = await adminCall('/api/agenda/6d10ef18-563e-4519-9697-1ab1a986b419/recordings', {}, api);
const get = (u) => fetch(u, { signal: AbortSignal.timeout(15000) }).then((r) => r.text());
for (const r of body.recordings) {
  const master = await get(r.url);
  const base = r.url.slice(0, r.url.lastIndexOf('/') + 1);
  const first = master.split('\n').find((l) => l && !l.startsWith('#'));
  const text = await get(base + first);
  const tags = text.split('\n').filter((l) => /^#EXT-X-(PLAYLIST-TYPE|ENDLIST|TARGETDURATION|VERSION|MEDIA-SEQUENCE)/.test(l));
  console.log(r.title, first, tags.join(' | '), 'last:', text.trim().split('\n').slice(-1)[0]);
}
