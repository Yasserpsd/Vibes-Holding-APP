// Previews of the text-bearing photos with a 10% grid, to read the text regions off them.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const root = 'C:/Users/LENOVO/OneDrive/Desktop/صور التطبيق الجديد';
const out = path.join(__dirname, 'out/grid');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });

const pick = (dir, prefix) => path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith(prefix)));
const banner = path.join(root, 'Banner');
const jobs = {
  b1: pick(banner, 'Authentic'),
  b2: pick(banner, 'Definitive'),
  b3: pick(banner, 'International'),
  b4: pick(banner, 'Luxury'),
  b5: pick(banner, 'Premium_business-travel'),
  b6: pick(banner, 'Premium_technology'),
  b7: pick(banner, 'Ultra'),
  m3: pick(root, 'Breathtaking'),
  m6: pick(root, 'Extraordinary_vertical'),
  m10: pick(root, 'The_most'),
  m11: pick(root, 'Visually'),
};

(async () => {
  const only = process.argv.slice(2);
  for (const [name, file] of Object.entries(jobs)) {
    if (only.length && !only.includes(name)) continue;
    const meta = await sharp(file).metadata();
    const landscape = meta.width >= meta.height;
    const w = landscape ? 1100 : Math.round((900 * meta.width) / meta.height);
    const h = landscape ? Math.round((1100 * meta.height) / meta.width) : 900;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
    for (let i = 1; i < 20; i++) {
      const major = i % 2 === 0;
      const x = (w * i) / 20;
      const y = (h * i) / 20;
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${major ? '#00ffff' : '#00ffff55'}" stroke-width="1"/>`;
      svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${major ? '#ff00ff' : '#ff00ff55'}" stroke-width="1"/>`;
      if (major) {
        svg += `<text x="${x + 2}" y="11" font-size="11" fill="#00ffff" font-family="Arial">${i * 5}</text>`;
        svg += `<text x="2" y="${y - 2}" font-size="11" fill="#ff00ff" font-family="Arial">${i * 5}</text>`;
      }
    }
    svg += '</svg>';
    await sharp(file).resize(w, h).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 78 }).toFile(path.join(out, `${name}.jpg`));
    console.log(name, meta.width, meta.height);
  }
})().catch((e) => { console.error(e); process.exit(1); });
