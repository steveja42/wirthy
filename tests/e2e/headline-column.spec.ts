// narrowToHeadlineColumn needs real layout (jsdom has none). The layout finder
// keeps the outermost passing block, so on a theme-builder page with no
// <article>/<main> it took the whole page (corbettreport.com: masthead logo,
// social icons, sidebar banner ad). Narrowing sheds only chrome beside or around
// the headline's column, and stops where the hero and body are siblings.

import { test, expect, type BrowserContext } from '@playwright/test';
import { launchWithExtension } from './helpers/launchExtension';
import { activateExtensionOnTab } from './helpers/activateExtension';

async function capture(ctx: BrowserContext, name: string): Promise<string> {
  const url = `http://127.0.0.1:4173/${name}.html`;
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await activateExtensionOnTab(ctx, url);
  const html = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('capture timeout')), 15_000);
    const on = (e: MessageEvent) => {
      if (e.data?.type !== '__WIRTHY_TEST_CAPTURE_RESULT') return;
      clearTimeout(timer); removeEventListener('message', on);
      resolve(e.data.capture?.bodyHtml ?? '');
    };
    addEventListener('message', on);
    postMessage({ type: '__WIRTHY_TEST_CAPTURE', format: 'article' }, location.origin);
  }));
  await page.close();
  return html;
}

test('layout winner narrows to the headline column, keeping hero and body', async () => {
  test.setTimeout(60_000);
  const { ctx } = await launchWithExtension({ blockAds: true });
  try {
    const html = await capture(ctx, 'headline-column-page');

    expect(html).toContain('Repainting the Underpass Together');
    expect(html, 'hero in a wrapper above the title').toContain('HERO-UNDERPASS-MURAL');
    expect(html, 'body in a sibling of the title box').toContain('BODY-CLOSING-PARAGRAPH');

    expect(html, 'masthead').not.toContain('MASTHEAD-SOCIAL-ROW');
    expect(html, 'side rail prose').not.toContain('RAIL-BLURB');
    expect(html, 'side rail banner').not.toContain('RAIL-BANNER-AD');
    expect(html, 'page footer').not.toContain('FOOTER-COPYRIGHT');
  } finally {
    await ctx.close();
  }
});

test('a product gallery beside the title column is not shed as a rail', async () => {
  test.setTimeout(60_000);
  const { ctx } = await launchWithExtension({ blockAds: true });
  try {
    const html = await capture(ctx, 'headline-column-gallery');
    expect(html).toContain('Trailhead Folding Lantern');
    expect(html, 'gallery beside the title').toContain('GALLERY-PHOTO');
    expect(html).toContain('sealed flap');
  } finally {
    await ctx.close();
  }
});
