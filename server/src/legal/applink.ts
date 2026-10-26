import type { FastifyPluginAsync } from 'fastify';

import { articlePage } from './pages.js';

/**
 * M133 smart download link: ONE public URL (`/app`) that reads the device from the
 * User-Agent and redirects iPhones to the App Store and Androids to Google Play.
 * Anything else (desktop, unknown) gets a small page with both store buttons.
 * The redirect depends on the User-Agent, so it must never be cached by a CDN.
 */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6825963092';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.vcmem.investorsclub';

export function storeUrlFor(userAgent: string): string | null {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return APP_STORE_URL;
  if (/Android/i.test(userAgent)) return PLAY_STORE_URL;
  return null;
}

export function downloadPage(): string {
  const body = `
<h1>حمّل تطبيق نادي المستثمرين</h1>
<p>افتح هذه الصفحة من جوالك لتُحوَّل تلقائيًا إلى متجر جهازك، أو اختر المتجر بنفسك:</p>
<div class="card" style="text-align:center">
<a href="${APP_STORE_URL}" style="display:block;margin:10px 0;padding:14px 18px;border-radius:12px;background:#161616;border:1px solid #C9A227;color:#EDEDED;text-decoration:none;font-weight:700"> App Store — للآيفون</a>
<a href="${PLAY_STORE_URL}" style="display:block;margin:10px 0;padding:14px 18px;border-radius:12px;background:#161616;border:1px solid #C9A227;color:#EDEDED;text-decoration:none;font-weight:700">▶ Google Play — للأندرويد</a>
</div>
<p class="en" style="color:#7A7A7A">Open this page on your phone to be redirected to your store automatically, or pick a store above.</p>`;
  return articlePage({ title: 'تحميل تطبيق نادي المستثمرين', body });
}

export const appLinkRoutes: FastifyPluginAsync = async (app) => {
  app.get('/app', (request, reply) => {
    void reply.header('cache-control', 'no-store');
    const target = storeUrlFor(String(request.headers['user-agent'] ?? ''));
    if (target) return reply.redirect(target, 302);
    return reply.header('content-type', 'text/html; charset=utf-8').send(downloadPage());
  });
};
