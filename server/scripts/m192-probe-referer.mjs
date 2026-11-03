// M192: member links on PROD: signed (no referer, like the app) must pass, the bare CDN link must not.
import { adminCall, API_PROD as api } from './admin-session.mjs';
const body = await adminCall('/api/agenda/6d10ef18-563e-4519-9697-1ab1a986b419/recordings', {}, api);
const get = (u) => fetch(u, { signal: AbortSignal.timeout(15000) });
for (const r of body.recordings) {
  const signed = await get(r.url);
  const text = await signed.text();
  const [, host, id] = /^https:\/\/([^/]+)\/.*\/([0-9a-f-]{36})\/playlist\.m3u8$/.exec(r.url);
  const plain = await get(`https://${host}/${id}/playlist.m3u8`);
  const variant = text.split('\n').find((l) => l && !l.startsWith('#'));
  const sub = variant ? await get(new URL(variant, r.url).href) : null;
  const subText = sub ? await sub.text() : '';
  const seg = subText.split('\n').find((l) => l && !l.startsWith('#'));
  const segRes = seg ? await fetch(new URL(seg, new URL(variant, r.url)).href, { headers: { range: 'bytes=0-1000' }, signal: AbortSignal.timeout(15000) }) : null;
  console.log(r.title, { signed: signed.status, plain: plain.status, variant, variantStatus: sub?.status, segment: segRes?.status, poster: (await get(r.poster)).status });
}
