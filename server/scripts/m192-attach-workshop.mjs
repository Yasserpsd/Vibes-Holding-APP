// M192: attach the workshop slides (PDF) and Bunny recordings to «ورش نادي المستثمرين» on PROD.
// Usage: node server/scripts/m192-attach-workshop.mjs [--pdfs] [--video <day 1-3> <bunny id>]... [--banner <day 1-3> <jpg>]...
import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { adminCall, API_PROD as api } from './admin-session.mjs';

const DIR = 'C:/Users/LENOVO/OneDrive/Desktop/PDF Workshop';
const DAYS = ['اليوم الأول', 'اليوم الثاني', 'اليوم الثالث'];
const listing = await readdir(DIR);
const PDFS = [/Day\s1/i, /DAY\s2/i, /Day\s3/i].map((re) => listing.find((n) => re.test(n) && n.endsWith('.pdf')));
const args = process.argv.slice(2);

const { events } = await adminCall('/api/admin/agenda', {}, api);
const event = events.find((e) => e.title.includes('ورش نادي المستثمرين'));
if (!event) throw new Error('workshop not found');
let files = event.files ?? [];
let recordings = event.recordings ?? [];

if (args.includes('--pdfs')) {
  files = [];
  for (const [i, name] of PDFS.entries()) {
    const bytes = await readFile(`${DIR}/${name}`);
    const { url, upload } = await adminCall('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename: basename(name), contentType: 'application/pdf', size: bytes.length }) }, api);
    let put;
    if (upload.method === 'PUT') put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
    else {
      const form = new FormData();
      for (const [k, v] of Object.entries(upload.fields ?? {})) form.append(k, v);
      form.append('file', new Blob([bytes], { type: 'application/pdf' }), basename(name));
      put = await fetch(upload.url, { method: 'POST', body: form });
    }
    if (!put.ok) throw new Error(`upload ${name} -> ${upload.method} ${put.status}`);
    files.push({ title: `ملف العرض — ${DAYS[i]}`, url });
    console.log('uploaded', name);
  }
}
for (let at = args.indexOf('--video'); at >= 0; at = args.indexOf('--video', at + 1)) {
  const day = Number(args[at + 1]) - 1;
  const videoId = args[at + 2];
  recordings = recordings.filter((r) => r.videoId !== videoId && r.title !== DAYS[day]);
  recordings.push({ title: DAYS[day], videoId });
}
for (let at = args.indexOf('--banner'); at >= 0; at = args.indexOf('--banner', at + 1)) {
  const title = DAYS[Number(args[at + 1]) - 1];
  const bytes = await readFile(args[at + 2]);
  const { url, upload } = await adminCall('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename: basename(args[at + 2]), contentType: 'image/jpeg', size: bytes.length }) }, api);
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields ?? {})) form.append(k, v);
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), basename(args[at + 2]));
  const sent = upload.method === 'PUT' ? await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes }) : await fetch(upload.url, { method: 'POST', body: form });
  if (!sent.ok) throw new Error(`banner ${title} -> ${sent.status}`);
  recordings = recordings.map((r) => (r.title === title ? { ...r, image: url } : r));
  console.log('banner', title);
}
recordings.sort((a, b) => DAYS.indexOf(a.title) - DAYS.indexOf(b.title));
await adminCall(`/api/admin/agenda/${event.id}`, { method: 'PUT', body: JSON.stringify({ files, recordings }) }, api);
const { events: after } = await adminCall('/api/admin/agenda', {}, api);
const saved = after.find((e) => e.id === event.id);
console.log(JSON.stringify({ id: event.id, files: saved.files?.map((f) => f.title), recordings: saved.recordings }));
