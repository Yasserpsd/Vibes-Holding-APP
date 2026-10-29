import { SELLER } from '../payments/invoice.js';

/**
 * M156 (owner, 2026-10-29: «إيميل ملكي مميز جدًا، صيغة ملكية قصيرة»): ONE short, ceremonial HTML shell for
 * the mails a member or the admins receive from the app server — navy #0d274a, gold #e7ad3f, white paper,
 * the club logo on top, a gold seal, a few rows of facts and one button. Inline styles only (mail clients),
 * light colour scheme forced, both directions. Every mail also gets a plain-text twin.
 */
export type RoyalLang = 'ar' | 'en';
export type RoyalRow = { label: string; value: string; ltr?: boolean };
export type RoyalMail = {
  lang: RoyalLang;
  /** The small gold line above the title (defaults to the club's name). */
  eyebrow?: string;
  title: string;
  /** A one-line subtitle under the title, inside the navy header. */
  subtitle?: string;
  /** The greeting line («أهلًا بك يا …»). */
  greeting?: string;
  /** One or two short sentences; each item is a paragraph. */
  lead?: string[];
  rows?: RoyalRow[];
  cta?: { label: string; url: string };
  /** A quiet closing note under the rows. */
  note?: string;
  /** The gold seal image (served by this server); nothing is drawn when absent. */
  sealUrl?: string;
};

export const NAVY = '#0d274a';
export const GOLD = '#e7ad3f';
const INK = '#111111';
const IVORY = '#FBF7EC';
const LINE = '#EADFC2';
const GOLD_DARK = '#7A6320';
const FONT = "font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif";
/** The club logo as vcmem.com/app serves it (the original artwork; mail clients render PNG). */
export const CLUB_LOGO_URL =
  'https://vcmem.com/wp-content/uploads/2025/11/%D9%84%D9%88%D8%AC%D9%88-%D9%86%D8%A7%D8%AF%D9%8A-%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D8%AB%D9%85%D8%B1%D9%8A%D9%86-%D8%AC%D9%88%D9%88%D9%84%D8%AF-%D8%B4%D9%81%D8%A7%D9%81.png';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LATIN = /^[\d+@A-Za-z.\-_ :/]+$/;

export function royalHtml(mail: RoyalMail): string {
  const en = mail.lang === 'en';
  const dir = en ? 'ltr' : 'rtl';
  const start = en ? 'left' : 'right';
  const eyebrow = mail.eyebrow ?? (en ? 'INVESTORS CLUB · VIBES VENTURES' : 'INVESTORS CLUB · VIBES VENTURES');
  const rows = (mail.rows ?? [])
    .map((row, index) => {
      const ltr = row.ltr ?? LATIN.test(row.value);
      const top = index ? `border-top:1px solid ${LINE};` : '';
      return `<tr><td bgcolor="${IVORY}" style="${FONT};padding:9px 14px;font-size:13.5px;color:${GOLD_DARK} !important;white-space:nowrap;width:36%;vertical-align:top;background:${IVORY} !important;${top}">${escapeHtml(row.label)}</td><td bgcolor="${IVORY}"${ltr ? ' dir="ltr"' : ''} style="${FONT};padding:9px 14px;font-size:14.5px;color:${INK} !important;font-weight:600;vertical-align:top;background:${IVORY} !important;text-align:${start};${top}">${escapeHtml(row.value)}</td></tr>`;
    })
    .join('');
  const paragraphs = (mail.lead ?? []).map((line) => `<p style="${FONT};margin:0 0 10px;font-size:15px;line-height:1.9;color:${INK} !important">${escapeHtml(line)}</p>`).join('');
  return `<!doctype html><html dir="${dir}" lang="${mail.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${escapeHtml(mail.title)}</title><style>:root{color-scheme:light only;supported-color-schemes:light only}body,table,td{color-scheme:light only}</style></head>
<body bgcolor="#F3EFE6" style="margin:0;background:#F3EFE6 !important;${FONT};direction:${dir}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F3EFE6" style="padding:26px 10px;background:#F3EFE6 !important"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:560px;width:100%;background:#ffffff !important;border:1px solid ${GOLD};border-radius:22px;overflow:hidden;box-shadow:0 14px 40px rgba(13,39,74,.14)">
<tr><td bgcolor="${NAVY}" style="background:${NAVY} !important;padding:28px 24px 22px;text-align:center;border-bottom:3px solid ${GOLD}">
<img src="${CLUB_LOGO_URL}" alt="Investors Club" width="104" style="width:104px;height:auto;display:inline-block;border:0">
<div style="${FONT};color:#F3E4B5 !important;font-size:12px;letter-spacing:3px;margin-top:12px">${escapeHtml(eyebrow)}</div>
<div style="${FONT};color:#ffffff !important;font-size:22px;font-weight:700;margin-top:8px;line-height:1.5">${escapeHtml(mail.title)}</div>
${mail.subtitle ? `<div style="${FONT};color:${GOLD} !important;font-size:15px;font-weight:600;margin-top:4px">${escapeHtml(mail.subtitle)}</div>` : ''}
</td></tr>
<tr><td bgcolor="#ffffff" style="background:#ffffff !important;padding:24px 26px 8px;text-align:${start}">
${mail.sealUrl ? `<div style="text-align:center;margin:-2px 0 14px"><img src="${escapeHtml(mail.sealUrl)}" alt="" width="88" height="88" style="width:88px;height:88px;display:inline-block;border:0;opacity:.95"></div>` : ''}
${mail.greeting ? `<p style="${FONT};margin:0 0 10px;font-size:17px;font-weight:700;color:${NAVY} !important;line-height:1.7">${escapeHtml(mail.greeting)}</p>` : ''}
${paragraphs}
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${IVORY}" style="margin:14px 0 6px;border:1px solid ${LINE};border-radius:14px;background:${IVORY} !important;border-collapse:separate">${rows}</table>` : ''}
${mail.cta ? `<div style="text-align:center;margin:20px 0 8px"><a href="${escapeHtml(mail.cta.url)}" style="${FONT};display:inline-block;background:${GOLD};color:${NAVY} !important;text-decoration:none;font-weight:700;padding:13px 30px;border-radius:999px;font-size:15px">${escapeHtml(mail.cta.label)}</a></div>` : ''}
${mail.note ? `<p style="${FONT};margin:10px 0 12px;font-size:12.5px;line-height:1.8;color:#555555 !important;text-align:center">${escapeHtml(mail.note)}</p>` : ''}
</td></tr>
<tr><td bgcolor="${NAVY}" style="background:${NAVY} !important;color:#cfcac0 !important;padding:14px 20px;text-align:center;${FONT};font-size:12px;line-height:1.9">${en ? 'Investors Club — Vibes Ventures' : 'نادي المستثمرين — Vibes Ventures'}<br><a href="https://${escapeHtml(SELLER.site)}" style="color:#F3E4B5 !important;text-decoration:none" dir="ltr">${escapeHtml(SELLER.site)}</a> · <a href="mailto:${escapeHtml(SELLER.email)}" style="color:#F3E4B5 !important;text-decoration:none" dir="ltr">${escapeHtml(SELLER.email)}</a></td></tr>
</table></td></tr></table></body></html>`;
}

/** The plain-text twin: the same facts, one per line. */
export function royalText(mail: RoyalMail): string {
  const lines: string[] = [mail.title];
  if (mail.subtitle) lines.push(mail.subtitle);
  lines.push('');
  if (mail.greeting) lines.push(mail.greeting, '');
  for (const line of mail.lead ?? []) lines.push(line);
  if (mail.lead?.length) lines.push('');
  for (const row of mail.rows ?? []) lines.push(`${row.label}: ${row.value}`);
  if (mail.cta) lines.push('', `${mail.cta.label}: ${mail.cta.url}`);
  if (mail.note) lines.push('', mail.note);
  lines.push('', mail.lang === 'en' ? 'Investors Club — Vibes Ventures' : 'نادي المستثمرين — Vibes Ventures', SELLER.site);
  return lines.join('\n');
}
