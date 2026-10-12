// Generic LIVE capture probe: capture a URL, render the clip in /clips, click
// its first play card, build + render the cast, and dump what each produced.
// Compare two builds with EXT_PATH_OVERRIDE.
//
// Run:
//   LIVECAP=1 LIVECAP_URL=<url> [LIVECAP_NAME=name] [LIVECAP_FORMAT=article]
//   [LIVECAP_SCROLLS=0] [LIVECAP_WARM=1] pnpm exec playwright test \
//     -c tests/e2e/playwright.config.ts --project=live-capture-probe
// LIVECAP_WARM=1 uses the warm logged-in Profile 3 (Chrome must be closed).

import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchWithExtension } from '../helpers/launchExtension';
import { activateExtensionOnTab } from '../helpers/activateExtension';
import { buildCastTemplates } from '../helpers/castFromCapture';
import { castShotSafe } from '../helpers/castShot';
import { grantAllSites, hasAllSites, revokeAllSites } from '../helpers/siteAccess';

const OUT = resolve(__dirname, '..', '..', '..', 'test-output');
const URL0 = process.env.LIVECAP_URL ?? '';
const NAME = process.env.LIVECAP_NAME ?? 'livecap';
const out = (s: string) => resolve(OUT, `${NAME}-${s}`);

test('live-capture-probe', async () => {
  test.skip(!process.env.LIVECAP || !URL0, 'set LIVECAP=1 and LIVECAP_URL');
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });

  const { ctx } = process.env.LIVECAP_WARM
    ? await launchWithExtension({
      rawUserDataDir: resolve(__dirname, '..', '..', '..', '.vscode', 'browser-test-profiles', 'chrome'),
      profileDirectory: process.env.PROFILE_DIR ?? 'Profile 3',
      channel: 'chrome', preinstalledExtension: true, headed: !!process.env.PWDEBUG_HEADED,
    })
    : await launchWithExtension({ headed: !!process.env.PWDEBUG_HEADED });
  if (process.env.LIVECAP_GRANT === '1') await grantAllSites(ctx);
  if (process.env.LIVECAP_GRANT === '0') await revokeAllSites(ctx);
  const granted = await hasAllSites(ctx);
  const page = await ctx.newPage();
  const lines: string[] = [];
  const consoleLines: string[] = [];
  page.on('console', m => { const t = m.text(); if (/wirthy/i.test(t)) consoleLines.push(`[${m.type()}] ${t.slice(0, 400)}`); });
  try {
    await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForTimeout(Number(process.env.LIVECAP_WAIT ?? 9_000));
    for (let i = 0; i < Number(process.env.LIVECAP_SCROLLS ?? 0); i++) {
      await page.mouse.move(640, 360);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(5_000);
    }
    lines.push(`url: ${page.url()}  all-sites grant: ${granted}`);
    lines.push('head: ' + JSON.stringify(await page.evaluate(() => ({
      canonical: document.querySelector<HTMLLinkElement>('link[rel=canonical]')?.href,
      ogUrl: document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content,
      ogImage: document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content?.slice(0, 100),
    }))));
    await page.screenshot({ path: out('source.png') });

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
    }), process.env.LIVECAP_FORMAT ?? 'article') as Record<string, unknown>;
    // LIVECAP_TEXT: every element whose OWN text holds this string, with its style.
    if (process.env.LIVECAP_TEXT) {
      lines.push('text hosts: ' + JSON.stringify(await page.evaluate((needle) =>
        Array.from(document.querySelectorAll('body *'))
          .filter(el => Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent ?? '').includes(needle)))
          .map(el => {
            const b = el.getBoundingClientRect();
            const chain: string[] = [];
            for (let a: Element | null = el; a && chain.length < 8; a = a.parentElement) {
              const cs = getComputedStyle(a);
              chain.push(`${a.tagName.toLowerCase()}${a.getAttribute('role') ? '[' + a.getAttribute('role') + ']' : ''}(${Math.round(a.getBoundingClientRect().width)}x${Math.round(a.getBoundingClientRect().height)} ${cs.visibility} op${cs.opacity} ${cs.position} clamp${cs.webkitLineClamp} ovf${cs.overflow})`);
            }
            return { rect: `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`, dx: (el.closest('[class*="dx-"]')?.className ?? '').toString().match(/dx-[\w-]+/g), chain };
          }), process.env.LIVECAP_TEXT), null, 1));
    }
    // Largest elements the tagger excluded on the LIVE page (classes persist there).
    lines.push('largest dx-excl: ' + JSON.stringify(await page.evaluate(() =>
      Array.from(document.querySelectorAll('.dx-excl')).map(el => {
        const b = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), aria: el.getAttribute('aria-label'),
          cls: Array.from(el.classList).filter(c => c.startsWith('dx-')).join(' '),
          rect: `${Math.round(b.width)}x${Math.round(b.height)}`, text: (el.textContent ?? '').length,
          imgs: el.querySelectorAll('img').length, videos: el.querySelectorAll('video').length,
          anchors: el.querySelectorAll('a').length, start: (el.textContent ?? '').trim().slice(0, 50),
        };
      }).sort((a, b) => b.text - a.text).slice(0, 6)), null, 1));
    const html = String(cap.bodyHtml ?? '');
    writeFileSync(out('clip.html'), html.replace(/data:image\/[^"']+/g, 'data:…'), 'utf8');
    const short = (s: unknown) => String(s ?? '').slice(0, 110);
    lines.push(`error: ${cap.error ?? ''}  title: ${cap.title}  format: ${cap.format}  keys: ${Object.keys(cap).join(',')}`);
    lines.push(`thumbnail: ${short(cap.thumbnail)}`);
    lines.push(`thumbnailUrl: ${short(cap.thumbnailUrl)}`);
    lines.push(`imageUrls: ${JSON.stringify((cap.imageUrls as string[] | undefined)?.map(u => u.slice(0, 80)))}`);
    lines.push(`bodyHtml len ${html.length}`);
    for (const m of html.matchAll(/<img[^>]*>/g)) {
      const tag = m[0];
      const attr = (a: string) => tag.match(new RegExp(`\\s${a}="([^"]*)"`))?.[1] ?? '';
      lines.push(`  img class="${attr('class')}" ${attr('width')}x${attr('height')} src=${attr('src').slice(0, 40)} dx-src=${attr('data-dx-src').slice(0, 60)}`);
    }
    lines.push(`play cards: ${JSON.stringify([...html.matchAll(/<a[^>]*class="(?:tweet-video|dx-video-link)[^"]*"[^>]*>/g)].map(m => m[0].match(/href="([^"]*)"/)?.[1]))}`);

    try {
      const t = await buildCastTemplates(page, cap);
      writeFileSync(out('cast.md'), `# kind-1\n${t.noteTemplate.content}\n\n# tags\n${JSON.stringify(t.noteTemplate.tags)}\n\n# kind-30023\n${t.longFormTemplate?.content ?? '(none)'}\n\n# tags\n${JSON.stringify(t.longFormTemplate?.tags ?? [])}`, 'utf8');
      const imgs = [...(t.longFormTemplate?.content ?? '').matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)].map(m => m[1].slice(0, 80));
      lines.push(`cast long-form images: ${JSON.stringify(imgs)}`);
      lines.push(`cast image tag: ${JSON.stringify((t.longFormTemplate?.tags ?? t.noteTemplate.tags).find(x => x[0] === 'image'))}`);
    } catch (e) { lines.push(`cast build failed: ${(e as Error).message}`); }

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
    await lib.waitForTimeout(2_000);
    lines.push('rendered imgs: ' + JSON.stringify(await body.evaluate(el => Array.from(el.querySelectorAll('img')).map(i => {
      const b = i.getBoundingClientRect();
      return `${i.className || '-'} ${Math.round(b.width)}x${Math.round(b.height)} natural ${i.naturalWidth}x${i.naturalHeight}`;
    }))));
    await body.screenshot({ path: out('rendered.png') });
    const card = body.locator('a.tweet-video, a.dx-video-link').first();
    if (await card.count()) {
      await card.click();
      const frame = body.locator('.clip-video-frame');
      await frame.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => undefined);
      lines.push(`player: ${await frame.count() ? await frame.getAttribute('src') : 'NONE (did not play in place)'}`);
      await lib.waitForTimeout(3_000);
      await body.screenshot({ path: out('playing.png') });
    } else {
      lines.push('player: no play card in clip');
    }
    await castShotSafe(page, cap as { title?: string }, out('cast.png'));
  } finally {
    writeFileSync(out('probe.txt'), lines.join('\n'), 'utf8');
    writeFileSync(out('console.txt'), consoleLines.join('\n'), 'utf8');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    await page.close().catch(() => undefined);
    await ctx.close();
  }
});
