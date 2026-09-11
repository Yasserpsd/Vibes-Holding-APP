// Prints the Projects Bank feed shape with founder contact values masked.
// Usage: npm run feed:inspect   (needs PB_FEED_KEY in server/.env)
import { loadConfig, loadDotEnv } from '../config.js';
import { extractItems, fetchFeedBody } from '../projectsBank/feed.js';

const MASKED = /whatsapp|email|website|pitch|phone|mobile/i;
const MAX_STRING = 120;

function mask(value: unknown, key = ''): unknown {
  if (MASKED.test(key)) return value == null || value === '' ? value : '***';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)` : value;
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => mask(item, key));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v, k)]));
  }
  return value;
}

function describe(body: unknown): string {
  if (Array.isArray(body)) return `array(${body.length})`;
  if (typeof body === 'object' && body !== null) return `object keys: ${Object.keys(body).join(', ')}`;
  return typeof body;
}

loadDotEnv();
const config = loadConfig();

try {
  const ping = await fetchFeedBody(config, '/../ping');
  console.log('ping:', JSON.stringify(mask(ping)));
} catch (error) {
  console.log('ping failed:', error instanceof Error ? error.message : error);
}

const body = await fetchFeedBody(config);
console.log('top-level:', describe(body));
if (!Array.isArray(body) && typeof body === 'object' && body !== null) {
  const envelope = Object.fromEntries(
    Object.entries(body).filter(([, v]) => !Array.isArray(v) && typeof v !== 'object'),
  );
  console.log('envelope scalars:', JSON.stringify(envelope));
}

const items = extractItems(body);
console.log('items:', items.length);

const keys = new Map<string, number>();
for (const item of items.slice(0, 50)) {
  if (typeof item !== 'object' || item === null) continue;
  for (const [k, v] of Object.entries(item)) {
    keys.set(k, (keys.get(k) ?? 0) + 1);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const nested of Object.keys(v)) keys.set(`${k}.${nested}`, (keys.get(`${k}.${nested}`) ?? 0) + 1);
    }
  }
}
console.log('field frequency (first 50 items):', JSON.stringify(Object.fromEntries(keys)));
console.log('first item (masked):');
console.log(JSON.stringify(mask(items[0]), null, 2));
