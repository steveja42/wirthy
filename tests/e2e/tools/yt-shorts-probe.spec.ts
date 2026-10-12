// Probe for YouTube SHORTS capture: load a Short, scroll to the NEXT one, then
// capture. Reports the Shorts DOM shape (which reel renderer is active, where
// the <video> and thumbnails live, head tags) and what the capture emitted.
//
// Run:
//   YTSHORTS=1 pnpm exec playwright test -c tests/e2e/playwright.config.ts \
//     --project=yt-shorts-probe
// Env: YTSHORTS_URL (default below), YTSHORTS_SCROLLS (default 1),
//      PWDEBUG_HEADED=1 for a visible window.

import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchWithExtension } from '../helpers/launchExtension';
import { activateExtensionOnTab } from '../helpers/activateExtension';
import { castShotSafe } from '../helpers/castShot';

const OUT = resolve(__dirname, '..', '..', '..', 'test-output');
const URL0 = process.env.YTSHORTS_URL ?? 'https://www.youtube.com/shorts/evylS_O_pLA';
const SCROLLS = Number(process.env.YTSHORTS_SCROLLS ?? '1');

test('yt-shorts-probe', async () => {
  test.skip(!process.env.YTSHORTS, 'set YTSHORTS=1 to run');
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });

  const { ctx } = await launchWithExtension({ headed: !!process.env.PWDEBUG_HEADED });
  const page = await ctx.newPage();
  const lines: string[] = [];
  try {
    await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(8_000);
    lines.push(`start url: ${page.url()}`);
    for (let i = 0; i < SCROLLS; i++) {
      await page.mouse.move(640, 360);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(5_000);
    }
    lines.push(`after ${SCROLLS} scroll(s): ${page.url()}`);

    const dom = await page.evaluate(() => {
      const r = (el: Element) => { const b = el.getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`; };
      const renderers = Array.from(document.querySelectorAll('ytd-reel-video-renderer')).map(el => ({
        id: el.id, active: el.hasAttribute('is-active'), rect: r(el),
        hasVideo: !!el.querySelector('video'),
        thumbs: Array.from(el.querySelectorAll('img')).map(i => (i as HTMLImageElement).src).filter(Boolean).slice(0, 3),
        bg: Array.from(el.querySelectorAll<HTMLElement>('[style*="background"]')).map(e => e.style.backgroundImage).filter(Boolean).slice(0, 2),
        links: Array.from(el.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).slice(0, 6),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      }));
      const videos = Array.from(document.querySelectorAll('video')).map(v => {
        let anc = v.parentElement; const chain: string[] = [];
        while (anc && chain.length < 12) { chain.push(anc.tagName.toLowerCase() + (anc.id ? '#' + anc.id : '')); anc = anc.parentElement; }
        return { src: v.src.slice(0, 60), poster: v.poster, rect: r(v), chain: chain.join(' < ') };
      });
      return {
        canonical: document.querySelector<HTMLLinkElement>('link[rel=canonical]')?.href,
        ogImage: document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content,
        ogUrl: document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content,
        firstImg: document.querySelector('img')?.src,
        hasPrimaryInner: !!document.querySelector('#primary-inner'),
        shortsTags: Array.from(new Set(Array.from(document.querySelectorAll('ytd-shorts *')).map(e => e.tagName.toLowerCase()).filter(t => t.includes('-')))).slice(0, 60),
        renderers, videos,
      };
    });
    lines.push('DOM: ' + JSON.stringify(dom, null, 2));
    // The metadata overlay of the reel holding the visible <video>, svg-stripped.
    const overlay = await page.evaluate(() => {
      const v = Array.from(document.querySelectorAll('video')).find(x => x.getBoundingClientRect().width > 0);
      const reel = v?.closest('ytd-reel-video-renderer');
      const parts = ['yt-reel-metapanel-view-model', 'reel-action-bar-view-model', 'yt-shorts-video-title-view-model'];
      return parts.map(sel => {
        const el = reel?.querySelector(sel);
        if (!el) return `${sel}: (none)`;
        const c = el.cloneNode(true) as Element;
        c.querySelectorAll('svg, style').forEach(s => s.remove());
        return `${sel}:\n${c.outerHTML.replace(/\s(class|style|jsaction|aria-hidden)="[^"]*"/g, '').slice(0, 4000)}`;
      }).join('\n\n');
    });
    writeFileSync(resolve(OUT, 'yt-shorts-overlay.html'), overlay, 'utf8');

    await activateExtensionOnTab(ctx, page.url());
    const cap = await page.evaluate((fmt) => new Promise((res) => {
      const t = setTimeout(() => res({ error: 'capture timeout' }), 60_000);
      const on = (e: MessageEvent) => {
        if (e.data?.type !== '__WIRTHY_TEST_CAPTURE_RESULT') return;
        clearTimeout(t); removeEventListener('message', on);
        res(e.data.error ? { error: e.data.error } : e.data.capture);
      };
      addEventListener('message', on);
      postMessage({ type: '__WIRTHY_TEST_CAPTURE', format: fmt }, location.origin);
    }), process.env.YTSHORTS_FORMAT ?? 'article') as Record<string, unknown>;
    const html = String(cap.bodyHtml ?? '');
    writeFileSync(resolve(OUT, 'yt-shorts-clip.html'), html, 'utf8');
    lines.push(`capture url: ${cap.url}  title: ${cap.title}`);
    lines.push(`thumbnail: ${String(cap.thumbnail ?? '').slice(0, 120)}`);
    lines.push(`thumbnailUrl: ${cap.thumbnailUrl}`);
    lines.push(`imageUrls: ${JSON.stringify(cap.imageUrls)}`);
    lines.push(`bodyHtml len ${html.length}; imgs: ${JSON.stringify([...html.matchAll(/<img[^>]*src="([^"]{0,90})/g)].map(m => m[1]))}`);
    lines.push(`tweet-video cards: ${JSON.stringify([...html.matchAll(/<a[^>]*class="tweet-video[^"]*"[^>]*>/g)].map(m => m[0]))}`);
    lines.push(`error: ${cap.error ?? ''}`);
    await page.screenshot({ path: resolve(OUT, 'yt-shorts-source.png') });

    // Render the clip in /clips, then click its play card.
    const lib = await ctx.newPage();
    await lib.goto('http://localhost:3000/clips', { waitUntil: 'networkidle' });
    await lib.evaluate((capture) => {
      const clip = { capture, evaluation: { signal: 'Worthwhile', qualifiers: [], category: 'General' }, encrypted: '' };
      window.postMessage({ type: 'WIRTHY_BRIDGE_HELLO', pubkey: 'a'.repeat(64), authMethod: 'nip07' }, window.location.origin);
      window.postMessage({ type: 'WIRTHY_BRIDGE_CLIPS', clips: [clip] }, window.location.origin);
    }, cap);
    await lib.locator('article.clip').first().click();
    const body = lib.locator('.clip-body');
    await body.waitFor({ state: 'visible', timeout: 10_000 });
    await lib.waitForTimeout(1_500);
    await body.screenshot({ path: resolve(OUT, 'yt-shorts-rendered.png') });
    await body.locator('a.tweet-video').first().click();
    const frame = body.locator('iframe.clip-video-frame');
    await frame.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => undefined);
    lines.push(`player: ${await frame.count() ? `${await frame.getAttribute('src')} box=${JSON.stringify(await frame.boundingBox())}` : 'NONE (card did not play in place)'}`);
    await lib.waitForTimeout(3_000);
    await body.screenshot({ path: resolve(OUT, 'yt-shorts-playing.png') });
    await castShotSafe(page, cap as { title?: string }, resolve(OUT, 'yt-shorts-cast.png'));
  } finally {
    writeFileSync(resolve(OUT, 'yt-shorts-probe.txt'), lines.join('\n'), 'utf8');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    await page.close().catch(() => undefined);
    await ctx.close();
  }
});
