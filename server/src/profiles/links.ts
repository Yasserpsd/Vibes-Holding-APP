/**
 * M253 (owner, 2026-11-19: a member typed an account name in the links box and the page was refused with
 * «some details are not valid»): a link is put right for the member where there is one right answer, instead of
 * being refused — «instagram: name», «@name» beside a network's name, a missing «https://», a space inside the
 * address. The app applies the same tidying before it sends (app/src/lib/fixes.ts); keep the two in step.
 */
export type TypedLink = { label: string; url: string };

/** A network a member names in the label, and the address its accounts live under. */
const NETWORKS: { names: RegExp; host: RegExp; base: string }[] = [
  { names: /insta|[اإ]نستا|[اإ]نستق|[اإ]نستغ/i, host: /instagram\.com/i, base: 'instagram.com/' },
  { names: /linked|لينكد|لنكد/i, host: /linkedin\.com/i, base: 'linkedin.com/in/' },
  { names: /tiktok|tik tok|تيك ?توك/i, host: /tiktok\.com/i, base: 'tiktok.com/@' },
  { names: /snap|سناب/i, host: /snapchat\.com/i, base: 'snapchat.com/add/' },
  { names: /youtube|يوتيوب/i, host: /youtube\.com|youtu\.be/i, base: 'youtube.com/@' },
  { names: /facebook|فيس ?بوك/i, host: /facebook\.com|fb\.com/i, base: 'facebook.com/' },
  { names: /telegram|تيليجرام|تليجرام|تلجرام|تيليغرام|تليغرام/i, host: /t\.me|telegram\.me/i, base: 't.me/' },
  { names: /twitter|تويتر|^(x|[اإ]كس)$/i, host: /twitter\.com|(^|[./])x\.com/i, base: 'x.com/' },
];

/** Marks nobody sees (direction marks, zero-width characters): a pasted address carries them. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\u061c\ufeff\u00ad]/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** An account name, not an address: letters, digits, dots, dashes — with or without the «@». */
const HANDLE = /^@?([A-Za-z0-9._-]{2,60})$/;

/** The link as the club stores it; what cannot be put right comes back as typed, and the rule refuses it by name. */
export function tidyLink(link: TypedLink): TypedLink {
  let label = link.label.replace(INVISIBLE, '').trim();
  let url = link.url.replace(INVISIBLE, '').trim();
  // «instagram: name» typed in one piece (never the «:» of «https://»).
  if (!label) {
    const split = url.match(/^([^\s:/|@]{1,40})\s*[:：]\s*(?!\/\/)(\S.*)$/);
    if (split) {
      label = (split[1] ?? '').trim();
      url = (split[2] ?? '').trim();
    }
  }
  // An address never holds a space.
  url = url.replace(/\s+/g, '');
  const network = NETWORKS.find((item) => item.names.test(label));
  const handle = url.match(HANDLE);
  if (network && handle && !network.host.test(url)) url = `${network.base}${handle[1] ?? ''}`;
  if (url && !HAS_SCHEME.test(url)) url = `https://${url}`;
  return { label, url };
}

export function isWebLink(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.') && !url.username;
  } catch {
    return false;
  }
}
