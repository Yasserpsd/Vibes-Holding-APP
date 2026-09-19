// Static server for the built dashboard (dist/), no dependencies. The Railway `admin` service runs
// `npm run build` and then `npm start`. Routes without a file extension get index.html (single-page
// app); the hashed files under /assets/ are cached for a year, everything else is revalidated.
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const INDEX = join(ROOT, 'index.html');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.map', '.txt', '.svg']);

// The admin token lives in localStorage, so no foreign script may ever run on this origin.
// connect-src stays open to https (the API URL is a build-time value) and to a local API in development.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-robots-tag': 'noindex, nofollow',
};

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(text);
}

// The file to serve for a request path, or null for a 404. A path never leaves dist/.
async function resolveFile(pathname) {
  const candidate = resolve(join(ROOT, pathname));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  const info = await stat(candidate).catch(() => null);
  if (info?.isFile()) return candidate;
  return extname(pathname) === '' ? INDEX : null;
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed', { allow: 'GET, HEAD' });
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }
  if (pathname.includes('\0')) {
    sendText(res, 400, 'Bad Request');
    return;
  }
  const file = await resolveFile(pathname);
  if (!file) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const ext = extname(file).toLowerCase();
  const hashed = file.startsWith(join(ROOT, 'assets') + sep);
  const headers = {
    ...SECURITY_HEADERS,
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (gzip) {
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const done = (err) => {
    if (err) res.destroy();
  };
  if (gzip) pipeline(createReadStream(file), createGzip(), res, done);
  else pipeline(createReadStream(file), res, done);
}

if (!existsSync(INDEX)) {
  console.error('dist/index.html is missing: run `npm run build` before `npm start`.');
  process.exit(1);
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (res.headersSent) res.destroy();
    else sendText(res, 500, 'Internal Server Error');
  });
});

server.listen(PORT, HOST, () => console.log(`dashboard listening on http://${HOST}:${PORT}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
