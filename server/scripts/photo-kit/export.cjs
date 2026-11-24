// Final app-ready pictures (WebP, under the 1 MB upload limit) + the manifest the upload script reads.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const root = 'C:/Users/LENOVO/OneDrive/Desktop/صور التطبيق الجديد';
const banner = path.join(root, 'Banner');
const en = path.join(__dirname, 'out/en');
const out = path.join(root, 'جاهزة للتطبيق');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const pick = (dir, prefix) => path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith(prefix)));

const SRC = {
  b1: pick(banner, 'Authentic'), b2: pick(banner, 'Definitive'), b3: pick(banner, 'International'), b4: pick(banner, 'Luxury'),
  b5: pick(banner, 'Premium_business-travel'), b6: pick(banner, 'Premium_technology'), b7: pick(banner, 'Ultra'),
  m3: pick(root, 'Breathtaking'), m6: pick(root, 'Extraordinary_vertical'), m10: pick(root, 'The_most'), m11: pick(root, 'Visually'),
  hallWide: pick(root, 'Artistic_evening'), hallTall: pick(root, 'Artistic_vertical'), chair: pick(root, 'Extraordinary_luxury'),
  hallSym: pick(root, 'Extraordinary_symmetrical'), aisle: pick(root, 'Powerful_vertical'), crowd: pick(root, 'Professional_photographic'), macro: pick(root, 'Refined_macro'),
};

// name → { from (source key), width, crop: { ratio, y0 (percent from the top) }, english: true = an English twin from
// out/en/<from>.en.png, slots }. A slot is an exact key, or one of two "first empty slot" words the upload script
// resolves on each server: `service.<key>` (that service's page banner) and `hq` (the HQ gallery).
// Service-page posters are cut 5:4: the store versions before 1.3.7 cap a banner at 320 points and would crop the
// headline of anything taller.
const ITEMS = [
  // The home's moving banners (and the same pictures on their own screens).
  { name: 'banner-seat-among-investors', from: 'b4', width: 1600, english: true, slots: ['home.slide.membership.1', 'membership.slide.1'] },
  { name: 'banner-membership-anywhere', from: 'b5', width: 1600, english: true, slots: ['home.slide.membership.2', 'membership.slide.2'] },
  { name: 'banner-relationships', from: 'b2', width: 1600, english: true, slots: ['home.slide.membership.3', 'membership.slide.3'] },
  { name: 'banner-project-starts-here', from: 'b6', width: 1600, english: true, slots: ['home.slide.partners.1', 'service.success-partners'] },
  { name: 'banner-five-minutes', from: 'b1', width: 1600, english: true, slots: ['home.slide.meetups.1', 'meetups.banner', 'service.meetup'] },
  { name: 'banner-one-meeting', from: 'b7', width: 1600, english: true, slots: ['home.slide.agenda.1', 'agenda.banner'] },
  { name: 'banner-saudi-market', from: 'b3', width: 1600, english: true, slots: ['home.slide.services.1', 'about.banner'] },
  // Success Partners and «انشر تطبيقك» posters, on their service pages.
  { name: 'poster-partners-chance-wide', from: 'm3', width: 1400, english: true, crop: { ratio: 5 / 4, y0: 5 }, slots: ['service.success-partners'] },
  { name: 'poster-partners-doors-wide', from: 'm10', width: 1400, english: true, crop: { ratio: 5 / 4, y0: 2.5 }, slots: ['service.success-partners'] },
  { name: 'poster-partners-idea-wide', from: 'm11', width: 1400, english: true, crop: { ratio: 5 / 4, y0: 1 }, slots: ['service.success-partners'] },
  { name: 'poster-app-digital', from: 'm6', width: 1280, english: true, crop: { ratio: 4 / 5, y0: 1.2 }, slots: ['service.app-publish.4'] },
  // Wordless cuts for the home door cards.
  { name: 'card-partners-handshake', from: 'm11', width: 1280, crop: { ratio: 16 / 9, y0: 25.5 }, slots: ['home.card.success-partners.1'] },
  { name: 'card-partners-emblem', from: 'm3', width: 1280, crop: { ratio: 16 / 9, y0: 25.5 }, slots: ['home.card.success-partners.2'] },
  { name: 'card-partners-gate', from: 'm10', width: 1280, crop: { ratio: 16 / 9, y0: 27 }, slots: ['home.card.success-partners.3'] },
  { name: 'card-app-screens', from: 'm6', width: 1280, crop: { ratio: 16 / 9, y0: 36 }, slots: ['home.card.app-publish.1'] },
  // The HQ: the membership benefit cards, the HQ gallery, two home banners and the services held in the hall.
  { name: 'hq-hall-evening', from: 'hallWide', width: 1280, crop: { ratio: 16 / 9, y0: 10 }, slots: ['membership.photo.1', 'hq', 'service.theater', 'service.meetup', 'auth.photo.5', 'page.photo.1'] },
  { name: 'hq-investor-seat', from: 'chair', width: 1280, crop: { ratio: 16 / 9, y0: 1 }, slots: ['membership.photo.2', 'hq', 'service.hq-visit', 'home.slide.hq.2', 'page.photo.2'] },
  { name: 'hq-hall-symmetry', from: 'hallSym', width: 1280, crop: { ratio: 16 / 9, y0: 0 }, slots: ['membership.photo.3', 'hq', 'service.theater', 'service.hq-visit', 'home.slide.hq.1', 'auth.photo.4', 'page.photo.3'] },
  { name: 'hq-meetup-audience', from: 'crowd', width: 1280, crop: { ratio: 16 / 9, y0: 36 }, slots: ['membership.photo.4', 'hq', 'service.meetup', 'service.workshop', 'page.photo.4'] },
  { name: 'hq-seat-embroidery', from: 'macro', width: 1280, crop: { ratio: 16 / 9, y0: 22 }, slots: ['membership.photo.5', 'hq', 'service.hq-visit', 'page.photo.5'] },
  { name: 'hq-hall-aisle', from: 'aisle', width: 1280, crop: { ratio: 16 / 9, y0: 50 }, slots: ['membership.photo.6', 'hq', 'service.theater', 'page.photo.6'] },
  // Upright cuts for the entry screens (the gate shows them tall, edge to edge).
  { name: 'auth-investor-seat', from: 'chair', width: 1080, crop: { ratio: 4 / 5, y0: 0 }, slots: ['auth.photo.1'] },
  { name: 'auth-hall-rows', from: 'hallTall', width: 1080, crop: { ratio: 4 / 5, y0: 30 }, slots: ['auth.photo.2'] },
  { name: 'auth-hall-aisle', from: 'aisle', width: 1080, crop: { ratio: 4 / 5, y0: 30 }, slots: ['auth.photo.3'] },
  { name: 'hq-hall-rows', from: 'hallTall', width: 1280, crop: { ratio: 16 / 9, y0: 52 }, slots: ['membership.photo.7', 'hq', 'service.workshop', 'page.photo.7'] },
];

async function render(file, item, target) {
  let image = sharp(file).removeAlpha();
  const meta = await image.metadata();
  if (item.crop) {
    const height = Math.min(meta.height, Math.round(meta.width / item.crop.ratio));
    const top = Math.min(meta.height - height, Math.round((item.crop.y0 / 100) * meta.height));
    image = image.extract({ left: 0, top, width: meta.width, height });
  }
  let quality = 84;
  for (;;) {
    const body = await image.clone().resize({ width: item.width, withoutEnlargement: true }).webp({ quality, effort: 5 }).toBuffer();
    if (body.length < 900 * 1024 || quality <= 60) { fs.writeFileSync(target, body); return body.length; }
    quality -= 6;
  }
}

(async () => {
  const manifest = [];
  for (const item of ITEMS) {
    const ar = `${item.name}.webp`;
    const size = await render(SRC[item.from], item, path.join(out, ar));
    const entry = { file: ar, slots: item.slots, kb: Math.round(size / 1024) };
    if (item.english) {
      entry.fileEn = `${item.name}.en.webp`;
      entry.kbEn = Math.round((await render(path.join(en, `${item.from}.en.png`), item, path.join(out, entry.fileEn))) / 1024);
    }
    manifest.push(entry);
    console.log(entry.file, entry.kb + 'KB', entry.fileEn ? entry.kbEn + 'KB en' : '');
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // A review sheet of the wordless cuts.
  const cuts = ITEMS.filter((item) => item.crop && item.name.startsWith('poster-'));
  const tiles = [];
  for (let i = 0; i < cuts.length; i++) tiles.push({ input: await sharp(path.join(out, `${cuts[i].name}.webp`)).resize(380, 214).jpeg().toBuffer(), left: (i % 4) * 386, top: Math.floor(i / 4) * 220 });
  await sharp({ create: { width: 4 * 386, height: Math.ceil(cuts.length / 4) * 220, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 80 }).toFile(path.join(__dirname, 'out/cuts.jpg'));
})().catch((e) => { console.error(e); process.exit(1); });
