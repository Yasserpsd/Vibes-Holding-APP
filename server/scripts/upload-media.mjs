// Uploads one local image to a live server's own media storage through the dashboard's upload
// ticket and prints the public URL (for an agenda cover, a post image, a service photo…).
// Usage: node server/scripts/upload-media.mjs <file> [prod]
// (prod needs the dashboard session: node server/scripts/admin-session.mjs dashboard prod ...)
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const [file, target] = process.argv.slice(2);
if (!file) throw new Error('usage: upload-media.mjs <file> [prod]');
const api = target === 'prod' ? API_PROD : API;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const bytes = await readFile(file);
const contentType = MIME[extname(file).toLowerCase()] ?? 'image/jpeg';
const filename = basename(file);
const { url: publicUrl, upload } = await adminCall('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ filename, contentType, size: bytes.length }) }, api);
if (upload.method === 'PUT') {
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes });
  if (!put.ok) throw new Error(`PUT upload -> ${put.status}`);
} else {
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields ?? {})) form.append(name, value);
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  const post = await fetch(upload.url, { method: 'POST', body: form });
  if (!post.ok) throw new Error(`POST upload -> ${post.status}`);
}
console.log(publicUrl);
