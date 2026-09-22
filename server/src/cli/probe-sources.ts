// Probes news source candidates through the real pipeline (rule 7): the feed itself, then the first
// article pages the way refresh() fetches them. A source goes into the seed enabled only when both work.
// Usage: npm run news:probe -- candidates.json   (or with no file: probes the stored/seed list itself)
// candidates.json: [{ "id": "...", "name": "...", "url": "...", "lang": "ar" | "en" }, ...]
import { readFileSync } from 'node:fs';

import { fetchArticle } from '../news/page.js';
import { fetchFeed } from '../news/rss.js';
import { NEWS_SOURCES_SEED } from '../news/sources.js';
import type { NewsLang } from '../news/types.js';

type Candidate = { id: string; name: string; url: string; lang: NewsLang };

const PAGES_PER_SOURCE = 3;

const file = process.argv[2];
const candidates: Candidate[] = file
  ? (JSON.parse(readFileSync(file, 'utf8')) as Candidate[])
  : NEWS_SOURCES_SEED.map(({ id, name, url, lang }) => ({ id, name, url, lang }));

function short(value: string, max = 90): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

for (const candidate of candidates) {
  const started = Date.now();
  try {
    const entries = await fetchFeed(candidate.url, fetch, candidate.lang);
    const feedMs = Date.now() - started;
    let pagesOk = 0;
    const failures: string[] = [];
    for (const entry of entries.slice(0, PAGES_PER_SOURCE)) {
      try {
        await fetchArticle(entry.url, fetch, candidate.lang);
        pagesOk += 1;
      } catch (error) {
        failures.push(`${short(entry.url, 70)} -> ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    const tried = Math.min(PAGES_PER_SOURCE, entries.length);
    const verdict = entries.length === 0 ? 'EMPTY' : pagesOk === 0 ? 'PAGES-FAIL' : pagesOk < tried ? 'PARTIAL' : 'OK';
    console.log(`${verdict.padEnd(10)} ${candidate.id.padEnd(24)} entries=${String(entries.length).padStart(3)} pages=${pagesOk}/${tried} feed=${feedMs}ms`);
    if (entries[0]) console.log(`           first: ${short(entries[0].title)}`);
    for (const failure of failures) console.log(`           page fail: ${failure}`);
  } catch (error) {
    console.log(`FEED-FAIL  ${candidate.id.padEnd(24)} ${error instanceof Error ? error.message : 'unknown'}`);
  }
}
