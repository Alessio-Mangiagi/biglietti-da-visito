/**
 * Generates the iOS launch screens (apple-touch-startup-image) and the 96px icons of the
 * home-screen shortcuts. Run once after changing the brand: `node scripts/make-splash.mjs`.
 * Output goes to public/splash and public/shortcut-*.png; the <link> tags are printed.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const font = readFileSync(require.resolve('@fontsource/ubuntu/files/ubuntu-latin-500-normal.woff2')).toString('base64');
const logo = readFileSync(join(root, 'public/favicon.svg'), 'utf8');

// [css width, css height, pixel ratio] — every iPhone shape since the SE
const IPHONES = [
  [440, 956, 3],
  [402, 874, 3],
  [430, 932, 3],
  [393, 852, 3],
  [428, 926, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 3],
  [414, 896, 2],
  [414, 736, 3],
  [375, 667, 2],
  [320, 568, 2],
];

const splashHtml = `<!doctype html><html><head><style>
@font-face { font-family: Ubuntu; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 500; }
html, body { margin: 0; height: 100%; }
body {
  display: grid; place-items: center;
  background: #0c4577; /* flat: a gradient would make each PNG ~600 KB */
  font-family: Ubuntu, sans-serif; color: #fff;
}
.box { display: grid; justify-items: center; gap: 18px; transform: translateY(-4%); }
.logo { width: 104px; height: 104px; border-radius: 24px; box-shadow: 0 18px 40px rgba(0,0,0,.28); overflow: hidden; }
.logo svg { width: 100%; height: 100%; display: block; }
.name { font-size: 30px; letter-spacing: -.01em; }
.tag { position: fixed; bottom: 7%; left: 0; right: 0; text-align: center; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #9fd2f5; }
.strip { position: fixed; bottom: 0; left: 0; right: 0; height: 6px; background: #65bc7b; }
</style></head><body>
<div class="box"><div class="logo">${logo}</div><div class="name">CardVault</div></div>
<div class="tag">Biglietti da visita · Cosedil</div><div class="strip"></div>
</body></html>`;

const ICONS = {
  scan: '<path d="M18 30V20a2 2 0 0 1 2-2h10M66 18h10a2 2 0 0 1 2 2v10M78 66v10a2 2 0 0 1-2 2H66M30 78H20a2 2 0 0 1-2-2V66" /><rect x="30" y="36" width="36" height="24" rx="3" />',
  card: '<rect x="16" y="24" width="64" height="48" rx="6" /><circle cx="36" cy="44" r="7" /><path d="M26 62c2-6 6-9 10-9s8 3 10 9M54 42h16M54 52h12" />',
  bell: '<path d="M30 64V44a18 18 0 0 1 36 0v20l6 6H24zM42 76a6 6 0 0 0 12 0" /><path d="M72 30a26 26 0 0 0-8-10M24 30a26 26 0 0 1 8-10" />',
};
const iconHtml = (paths) => `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
<rect width="96" height="96" rx="22" fill="#0c4577"/>
<g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
</svg></body></html>`;

const browser = await chromium.launch();
mkdirSync(join(root, 'public/splash'), { recursive: true });
const links = [];
for (const [w, h, r] of IPHONES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
  await page.setContent(splashHtml);
  await page.evaluate(() => document.fonts.ready);
  const file = `splash/iphone-${w * r}x${h * r}.png`;
  await page.screenshot({ path: join(root, 'public', file) });
  links.push(
    `<link rel="apple-touch-startup-image" href="/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)" />`,
  );
  await page.close();
}
for (const [name, paths] of Object.entries(ICONS)) {
  const page = await browser.newPage({ viewport: { width: 96, height: 96 } });
  await page.setContent(iconHtml(paths));
  await page.screenshot({ path: join(root, `public/shortcut-${name}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
console.log(links.join('\n'));
