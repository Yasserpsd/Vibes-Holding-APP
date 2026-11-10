// Captioned App Store screenshots, 1206x2622. Run from server/ (uses its sharp).
const sharp = require('sharp');
const path = require('path');
const SP = __dirname;
const FONTS = 'C:/Projects/vibes-club-app/app/node_modules/@expo-google-fonts/ibm-plex-sans-arabic';
const BOLD = `${FONTS}/700Bold/IBMPlexSansArabic_700Bold.ttf`;
const REG = `${FONTS}/400Regular/IBMPlexSansArabic_400Regular.ttf`;
const EMBLEM = 'C:/Projects/vibes-club-app/app/assets/images/club-emblem.png';
const W = 1206, H = Number(process.env.OUT_H || 2622);
const CH = Math.max(H, 2900); // draw tall, crop to H (Play needs 9:16)
const OUT = process.env.OUT_DIR || 'store-out';

const SHOTS = [
  // Owner, 2026-11-10: relationships first («العلاقات لا تقدر بثمن»), no «الفكر ثروة».
  // A = owner's home shot (2026-11-10), C = his events + services shot.
  ['A', 'العلاقات لا تُقدَّر بثمن', 'نادٍ يجمعك بالمستثمرين ورواد الأعمال'],
  ['07', 'الشراكة تبدأ بلقاء', 'تعرّف على أعضاء النادي وقصصهم'],
  ['09', 'لقاءات وجهًا لوجه', 'مقر النادي في الرياض يجمع الأعضاء حضوريًا'],
  ['02', 'تواصل مع المؤسس مباشرة', 'أكثر من 260 مشروعًا في بنك المشاريع'],
  ['C', 'ملتقيات وورش طوال العام', 'تتعرّف فيها على شركاء ومستثمرين جدد'],
  ['08', 'حضّر فكرتك قبل اللقاء', 'مساعد Vibes Ventures يقرأ دراسة الجدوى معك'],
  ['04', 'خارج الرياض؟ أنت معنا', 'كل فعالية تُبثّ عبر الإنترنت للأعضاء'],
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (t, file, family, size, color, width) =>
  sharp({ text: { text: `<span foreground="${color}">${esc(t)}</span>`, font: `${family} ${size}`, fontfile: file, rgba: true, align: 'centre', width, dpi: 72, wrap: 'word', spacing: Math.round(size * 0.35) } }).png().toBuffer();

const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${CH}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10224A"/><stop offset="0.45" stop-color="#081431"/><stop offset="1" stop-color="#040A1A"/></linearGradient>
    <radialGradient id="r" cx="0.5" cy="0.3" r="0.55"><stop offset="0" stop-color="#D4AF37" stop-opacity="0.22"/><stop offset="1" stop-color="#D4AF37" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/>
</svg>`);

(async () => {
  const emblem = await sharp(EMBLEM).resize({ height: 120 }).png().toBuffer();
  const em = await sharp(emblem).metadata();
  for (let i = 0; i < SHOTS.length; i++) {
    const [src, head, sub] = SHOTS[i];
    const headImg = await text(head, BOLD, 'IBM Plex Sans Arabic Bold', 84, '#E8C766', 1060);
    const subImg = await text(sub, REG, 'IBM Plex Sans Arabic', 42, '#FFFFFF', 940);
    const hm = await sharp(headImg).metadata();
    const sm = await sharp(subImg).metadata();
    const shotW = 940, radius = 64, border = 5;
    const shot = await sharp(path.join(SP, 'store-src', `${src}.png`)).resize({ width: shotW }).png().toBuffer();
    const shm = await sharp(shot).metadata();
    const mask = Buffer.from(`<svg width="${shotW}" height="${shm.height}"><rect width="${shotW}" height="${shm.height}" rx="${radius}" ry="${radius}"/></svg>`);
    const rounded = await sharp(shot).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const frameW = shotW + border * 2, frameH = shm.height + border * 2;
    const frame = Buffer.from(`<svg width="${frameW + 120}" height="${frameH + 120}"><defs><filter id="f" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="28"/></filter></defs>
      <rect x="60" y="60" width="${frameW}" height="${frameH}" rx="${radius + border}" fill="#D4AF37" opacity="0.35" filter="url(#f)"/>
      <rect x="60" y="60" width="${frameW}" height="${frameH}" rx="${radius + border}" fill="#C9A23A"/></svg>`);
    let y = 110;
    const layers = [{ input: emblem, left: Math.round((W - em.width) / 2), top: y }];
    y += em.height + 50;
    layers.push({ input: headImg, left: Math.round((W - hm.width) / 2), top: y });
    y += hm.height + 28;
    layers.push({ input: subImg, left: Math.round((W - sm.width) / 2), top: y });
    y += sm.height + 70;
    const shotTop = Math.max(y, 690);
    layers.push({ input: frame, left: Math.round((W - frameW) / 2) - 60, top: shotTop - 60 });
    layers.push({ input: rounded, left: Math.round((W - shotW) / 2), top: shotTop + border });
    const canvas = await sharp(bg).composite(layers).png().toBuffer();
    // Layers may run past the bottom edge: crop to the store size.
    const out = path.join(SP, OUT, `${i + 1}-${src}.png`);
    await sharp(canvas).extract({ left: 0, top: 0, width: W, height: H }).flatten({ background: '#040A1A' }).png().toFile(out);
    console.log(out, 'head', hm.width + 'x' + hm.height, 'shotTop', shotTop);
  }
})().catch((e) => { console.error(e); process.exit(1); });
