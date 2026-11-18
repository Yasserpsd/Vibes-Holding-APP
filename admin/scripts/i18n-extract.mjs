// Lists every Arabic string the dashboard source can show, so the English dictionary (src/i18n/en.json) stays complete.
//   node scripts/i18n-extract.mjs            -> prints the strings that have no English entry yet (exit 1 when any)
//   node scripts/i18n-extract.mjs --all FILE -> writes every string, as a JSON array, to FILE
// A template literal becomes one key with numbered holes: `${count} عضو` -> "{0} عضو".
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'src');
// The dashboard's own TypeScript 7 ships no parser API; the app's copy does.
const ts = createRequire(join(here, '..', '..', 'app', 'package.json'))('typescript');

const ARABIC = /[؀-ۿ]/;
const found = new Map();
const add = (text, file) => {
  const key = text.trim();
  if (key && ARABIC.test(key) && !found.has(key)) found.set(key, file);
};

/** The text React receives for a JSX text node: lines trimmed, blank lines dropped, joined by one space. */
function jsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  return lines
    .map((line, index) => {
      let out = line.replace(/\t/g, ' ');
      if (index > 0) out = out.replace(/^ +/, '');
      if (index < lines.length - 1) out = out.replace(/ +$/, '');
      return out;
    })
    .filter(Boolean)
    .join(' ');
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.tsx?$/.test(entry.name)) scan(path);
  }
}

function scan(path) {
  const file = path.slice(root.length + 1).replace(/\\/g, '/');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isJsxText(node)) add(jsxText(node.text), file);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, file);
    else if (ts.isTemplateExpression(node)) {
      let key = node.head.text;
      node.templateSpans.forEach((span, index) => {
        key += `{${index}}${span.literal.text}`;
      });
      add(key, file);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

walk(root);

const all = process.argv.indexOf('--all');
if (all > -1) {
  const out = process.argv[all + 1];
  writeFileSync(out, JSON.stringify([...found].map(([text, file]) => ({ text, file })), null, 1));
  console.log(`${found.size} strings -> ${out}`);
} else {
  const dictPath = join(root, 'i18n', 'en.json');
  const dict = existsSync(dictPath) ? JSON.parse(readFileSync(dictPath, 'utf8')) : {};
  const missing = [...found].filter(([text]) => !(text in dict));
  for (const [text, file] of missing) console.log(`${file}\t${text}`);
  console.log(missing.length ? `${missing.length} strings have no English entry` : 'ALL GOOD: every string has an English entry');
  process.exit(missing.length ? 1 : 0);
}
