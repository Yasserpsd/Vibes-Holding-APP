// M233: stores the Play Console's daily acquisitions (read on its statistics page) on a live server.
// node server/scripts/import-play-console.mjs <days.json> [prod]   — days.json = { "2026-10-24": 1, ... }
import { readFileSync } from 'node:fs';

import { API, API_PROD, adminCall } from './admin-session.mjs';

const days = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const answer = await adminCall('/api/admin/downloads/play-console', { method: 'POST', body: JSON.stringify({ days }) }, process.argv[3] === 'prod' ? API_PROD : API);
console.log(JSON.stringify({ stored: answer.stored, google: answer.stores?.google, installs: answer.installs }));
