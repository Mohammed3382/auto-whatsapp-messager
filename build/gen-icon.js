// Renders build/icon.svg into build/icon.ico (multi-size) + build/icon.png,
// using the Chromium that Puppeteer already bundles (no extra image deps).
// Run from the project root: node build/gen-icon.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const pngToIco = require('png-to-ico');

const ROOT = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const sizes = [256, 128, 64, 48, 32, 16];
  const buffers = [];
  for (const s of sizes) {
    await page.setViewport({ width: s, height: s, deviceScaleFactor: 1 });
    const scaled = svg.replace('width="256" height="256"', `width="${s}" height="${s}"`);
    await page.setContent('<!doctype html><html><body style="margin:0;padding:0">' + scaled + '</body></html>', { waitUntil: 'domcontentloaded' });
    const el = await page.$('svg');
    const buf = await el.screenshot({ omitBackground: true, type: 'png' });
    buffers.push(buf);
    if (s === 256) fs.writeFileSync(path.join(__dirname, 'icon.png'), buf);
  }
  await browser.close();
  const ico = await pngToIco(buffers);
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
  console.log('generated build/icon.ico (' + ico.length + ' bytes) + build/icon.png');
})().catch((e) => { console.error(e); process.exit(1); });
