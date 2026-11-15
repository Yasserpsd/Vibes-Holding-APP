// rev-design hand-over (2026-11-15) — the light theme's pale gold text.
//
// DO NOT RUN WITH --write BEFORE THE COORDINATOR'S GO: it rewrites lines in ~50 files that other
// sessions are editing. The dry run is safe at any time (it changes nothing).
//
// `colors.goldLight` is #D9A83C in the light palette: 2.2:1 on white. It is used as a TEXT or ICON
// colour in ~110 places outside the design session's files. `theme/tokens.ts` has `colors.goldLightText`
// (dark: #F2CE74 = goldLight, so nothing changes in the dark; light: #7F6218, 5.7:1 on white).
//
// Dry run (lists every site, changes nothing):
//   node docs/reviews/2026-11-15/rev-design-gold-text.cjs
// Apply the default replacement (goldLight -> goldLightText) everywhere except the CHECK files:
//   node docs/reviews/2026-11-15/rev-design-gold-text.cjs --write
//
// CHECK files draw on a surface that is dark in BOTH themes (the black membership card, the video
// player, the welcome film, a dark news slide). There the right token is `colors.onPhotoGold`
// (or keep goldLight) — look at each line by hand. After --write: `npx tsc --noEmit` and
// `npx eslint` inside app/ (the script only renames a property, so both should stay clean).
const fs = require('fs');
const path = require('path');
const local = path.join(__dirname, '..', '..', '..', 'app');
const root = (fs.existsSync(path.join(local, 'src')) ? local : 'C:/Projects/vibes-club-app/app') + '/';
const ts = require(root + 'node_modules/typescript');
const write = process.argv.includes('--write');
const CHECK = new Set(['app/card.tsx', 'app/watch.tsx', 'app/welcome.tsx', 'components/NewsCarousel.tsx']);
const TEXT_NAMES = /^(color|ink|tone|linkColor|tintColor)$/;

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f.name)) out.push(p);
  }
  return out;
}

let total = 0;
let changed = 0;
for (const file of walk(root + 'src')) {
  const rel = path.relative(root + 'src', file).split(path.sep).join('/');
  if (rel.startsWith('theme/')) continue;
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('colors.goldLight')) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = src.split('\n');
  const hits = [];
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'goldLight' && n.expression.getText(sf) === 'colors') {
      // Is this value a text / icon colour? Walk up to the nearest property, JSX attribute or parameter.
      let p = n.parent;
      let name = null;
      while (p && !ts.isSourceFile(p)) {
        if (ts.isPropertyAssignment(p) || ts.isJsxAttribute(p)) { name = p.name.getText(sf); break; }
        if (ts.isParameter(p) || ts.isBindingElement(p)) { name = p.name.getText(sf); break; }
        if (ts.isArrayLiteralExpression(p) || ts.isCallExpression(p)) break;
        p = p.parent;
      }
      if (name && TEXT_NAMES.test(name)) hits.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!hits.length) continue;
  for (const n of hits) {
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    console.log(`${CHECK.has(rel) ? 'CHECK ' : 'text  '}${rel}:${line}  ${lines[line - 1].trim().slice(0, 110)}`);
    total += 1;
  }
  if (write && !CHECK.has(rel)) {
    let out = src;
    for (const n of hits.sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
      out = out.slice(0, n.name.getStart(sf)) + 'goldLightText' + out.slice(n.name.getEnd());
      changed += 1;
    }
    fs.writeFileSync(file, out);
  }
}
console.log(`\n${total} text/icon sites` + (write ? `, ${changed} rewritten (CHECK files left alone)` : ' (dry run)'));
