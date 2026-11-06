// M204: files WhatsApp templates with Meta for review, through the server's own admin route (the token never leaves
// the server). The JSON file is an array of { name, language, category, body, bodyExamples, footer?, urlButton? }.
// Without --send it only prints what would be filed. A name + language Meta already holds is skipped by the server.
// Usage: node server/scripts/create-wa-templates.mjs <templates.json> [prod] [--send]
// (prod needs the dashboard session: node server/scripts/admin-session.mjs dashboard prod ...)
import { readFile } from 'node:fs/promises';

import { adminCall, API, API_PROD } from './admin-session.mjs';

const args = process.argv.slice(2);
const jsonPath = args.find((arg) => !arg.startsWith('--') && arg !== 'prod');
if (!jsonPath) throw new Error('usage: create-wa-templates.mjs <templates.json> [prod] [--send]');
const api = args.includes('prod') ? API_PROD : API;
const send = args.includes('--send');
const templates = JSON.parse(await readFile(jsonPath, 'utf8'));
if (!Array.isArray(templates) || templates.length === 0) throw new Error('the file must hold a non-empty array of templates');

for (const template of templates) {
  const label = `${template.name} [${template.language}]`;
  if (!send) {
    console.log(`DRY RUN ${label}: ${template.category ?? 'UTILITY'}, ${template.bodyExamples?.length ?? 0} variables${template.urlButton ? ', URL button' : ''}`);
    continue;
  }
  try {
    const result = await adminCall('/api/admin/whatsapp/templates', { method: 'POST', body: JSON.stringify({ ...template, confirm: true }) }, api);
    console.log(`${label}: ${result.created ? 'filed' : 'not filed'} — status ${result.status}${result.error ? ` (${result.error})` : ''}`);
  } catch (error) {
    console.log(`${label}: request failed — ${error instanceof Error ? error.message : 'error'}`);
  }
}
if (!send) console.log('Nothing was sent. Add --send to file these with Meta.');
