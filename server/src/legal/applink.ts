import type { FastifyPluginAsync } from 'fastify';

import { APP_STORE_BADGE, PLAY_STORE_BADGE } from './badges.js';

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

/** The club logo as the owner's site serves it (vcmem.com/app) — the original artwork, not a themed copy. */
const CLUB_LOGO_URL = 'https://vcmem.com/wp-content/uploads/2025/11/%D9%84%D9%88%D8%AC%D9%88-%D9%86%D8%A7%D8%AF%D9%8A-%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%AB%D9%85%D8%B1%D9%8A%D9%86-%D8%AC%D9%88%D9%88%D9%84%D8%AF-%D8%B4%D9%81%D8%A7%D9%81.png';

/**
 * M132 (owner, 2026-10-28: «عربي انجليزي… اللوجوهات الأصلية… خلفية بيضاء باللون الأصلي»): the desktop page is white,
 * bilingual, with the original logo and the official store badges — the same look as vcmem.com/app.
 */
export function downloadPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Investors Club — حمّل تطبيق نادي المستثمرين</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<style>
body{margin:0;background:#fff;color:#0d274a;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.card{max-width:440px;width:100%;text-align:center;border:1px solid #e7ad3f;border-radius:24px;padding:36px 28px;box-shadow:0 24px 60px rgba(13,39,74,.12)}
.logo{width:150px;height:150px;object-fit:contain;display:block;margin:0 auto 18px}
h1{font-size:22px;margin:0 0 4px;line-height:1.4}
h2{font-size:17px;font-weight:600;margin:0 0 14px;direction:ltr}
p{font-size:14.5px;line-height:1.8;color:#4A5568;margin:0 0 4px}
p.en{direction:ltr;font-size:13px;margin-bottom:18px}
.badges{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:8px 0 10px}
.badges a{line-height:0}.badges img{height:48px;width:auto;border-radius:8px}
.hint{font-size:12px;color:#718096;margin-top:8px}
</style></head><body>
<div class="card">
<img class="logo" alt="Investors Club" src="${CLUB_LOGO_URL}">
<h1>حمّل تطبيق Investors Club الآن</h1>
<h2>Download the Investors Club app now</h2>
<p>سجّل حسابك في ثوانٍ — مستشارك، بنك المشاريع، الورش وكل الخدمات في التطبيق.</p>
<p class="en">Register in seconds — your advisor, the Projects Bank, workshops and every service live in the app.</p>
<div class="badges">
<a href="${APP_STORE_URL}" aria-label="App Store"><img alt="Download on the App Store" src="${APP_STORE_BADGE}"></a>
<a href="${PLAY_STORE_URL}" aria-label="Google Play"><img alt="Get it on Google Play" src="${PLAY_STORE_BADGE}"></a>
</div>
<div class="hint">اضغط على الشعار للتحميل · Tap the badge to download</div>
</div></body></html>`;
}

export const appLinkRoutes: FastifyPluginAsync = async (app) => {
  app.get('/app', (request, reply) => {
    void reply.header('cache-control', 'no-store');
    const target = storeUrlFor(String(request.headers['user-agent'] ?? ''));
    if (target) return reply.redirect(target, 302);
    return reply.header('content-type', 'text/html; charset=utf-8').send(downloadPage());
  });
};
