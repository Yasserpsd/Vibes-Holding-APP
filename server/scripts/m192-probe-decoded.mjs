// M192: what the app's player receives after expo-router decodes the param once more.
import { adminCall, API_PROD as api } from './admin-session.mjs';
const body = await adminCall('/api/agenda/6d10ef18-563e-4519-9697-1ab1a986b419/recordings', {}, api);
const url = body.recordings[0].url;
for (const [name, u] of Object.entries({ asSent: url, decodedOnce: decodeURIComponent(url) })) {
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
  console.log(name, res.status);
}
