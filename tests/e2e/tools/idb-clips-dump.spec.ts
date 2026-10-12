// Dump the most recent clips saved in the warm profile's extension IndexedDB,
// optionally filtered by URL substring. Shows what the REAL overlay flow stored.
//
// Run (Chrome must be closed — warm profile):
//   IDBDUMP=1 [IDBDUMP_MATCH=instagram.com] [IDBDUMP_N=6] pnpm exec playwright test \
//     -c tests/e2e/playwright.config.ts --project=idb-clips-dump

import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchWithExtension } from '../helpers/launchExtension';

const OUT = resolve(__dirname, '..', '..', '..', 'test-output');

test('idb-clips-dump', async () => {
  test.skip(!process.env.IDBDUMP, 'set IDBDUMP=1 to run');
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  const { ctx } = await launchWithExtension({
    rawUserDataDir: resolve(__dirname, '..', '..', '..', '.vscode', 'browser-test-profiles', 'chrome'),
    profileDirectory: process.env.PROFILE_DIR ?? 'Profile 3',
    channel: 'chrome', preinstalledExtension: true,
  });
  try {
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30_000 });
    const clips = await sw.evaluate(({ match, n }) => new Promise<unknown[]>((res, rej) => {
      const req = indexedDB.open('wirthy');
      req.onerror = () => rej(req.error);
      req.onsuccess = () => {
        const all = req.result.transaction('clips').objectStore('clips').getAll();
        all.onsuccess = () => {
          const rows = (all.result as Array<Record<string, any>>)
            .filter(c => !match || String(c.capture?.url ?? '').includes(match))
            .sort((a, b) => (b.capture?.timestamp ?? 0) - (a.capture?.timestamp ?? 0))
            .slice(0, n);
          res(rows);
        };
      };
    }), { match: process.env.IDBDUMP_MATCH ?? '', n: Number(process.env.IDBDUMP_N ?? 6) });
    const lines: string[] = [];
    (clips as Array<Record<string, any>>).forEach((c, i) => {
      const cap = c.capture ?? {};
      const body = String(cap.bodyHtml ?? '');
      writeFileSync(resolve(OUT, `idb-clip-${i}.html`), body.replace(/data:image\/[^"']+/g, 'data:…'), 'utf8');
      lines.push(`#${i} ${new Date(cap.timestamp).toISOString()} ${cap.format} ${cap.url}`);
      lines.push(`   title=${cap.title} bodyLen=${body.length} thumbnail=${String(cap.thumbnail ?? '').slice(0, 70)}`);
      lines.push(`   thumbnailUrl=${String(cap.thumbnailUrl ?? '').slice(0, 90)}`);
      for (const m of body.matchAll(/<img[^>]*>/g)) {
        const attr = (a: string) => m[0].match(new RegExp(`\\s${a}="([^"]*)"`))?.[1] ?? '';
        lines.push(`   img class="${attr('class')}" ${attr('width')}x${attr('height')} src=${attr('src').slice(0, 30)} dx-src=${attr('data-dx-src').slice(0, 70)}`);
      }
      lines.push(`   cards=${JSON.stringify([...body.matchAll(/<a[^>]*class="(?:tweet-video|dx-video-link)[^"]*"[^>]*>/g)].map(x => x[0].match(/href="([^"]*)"/)?.[1]))}`);
    });
    writeFileSync(resolve(OUT, 'idb-clips-dump.txt'), lines.join('\n'), 'utf8');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  } finally {
    await ctx.close();
  }
});
