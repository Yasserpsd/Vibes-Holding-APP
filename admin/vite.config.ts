import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `tx-jsx` is the dashboard's own JSX runtime (src/jsx): React's, plus the English display layer.
// The dev server pre-bundles it together with the dictionary: restart `npm run dev` after editing src/i18n/en.json.
export default defineConfig({
  plugins: [react({ jsxImportSource: 'tx-jsx' })],
  resolve: { alias: [{ find: /^tx-jsx\//, replacement: fileURLToPath(new URL('./src/jsx/', import.meta.url)) }] },
  server: { port: 5173, strictPort: true },
});
