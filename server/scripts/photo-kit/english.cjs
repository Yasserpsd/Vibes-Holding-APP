// English versions of the owner's text-bearing photos: the Arabic lettering is lifted off the picture
// (top-hat mask + smooth fill + grain), then the English line is typeset in its place. Source files are only read.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const root = 'C:/Users/LENOVO/OneDrive/Desktop/صور التطبيق الجديد';
const banner = path.join(root, 'Banner');
const out = path.join(__dirname, 'out/en');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const FONTS = path.join(__dirname, '../../../app/node_modules/@expo-google-fonts/ibm-plex-sans-arabic');
const fontFile = (w) => ({ 400: `${FONTS}/400Regular/IBMPlexSansArabic_400Regular.ttf`, 500: `${FONTS}/500Medium/IBMPlexSansArabic_500Medium.ttf`, 600: `${FONTS}/600SemiBold/IBMPlexSansArabic_600SemiBold.ttf`, 700: `${FONTS}/700Bold/IBMPlexSansArabic_700Bold.ttf` })[w];
const pick = (dir, prefix) => path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith(prefix)));

// Percent coordinates of the full picture. erase: [x0,y0,x1,y1,(dark text?)]. blocks: one typeset block each.
// span colour: a hex, or a [x0,y0,x1,y1] box whose ORIGINAL lettering gives the colour.
const JOBS = {
  b1: { file: pick(banner, 'Authentic'), erase: [[25, 8, 75.5, 32.5]], blocks: [
    { spans: [{ t: '5 Minutes ', c: [54, 10, 74, 23] }, { t: 'for Your Project', c: '#FFFFFF' }], weight: 600, align: 'center', x: 50, cy: 16.5, maxW: 60, maxH: 8.6 },
    { spans: [{ t: 'Present your idea to those interested in partnership.', c: '#FFFFFF' }], weight: 400, align: 'center', x: 50, cy: 27.6, maxW: 50, maxH: 4.4 },
  ] },
  b2: { file: pick(banner, 'Definitive'), erase: [[60.5, 55.5, 95.4, 67.5]], blocks: [
    { spans: [{ t: 'Relationships\nAre Priceless', c: [61, 56, 95, 67] }], weight: 500, align: 'center', x: 78.3, cy: 63, maxW: 30, maxH: 13 },
  ] },
  b3: { file: pick(banner, 'International'), erase: [[4, 11, 37.3, 33.5]], blocks: [
    { spans: [{ t: 'Your Gateway to\nthe Saudi Market', c: [5, 22, 36, 32] }], weight: 500, align: 'left', x: 5.2, cy: 22.2, maxW: 31, maxH: 19 },
  ] },
  b4: { file: pick(banner, 'Luxury'), erase: [[28, 9.5, 79, 22.3]], blocks: [
    { spans: [{ t: 'Your Seat Among Investors', c: '#FFFFFF' }], weight: 600, align: 'center', x: 53.5, cy: 15.8, maxW: 50, maxH: 8.4 },
  ] },
  b5: { file: pick(banner, 'Premium_business-travel'), erase: [[4, 8, 41, 34]], blocks: [
    { spans: [{ t: 'Your Membership,\n', c: [5, 10, 40, 19.5] }, { t: 'Wherever You Are', c: '#FFFFFF' }], weight: 500, align: 'left', x: 5.4, cy: 21, maxW: 35, maxH: 21 },
  ] },
  b6: { file: pick(banner, 'Premium_technology'), erase: [[4.5, 13, 52.4, 38]], blocks: [
    { spans: [{ t: 'Your Project Starts Here', c: '#FFFFFF' }], weight: 700, align: 'left', x: 5.4, cy: 20.6, maxW: 46, maxH: 9 },
    { spans: [{ t: 'Register your project with no fees', c: [5, 28.5, 44, 37] }], weight: 400, align: 'left', x: 5.5, cy: 32.4, maxW: 38, maxH: 5.4 },
  ] },
  b7: { file: pick(banner, 'Ultra'), erase: [[22, 7, 78, 22.5]], blocks: [
    { spans: [{ t: 'One Meeting Can Change the Course', c: [23, 9, 77, 21] }], weight: 500, align: 'center', x: 50, cy: 14.8, maxW: 56, maxH: 8 },
  ] },
  m3: { file: pick(root, 'Breathtaking'), erase: [[10, 10.5, 90, 25.6]], blocks: [
    { spans: [{ t: 'Your Project\nDeserves a Chance', c: '#FFFFFF' }], weight: 700, align: 'center', x: 50, cy: 15.2, maxW: 78, maxH: 9.4 },
    { spans: [{ t: 'Register your project with no fees', c: '#FFFFFF' }], weight: 400, align: 'center', x: 50, cy: 24.1, maxW: 62, maxH: 2.6 },
  ] },
  m6: { file: pick(root, 'Extraordinary_vertical'), erase: [[12, 12.7, 88, 25.6]], blocks: [
    { spans: [{ t: 'Your Project, Now Digital', c: [14, 13, 86, 20] }], weight: 600, align: 'center', x: 50, cy: 16.4, maxW: 76, maxH: 5 },
    { spans: [{ t: 'A website and an app for your project\nfrom the day you register.', c: '#FFFFFF' }], weight: 400, align: 'center', x: 50, cy: 22.2, maxW: 68, maxH: 4.4 },
  ] },
  m10: { file: pick(root, 'The_most'), erase: [[9, 11, 91, 21.6], [64, 90.2, 91.6, 94.7, true]], blocks: [
    { spans: [{ t: 'Open the Doors of Opportunity\nfor Your Project', c: [10, 12, 90, 20.5] }], weight: 600, align: 'center', x: 50, cy: 16.2, maxW: 80, maxH: 9.6 },
    { spans: [{ t: 'Register your project now', c: '#2B1C06' }], weight: 700, align: 'center', x: 77.8, cy: 92.45, maxW: 26.5, maxH: 2.5, shadow: 0 },
  ] },
  m11: { file: pick(root, 'Visually'), erase: [[14, 7.2, 86, 22.6]], blocks: [
    { spans: [{ t: 'From Idea to Partnership', c: '#FFFFFF' }], weight: 700, align: 'center', x: 50, cy: 11.4, maxW: 70, maxH: 6.4, shadow: 0.5 },
    { spans: [{ t: 'Your gateway to the Projects Bank\nand potential partners.', c: '#FFFFFF' }], weight: 500, align: 'center', x: 50, cy: 19.6, maxW: 60, maxH: 6, shadow: 0.5 },
  ] },
};

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Sliding min (or max) over a window of `k` pixels, separable. */
function morph(src, w, h, k, useMax) {
  const r = k >> 1;
  const pass = (input, horizontal) => {
    const outArr = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let best = useMax ? -Infinity : Infinity;
      for (let o = -r; o <= r; o++) {
        const xx = horizontal ? Math.min(w - 1, Math.max(0, x + o)) : x;
        const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + o));
        const v = input[yy * w + xx];
        if (useMax ? v > best : v < best) best = v;
      }
      outArr[y * w + x] = best;
    }
    return outArr;
  };
  return pass(pass(src, true), false);
}

/** The lettering mask of a region: thin strokes that stand off their surroundings (top-hat / bottom-hat). */
function letterMask(L, w, h, dark, k, threshold, grow) {
  const opened = dark ? morph(morph(L, w, h, k, true), w, h, k, false) : morph(morph(L, w, h, k, false), w, h, k, true);
  const hat = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hat[i] = dark ? opened[i] - L[i] : L[i] - opened[i];
  const core = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) core[i] = hat[i] > threshold ? 1 : 0;
  const grown = morph(core, w, h, grow * 2 + 1, true);
  return { hat, mask: grown };
}

/** Pull-push fill of the masked pixels, then a diffusion polish and a touch of the picture's own grain. */
function fill(rgb, w, h, mask) {
  const levels = [{ w, h, c: new Float32Array(w * h * 3), wt: new Float32Array(w * h) }];
  for (let i = 0; i < w * h; i++) if (!mask[i]) { levels[0].wt[i] = 1; for (let ch = 0; ch < 3; ch++) levels[0].c[i * 3 + ch] = rgb[i * 3 + ch]; }
  while (levels[levels.length - 1].w > 2 && levels[levels.length - 1].h > 2) {
    const a = levels[levels.length - 1];
    const bw = Math.ceil(a.w / 2), bh = Math.ceil(a.h / 2);
    const b = { w: bw, h: bh, c: new Float32Array(bw * bh * 3), wt: new Float32Array(bw * bh) };
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      let sw = 0; const sc = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const xx = Math.min(a.w - 1, x * 2 + dx), yy = Math.min(a.h - 1, y * 2 + dy);
        const wv = a.wt[yy * a.w + xx];
        sw += wv; for (let ch = 0; ch < 3; ch++) sc[ch] += a.c[(yy * a.w + xx) * 3 + ch] * wv;
      }
      if (sw > 0) { b.wt[y * bw + x] = 1; for (let ch = 0; ch < 3; ch++) b.c[(y * bw + x) * 3 + ch] = sc[ch] / sw; }
    }
    levels.push(b);
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const a = levels[l], b = levels[l + 1];
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const i = y * a.w + x;
      if (a.wt[i]) continue;
      const fx = Math.min(b.w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(b.h - 1, Math.max(0, (y - 0.5) / 2));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(b.w - 1, x0 + 1), y1 = Math.min(b.h - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const p = (xx, yy) => b.c[(yy * b.w + xx) * 3 + ch];
        a.c[i * 3 + ch] = (p(x0, y0) * (1 - tx) + p(x1, y0) * tx) * (1 - ty) + (p(x0, y1) * (1 - tx) + p(x1, y1) * tx) * ty;
      }
    }
  }
  const c = levels[0].c;
  const inside = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (mask[y * w + x]) inside.push(y * w + x);
  for (let it = 0; it < 120; it++) for (const i of inside) for (let ch = 0; ch < 3; ch++) c[i * 3 + ch] = (c[(i - 1) * 3 + ch] + c[(i + 1) * 3 + ch] + c[(i - w) * 3 + ch] + c[(i + w) * 3 + ch]) / 4;
  // Grain: the spread of each known pixel against its neighbours, replayed on the filled ones.
  const res = [];
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const i = y * w + x;
    if (mask[i] || mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w]) continue;
    res.push(Math.abs(lum(rgb, i * 3) - (lum(rgb, (i - 1) * 3) + lum(rgb, (i + 1) * 3) + lum(rgb, (i - w) * 3) + lum(rgb, (i + w) * 3)) / 4));
  }
  res.sort((p, q) => p - q);
  const sigma = Math.min(4, (res[res.length >> 1] ?? 0) * 1.4826 * 0.9);
  for (const i of inside) {
    const n = sigma * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
    for (let ch = 0; ch < 3; ch++) c[i * 3 + ch] += n;
  }
  for (let i = 0; i < w * h; i++) if (mask[i]) for (let ch = 0; ch < 3; ch++) rgb[i * 3 + ch] = Math.max(0, Math.min(255, Math.round(c[i * 3 + ch])));
  return sigma;
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function run(name, job) {
  const base = sharp(job.file).removeAlpha();
  const { width: W, height: H } = await base.metadata();
  const { data } = await base.raw().toBuffer({ resolveWithObject: true });
  const original = Buffer.from(data);
  const px = (p, total) => Math.round((p / 100) * total);
  const scale = W >= H ? W / 2752 : W / 1856;

  /** The colour of the original lettering inside a box: the mean of its strongest stroke pixels. */
  const sample = (box) => {
    const [x0, y0, x1, y1] = [px(box[0], W), px(box[1], H), px(box[2], W), px(box[3], H)];
    const w = x1 - x0, h = y1 - y0;
    const L = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) L[y * w + x] = lum(original, ((y0 + y) * W + x0 + x) * 3);
    const { hat } = letterMask(L, w, h, false, Math.round(61 * scale) | 1, 18, 0);
    const order = Array.from(hat.keys()).sort((p, q) => hat[q] - hat[p]).slice(0, Math.max(50, Math.round(w * h * 0.02)));
    const sum = [0, 0, 0];
    for (const i of order) { const o = ((y0 + Math.floor(i / w)) * W + x0 + (i % w)) * 3; for (let ch = 0; ch < 3; ch++) sum[ch] += original[o + ch]; }
    return hex(sum[0] / order.length, sum[1] / order.length, sum[2] / order.length);
  };

  for (const [ex0, ey0, ex1, ey1, dark] of job.erase) {
    const x0 = px(ex0, W), y0 = px(ey0, H), w = px(ex1, W) - x0, h = px(ey1, H) - y0;
    const rgb = new Float32Array(w * h * 3), L = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = ((y0 + y) * W + x0 + x) * 3;
      for (let ch = 0; ch < 3; ch++) rgb[(y * w + x) * 3 + ch] = data[o + ch];
      L[y * w + x] = lum(data, o);
    }
    const { mask } = letterMask(L, w, h, Boolean(dark), Math.round((dark ? 31 : 75) * scale) | 1, dark ? 30 : 16, Math.round((dark ? 4 : 9) * scale));
    // The frame of the region stays untouched so the fill has a known edge all round.
    for (let x = 0; x < w; x++) { mask[x] = 0; mask[(h - 1) * w + x] = 0; }
    for (let y = 0; y < h; y++) { mask[y * w] = 0; mask[y * w + w - 1] = 0; }
    let covered = 0; for (let i = 0; i < w * h; i++) covered += mask[i];
    const sigma = fill(rgb, w, h, mask);
    console.log(`${name}: erased ${Math.round((100 * covered) / (w * h))}% of ${w}x${h}, grain ${sigma.toFixed(2)}`);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = ((y0 + y) * W + x0 + x) * 3;
      for (let ch = 0; ch < 3; ch++) data[o + ch] = rgb[(y * w + x) * 3 + ch];
    }
  }
  const clean = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  await sharp(clean).resize(1100).jpeg({ quality: 80 }).toFile(path.join(out, `${name}.clean.jpg`));

  const layers = [];
  for (const block of job.blocks) {
    const markup = block.spans.map((span) => `<span foreground="${Array.isArray(span.c) ? sample(span.c) : span.c}">${esc(span.t)}</span>`).join('');
    const rendered = await sharp({ text: { text: markup, font: `IBM Plex Sans Arabic ${{ 400: 'Regular', 500: 'Medium', 600: 'Semi-Bold', 700: 'Bold' }[block.weight]}`, fontfile: fontFile(block.weight), rgba: true, dpi: 900, align: block.align === 'center' ? 'centre' : block.align, spacing: 3 } }).png().toBuffer();
    const fitted = await sharp(rendered).trim().resize({ width: px(block.maxW, W), height: px(block.maxH, H), fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    const { width: tw, height: th } = fitted.info;
    const left = block.align === 'center' ? px(block.x, W) - Math.round(tw / 2) : block.align === 'right' ? px(block.x, W) - tw : px(block.x, W);
    const top = px(block.cy, H) - Math.round(th / 2);
    const strength = block.shadow ?? 0.35;
    if (strength > 0) {
      const pad = 40;
      const mono = await sharp(fitted.data).ensureAlpha().extractChannel(3).raw().toBuffer();
      const soft = await sharp(mono, { raw: { width: tw, height: th, channels: 1 } }).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0 } }).blur(9 * scale + 1).linear(strength, 0).extractChannel(0).raw().toBuffer();
      const shadow = await sharp({ create: { width: tw + pad * 2, height: th + pad * 2, channels: 3, background: '#000' } }).joinChannel(soft, { raw: { width: tw + pad * 2, height: th + pad * 2, channels: 1 } }).png().toBuffer();
      layers.push({ input: shadow, left: left - pad, top: top - pad + Math.round(4 * scale) });
    }
    layers.push({ input: fitted.data, left, top });
    console.log(`${name}: "${block.spans.map((s) => s.t).join('').replace(/\n/g, ' / ')}" ${tw}x${th} at ${left},${top}`);
  }
  const final = await sharp(clean).composite(layers).png().toBuffer();
  await sharp(final).png({ compressionLevel: 6 }).toFile(path.join(out, `${name}.en.png`));
  await sharp(final).resize(W >= H ? 1100 : 760).jpeg({ quality: 82 }).toFile(path.join(out, `${name}.preview.jpg`));
}

(async () => {
  const only = process.argv.slice(2);
  for (const [name, job] of Object.entries(JOBS)) if (!only.length || only.includes(name)) await run(name, job);
})().catch((e) => { console.error(e); process.exit(1); });
