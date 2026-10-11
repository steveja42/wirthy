// Regenerates public/og/default.png, the 1200x630 Open Graph card used by every page
// that doesn't set its own image (and by cast pages without an http thumbnail).
//
// Run:  pnpm gen:og
//
// A COMMITTED BUILD-TIME ASSET, like the icons (see wirthy-ext/scripts/gen-icons.mjs):
// drawn by @playwright/test's bundled Chromium, already a root devDependency.
// The mark is app/icon.svg (the navy site master), so the card matches the favicon.

import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT = join(root, 'public', 'og', 'default.png');

// Strip the master's leading comment so it inlines cleanly.
const mark = readFileSync(join(root, 'app', 'icon.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();

const html = `<!doctype html>
<html><head><style>
  html, body { margin: 0; width: 1200px; height: 630px; }
  body {
    background: #ffffff;
    font-family: Georgia, 'Iowan Old Style', serif;
    color: #0d0d0d;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 96px; box-sizing: border-box;
    border-bottom: 14px solid #1d4ed8;
  }
  .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 44px; }
  .brand svg { height: 72px; width: auto; }
  .brand span { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 40px; font-weight: 600; letter-spacing: -0.01em; }
  h1 { font-size: 76px; font-weight: 500; line-height: 1.02; letter-spacing: -0.025em; margin: 0 0 28px; }
  h1 em { color: #1d4ed8; }
  p { font-size: 30px; line-height: 1.4; color: #2b2b2b; margin: 0; max-width: 900px; }
</style></head><body>
  <div class="brand">${mark}<span>Wirthy</span></div>
  <h1>Clip anything on the web,<br><em>rate it, keep it</em></h1>
  <p>A web clipper that keeps the page&rsquo;s real layout. Publish your picks to Nostr if you want.</p>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  mkdirSync(dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: 'png' });
  console.log(`wrote ${OUT}`);
} finally {
  await browser.close();
}
