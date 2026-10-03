import { htmlToText } from '../projectsBank/text.js';

/**
 * One rendered piece of a golden company's offer page, in page order. The app draws these natively
 * (M: golden offer pages in-app, PROJECT_BRIEF §5.1). Web buttons and forms are dropped on purpose:
 * the calls to action stay in-app (interest form, advisor), so no offer page leads out of the app.
 */
export type OfferBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'text'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'image'; url: string };

const MAX_BLOCKS = 150;
const MAX_HEADING = 200;
const MAX_TEXT = 700;
const MAX_BULLET = 300;

/** Elementor pages mark their areas; the slice keeps the page content and drops the theme header, menus and footer. */
function contentSlice(html: string): string {
  const body = html.slice(html.search(/<body\b/i));
  // The earliest content marker wins: some themes put the page in <main> and keep Elementor
  // templates (popups, login sheets) after the footer, where a later wp-post marker would mislead.
  const candidates = [body.search(/data-elementor-type="wp-(page|post)"/i), body.search(/<main\b/i)].filter((at) => at >= 0);
  const start = candidates.length ? Math.min(...candidates) : 0;
  let slice = body.slice(start);
  const footerAt = slice.search(/data-elementor-type="footer"|<footer\b/i);
  if (footerAt > 0) slice = slice.slice(0, footerAt);
  return slice
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|form|nav|header)\b[\s\S]*?<\/\1>/gi, '');
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) attributes[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? '';
  return attributes;
}

/** A content image: absolute, raster, not a tracking pixel or icon-sized asset. */
function imageUrl(tag: string, pageUrl: string): string | null {
  const attributes = attributesOf(tag);
  const raw = [attributes['data-lazy-src'], attributes['data-src'], attributes.src].find(
    (value) => value && !value.startsWith('data:'),
  );
  if (!raw) return null;
  let resolved: URL;
  try {
    resolved = new URL(raw, pageUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(resolved.protocol)) return null;
  if (/\.(svg|ico)(\?|$)/i.test(resolved.pathname)) return null;
  const width = Number(attributes.width ?? '');
  const height = Number(attributes.height ?? '');
  if ((width > 0 && width < 64) || (height > 0 && height < 64)) return null;
  return resolved.toString();
}

function flatText(inner: string, max: number): string {
  return htmlToText(inner).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Reads the rendered offer page into ordered blocks: headings, paragraphs, list items and images.
 * The walk is tag-generic so it survives every company's own Elementor layout; duplicated texts
 * (Elementor repeats sections per breakpoint) are kept once.
 */
export function parseOfferPage(html: string, pageUrl: string): OfferBlock[] {
  const slice = contentSlice(html);
  const blocks: OfferBlock[] = [];
  const seenTexts = new Set<string>();
  const seenImages = new Set<string>();
  const pattern = /<(h[1-6]|p|li|blockquote)\b[^>]*>|<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(slice)) !== null && blocks.length < MAX_BLOCKS) {
    const tagText = match[0];
    if (tagText.toLowerCase().startsWith('<img')) {
      const url = imageUrl(tagText, pageUrl);
      if (url && !seenImages.has(url)) {
        seenImages.add(url);
        blocks.push({ type: 'image', url });
      }
      continue;
    }
    const tag = match[1]!.toLowerCase();
    const closeAt = slice.toLowerCase().indexOf(`</${tag}`, pattern.lastIndex);
    if (closeAt < 0) continue;
    const inner = slice.slice(pattern.lastIndex, closeAt);
    // A list item holding a nested list (menus) or a heading inside it renders through its children instead.
    if (tag === 'li' && /<(ul|ol|h[1-6])\b/i.test(inner)) continue;
    const isHeading = tag.startsWith('h');
    const text = flatText(inner, isHeading ? MAX_HEADING : tag === 'li' ? MAX_BULLET : MAX_TEXT);
    if (text.length < 2) continue;
    // A short Latin-only heading is the theme's own page title («offer», «home»), not content.
    if (isHeading && text.length <= 12 && !/[؀-ۿ]/.test(text)) continue;
    const seenKey = `${isHeading ? 'h' : 't'}:${text}`;
    if (seenTexts.has(seenKey)) continue;
    seenTexts.add(seenKey);
    if (isHeading) {
      const level = tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3;
      blocks.push({ type: 'heading', level, text });
    } else if (tag === 'li') {
      blocks.push({ type: 'bullet', text });
    } else {
      blocks.push({ type: 'text', text });
    }
    // Text inside this element (images aside) is consumed: nested p/li do not repeat it.
    const imgPattern = /<img\b[^>]*>/gi;
    imgPattern.lastIndex = pattern.lastIndex;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgPattern.exec(slice)) !== null && imgMatch.index < closeAt) {
      const url = imageUrl(imgMatch[0], pageUrl);
      if (url && !seenImages.has(url)) {
        seenImages.add(url);
        blocks.push({ type: 'image', url });
      }
    }
    pattern.lastIndex = closeAt;
  }
  return blocks;
}
