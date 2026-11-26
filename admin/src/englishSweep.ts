/**
 * M282 (owner, 2026-11-26, «لو عملته انجليزي ميبقاش في ولا كلمة عربي… اسماء تترجم كل شئ يكون انجليزي اوتوماتيك»):
 * the dictionary in `i18n/en.json` covers the dashboard's own wording; everything else a page shows in English
 * mode — members' names, poll texts, «other» answers, project names, reasons the server sends — is swept here.
 * Any visible text (or placeholder / tooltip) that still holds an Arabic letter goes to the server in batches,
 * which answers in English (names in Latin letters, cached there), and the page shows the English in its place.
 * The translations are remembered (`learn`) so the next render and the next visit show English at once.
 *
 * Left as written on purpose: what is being typed (inputs, text areas, editable areas) and anything under
 * `lang="ar"` (the app's own Arabic wording shown for editing), so what is saved is exactly what was written.
 */
import { api } from './api';
import { isEn, learn, learnedFor } from './i18n';

const ARABIC = /[؀-ۿ]/;
const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT']);
/** One request carries at most this many texts (the server's own limit). */
const BATCH = 200;
/** Longer texts are left as written (the server's own limit per text). */
const MAX_LENGTH = 20_000;
/** A text the server could not translate is asked again only after this pause. */
const RETRY_MS = 60_000;
const DEBOUNCE_MS = 120;

const inflight = new Set<string>();
const failedAt = new Map<string, number>();
let timer: number | undefined;

function core(text: string): { lead: string; body: string; tail: string } {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return { lead: match?.[1] ?? '', body: match?.[2] ?? text, tail: match?.[3] ?? '' };
}

function kept(element: Element | null): boolean {
  for (let at = element; at; at = at.parentElement) {
    if (SKIP_TAGS.has(at.tagName)) return true;
    if ((at as HTMLElement).isContentEditable) return true;
    if (at.getAttribute('lang') === 'ar') return true;
  }
  return false;
}

/** Swaps every Arabic text this browser already knows; returns the ones still to ask the server. */
function sweep(root: Node): Set<string> {
  const wanted = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? '';
    if (!ARABIC.test(value) || kept(node.parentElement)) continue;
    const { lead, body, tail } = core(value);
    const english = learnedFor(body);
    if (english !== undefined) node.nodeValue = `${lead}${english}${tail}`;
    else wanted.add(body);
  }
  const elements = root instanceof Element || root instanceof Document ? root.querySelectorAll(ATTRIBUTES.map((name) => `[${name}]`).join(',')) : [];
  for (const element of elements) {
    // A field's hint or tooltip is translated; what is typed in it (its value) never is.
    if (element.closest('[lang="ar"]')) continue;
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value || !ARABIC.test(value)) continue;
      const { lead, body, tail } = core(value);
      const english = learnedFor(body);
      if (english !== undefined) element.setAttribute(name, `${lead}${english}${tail}`);
      else wanted.add(body);
    }
  }
  return wanted;
}

async function ask(texts: string[]): Promise<void> {
  for (const text of texts) inflight.add(text);
  try {
    const { texts: english } = await api.english(texts);
    const pairs: [string, string][] = [];
    texts.forEach((text, index) => {
      const done = english[index];
      if (done && !ARABIC.test(done)) pairs.push([text, done]);
      else failedAt.set(text, Date.now());
    });
    if (pairs.length) learn(pairs);
  } catch {
    // Offline or signed out: try these again after the pause.
    for (const text of texts) failedAt.set(text, Date.now());
  } finally {
    for (const text of texts) inflight.delete(text);
  }
  schedule();
}

function run(): void {
  timer = undefined;
  const now = Date.now();
  const wanted = [...sweep(document.body)].filter((text) => {
    if (text.length > MAX_LENGTH) return false;
    if (inflight.has(text)) return false;
    const failed = failedAt.get(text);
    return failed === undefined || now - failed > RETRY_MS;
  });
  for (let start = 0; start < wanted.length; start += BATCH) void ask(wanted.slice(start, start + BATCH));
  document.title = sweepTitle(document.title);
}

function sweepTitle(title: string): string {
  if (!ARABIC.test(title)) return title;
  const { lead, body, tail } = core(title);
  const english = learnedFor(body);
  return english === undefined ? title : `${lead}${english}${tail}`;
}

function schedule(): void {
  if (timer === undefined) timer = window.setTimeout(run, DEBOUNCE_MS);
}

/** Starts the sweep for the English dashboard; the Arabic one is left untouched. */
export function startEnglishSweep(): void {
  if (!isEn || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
  schedule();
  // A failed batch is retried even on a page that does not change.
  window.setInterval(schedule, RETRY_MS);
}
