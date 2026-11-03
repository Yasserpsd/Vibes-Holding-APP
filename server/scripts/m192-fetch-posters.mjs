// M192: saves each attached workshop part's Bunny thumbnail (members' signed link) to a folder.
import { writeFile } from 'node:fs/promises';
import { adminCall, API_PROD as api } from './admin-session.mjs';
const out = process.argv[2];
const body = await adminCall('/api/agenda/6d10ef18-563e-4519-9697-1ab1a986b419/recordings', {}, api);
for (const [i, r] of body.recordings.entries()) {
  const res = await fetch(r.poster, { signal: AbortSignal.timeout(20000) });
  await writeFile(`${out}/poster-${i + 1}.jpg`, Buffer.from(await res.arrayBuffer()));
  console.log(r.title, res.status);
}
